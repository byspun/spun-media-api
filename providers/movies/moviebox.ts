import { createHash, createHmac } from 'node:crypto';
import { attachSubtitles } from '../normalizer.js';
import { detectFormat, isSafeHttpUrl, normalizeQuality, normalizeTitle, uniqueBy } from '../mapper.js';
import type { MovieProviderInput, RawStream, RawSubtitle } from '../shared/types.js';

const API_BASE = 'https://api3.aoneroom.com';
const DEFAULT_KEY = 'NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==';
const PACKAGE = { package_name: 'com.community.mbox.in', version_name: '3.0.03.0529.03', version_code: 50020042 };
let deviceId = '';
let bearerToken = '';

function initDevice(): void {
  if (deviceId) return;
  deviceId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
function md5(value: string | Buffer): string { return createHash('md5').update(value).digest('hex'); }
function secretKey(value: string): Buffer { return Buffer.from(Buffer.from(value, 'base64').toString('utf8'), 'base64'); }
function tokenExpiry(token: string): number { try { return Number(JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).exp ?? 0); } catch { return 0; } }
function tokenValid(token: string): boolean { return Boolean(token) && tokenExpiry(token) > Date.now() / 1000 + 3600; }
function canonical(method: string, accept: string, contentType: string, url: string, body: string | null, timestamp: number): string {
  const parsed = new URL(url); const keys = [...new Set([...parsed.searchParams.keys()])].sort();
  const query = keys.flatMap((key) => parsed.searchParams.getAll(key).map((value) => `${key}=${value}`)).join('&');
  const path = `${parsed.pathname}${query ? `?${query}` : ''}`;
  const bodyBuffer = body ? Buffer.from(body) : null;
  return `${method.toUpperCase()}\n${accept}\n${contentType}\n${bodyBuffer?.byteLength ?? ''}\n${timestamp}\n${bodyBuffer ? md5(bodyBuffer) : ''}\n${path}`;
}
async function signedRequest(method: string, url: string, body: string | null = null): Promise<{ data: any; headers: Headers } | null> {
  initDevice();
  const timestamp = Date.now(); const accept = 'application/json'; const contentType = body ? 'application/json; charset=utf-8' : 'application/json';
  const signature = createHmac('md5', secretKey(DEFAULT_KEY)).update(canonical(method, accept, contentType, url, body, timestamp)).digest('base64');
  const headers = new Headers({ Accept: accept, 'Content-Type': contentType, 'x-client-token': `${timestamp},${md5(String(timestamp).split('').reverse().join(''))}`, 'x-tr-signature': `${timestamp}|2|${signature}`, 'User-Agent': `${PACKAGE.package_name}/${PACKAGE.version_code} (Linux; Android 16)`, 'x-client-info': JSON.stringify({ ...PACKAGE, os: 'android', os_version: '16', device_id: deviceId, system_language: 'en', net: 'NETWORK_WIFI', region: 'IN', timezone: 'Asia/Calcutta' }), 'x-client-status': '0' });
  if (tokenValid(bearerToken)) headers.set('Authorization', `Bearer ${bearerToken}`);
  try {
    const response = await fetch(url, { method, headers, body: body ?? undefined, signal: AbortSignal.timeout(20_000) });
    const xUser = response.headers.get('x-user');
    if (xUser) { try { const next = JSON.parse(xUser).token; if (tokenValid(next)) bearerToken = next; } catch {} }
    if (!response.ok) return null;
    let data: any; try { data = await response.json(); } catch { return null; }
    return { data, headers: response.headers };
  } catch { return null; }
}
async function ensureToken(): Promise<void> {
  if (tokenValid(bearerToken)) return;
  const response = await signedRequest('GET', `${API_BASE}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`);
  const token = response?.headers.get('x-user');
  if (token) { try { const value = JSON.parse(token).token; if (value) bearerToken = value; } catch {} }
}
function candidateType(value: any): number { return Number(value?.subjectType ?? (String(value?.type ?? '').toLowerCase() === 'movie' ? 1 : 2)); }
function pickSubject(items: any[], input: MovieProviderInput): any | null {
  const wanted = normalizeTitle(input.title);
  const ranked = items.filter((item) => candidateType(item) === 1).map((item) => {
    const actual = normalizeTitle(item.title ?? ''); const year = Number(String(item.releaseDate ?? item.year ?? '').slice(0, 4));
    let score = actual === wanted ? 50 : actual.includes(wanted) || wanted.includes(actual) ? 15 : 0;
    if (input.year && year === input.year) score += 35;
    return { item, score };
  }).filter((item) => item.score >= 40).sort((a, b) => b.score - a.score);
  return ranked[0]?.item ?? null;
}
function subtitle(value: any): RawSubtitle | null {
  if (!isSafeHttpUrl(value?.url)) return null;
  return { url: value.url, language: String(value.language ?? value.lanName ?? value.lan ?? 'Unknown'), language_code: String(value.language_code ?? value.lang ?? value.lan ?? 'und').toLowerCase(), format: 'vtt', provider: 'moviebox' };
}
async function captions(subjectId: string, streamId: string): Promise<RawSubtitle[]> {
  const output: RawSubtitle[] = [];
  for (const url of [`${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${encodeURIComponent(subjectId)}&streamId=${encodeURIComponent(streamId)}`, `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${encodeURIComponent(subjectId)}&resourceId=${encodeURIComponent(streamId)}&episode=0`]) {
    const result = await signedRequest('GET', url); const values = result?.data?.data?.extCaptions;
    if (Array.isArray(values)) output.push(...values.map(subtitle).filter(Boolean) as RawSubtitle[]);
  }
  return uniqueBy(output, (item) => item.language_code);
}

