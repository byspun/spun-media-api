// Anv anime provider — direct HLS streams with cookie-bound sessions.
// Upstream: anv.to
//   catalog:     POST /api/catalog  { operation: "SearchAnime" | "AnimeDetail", variables }
//   session:     GET  /anime/{slug}-episode-{ep}   → sets shiro_watch cookie
//   episode:     POST /api/episode  { anilistId, malId, episode, first: true, prefer }
//                → { status: "ready", variants: [{ id: "sub"|"dub", sources: [...] }] }
//   skip times:  GET  /api/skip-times?malId=&episode=&duration=1440   → { intro: {...} }
// Sources are ranked by CDN preference: banana → pear → orange → other.
// Ported faithfully from ultrasrc src/providers/anime/anv.ts.

import { attachSubtitles } from './internal/normalizer.js';
import { detectFormat, isSafeHttpUrl, normalizeQuality, uniqueBy } from './internal/utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const BASE = 'https://anv.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36';

interface CatalogMedia {
  id: number;
  slug: string;
  title: { english?: string | null; romaji?: string | null; native?: string | null };
  idMal?: number | null;
}

interface EpisodeTrack {
  id?: string;
  src: string;
  type?: string;
  label?: string;
  language?: string;
  default?: boolean;
}

interface EpisodeSource {
  id: string;
  label: string;
  url: string;
  type?: string;
  tracks?: EpisodeTrack[];
}

interface EpisodeVariant {
  id: string; // "sub" | "dub"
  label: string;
  sources: EpisodeSource[];
}

interface EpisodeResponse {
  status: 'ready' | 'loading' | 'unavailable';
  reason?: string;
  variants?: EpisodeVariant[];
}

interface SkipTimesResponse {
  intro?: { start: number; end: number };
}

async function queryCatalog<T>(operation: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/api/catalog`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: `${BASE}/browse`,
      },
      body: JSON.stringify({ operation, variables }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function searchAnime(title: string, anilistId?: number): Promise<CatalogMedia | null> {
  const data = await queryCatalog<{ data?: { Page?: { media?: CatalogMedia[] } } }>('SearchAnime', {
    search: title,
    page: 1,
    perPage: 10,
  });
  const mediaList = data?.data?.Page?.media;
  if (!mediaList || !mediaList.length) return null;

  // Prefer an exact AniList ID match inside the catalog results.
  if (anilistId) {
    const idMatch = mediaList.find(m => m.id === anilistId);
    if (idMatch) return idMatch;
  }

  const lower = title.toLowerCase();
  return mediaList.find(
    m =>
      m.title.english?.toLowerCase() === lower ||
      m.title.romaji?.toLowerCase() === lower ||
      m.title.native?.toLowerCase() === lower,
  ) ?? mediaList[0] ?? null;
}

async function getAnimeDetail(id: number): Promise<CatalogMedia | null> {
  const data = await queryCatalog<{ data?: { Media?: CatalogMedia } }>('AnimeDetail', { id });
  return data?.data?.Media ?? null;
}

async function fetchEpisodeSources(
  anilistId: number,
  malId: number | null | undefined,
  episode: number,
  lang: 'sub' | 'dub',
  slug: string,
): Promise<{ data: EpisodeResponse; watchReferer: string; cookie: string } | null> {
  // 1. Visit the watch page to establish the shiro_watch session cookie.
  const watchUrl = `${BASE}/anime/${slug || anilistId}-episode-${episode}`;
  let finalWatchUrl = watchUrl;
  let cookieStr = '';
  try {
    const pageRes = await fetch(watchUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    finalWatchUrl = pageRes.url || watchUrl;
    const setCookies = pageRes.headers.getSetCookie?.() ?? [pageRes.headers.get('set-cookie') ?? ''];
    cookieStr = setCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');
  } catch {
    // Continue best-effort without the cookie.
  }

  // 2. Query episode sources (retry up to 3 times while the server prepares).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/episode`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          Origin: BASE,
          Referer: finalWatchUrl,
          ...(cookieStr ? { Cookie: cookieStr } : {}),
          Accept: '*/*',
        },
        body: JSON.stringify({
          anilistId: anilistId || undefined,
          malId: malId || undefined,
          episode,
          first: true,
          prefer: lang,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = (await res.json()) as EpisodeResponse;
        if (data.status === 'ready' && data.variants?.length) {
          return { data, watchReferer: finalWatchUrl, cookie: cookieStr };
        }
      }
    } catch {
      // Retry.
    }
    await new Promise(r => setTimeout(r, 600));
  }
  return null;
}

