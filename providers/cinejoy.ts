// CineJoy movie/TV provider — direct HLS/MP4 streams via a WASM-sealed gateway.
// Upstream: cinejoy.to → api.wing.st. Requests are sealed inside the host's
// `crush.wasm` (alloc/seal_request/dealloc) producing an ECIES P-256 envelope;
// responses come back AES-256-GCM encrypted with a key the WASM emitted. The
// WASM is fetched at runtime, compiled with zero imports, so it cannot reach
// the host. Ported faithfully from ultrasrc src/providers/movies/cinejoy.ts.

import { createDecipheriv, randomBytes } from 'node:crypto';
import { attachSubtitles } from './internal/normalizer.js';
import { detectFormat, isSafeHttpUrl, normalizeQuality, uniqueBy } from './internal/utils.js';
import type { MovieProviderInput, TvProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const DEFAULT_GATEWAY = 'https://api.wing.st';
const APPROVED_GATEWAYS = new Set(['https://api.wing.st', 'https://api.shegu.st']);
const ORIGIN = 'https://cinejoy.to';
// Domain separation string bound into the GCM AAD alongside the key envelope.
const DOMAIN = Buffer.from('lumen-gate-v2', 'utf8');
const MAX_WASM_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

// Default server list when the caller does not pin one.
const SERVERS = ['Lisbon', 'Nebula'];

const SUBS_ENDPOINT = 'https://subs.wing.st/subtitles';
const MAX_SUBTITLES = 10;

type SealerExports = {
  memory: WebAssemblyMemory;
  alloc(size: number): number;
  dealloc(pointer: number, size: number): void;
  seal_request(
    plainPointer: number,
    plainLength: number,
    seedPointer: number,
    seedLength: number,
    outPointer: number,
    outCapacity: number,
  ): number;
};

// Minimal structural typings for the global WebAssembly API (this project's
// tsconfig has no DOM lib, so the standard namespace isn't declared).
interface WasmModule { exports: unknown }
interface WasmGlobal {
  compile(bytes: unknown): Promise<WasmModule>;
  Module: {
    imports(module: WasmModule): Array<{ name: string }>;
    exports(module: WasmModule): Array<{ name: string }>;
  };
  instantiate(module: WasmModule, imports?: Record<string, unknown>): Promise<{ exports: unknown }>;
}
type WebAssemblyMemory = { buffer: ArrayBuffer };

/** Keeps the gateway pinned to an approved origin (prevents SSRF via config). */
function gatewayUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid CINEJOY_GATEWAY');
  }
  if (!APPROVED_GATEWAYS.has(parsed.origin) || raw.replace(/\/$/, '') !== parsed.origin) {
    throw new Error(`CINEJOY_GATEWAY must be one of: ${[...APPROVED_GATEWAYS].join(', ')}`);
  }
  return parsed.origin;
}

/** Fetch with a hard byte cap so a hostile/large upstream cannot exhaust memory. */
async function boundedFetch(url: string, init: RequestInit = {}, limit = MAX_RESPONSE_BYTES): Promise<Buffer> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > limit) {
    throw new Error('CineJoy upstream response exceeds size limit');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error('CineJoy upstream response exceeds size limit');
  return bytes;
}

/** Builds the GCM additional-authenticated-data: domain || keyId || publicKey. */
function buildAad(keyId: number, publicKey: Buffer): Buffer {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('CineJoy returned an invalid P-256 public key');
  return Buffer.concat([DOMAIN, Buffer.from([0, 2, keyId]), publicKey]);
}

/** Seals a JSON payload with the host WASM, returning the response key + body + AAD. */
function sealRequest(wasm: SealerExports, payload: object) {
  const plaintext = Buffer.from(JSON.stringify(payload));
  const seed = randomBytes(44);
  const capacity = plaintext.length + 512;
  const allocations: Array<[number, number]> = [];
  const alloc = (size: number) => {
    const pointer = wasm.alloc(size);
    if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + size > wasm.memory.buffer.byteLength) {
      throw new Error('CineJoy WASM returned an invalid memory allocation');
    }
    allocations.push([pointer, size]);
    return pointer;
  };
  try {
    const plainPointer = alloc(plaintext.length);
    const seedPointer = alloc(seed.length);
    const outPointer = alloc(capacity);
    new Uint8Array(wasm.memory.buffer).set(plaintext, plainPointer);
    new Uint8Array(wasm.memory.buffer).set(seed, seedPointer);
    const length = wasm.seal_request(plainPointer, plaintext.length, seedPointer, seed.length, outPointer, capacity);
    if (!Number.isSafeInteger(length) || length <= 98 || length > capacity || outPointer + length > wasm.memory.buffer.byteLength) {
      throw new Error('CineJoy WASM returned an invalid request envelope');
    }
    const sealed = Buffer.from(new Uint8Array(wasm.memory.buffer).slice(outPointer, outPointer + length));
    const keyId = sealed[32];
    const publicKey = sealed.subarray(33, 98);
    const body = sealed.subarray(98);
    if (body.length < 92 || body[0] !== 2 || body[1] !== keyId || body[2] !== 4 || !body.subarray(2, 67).equals(publicKey)) {
      throw new Error('CineJoy WASM returned an unexpected request envelope');
    }
    return { responseKey: sealed.subarray(0, 32), body, aad: buildAad(keyId, publicKey) };
  } finally {
    for (const [pointer, size] of allocations.reverse()) wasm.dealloc(pointer, size);
  }
}

