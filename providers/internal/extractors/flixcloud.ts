// FlixCloud / MegaCloud embed extractor.
// Pipeline (all inputs treated as untrusted data, never executed):
//   1. Fetch the embed page, parse the SvelteKit client bootstrap payload
//   2. Derive obfuscated field names from the payload's seed (SHA-256 chains)
//   3. Fetch the playback token from /api/m3u8/{token}
//   4. Run the host-supplied WASM to derive the key + playlist XOR key
//   5. PBKDF2 + XOR + SHA-256 -> AES-256-CBC decrypt the master playlist URL
// Ported from ultrasrc src/extractors/flixcloud.ts + flixcloud-wasm.ts.

import { Worker } from 'node:worker_threads';
import { parseDataLiteral } from '../parser.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const FRAGMENTS_OFFSET = 1000;
const PLAYLIST_KEY_BYTES = 32;
const WASM_TIMEOUT_MS = 5_000;

export interface FlixCloudResult {
  masterUrl: string;
  playlistKey: string;
  subtitles: Array<{ url: string; lang: string }>;
  headers: Record<string, string>;
  intro?: { start: number; end: number };
  outro?: { start: number; end: number };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64ToUint8(value: string): Uint8Array {
  const buffer = Buffer.from(value, 'base64');
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Resolves the dynamic, obfuscated object/field names from the payload seed. */
async function resolveFields(seed: string) {
  let e = seed;
  for (let s = 0; s < 3; s++) e = await sha256Hex(e + s.toString());
  let a = e;
  for (let s = 0; s < 3; s++) a = await sha256Hex(a + s.toString());
  return {
    videoField: `vf_${e.substring(0, 8)}`,
    keyField: `kf_${e.substring(8, 16)}`,
    ivField: `ivf_${e.substring(16, 24)}`,
    containerName: `cd_${e.substring(24, 32)}`,
    arrayName: `ad_${e.substring(32, 40)}`,
    objectName: `od_${e.substring(40, 48)}`,
    tokenField: `${e.substring(48, 64)}_${e.substring(56, 64)}`,
    keyFrag2Field: `${a.substring(0, 16)}_${a.substring(16, 24)}`,
  };
}

/**
 * Runs the host-supplied WASM in a worker thread so a runaway module cannot block
 * the event loop. The module gets no imports, so it cannot reach the host.
 */
function runWasm(wasmBase64: string, frag1B64: string, frag2B64: string, tokenKeyB64: string, seed: string): Promise<{ derivedKey: string; playlistKey: string }> {
  return new Promise((resolve, reject) => {
    const source = `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        try {
          const { wasm, frag1, frag2, tokenKey, seed } = workerData;
          const f1 = Buffer.from(frag1, 'base64');
          const f2 = Buffer.from(frag2, 'base64');
          const tk = Buffer.from(tokenKey, 'base64');
          const size = f1.length;
          if (!size || f2.length !== size || tk.length !== size) throw new Error('mismatched key fragment lengths');

          const { instance } = await WebAssembly.instantiate(Buffer.from(wasm, 'base64'), {});
          const { memory, _s, _r, _c } = instance.exports;
          if (!(memory instanceof WebAssembly.Memory) || typeof _s !== 'function' || typeof _r !== 'function' || typeof _c !== 'function') {
            throw new Error('WASM missing required exports');
          }
          if (memory.buffer.byteLength === 0) memory.grow(1);

          const frag2Offset = 1000 + size;
          const tokenKeyOffset = frag2Offset + size;
          const outputOffset = tokenKeyOffset + size;
          if (outputOffset + size > memory.buffer.byteLength) throw new Error('key fragments do not fit in WASM memory');

          const view = new Uint8Array(memory.buffer);
          view.set(f1, 1000);
          view.set(f2, frag2Offset);
          view.set(tk, tokenKeyOffset);

          _s(parseInt(String(seed).substring(0, 8), 16));
          _r(1000, frag2Offset, tokenKeyOffset, outputOffset, size);
          const playlistKeyOffset = _c();

          // Re-read: the module may have grown memory, detaching the old view.
          const after = new Uint8Array(memory.buffer);
          const playlistKey = after.slice(playlistKeyOffset, playlistKeyOffset + 32);
          if (playlistKey.length !== 32) throw new Error('playlist key outside WASM memory');

          parentPort.postMessage({
            derivedKey: Buffer.from(after.subarray(outputOffset, outputOffset + size)).toString('base64'),
            playlistKey: Buffer.from(playlistKey).toString('base64'),
          });
        } catch (error) {
          parentPort.postMessage({ error: String(error && error.message || error) });
        }
      })();
    `;

    const worker = new Worker(source, {
      eval: true,
      workerData: { wasm: wasmBase64, frag1: frag1B64, frag2: frag2B64, tokenKey: tokenKeyB64, seed },
    });

    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`flixcloud: WASM exceeded ${WASM_TIMEOUT_MS}ms`));
    }, WASM_TIMEOUT_MS);

