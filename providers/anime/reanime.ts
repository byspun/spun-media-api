import { attachSubtitles } from '../normalizer.js';
import { buildTitles, dedupeStreams, dedupeSubtitles, fetchJson, fetchText, getAniListMedia, safeStream, safeSubtitle, bestTitleScore, UA } from './anivexa-utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from '../shared/types.js';

const BASE = 'https://reanime.to';
const FLIX = 'https://flixcloud.cc';
const ANIZIP = 'https://api.ani.zip/mappings';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function sha256hex(value: string | Uint8Array): Promise<string> {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function b64toU8(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i);
  return output;
}

async function deriveFields(seed: string) {
  let first = seed;
  for (let i = 0; i < 3; i++) first = await sha256hex(first + i);
  let second = first;
  for (let i = 0; i < 3; i++) second = await sha256hex(second + i);
  return {
    keyField: `kf_${first.slice(8, 16)}`,
    ivField: `ivf_${first.slice(16, 24)}`,
    containerName: `cd_${first.slice(24, 32)}`,
    arrayName: `ad_${first.slice(32, 40)}`,
    objectName: `od_${first.slice(40, 48)}`,
    tokenField: `${first.slice(48, 64)}_${first.slice(56, 64)}`,
    keyFrag2Field: `${second.slice(0, 16)}_${second.slice(16, 24)}`,
  };
}

function extractSsrObj(html: string): string {
  const marker = html.match(/\{type:"data",data:(\{)/);
  if (!marker || marker.index === undefined) throw new Error('Reanime SSR data block not found');
  const start = html.indexOf('{', marker.index + marker[0].length - 1);
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('Reanime SSR brace matching failed');
}

function parseJsLiteral(source: string): any {
  let index = 0;
  const whitespace = () => { while (/\s/.test(source[index] ?? '')) index++; };
  const stringValue = (quote: string) => {
    let value = '';
    index++;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\') {
        index++;
        const escaped = source[index++];
        value += ({ n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\' } as Record<string, string>)[escaped] ?? escaped;
      } else value += source[index++];
    }
    index++;
    return value;
  };
  const keyValue = () => {
    whitespace();
    if (source[index] === '"' || source[index] === "'") return stringValue(source[index]);
    const match = source.slice(index).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (!match) throw new Error(`Reanime invalid object key at ${index}`);
    index += match[0].length;
    return match[0];
  };
  const value = (): any => {
    whitespace();
    if (source[index] === '{') return objectValue();
    if (source[index] === '[') return arrayValue();
    if (source[index] === '"' || source[index] === "'") return stringValue(source[index]);
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null], ['undefined', null], ['!0', true], ['!1', false]] as const) {
      if (source.startsWith(literal, index)) { index += literal.length; return parsed; }
    }
    const number = source.slice(index).match(/^-?[\d.]+(?:[eE][+-]?\d+)?/);
    if (number) { index += number[0].length; return Number(number[0]); }
    throw new Error(`Reanime invalid literal at ${index}`);
  };
  const objectValue = () => {
    const result: Record<string, any> = {};
    index++;
    whitespace();
    while (index < source.length && source[index] !== '}') {
      if (source[index] === ',') { index++; whitespace(); continue; }
      const key = keyValue();
      whitespace();
      if (source[index] !== ':') throw new Error(`Reanime missing colon at ${index}`);
      index++;
      result[key] = value();
      whitespace();
    }
    index++;
    return result;
  };
  const arrayValue = () => {
    const result: any[] = [];
    index++;
    whitespace();
    while (index < source.length && source[index] !== ']') {
      if (source[index] === ',') { index++; whitespace(); continue; }
      result.push(value());
      whitespace();
    }
    index++;
    return result;
  };
  return value();
}

