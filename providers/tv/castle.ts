import CryptoJS from 'crypto-js';
import { detectFormat, isSafeHttpUrl, normalizeQuality, uniqueBy } from '../mapper.js';
import { attachSubtitles } from '../normalizer.js';
import type { RawStream, RawSubtitle, TvProviderInput } from '../shared/types.js';

const BASE = 'https://api.hlowb.com';
const PKG = 'com.external.castle';
const CHANNEL = 'IndiaA';
const CLIENT = '1';
const LANG = 'en-US';
const HEADERS = { 'User-Agent': 'okhttp/4.9.3', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Referer: BASE };
const PLAYBACK = { Referer: BASE, 'User-Agent': 'Mozilla/5.0' };
async function req(url: string, init: RequestInit = {}): Promise<Response> { const r = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }
async function cipher(url: string, init?: RequestInit): Promise<string> { const t = (await (await req(url, init)).text()).trim(); try { return String(JSON.parse(t)?.data ?? t); } catch { return t; } }
function decrypt(value: string, secret: string): any { const material = CryptoJS.enc.Base64.parse(secret).concat(CryptoJS.enc.Utf8.parse('T!BgJB')); const key = CryptoJS.lib.WordArray.create(material.words.slice(0, 4), 16); return JSON.parse(CryptoJS.AES.decrypt(value, key, { iv: key, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8)); }
function block(value: any): any { return value?.data && typeof value.data === 'object' ? value.data : value ?? {}; }
function subtitle(value: any): RawSubtitle | null { if (!isSafeHttpUrl(value?.url)) return null; return { url: value.url, language: String(value.abbreviate ?? value.title ?? 'Unknown'), language_code: String(value.abbreviate ?? 'und').toLowerCase(), format: 'vtt', provider: 'castle' }; }

export async function getCastleStreams(input: TvProviderInput, tmdbApiKey: string): Promise<RawStream[]> {
  try {
    const tmdb: any = await fetch(`https://api.themoviedb.org/3/tv/${input.tmdb_id}?api_key=${encodeURIComponent(tmdbApiKey)}&append_to_response=external_ids`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
    const title = String(tmdb.name ?? input.title); const year = String(tmdb.first_air_date ?? input.year ?? '').slice(0, 4); const keyPayload: any = await (await req(`${BASE}/v0.1/system/getSecurityKey/1?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}`)).json(); const key = String(keyPayload.data);
    const searchUrl = `${BASE}/film-api/v1.1.0/movie/searchByKeyword?${new URLSearchParams({ channel: CHANNEL, clientType: CLIENT, keyword: year ? `${title} ${year}` : title, lang: LANG, mode: '1', packageName: PKG, page: '1', size: '30' })}`; const search = block(decrypt(await cipher(searchUrl), key)); const row = (search.rows ?? []).find((item: any) => String(item.title ?? item.name ?? '').toLowerCase().includes(title.toLowerCase())) ?? search.rows?.[0]; const movieId = row?.id ?? row?.redirectId ?? row?.redirectIdStr; if (!movieId) return [];
    let details = block(decrypt(await cipher(`${BASE}/film-api/v1.9.9/movie?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}&movieId=${movieId}&packageName=${PKG}`), key)); const season = details.seasons?.find((item: any) => Number(item.number) === input.season); const currentId = season?.movieId ?? movieId; if (currentId !== movieId) details = block(decrypt(await cipher(`${BASE}/film-api/v1.9.9/movie?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}&movieId=${currentId}&packageName=${PKG}`), key));
    const episode = details.episodes?.find((item: any) => Number(item.number) === input.episode); if (!episode?.id) return []; const body = { mode: '1', appMarket: 'GuanWang', clientType: CLIENT, woolUser: 'false', apkSignKey: 'ED0955EB04E67A1D9F3305B95454FED485261475', androidVersion: '13', movieId: String(currentId), episodeId: String(episode.id), languageId: '0', isNewUser: 'true', resolution: '2', packageName: PKG };
    const video = block(decrypt(await cipher(`${BASE}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT}&packageName=${PKG}&channel=${CHANNEL}&lang=${LANG}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), key)); const subtitles = (video.subtitles ?? []).map(subtitle).filter(Boolean) as RawSubtitle[]; const values = Array.isArray(video.videos) && video.videos.some((item: any) => isSafeHttpUrl(item.url)) ? video.videos : [{ url: video.videoUrl, resolution: video.videoResolution ?? '720p' }]; const streams = values.filter((item: any) => isSafeHttpUrl(item.url)).map((item: any) => ({ url: item.url, format: detectFormat(item.url, 'mp4') as any, quality: normalizeQuality(item.resolutionDescription ?? item.resolution), audio: 'Original', provider: 'castle' as const, headers: PLAYBACK })); return attachSubtitles(streams, uniqueBy(subtitles, (item) => item.language_code));
  } catch { return []; }
}