/** Decrypts an AES-256-GCM gateway response (nonce || ciphertext || tag). */
function decryptResponse(bytes: Buffer, key: Buffer, aad: Buffer): unknown {
  if (key.length !== 32 || bytes.length < 28) throw new Error('CineJoy returned an invalid encrypted response');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(aad);
  decipher.setAuthTag(bytes.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/** Recursively collects supported playback URLs, skipping poster/artwork fields. */
function collectUrls(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || value == null) return out;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && !out.includes(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^(poster|cover|image|thumbnail|logo|artwork)$/i.test(key)) continue;
      collectUrls(child, out, depth + 1);
    }
  }
  return out;
}

/** Depth-first search for the first non-null value under any of the given keys. */
function findValue(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 8 || value == null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) if (record[key] != null) return record[key];
  for (const child of Object.values(record)) {
    const found = findValue(child, keys, depth + 1);
    if (found != null) return found;
  }
  return undefined;
}

function normalizeSubtitles(value: unknown): RawSubtitle[] {
  if (!Array.isArray(value)) return [];
  const out: RawSubtitle[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === 'string' ? row.url : typeof row.file === 'string' ? row.file : '';
    if (!isSafeHttpUrl(url)) continue;
    const language = row.language == null ? 'English' : String(row.language);
    out.push({
      url,
      language,
      language_code: language.slice(0, 2).toLowerCase() || 'en',
      format: /\.srt($|[?#])/i.test(url) || String(row.format) === 'srt' ? 'srt' : 'vtt',
      provider: 'cinejoy',
    });
  }
  return uniqueBy(out, s => s.url);
}

/** Fetches the wing.st subtitle list, ranked English-first with duplicates capped. */
async function fetchWingSubtitles(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<RawSubtitle[]> {
  const params = new URLSearchParams({ type, tmdb: String(tmdbId) });
  if (type === 'tv') {
    params.set('season', String(season ?? 1));
    params.set('episode', String(episode ?? 1));
  }
  const response = await fetch(`${SUBS_ENDPOINT}?${params}`, {
    headers: { Accept: '*/*', Referer: `${ORIGIN}/` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`subs.wing.st -> HTTP ${response.status}`);
  const rows = (await response.json()) as { subtitles?: Array<Record<string, unknown>> };
  const entries = Array.isArray(rows.subtitles) ? rows.subtitles : [];
  const ranked = [...entries].sort(
    (a, b) => (String(a.language || '').toLowerCase() === 'en' ? 0 : 1) - (String(b.language || '').toLowerCase() === 'en' ? 0 : 1),
  );
  const out: RawSubtitle[] = [];
  const languages = new Set<string>();
  let englishCount = 0;
  for (const row of ranked) {
    const url = typeof row.url === 'string' ? row.url : '';
    const language = String(row.language || 'en').toLowerCase();
    if (!isSafeHttpUrl(url) || out.length >= MAX_SUBTITLES) continue;
    if (language === 'en') {
      if (englishCount >= 4) continue;
      englishCount++;
    } else if (languages.has(language)) continue;
    languages.add(language);
    out.push({
      url,
      language: String(row.display || `CineJoy ${language.toUpperCase()} subtitles`).replace(/\.srt$/i, ''),
      language_code: language.slice(0, 2) || 'en',
      format: String(row.type || 'srt') === 'srt' ? 'srt' : 'vtt',
      provider: 'cinejoy',
    });
  }
  return out;
}

function isTvInput(input: MovieProviderInput | TvProviderInput): input is TvProviderInput {
  return 'season' in input && 'episode' in input;
}

/**
 * Resolves CineJoy streams. The gateway + WASM are fetched once per call; each
 * server in the list is tried independently and failures are collected so the
 * error message names every attempted server.
 */
export async function getCinejoyStreams(input: MovieProviderInput | TvProviderInput): Promise<RawStream[]> {
  try {
    if (!input.tmdb_id) return [];
    const isTv = isTvInput(input);
    const type: 'movie' | 'tv' = isTv ? 'tv' : 'movie';

    const gateway = gatewayUrl(process.env.CINEJOY_GATEWAY || DEFAULT_GATEWAY);

    // Fetch + compile the sealer WASM (no imports => cannot call back into host).
    const wasmBytes = await boundedFetch(`${gateway}/crush.wasm`, {}, MAX_WASM_BYTES);
    const WebAssemblyGlobal = globalThis as unknown as { WebAssembly?: WasmGlobal };
    const wasmGlobal = WebAssemblyGlobal.WebAssembly;
    if (!wasmGlobal) throw new Error('CineJoy: WebAssembly runtime unavailable');
    const compiled = await wasmGlobal.compile(wasmBytes);
    if (wasmGlobal.Module.imports(compiled).length) throw new Error('CineJoy WASM has unexpected imports');
    const exportNames = new Set(wasmGlobal.Module.exports(compiled).map(item => item.name));
    for (const name of ['memory', 'alloc', 'dealloc', 'seal_request']) {
      if (!exportNames.has(name)) throw new Error(`CineJoy WASM is missing ${name}`);
    }
    const instance = await wasmGlobal.instantiate(compiled, {});
    const wasm = instance.exports as unknown as SealerExports;

    // Base payload shared by every server attempt.
    const payload: Record<string, string> = { tmdb: String(input.tmdb_id) };
    if (type === 'tv') {
      payload.season = String((input as TvProviderInput).season ?? 1);
      payload.episode = String((input as TvProviderInput).episode ?? 1);
    }
    if (input.title?.trim()) payload.title = input.title.trim();
    if (input.year != null) payload.year = String(input.year);
    const mediaType = type === 'tv' ? 'series' : 'movie';

    const responses: unknown[] = [];
    const failures: string[] = [];
    for (const server of SERVERS) {
      try {
        const sealed = sealRequest(wasm, { path: `/${server}/${mediaType}`, mediaType, payload });
        const encrypted = await boundedFetch(`${gateway}/g`, {
          method: 'POST',
          headers: {
            Accept: '*/*',
            Origin: ORIGIN,
            Referer: `${ORIGIN}/`,
            'Content-Type': 'text/plain;charset=UTF-8',
            'User-Agent': UA,
          },
          body: sealed.body as unknown as string,
        });
        const response = decryptResponse(encrypted, sealed.responseKey, sealed.aad);
        const status = findValue(response, ['status']);
        if (typeof status === 'number' && status >= 400) throw new Error(`CineJoy resolver returned status ${status}`);
        responses.push(response);
      } catch (serverError) {
        failures.push(`${server}: ${serverError instanceof Error ? serverError.message : String(serverError)}`);
      }
    }

    if (!responses.length) throw new Error(failures.join(' | ') || 'CineJoy returned no playable response');

    const playable = new Set<string>();
    for (const response of responses) {
      for (const url of collectUrls(response)) {
        if (/\.(?:m3u8|mpd|mp4|m4v|webm)(?:[?#]|$)/i.test(url) && isSafeHttpUrl(url)) playable.add(url);
      }
    }
    if (!playable.size) throw new Error('CineJoy response contained no supported playback URLs');

    const streams: RawStream[] = [];
    for (const url of playable) {
      const format = detectFormat(url);
      if (format === 'unknown') continue;
      streams.push({
        url,
        format,
        quality: normalizeQuality(url),
        audio: 'Original',
        provider: 'cinejoy',
        headers: { 'User-Agent': UA, Referer: `${ORIGIN}/` },
      });
    }

    // Subtitles: embedded in the first response, plus the wing.st list.
    const subtitles = normalizeSubtitles(findValue(responses[0], ['subtitles', 'tracks']));
    try {
      for (const row of await fetchWingSubtitles(type, input.tmdb_id, isTv ? input.season : undefined, isTv ? input.episode : undefined)) {
        if (!subtitles.some(sub => sub.url === row.url)) subtitles.push(row);
      }
    } catch { /* subtitles are optional */ }

    return attachSubtitles(uniqueBy(streams, s => `${s.url}:${s.quality}`), uniqueBy(subtitles, s => s.url));
  } catch (error) {
    console.error(`CineJoy error: ${String(error)}`);
    return [];
  }
}
