// worker/src/metadata/jikan.ts
// All Jikan v4 REST calls — routed through the Vercel proxy at PROXY_BASE_URL.
// Direct calls from Cloudflare Workers hit the same orange-to-orange block as AniList.
//
// Proxy endpoint: GET ${PROXY_BASE_URL}/api/jikan/{path}
// Auth header:    x-spun-proxy-secret: ${SPUN_PROXY_SECRET}

import type { Env } from '../types/env.js';

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function jikanGet<T>(env: Env, path: string): Promise<T | null> {
  // Strip leading slash so we never get double slashes
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const baseUrl   = env.PROXY_BASE_URL.replace(/\/$/, '');
  const url       = `${baseUrl}/api/jikan/${cleanPath}`;

  try {
    const res = await fetch(url, {
      headers: {
        'x-spun-proxy-secret': env.SPUN_PROXY_SECRET ?? '',
        Accept:                'application/json',
      },
    });

    if (res.status === 429) {
      // Jikan rate-limits at 3 req/s and 60 req/min. Back off and return null.
      console.warn('[Jikan] Rate limited — backing off');
      return null;
    }

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Jikan Proxy] HTTP ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const json = await res.json() as T;
    return json;
  } catch (err) {
    console.error('[Jikan proxy fetch error]', err);
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JikanEpisode {
  mal_id:       number;
  title:        string  | null;
  title_romaji: string  | null;
  title_japanese: string | null;
  aired:        string  | null;
  filler:       boolean;
  recap:        boolean;
  forum_url:    string  | null;
}

export interface JikanTheme {
  openings: string[];
  endings:  string[];
}

export interface JikanAnimeDetail {
  mal_id:        number;
  title:         string;
  title_english?: string | null;
  title_japanese?: string | null;
  type?:         string | null;
  episodes:      number | null;
  score?:        number | null;
  year?:         number | null;
  aired?:        { from: string | null };
  images?:       { jpg?: { image_url?: string | null; large_image_url?: string | null } };
  synopsis?:     string | null;
  themes:        JikanTheme;
}

export async function getJikanAnimeDetail(
  env: Env,
  malId: number,
): Promise<JikanAnimeDetail | null> {
  const result = await jikanGet<{ data: JikanAnimeDetail }>(env, `anime/${malId}`);
  return result?.data ?? null;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * Full episode list for an anime by MAL ID.
 * Jikan paginates at 100 eps/page — we fetch all pages automatically.
 */
export async function getJikanEpisodes(
  env:   Env,
  malId: number
): Promise<JikanEpisode[]> {
  const all:     JikanEpisode[] = [];
  let   page     = 1;
  let   hasMore  = true;

  while (hasMore) {
    const result = await jikanGet<{
      data:       JikanEpisode[];
      pagination: { has_next_page: boolean };
    }>(env, `anime/${malId}/episodes?page=${page}`);

    if (!result || !result.data?.length) break;

    all.push(...result.data);
    hasMore = result.pagination?.has_next_page ?? false;
    page++;

    // Safety cap — no anime has more than 2000 episodes that Jikan tracks
    if (page > 20) break;
  }

  return all;
}

/**
 * Single page of episodes — used when we only need a specific page,
 * e.g. for the /info/:spunId/episodes endpoint with pagination.
 */
export async function getJikanEpisodesPage(
  env:   Env,
  malId: number,
  page  = 1
): Promise<{ episodes: JikanEpisode[]; hasNextPage: boolean }> {
  const result = await jikanGet<{
    data:       JikanEpisode[];
    pagination: { has_next_page: boolean };
  }>(env, `anime/${malId}/episodes?page=${page}`);

  return {
    episodes:    result?.data ?? [],
    hasNextPage: result?.pagination?.has_next_page ?? false,
  };
}

/**
 * Opening and ending themes for an anime.
 */
export async function getJikanThemes(
  env:   Env,
  malId: number
): Promise<{ openings: string[]; endings: string[] }> {
  const result = await jikanGet<{
    data: { openings: string[]; endings: string[] }
  }>(env, `anime/${malId}/themes`);

  return {
    openings: result?.data?.openings ?? [],
    endings:  result?.data?.endings  ?? [],
  };
}

/**
 * Parse Jikan's raw theme strings into structured objects.
 * Jikan returns: "#1: \"Guren no Yumiya\" by Linked Horizon (eps 1-13)"
 */
export function parseThemeString(raw: string): {
  title:    string;
  artist:   string;
  episodes: string;
} {
  // Strip the leading "#N: " ordinal if present
  const stripped = raw.replace(/^#\d+:\s*/, '');

  // Match `"Title" by Artist (eps X-Y)` or just `"Title" by Artist`
  const match = stripped.match(/^"(.+?)"\s+by\s+(.+?)(?:\s+\(eps?\s*([^)]+)\))?$/i);
  if (!match) {
    return { title: stripped, artist: 'Unknown', episodes: '' };
  }

  return {
    title:    match[1] ?? stripped,
    artist:   match[2]?.trim() ?? 'Unknown',
    episodes: match[3]?.trim() ?? '',
  };
}

/**
 * Filler episode guide.
 */
export async function getJikanFillers(
  env:   Env,
  malId: number
): Promise<JikanEpisode[]> {
  const all = await getJikanEpisodes(env, malId);
  return all.filter((ep) => ep.filler || ep.recap);
}

/**
 * Full episode guide with filler classification.
 * Returns every episode with a canon/filler/mixed label.
 */
export async function getJikanFillerGuide(
  env:   Env,
  malId: number
): Promise<Array<{ number: number; type: 'canon' | 'filler' | 'mixed' }>> {
  const eps = await getJikanEpisodes(env, malId);
  return eps.map((ep) => ({
    number: ep.mal_id,
    type:   ep.filler && ep.recap
      ? 'mixed'
      : ep.filler || ep.recap
        ? 'filler'
        : 'canon',
  }));
}

/**
 * Normalise a Jikan episode into the /info/:spunId/episodes shape.
 */
export function normalizeJikanEpisode(ep: JikanEpisode): {
  number:    number;
  season:    number;
  title:     string | null;
  overview:  string | null;
  thumbnail: string | null;
  runtime:   number | null;
  air_date:  string | null;
} {
  return {
    number:    ep.mal_id,
    season:    1,                                    // anime is always season 1 in Spün
    title:     ep.title ?? ep.title_romaji ?? null,
    overview:  null,                                 // Jikan v4 doesn't return episode overviews
    thumbnail: null,                                 // Jikan v4 doesn't return episode thumbnails
    runtime:   null,
    air_date:  ep.aired ?? null,
  };
}
