import CryptoJS from 'crypto-js';
import { detectFormat, isSafeHttpUrl, normalizeQuality, uniqueBy } from '../mapper.js';
import { attachSubtitles } from '../normalizer.js';
import type { MovieProviderInput, RawStream, RawSubtitle } from '../shared/types.js';

const BASE = 'https://api.hlowb.com';
const PKG = 'com.external.castle';
const CHANNEL = 'IndiaA';
const CLIENT = '1';
const LANG = 'en-US';
const HEADERS = { 'User-Agent': 'okhttp/4.9.3', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Referer: BASE };
const PLAYBACK = { Referer: BASE, 'User-Agent': 'Mozilla/5.0' };

async function request(url: string, init: RequestInit = {}): Promise<Response> { const response = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response; }
async function cipher(url: string, init?: RequestInit): Promise<string> { const response = await request(url, init); const text = (await response.text()).trim(); try { const data = JSON.parse(text); return String(data?.data ?? text); } catch { return text; } }
function decrypt(value: string, securityKey: string): any { const keyMaterial = CryptoJS.enc.Base64.parse(securityKey).concat(CryptoJS.enc.Utf8.parse('T!BgJB')); const key = CryptoJS.lib.WordArray.create(keyMaterial.words.slice(0, 4), 16); const plain = CryptoJS.AES.decrypt(value, key, { iv: key, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8); return JSON.parse(plain); }
function data(value: any): any { return value?.data && typeof value.data === 'object' ? value.data : value ?? {}; }
function q(value: unknown): any { const text = String(value ?? ''); return text.includes('2160') || text.includes('4K') ? '4k' : normalizeQuality(text); }
function sub(value: any): RawSubtitle | null { if (!isSafeHttpUrl(value?.url)) return null; return { url: value.url, language: String(value.abbreviate ?? value.title ?? 'Unknown'), language_code: String(value.abbreviate ?? 'und').toLowerCase(), format: 'vtt', provider: 'castle' }; }

export async function getCastleStreams(input: MovieProviderInput, tmdbApiKey: string): Promise<RawStream[]> {
  try {
    const endpoint = `${input.tmdb_id}`;
    const tmdb: any = await fetch(`${tmdbApiKey ? 'https://api.themoviedb.org/3/movie/' : ''}${endpoint}?api_key=${encodeURIComponent(tmdbApiKey)}&append_to_response=external_ids`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
    const title = String(tmdb.title ?? input.title); const year = String(tmdb.release_date ?? input.year ?? '').slice(0, 4);
    const keyResponse = await request(`${BASE}/v0.1/system/getSecurityKey/1?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}`); const keyPayload: any = await keyResponse.json(); const securityKey = String(keyPayload.data);
    const searchUrl = `${BASE}/film-api/v1.1.0/movie/searchByKeyword?${new URLSearchParams({ channel: CHANNEL, clientType: CLIENT, keyword: year ? `${title} ${year}` : title, lang: LANG, mode: '1', packageName: PKG, page: '1', size: '30' })}`;
    const search = data(decrypt(await cipher(searchUrl), securityKey)); const row = (search.rows ?? []).find((item: any) => String(item.title ?? item.name ?? '').toLowerCase().includes(title.toLowerCase())) ?? search.rows?.[0]; const movieId = row?.id ?? row?.redirectId ?? row?.redirectIdStr; if (!movieId) return [];
    const details = data(decrypt(await cipher(`${BASE}/film-api/v1.9.9/movie?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}&movieId=${movieId}&packageName=${PKG}`), securityKey)); const episode = details.episodes?.[0]; if (!episode?.id) return [];
    const body = { mode: '1', appMarket: 'GuanWang', clientType: CLIENT, woolUser: 'false', apkSignKey: 'ED0955EB04E67A1D9F3305B95454FED485261475', androidVersion: '13', movieId: String(movieId), episodeId: String(episode.id), languageId: '0', isNewUser: 'true', resolution: '2', packageName: PKG };
    const video = data(decrypt(await cipher(`${BASE}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT}&packageName=${PKG}&channel=${CHANNEL}&lang=${LANG}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), securityKey));
    const subtitles = (video.subtitles ?? []).map(sub).filter(Boolean) as RawSubtitle[]; const values = Array.isArray(video.videos) && video.videos.some((item: any) => isSafeHttpUrl(item.url)) ? video.videos : [{ url: video.videoUrl, resolution: video.videoResolution ?? '720p', size: video.size }];
    const streams = values.filter((item: any) => isSafeHttpUrl(item.url)).map((item: any) => ({ url: item.url, format: detectFormat(item.url, 'mp4') as any, quality: q(item.resolutionDescription ?? item.resolution), audio: 'Original', provider: 'castle' as const, headers: PLAYBACK }));
    return attachSubtitles(streams, uniqueBy(subtitles, (item) => item.language_code));
  } catch { return []; }
}
