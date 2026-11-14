import { fetchJson, fetchWithTimeout } from './internal/http.js';
import { isSafeHttpUrl, detectFormat, normalizeQuality } from './internal/utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const SITE = 'https://www.animeonsen.xyz';
const REFERER = `${SITE}/`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

interface AnimeOnsenSession {
  token: string;
  apiOrigin: string;
  searchOrigin: string;
  searchToken: string;
}

let sessionCache: AnimeOnsenSession | null = null;
let sessionInFlight: Promise<AnimeOnsenSession> | null = null;

async function createSession(): Promise<AnimeOnsenSession> {
  const response = await fetchWithTimeout(SITE, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15_000,
  });

  const html = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`AnimeOnsen homepage HTTP ${response.status}`);

  // Extract session cookie
  const setCookie = response.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/ao\.session=([^;]+)/);
  if (!cookieMatch) throw new Error('AnimeOnsen session bootstrap data missing');

  const cookie = cookieMatch[1];
  const decoded = Buffer.from(decodeURIComponent(cookie), 'base64').toString('utf8');
  const token = [...decoded].map(char => String.fromCharCode(char.charCodeAt(0) + 1)).join('');
  if (!token || !/^[\x20-\x7e]+$/.test(token)) throw new Error('AnimeOnsen returned an invalid session token');

  // Extract meta tags
  const apiOriginMatch = html.match(/<meta[^>]*name=["']ao-api-origin["'][^>]*content=["']([^"']+)["']/i);
  const searchOriginMatch = html.match(/<meta[^>]*name=["']ao-search-origin["'][^>]*content=["']([^"']+)["']/i);
  const searchTokenMatch = html.match(/<meta[^>]*name=["']ao-search-token["'][^>]*content=["']([^"']+)["']/i);

  if (!apiOriginMatch?.[1] || !searchOriginMatch?.[1] || !searchTokenMatch?.[1]) {
    throw new Error('AnimeOnsen session bootstrap data missing');
  }

  return {
    token,
    apiOrigin: new URL(apiOriginMatch[1]).origin,
    searchOrigin: new URL(searchOriginMatch[1]).origin,
    searchToken: searchTokenMatch[1],
  };
}

async function getSession(force = false): Promise<AnimeOnsenSession> {
  if (force) sessionCache = null;
  if (sessionCache) return sessionCache;
  if (!sessionInFlight) {
    sessionInFlight = createSession()
      .then(value => { sessionCache = value; return value; })
      .finally(() => { sessionInFlight = null; });
  }
  return sessionInFlight;
}

async function apiJson(path: string, retry = true): Promise<any> {
  const current = await getSession();
  const response = await fetchWithTimeout(`${current.apiOrigin}${path}`, {
    headers: {
      'Authorization': `Bearer ${current.token}`,
      'Accept': 'application/json, text/plain, */*',
      'Origin': SITE,
      'Referer': REFERER,
      'User-Agent': UA,
    },
    timeout: 15_000,
  });

  if ((response.status === 401 || response.status === 403) && retry) {
    await getSession(true);
    return apiJson(path, false);
  }

  const raw = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`AnimeOnsen ${path} HTTP ${response.status}`);
  try { return JSON.parse(raw); } catch { throw new Error(`AnimeOnsen ${path} returned invalid JSON`); }
}

function extractSubtitles(video: any, authHeaders: Record<string, string>): RawSubtitle[] {
  const subtitles: RawSubtitle[] = [];

  for (const [language, url] of Object.entries(video?.uri?.subtitles ?? {})) {
    if (!isSafeHttpUrl(String(url))) continue;
    const label = video?.metadata?.subtitles?.[language] || language;
    subtitles.push({
      url: String(url),
      language: label,
      language_code: language.split('-')[0].toLowerCase(),
      format: 'vtt',
      provider: 'animeonsen',
      headers: authHeaders,
    });
  }
  return subtitles;
}

async function searchAnimeOnsen(query: string, retry = true): Promise<any[]> {
  const current = await getSession();
  const response = await fetchWithTimeout(`${current.searchOrigin}/multi-search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${current.searchToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': SITE,
      'Referer': REFERER,
      'User-Agent': UA,
    },
    body: JSON.stringify({ queries: [{ indexUid: 'content', q: query, limit: 20 }] }),
    timeout: 15_000,
  });

  if ((response.status === 401 || response.status === 403) && retry) {
    await getSession(true);
    return searchAnimeOnsen(query, false);
  }

  const data = await response.json().catch(() => ({} as any));
  const typedData = data as { results?: Array<{ hits?: any[] }> };
  return Array.isArray(typedData?.results?.[0]?.hits) ? typedData.results[0].hits : [];
}

function buildTitleQueries(titles: string[]): string[] {
  const queries = new Set<string>();
  for (const title of titles) {
    if (!title.trim()) continue;
    queries.add(title.trim());
    queries.add(title.trim().replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return Array.from(queries).slice(0, 20);
}

async function findAnimeOnsenShow(anilistId: number, title: string): Promise<{ contentId: string; title: string; malId: number | null; isMovie: boolean } | null> {
  const titles = [title].filter(Boolean);
  const queries = buildTitleQueries(titles);

  const discovered = new Map<string, any>();
  for (const query of queries) {
    try {
      const hits = await searchAnimeOnsen(query);
      for (const hit of hits) {
        if (hit?.content_id && !discovered.has(hit.content_id)) discovered.set(hit.content_id, hit);
      }
    } catch {}
  }

  const candidates = Array.from(discovered.values())
    .filter(c => c.content_id)
    .slice(0, 14);

  for (const candidate of candidates) {
    try {
      const contentId = String(candidate.content_id);
      const video = await apiJson(`/v4/content/${encodeURIComponent(contentId)}/video/1`);
      const metadata = video?.metadata;
      if (!metadata) continue;

      const malId = Number(metadata.mal_id) || null;
      if (malId && malId === anilistId) {
        return { contentId, title: candidate.content_title_en || candidate.content_title || title, malId, isMovie: Boolean(metadata.is_movie) };
      }
    } catch {}
  }

  // Fallback: first candidate
  if (candidates.length > 0) {
    const candidate = candidates[0];
    try {
      const contentId = String(candidate.content_id);
      const video = await apiJson(`/v4/content/${encodeURIComponent(contentId)}/video/1`);
      const metadata = video?.metadata;
      if (metadata) {
        return { contentId, title: candidate.content_title_en || candidate.content_title || title, malId: Number(metadata.mal_id) || null, isMovie: Boolean(metadata.is_movie) };
      }
    } catch {}
  }

  return null;
}

async function fetchEpisodes(series: { contentId: string; isMovie: boolean }): Promise<Array<{ number: number; sourceNumber: string }>> {
  const data = await apiJson(`/v4/content/${encodeURIComponent(series.contentId)}/episodes`);
  const episodes = Object.entries(data ?? {})
    .map(([sourceNumber, detail]: [string, any]) => ({
      number: Number(sourceNumber),
      sourceNumber,
      title: detail?.contentTitle_episode_en || detail?.contentTitle_episode_jp || null,
    }))
    .filter(ep => Number.isInteger(ep.number) && ep.number >= 1)
    .sort((a, b) => a.number - b.number);

  if (episodes.length) return episodes;
  if (series.isMovie) return [{ number: 1, sourceNumber: '1' }];
  throw new Error(`AnimeOnsen has no episodes for ${series.contentId}`);
}

export async function getAnimeonsenStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  const streams: RawStream[] = [];

  try {
    const show = await findAnimeOnsenShow(input.anilist_id, input.title);
    if (!show) return [];

    const episodes = await fetchEpisodes(show);
    const episode = episodes.find(ep => ep.number === input.episode);
    if (!episode) return [];

    const video = await apiJson(`/v4/content/${encodeURIComponent(show.contentId)}/video/${encodeURIComponent(episode.sourceNumber)}`);
    const streamUrl = video?.uri?.stream;
    if (!streamUrl) return [];

    const currentSession = await getSession();
    const authHeaders = { 'Authorization': `Bearer ${currentSession.token}` };

    const subTracks = extractSubtitles(video, authHeaders);
    // Attach subtitles via normalizer (handled by attachSubtitles in the caller if needed)

    streams.push({
      url: streamUrl,
      format: 'dash',
      quality: normalizeQuality('1080p'),
      audio: input.dub ? 'Dub' : 'Original',
      provider: 'animeonsen',
      headers: { ...authHeaders, 'Referer': REFERER },
    });
  } catch (error) {
    console.error(`AnimeOnsen error: ${String(error)}`);
  }

  return streams;
}