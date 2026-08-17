import { createHash, createHmac } from 'node:crypto';
import { attachSubtitles } from '../normalizer.js';
import { detectFormat, isSafeHttpUrl, normalizeQuality, normalizeTitle, uniqueBy } from '../mapper.js';
import type { RawStream, RawSubtitle, TvProviderInput } from '../shared/types.js';

const API_BASE = 'https://api3.aoneroom.com';
const SIGNING_KEY = 'NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==';
const PACKAGE = { package_name: 'com.community.mbox.in', version_code: 50020042 };
let deviceId = '';
let bearerToken = '';

function init(): void { if (!deviceId) deviceId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
function md5(value: string | Buffer): string { return createHash('md5').update(value).digest('hex'); }
function tokenIsValid(token: string): boolean { try { const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return Number(JSON.parse(Buffer.from(part, 'base64').toString()).exp ?? 0) > Date.now() / 1000 + 3600; } catch { return false; } }
function sign(method: string, url: string, body: string | null, timestamp: number): string {
  const parsed = new URL(url); const query = [...new Set([...parsed.searchParams.keys()])].sort().flatMap((key) => parsed.searchParams.getAll(key).map((value) => `${key}=${value}`)).join('&');
  const canonical = `${method}\napplication/json\napplication/json${body ? '; charset=utf-8' : ''}\n${body ? Buffer.byteLength(body) : ''}\n${timestamp}\n${body ? md5(body) : ''}\n${parsed.pathname}${query ? `?${query}` : ''}`;
  const key = Buffer.from(Buffer.from(SIGNING_KEY, 'base64').toString('utf8'), 'base64');
  return `${timestamp}|2|${createHmac('md5', key).update(canonical).digest('base64')}`;
}
async function request(method: string, url: string, body: string | null = null): Promise<{ data: any; headers: Headers } | null> {
  init(); const timestamp = Date.now(); const headers = new Headers({ Accept: 'application/json', 'Content-Type': body ? 'application/json; charset=utf-8' : 'application/json', 'x-client-token': `${timestamp},${md5(String(timestamp).split('').reverse().join(''))}`, 'x-tr-signature': sign(method, url, body, timestamp), 'User-Agent': `${PACKAGE.package_name}/${PACKAGE.version_code} (Linux; Android 16)`, 'x-client-info': JSON.stringify({ ...PACKAGE, os: 'android', os_version: '16', device_id: deviceId, region: 'IN' }) });
  if (tokenIsValid(bearerToken)) headers.set('Authorization', `Bearer ${bearerToken}`);
  try { const response = await fetch(url, { method, headers, body: body ?? undefined, signal: AbortSignal.timeout(20_000) }); const user = response.headers.get('x-user'); if (user) { try { const next = JSON.parse(user).token; if (next) bearerToken = next; } catch {} } if (!response.ok) { console.warn('[tv-moviebox-upstream-status]', { status: response.status, path: new URL(url).pathname }); return null; } return { data: await response.json(), headers: response.headers }; } catch { return null; }
}
function bestSubject(items: any[], input: TvProviderInput): any | null {
  const wanted = normalizeTitle(input.title);
  const seasonToken = `s${input.season}`;
  const ranked = items.filter((item) => Number(item.subjectType ?? 2) === 2).map((item) => {
    const actual = normalizeTitle(item.title ?? '');
    const year = Number(String(item.releaseDate ?? item.year ?? '').slice(0, 4));
    let score = actual === wanted ? 60 : actual.startsWith(wanted) ? 35 : actual.includes(wanted) || wanted.includes(actual) ? 20 : 0;
    if (input.year && year === input.year) score += 35;
    if (actual.includes(seasonToken)) score += 20;
    if (/s\d+$/.test(actual) && !actual.includes(seasonToken)) score -= 15;
    return { item, score };
  }).filter((value) => value.score >= 30).sort((a, b) => b.score - a.score);
  return ranked[0]?.item ?? null;
}
function subtitle(value: any): RawSubtitle | null { if (!isSafeHttpUrl(value?.url)) return null; return { url: value.url, language: String(value.language ?? value.lanName ?? value.lan ?? 'Unknown'), language_code: String(value.language_code ?? value.lang ?? value.lan ?? 'und').toLowerCase(), format: 'vtt', provider: 'moviebox' }; }
async function getCaptions(subjectId: string, streamId: string): Promise<RawSubtitle[]> { const list: RawSubtitle[] = []; for (const path of [`get-stream-captions?subjectId=${encodeURIComponent(subjectId)}&streamId=${encodeURIComponent(streamId)}`, `get-ext-captions?subjectId=${encodeURIComponent(subjectId)}&resourceId=${encodeURIComponent(streamId)}&episode=${0}`]) { const res = await request('GET', `${API_BASE}/wefeed-mobile-bff/subject-api/${path}`); const values = res?.data?.data?.extCaptions; if (Array.isArray(values)) list.push(...values.map(subtitle).filter(Boolean) as RawSubtitle[]); } return uniqueBy(list, (item) => item.language_code); }

export async function getMovieboxStreams(input: TvProviderInput, _tmdbApiKey: string): Promise<RawStream[]> {
  const search = await request('POST', `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`, JSON.stringify({ page: 1, perPage: 20, keyword: input.title }));
  const groups = Array.isArray(search?.data?.data?.results) ? search.data.data.results : []; const subjectsFound = groups.flatMap((group: any) => Array.isArray(group.subjects) ? group.subjects : []); console.log('[tv-moviebox-search-result]', { title: input.title, season: input.season, groups: groups.length, subjects: subjectsFound.length }); const subject = bestSubject(subjectsFound, input); if (!subject) { console.warn('[tv-moviebox-subject-not-found]', { title: input.title, season: input.season }); return []; }
  const detail = await request('GET', `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(String(subject.subjectId))}`); const dubs = Array.isArray(detail?.data?.data?.dubs) ? detail.data.data.dubs : []; const subjects = [{ id: String(subject.subjectId), lang: String(subject.lanName ?? 'Original') }, ...dubs.filter((item: any) => String(item.subjectId) !== String(subject.subjectId)).map((item: any) => ({ id: String(item.subjectId), lang: String(item.lanName ?? 'Original') }))];
  const streams: RawStream[] = []; const subtitles: RawSubtitle[] = [];
  for (const item of subjects) { const result = await request('GET', `${API_BASE}/wefeed-mobile-bff/subject-api/play-info?subjectId=${encodeURIComponent(item.id)}&se=${input.season}&ep=${input.episode}`); const values = Array.isArray(result?.data?.data?.streams) ? result.data.data.streams : []; console.log('[tv-moviebox-playback-result]', { subject: item.id, season: input.season, episode: input.episode, streams: values.length }); for (const value of values) { if (!isSafeHttpUrl(value.url)) continue; const streamId = String(value.id ?? `${item.id}|${input.season}|${input.episode}`); subtitles.push(...await getCaptions(item.id, streamId)); streams.push({ url: value.url, format: detectFormat(value.url, value.format) as any, quality: normalizeQuality(value.resolutions ?? value.quality), audio: item.lang, provider: 'moviebox', headers: { Referer: API_BASE, ...(value.signCookie ? { Cookie: value.signCookie } : {}) } }); } }
  return attachSubtitles(streams, uniqueBy(subtitles, (item) => item.language_code));
}