export async function getMovieboxStreams(input: MovieProviderInput, _tmdbApiKey: string): Promise<RawStream[]> {
  await ensureToken();
  const search = await signedRequest('POST', `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`, JSON.stringify({ page: 1, perPage: 20, keyword: input.title }));
  const groups = Array.isArray(search?.data?.data?.results) ? search.data.data.results : [];
  const subjects = groups.flatMap((group: any) => Array.isArray(group.subjects) ? group.subjects : []);
  const chosen = pickSubject(subjects, input);
  if (!chosen) return [];
  const detail = await signedRequest('GET', `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(String(chosen.subjectId))}`);
  const dubs = Array.isArray(detail?.data?.data?.dubs) ? detail.data.data.dubs : [];
  const subjectIds = [{ id: String(chosen.subjectId), lang: String(chosen.lanName ?? 'Original') }, ...dubs.filter((item: any) => String(item.subjectId) !== String(chosen.subjectId)).map((item: any) => ({ id: String(item.subjectId), lang: String(item.lanName ?? 'Original') }))];
  const streams: RawStream[] = []; const subtitles: RawSubtitle[] = [];
  for (const item of subjectIds) {
    const result = await signedRequest('GET', `${API_BASE}/wefeed-mobile-bff/subject-api/play-info?subjectId=${encodeURIComponent(item.id)}&se=0&ep=0`);
    const values = Array.isArray(result?.data?.data?.streams) ? result.data.data.streams : [];
    for (const value of values) {
      if (!isSafeHttpUrl(value.url)) continue;
      const streamId = String(value.id ?? `${item.id}|0|0`);
      const found = await captions(item.id, streamId); subtitles.push(...found);
      streams.push({ url: value.url, format: detectFormat(value.url, value.format) as any, quality: normalizeQuality(value.resolutions ?? value.quality), audio: item.lang, provider: 'moviebox', headers: { Referer: API_BASE, ...(value.signCookie ? { Cookie: value.signCookie } : {}) } });
    }
  }
  return attachSubtitles(streams, uniqueBy(subtitles, (item) => item.language_code));
}