function parseWasmDecrypt(wasmBytes: Uint8Array) {
  let position = 8;
  while (position < wasmBytes.length) {
    const sectionId = wasmBytes[position++];
    let size = 0; let shift = 0; let byte = 0;
    do { byte = wasmBytes[position++]; size |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    if (sectionId === 10) { position++; let bodySize = 0; let bodyShift = 0; let bodyByte = 0; do { bodyByte = wasmBytes[position++]; bodySize |= (bodyByte & 127) << bodyShift; bodyShift += 7; } while (bodyByte & 128); position += bodySize; break; }
    position += size;
  }
  let resultSize = 0; let resultShift = 0; let resultByte = 0;
  do { resultByte = wasmBytes[position++]; resultSize |= (resultByte & 127) << resultShift; resultShift += 7; } while (resultByte & 128);
  const code = wasmBytes.slice(position, position + resultSize);
  let lebPosition = 0;
  const leb = (array: Uint8Array, at: number): [number, number] => { let result = 0; let shift = 0; let byte = 0; do { byte = array[at++]; result |= (byte & 127) << shift; shift += 7; } while (byte & 128); return [result, at]; };
  const xorEnd = [32, 2, 32, 5, 106, 45, 0, 0, 115, 33, 6];
  let transformStart = -1;
  outer: for (let i = 0; i < code.length - xorEnd.length; i++) { for (let j = 0; j < xorEnd.length; j++) if (code[i + j] !== xorEnd[j]) continue outer; transformStart = i + xorEnd.length; break; }
  if (transformStart < 0) throw new Error('Reanime WASM transform start not found');
  let transformEnd = -1; let step = 36;
  for (let i = transformStart; i < code.length - 4; i++) if (code[i] === 32 && code[i + 1] === 5 && code[i + 2] === 65) { const [value, next] = leb(code, i + 3); if (code[next] === 108) { transformEnd = i; step = value; break; } }
  if (transformEnd < 0) throw new Error('Reanime WASM keystream not found');
  const transformCode = code.slice(transformStart, transformEnd);
  return { step, transform(inputByte: number) {
    let local = inputByte & 255; const stack: number[] = []; lebPosition = 0;
    while (lebPosition < transformCode.length) {
      const op = transformCode[lebPosition++];
      if (op === 32) { const [idx, next] = leb(transformCode, lebPosition); lebPosition = next; stack.push(idx === 6 ? local : 0); }
      else if (op === 33) { const [idx, next] = leb(transformCode, lebPosition); lebPosition = next; const value = stack.pop() ?? 0; if (idx === 6) local = value & 255; }
      else if (op === 65) { const [value, next] = leb(transformCode, lebPosition); lebPosition = next; stack.push(value); }
      else { const right = stack.pop() ?? 0; const left = stack.pop() ?? 0; if (op === 106) stack.push((left + right) & 255); else if (op === 107) stack.push((left - right + 256) & 255); else if (op === 113) stack.push(left & right & 255); else if (op === 114) stack.push((left | right) & 255); else if (op === 115) stack.push((left ^ right) & 255); else if (op === 116) stack.push((left << (right & 7)) & 255); else if (op === 118) stack.push((left >>> (right & 7)) & 255); }
    }
    return local;
  } };
}

function runDecrypt(wasmBytes: Uint8Array, fragment: Uint8Array, keyFragment: Uint8Array, tokenBytes: Uint8Array, seedInt: number): Uint8Array {
  const { step, transform } = parseWasmDecrypt(wasmBytes);
  const output = new Uint8Array(fragment.length);
  for (let i = 0; i < fragment.length; i++) output[i] = transform((fragment[i] ^ keyFragment[i] ^ tokenBytes[i]) & 255) ^ (i * step + seedInt) & 255;
  return output;
}

async function decryptEmbed(html: string): Promise<{ url: string; subtitles: any[] }> {
  const data = parseJsLiteral(extractSsrObj(html));
  const seed = String(data.obfuscation_seed ?? '');
  if (!seed) throw new Error('Reanime obfuscation seed missing');
  const fields = await deriveFields(seed);
  const container = data.obfuscated_crypto_data?.[fields.containerName];
  const array = container?.[fields.arrayName];
  const object = array?.[0]?.[fields.objectName];
  const fragment = object?.[fields.keyField] ? b64toU8(object[fields.keyField]) : null;
  const iv = object?.[fields.ivField] ? b64toU8(object[fields.ivField]) : null;
  const keyFragmentRaw = data[fields.keyFrag2Field];
  const token = data[fields.tokenField];
  if (!fragment || !iv || !keyFragmentRaw || !token) throw new Error('Reanime encrypted embed fields missing');
  const tokenData = await fetchJson<any>(`${FLIX}/api/m3u8/${encodeURIComponent(token)}`, { Referer: `${BASE}/` });
  const videoKey = (await sha256hex(`${token}vid`)).slice(0, 10);
  const keyKey = (await sha256hex(`${token}key`)).slice(0, 10);
  const tokenVideo = b64toU8(tokenData[videoKey]);
  const tokenBytes = b64toU8(tokenData[keyKey]);
  const wasmPayload = b64toU8(data.w_payload ?? '');
  const decryptedWasm = runDecrypt(wasmPayload, fragment, b64toU8(keyFragmentRaw), tokenBytes, parseInt(seed.slice(0, 8), 16));
  const keyMaterial = await crypto.subtle.importKey('raw', decryptedWasm, { name: 'PBKDF2' }, false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(seed), iterations: 1000, hash: 'SHA-256' }, keyMaterial, 256));
  for (let i = 0; i < 32; i++) derived[i] ^= seed.charCodeAt(i % seed.length);
  const aesKeyBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', derived));
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aesKey, tokenVideo);
  const url = decoder.decode(plain).trim().replace(/\0+$/, '');
  if (!/^https?:\/\//.test(url)) throw new Error('Reanime decrypted URL invalid');
  return { url, subtitles: Array.isArray(data.subtitles) ? data.subtitles : [] };
}