    worker.on('message', (message: any) => {
      clearTimeout(timer);
      void worker.terminate();
      if (message?.error) reject(new Error(`flixcloud: WASM failed: ${message.error}`));
      else resolve({ derivedKey: message.derivedKey, playlistKey: message.playlistKey });
    });
    worker.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`flixcloud: WASM worker error: ${error.message}`));
    });
  });
}

/** Decrypts a FlixCloud XOR-scrambled m3u8 playlist with the derived 32-byte key. */
export function decryptFlixPlaylist(encText: string, playlistKeyB64: string): string {
  const trimmed = encText.trim();
  if (trimmed.startsWith('#EXTM3U')) return trimmed;
  const key = Buffer.from(playlistKeyB64, 'base64');
  if (key.length !== 32) throw new Error('flixcloud: playlist key must be 32 bytes');
  const encrypted = Buffer.from(trimmed, 'base64');
  const out = Buffer.alloc(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) out[i] = encrypted[i] ^ key[i % key.length];
  return out.toString('utf8');
}

export async function extractFlixCloud(
  embedUrl: string,
  headers: Record<string, string> = {},
): Promise<FlixCloudResult> {
  const urlObj = new URL(embedUrl);

  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': UA,
      Referer: `${urlObj.origin}/`,
      ...headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`flixcloud: embed fetch failed: HTTP ${res.status}`);

  const html = await res.text();
  const kitMatch = /kit\.start\(app, element, (\{[\s\S]*?\})\);\s*\}\);/.exec(html);
  if (!kitMatch) throw new Error('flixcloud: no SvelteKit bootstrap payload in HTML');

  const kitData = parseDataLiteral(kitMatch[1]) as any;
  const rData = kitData?.data?.[2]?.data;
  if (!rData) throw new Error('flixcloud: missing r.data in payload');

  const seed = rData.obfuscation_seed;
  if (!seed || typeof seed !== 'string') throw new Error('flixcloud: missing obfuscation_seed');

  const fields = await resolveFields(seed);
  const container = rData.obfuscated_crypto_data?.[fields.containerName];
  const array = container?.[fields.arrayName];
  const obj = array?.[0]?.[fields.objectName];
  const frag1 = obj?.[fields.keyField];
  const ivB64 = obj?.[fields.ivField];
  const frag2 = rData[fields.keyFrag2Field];
  const tokenVal = rData[fields.tokenField];

  if (!frag1 || !ivB64 || !frag2 || !tokenVal) {
    throw new Error('flixcloud: incomplete crypto fragments in payload');
  }

  const tokenRes = await fetch(`${urlObj.origin}/api/m3u8/${tokenVal}`, {
    headers: { 'User-Agent': UA, Referer: embedUrl, Accept: 'application/json, text/plain, */*' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new Error(`flixcloud: token fetch failed: HTTP ${tokenRes.status}`);

  const tokenJson = await tokenRes.json() as Record<string, string>;
  const vidKey = (await sha256Hex(tokenVal + 'vid')).substring(0, 10);
  const keyKey = (await sha256Hex(tokenVal + 'key')).substring(0, 10);
  const cipherL = tokenJson[vidKey];
  const tokenKeyV = tokenJson[keyKey];
  if (!cipherL || !tokenKeyV) throw new Error('flixcloud: incomplete token response');

  if (typeof rData.w_payload !== 'string' || !rData.w_payload) {
    throw new Error('flixcloud: missing w_payload');
  }

  const { derivedKey, playlistKey } = await runWasm(rData.w_payload, frag1, frag2, tokenKeyV, seed);
  const H = b64ToUint8(derivedKey);

  const qKey = await crypto.subtle.importKey('raw', H as Buffer, { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(seed), iterations: 1000, hash: 'SHA-256' },
    qKey,
    256,
  );

  const J = new Uint8Array(derivedBits);
  for (let i = 0; i < 32; i++) J[i] ^= seed.charCodeAt(i % seed.length);

  const aesKeyBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', J));
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: b64ToUint8(ivB64) as Buffer },
    aesKey,
    b64ToUint8(cipherL) as Buffer,
  );

  const masterUrl = new TextDecoder().decode(decrypted).trim();
  if (!masterUrl) throw new Error('flixcloud: decrypted stream URL is empty');

  const subtitles: Array<{ url: string; lang: string }> = [];
  if (Array.isArray(rData.subtitles)) {
    for (const sub of rData.subtitles) {
      if (sub?.url && sub?.language) {
        subtitles.push({ url: String(sub.url), lang: String(sub.language) });
      }
    }
  }

  return {
    masterUrl,
    playlistKey,
    subtitles,
    headers: { 'User-Agent': UA, Referer: `${urlObj.origin}/`, ...headers },
    intro: rData.intro,
    outro: rData.outro,
  };
}