/** CDN preference used to rank anv.to sources (fast/unthrottled hosts first). */
function serverRank(label: string): number {
  const l = (label || '').toLowerCase();
  if (l.includes('banana')) return 0;
  if (l.includes('pear')) return 1;
  if (l.includes('orange')) return 2;
  return 5;
}

export async function getAnvStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    // 1. Resolve the catalog entry — ID match preferred over fuzzy title match.
    const anime = await searchAnime(input.title, input.anilist_id);
    if (!anime) return [];

    // 2. Detail lookup guarantees accurate MAL ID for skip times + episode call.
    const detail = anime.id === input.anilist_id ? anime : (await getAnimeDetail(anime.id) ?? anime);
    const anilistId = detail.id ?? input.anilist_id;
    const malId = detail.idMal ?? input.mal_id;
    const slug = detail.slug || anime.slug;

    // 3. Establish the session cookie and fetch episode sources.
    const lang: 'sub' | 'dub' = input.dub ? 'dub' : 'sub';
    const ep = await fetchEpisodeSources(anilistId, malId, input.episode, lang, slug);
    if (!ep) {
      throw new Error(`anv: no stream for '${input.title}' episode ${input.episode}`);
    }

    // 4. Pick the requested variant (sub/dub), falling back to the first.
    const variant = ep.data.variants!.find(v => v.id === lang) ?? ep.data.variants![0];
    if (!variant?.sources?.length) {
      throw new Error(`anv: no sources for variant '${variant?.id}'`);
    }

    // 5. Rank sources by CDN preference; primary = first after sort.
    const sortedSources = [...variant.sources].sort((a, b) => serverRank(a.label) - serverRank(b.label));
    const streamHeaders: Record<string, string> = {
      'User-Agent': UA,
      Referer: ep.watchReferer,
      Origin: BASE,
      ...(ep.cookie ? { Cookie: ep.cookie } : {}),
    };

    const audio = input.dub ? 'Dub' : 'Original';
    const streams: RawStream[] = [];
    const seen = new Set<string>();

    for (const src of sortedSources) {
      const url = src.url.startsWith('http') ? src.url : `${BASE}${src.url}`;
      if (!isSafeHttpUrl(url)) continue;
      const format = detectFormat(url, src.type);
      if (format === 'unknown') continue;
      const key = `${url}:${src.label ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      streams.push({
        url,
        format,
        quality: normalizeQuality(src.label),
        audio,
        provider: 'anv',
        headers: streamHeaders,
      });
    }

    // 6. Subtitle tracks from every variant source.
    const subtitles: RawSubtitle[] = [];
    const seenSubs = new Set<string>();
    for (const source of variant.sources) {
      for (const track of source.tracks ?? []) {
        const trackUrl = track.src.startsWith('http') ? track.src : `${BASE}${track.src}`;
        if (!isSafeHttpUrl(trackUrl) || seenSubs.has(trackUrl)) continue;
        seenSubs.add(trackUrl);
        const language = track.label || track.language || 'English';
        subtitles.push({
          url: trackUrl,
          language,
          language_code: (track.language ?? track.label ?? 'en').slice(0, 2).toLowerCase() || 'en',
          format: track.type === 'srt' || /\.srt($|[?#])/i.test(trackUrl) ? 'srt' : 'vtt',
          provider: 'anv',
        });
      }
    }

    return attachSubtitles(uniqueBy(streams, s => `${s.url}:${s.quality}`), uniqueBy(subtitles, s => s.url));
  } catch (error) {
    console.error(`Anv error: ${String(error)}`);
    return [];
  }
}