async function searchReanime(query: string): Promise<any[]> {
  const data = await fetchJson<any>(`${BASE}/api/v1/search?${new URLSearchParams({ q: query, limit: '10' })}`);
  return Array.isArray(data?.results) ? data.results : [];
}

async function resolveSeries(input: AnimeProviderInput, media: any): Promise<{ animeId: string; title: string }> {
  const titles = buildTitles(media, input).slice(0, 5);
  const candidates = new Map<string, any>();
  for (const title of titles) for (const item of await searchReanime(title).catch(() => [])) if (item?.anime_id) candidates.set(String(item.anime_id), item);
  for (const candidate of candidates.values()) {
    const cover = [candidate.cover_image?.extra_large, candidate.cover_image?.large, candidate.cover_image?.medium].filter(Boolean).join(' ');
    const coverId = cover.match(/anilist\.co\/.*\/bx(\d+)-/)?.[1];
    if (coverId && Number(coverId) === input.anilist_id) return { animeId: String(candidate.anime_id), title: candidate.title?.english || candidate.title?.romaji || String(candidate.anime_id) };
  }
  for (const candidate of candidates.values()) {
    const detail = await fetchJson<any>(`${BASE}/api/v1/anime/${encodeURIComponent(String(candidate.anime_id))}`).catch(() => null);
    if (Number(detail?.anilist_id) === input.anilist_id || (!detail?.anilist_id && Number(detail?.mal_id) === Number(media?.idMal))) return { animeId: String(candidate.anime_id), title: detail?.title?.english || detail?.title?.romaji || candidate.title?.english || String(candidate.anime_id) };
  }
  const fallback = [...candidates.values()].sort((a, b) => bestTitleScore(b.title?.english || b.title?.romaji || '', titles) - bestTitleScore(a.title?.english || a.title?.romaji || '', titles))[0];
  if (!fallback || bestTitleScore(fallback.title?.english || fallback.title?.romaji || '', titles) < 0.8) throw new Error('Reanime match not found');
  return { animeId: String(fallback.anime_id), title: fallback.title?.english || fallback.title?.romaji || String(fallback.anime_id) };
}

export async function getReanimeStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    const media = await getAniListMedia(input.anilist_id);
    if (!media) return [];
    const series = await resolveSeries(input, media);
    const [watchData, flixData] = await Promise.all([
      fetchJson<any>(`${BASE}/api/watch/${encodeURIComponent(series.animeId)}/${input.episode}`).catch(() => null),
      fetchJson<any>(`${BASE}/api/flix/${input.anilist_id}/${input.episode}`).catch(() => null),
    ]);
    const links = [...(Array.isArray(watchData?.episode_links) ? watchData.episode_links : [])];
    const seen = new Set(links.map((value: any) => value?.$id));
    for (const server of Array.isArray(flixData?.servers) ? flixData.servers : []) if (!seen.has(server?.$id)) links.push(server);
    const wanted = input.dub ? ['dub', 's-dub'] : ['sub', 's-sub'];
    const servers = links.filter((value: any) => wanted.includes(String(value?.dataType))).sort((a: any, b: any) => ({ 'HD-2': 0, 'HD-1': 1 }[a?.serverName] ?? 9) - ({ 'HD-2': 0, 'HD-1': 1 }[b?.serverName] ?? 9));
    if (!servers.length || !servers[0]?.dataLink) return [];
    const embed = await fetchText(String(servers[0].dataLink), { Referer: `${BASE}/` });
    const streamData = await decryptEmbed(embed);
    const stream = safeStream({ url: streamData.url, type: 'hls', quality: 'auto' }, 'reanime', input.dub ? 'English' : 'Japanese', 'hls', { Referer: `${new URL(streamData.url).origin}/`, 'User-Agent': UA });
    const subtitles: RawSubtitle[] = streamData.subtitles.map((value: any) => safeSubtitle(value, 'reanime')).filter(Boolean) as RawSubtitle[];
    return attachSubtitles(stream ? dedupeStreams([stream]) : [], dedupeSubtitles(subtitles));
  } catch {
    return [];
  }
}
