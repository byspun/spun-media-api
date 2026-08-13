// worker/src/metadata/tmdb.ts
// All TMDB API calls. Uses Bearer token auth (read access token).
// Never exposes raw TMDB IDs in return values — callers handle ID mapping.

import type { Env } from '../types/env.js';
import type { ContentItem, ContentType } from '../types/index.js';

const TMDB_BASE  = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

// ─── Image helpers ─────────────────────────────────────────────────────────────

export function tmdbPoster(path: string | null | undefined, size = 'w342'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function tmdbBackdrop(path: string | null | undefined, size = 'w1280'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function tmdbStill(path: string | null | undefined, size = 'w300'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function tmdbProfile(path: string | null | undefined, size = 'w185'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function tmdbLogo(path: string | null | undefined, size = 'w300'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

export async function tmdbFetch<T>(
  env:    Env,
  path:   string,
  params: Record<string, string | number | boolean> = {}
): Promise<T | null> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}`,
        Accept:        'application/json',
      },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function extractYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const y = parseInt(dateStr.slice(0, 4));
  return isNaN(y) ? null : y;
}

// ─── Movie detail ─────────────────────────────────────────────────────────────

export interface TmdbMovieDetail {
  id:                  number;
  title:               string;
  original_title:      string;
  overview:            string | null;
  tagline:             string | null;
  release_date:        string | null;
  runtime:             number | null;
  status:              string | null;
  vote_average:        number;
  vote_count:          number;
  poster_path:         string | null;
  backdrop_path:       string | null;
  genres:              Array<{ id: number; name: string }>;
  production_companies: Array<{ id: number; name: string; logo_path: string | null }>;
  videos:              { results: Array<{ key: string; site: string; type: string }> };
  images:              { backdrops: Array<{ file_path: string }>; logos: Array<{ file_path: string }> };
  credits: {
    cast: Array<{
      name:         string;
      character:    string;
      profile_path: string | null;
      order:        number;
    }>;
    crew: Array<{
      name:         string;
      job:          string;
      department:   string;
      profile_path: string | null;
    }>;
  };
  external_ids: {
    imdb_id: string | null;
  };
  belongs_to_collection: { id: number; name: string } | null;
}

export async function getTmdbMovieDetail(
  env:    Env,
  tmdbId: number
): Promise<TmdbMovieDetail | null> {
  return tmdbFetch<TmdbMovieDetail>(env, `/movie/${tmdbId}`, {
    append_to_response: 'credits,videos,images,external_ids',
    include_image_language: 'en,null',
  });
}

// ─── TV detail ────────────────────────────────────────────────────────────────

export interface TmdbTvDetail {
  id:               number;
  name:             string;
  original_name:    string;
  overview:         string | null;
  tagline:          string | null;
  first_air_date:   string | null;
  status:           string | null;
  vote_average:     number;
  vote_count:       number;
  poster_path:      string | null;
  backdrop_path:    string | null;
  episode_run_time: number[];
  genres:           Array<{ id: number; name: string }>;
  networks:         Array<{ id: number; name: string; logo_path: string | null }>;
  production_companies: Array<{ id: number; name: string }>;
  created_by:       Array<{ name: string; profile_path: string | null }>;
  seasons: Array<{
    season_number: number;
    episode_count: number;
    name:          string;
    air_date:      string | null;
    poster_path:   string | null;
  }>;
  next_episode_to_air: {
    season_number:  number;
    episode_number: number;
    air_date:       string;
  } | null;
  videos:  { results: Array<{ key: string; site: string; type: string }> };
  images:  { backdrops: Array<{ file_path: string }>; logos: Array<{ file_path: string }> };
  credits: {
    cast: Array<{
      name:         string;
      character:    string;
      profile_path: string | null;
      order:        number;
    }>;
    crew: Array<{
      name:         string;
      job:          string;
      department:   string;
      profile_path: string | null;
    }>;
  };
  external_ids: {
    imdb_id:  string | null;
    tvdb_id:  number | null;
  };
}

export async function getTmdbTvDetail(
  env:    Env,
  tmdbId: number
): Promise<TmdbTvDetail | null> {
  return tmdbFetch<TmdbTvDetail>(env, `/tv/${tmdbId}`, {
    append_to_response: 'credits,videos,images,external_ids',
    include_image_language: 'en,null',
  });
}

// ─── TV season detail ─────────────────────────────────────────────────────────

export interface TmdbSeasonDetail {
  season_number: number;
  episodes: Array<{
    episode_number: number;
    name:           string | null;
    overview:       string | null;
    still_path:     string | null;
    runtime:        number | null;
    air_date:       string | null;
  }>;
}

export async function getTmdbSeasonDetail(
  env:          Env,
  tmdbId:       number,
  seasonNumber: number
): Promise<TmdbSeasonDetail | null> {
  return tmdbFetch<TmdbSeasonDetail>(env, `/tv/${tmdbId}/season/${seasonNumber}`);
}

// ─── TV episode detail ────────────────────────────────────────────────────────

export async function getTmdbEpisodeDetail(
  env:           Env,
  tmdbId:        number,
  seasonNumber:  number,
  episodeNumber: number
): Promise<Record<string, unknown> | null> {
  return tmdbFetch(env, `/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`);
}

// ─── External IDs ─────────────────────────────────────────────────────────────

export async function getTmdbExternalIds(
  env:       Env,
  tmdbId:    number,
  mediaType: 'movie' | 'tv'
): Promise<{ imdb_id: string | null; tvdb_id: number | null }> {
  const data = await tmdbFetch<{ imdb_id?: string; tvdb_id?: number }>(
    env,
    `/${mediaType}/${tmdbId}/external_ids`
  );
  return {
    imdb_id: data?.imdb_id  ?? null,
    tvdb_id: data?.tvdb_id  ?? null,
  };
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface TmdbSearchResult {
  id:           number;
  media_type:   'movie' | 'tv' | 'person';
  title?:       string;
  name?:        string;
  overview?:    string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  poster_path?:  string | null;
  backdrop_path?: string | null;
  genre_ids?:   number[];
  adult?:       boolean;
}

export async function searchTmdb(
  env:   Env,
  query: string,
  page  = 1
): Promise<{ results: TmdbSearchResult[]; total_pages: number; total_results: number }> {
  const data = await tmdbFetch<{
    results:       TmdbSearchResult[];
    total_pages:   number;
    total_results: number;
  }>(env, '/search/multi', { query, page, include_adult: false });

  const filtered = (data?.results ?? []).filter(
    (r) => (r.media_type === 'movie' || r.media_type === 'tv') && !r.adult
  );

  return {
    results:       filtered,
    total_pages:   data?.total_pages   ?? 1,
    total_results: data?.total_results ?? 0,
  };
}

// ─── Discover ─────────────────────────────────────────────────────────────────

export async function tmdbDiscover(
  env:       Env,
  mediaType: 'movie' | 'tv',
  params:    Record<string, string | number | boolean> = {},
  page      = 1
): Promise<TmdbSearchResult[]> {
  const data = await tmdbFetch<{ results: TmdbSearchResult[] }>(
    env,
    `/discover/${mediaType}`,
    { ...params, page, include_adult: false }
  );
  return data?.results ?? [];
}

// ─── Trending ─────────────────────────────────────────────────────────────────

export async function getTmdbTrending(
  env:  Env,
  type: 'all' | 'movie' | 'tv' = 'all',
  page = 1
): Promise<TmdbSearchResult[]> {
  const data = await tmdbFetch<{ results: TmdbSearchResult[] }>(
    env,
    `/trending/${type}/day`,
    { page }
  );
  return (data?.results ?? []).filter(
    (r) => r.media_type === 'movie' || r.media_type === 'tv'
  );
}

// ─── Similar / Recommendations ────────────────────────────────────────────────

export async function getTmdbSimilar(
  env:       Env,
  tmdbId:    number,
  mediaType: 'movie' | 'tv'
): Promise<TmdbSearchResult[]> {
  const data = await tmdbFetch<{ results: TmdbSearchResult[] }>(
    env,
    `/${mediaType}/${tmdbId}/similar`
  );
  return data?.results ?? [];
}

export async function getTmdbRecommendations(
  env:       Env,
  tmdbId:    number,
  mediaType: 'movie' | 'tv'
): Promise<TmdbSearchResult[]> {
  const data = await tmdbFetch<{ results: TmdbSearchResult[] }>(
    env,
    `/${mediaType}/${tmdbId}/recommendations`
  );
  return data?.results ?? [];
}

// ─── Normalize raw TMDB result → partial ContentItem (no spun_id) ─────────────

export function normalizeTmdbResult(
  raw:       TmdbSearchResult,
  mediaType: ContentType
): Omit<ContentItem, 'spun_id'> {
  const title   = (raw.title || raw.name || '') as string;
  const dateStr = (raw.release_date || raw.first_air_date || '') as string;

  return {
    type:   mediaType,
    title,
    year:   extractYear(dateStr),
    rating: raw.vote_average
      ? parseFloat(raw.vote_average.toFixed(1))
      : null,
    poster: tmdbPoster(raw.poster_path ?? null),
  };
}

// ─── Map TMDB status string → Spün status ────────────────────────────────────

export function mapTmdbStatus(status: string | null | undefined): string | null {
  switch (status) {
    case 'Released':           return 'Released';
    case 'Returning Series':   return 'Ongoing';
    case 'Ended':              return 'Ended';
    case 'Canceled':           return 'Cancelled';
    case 'In Production':      return 'Upcoming';
    case 'Planned':            return 'Upcoming';
    default:                   return status ?? null;
  }
}
