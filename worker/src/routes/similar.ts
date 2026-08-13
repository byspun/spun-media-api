// worker/src/routes/similar.ts
// Similar content endpoints:
//   GET /v1/similar/movie/:spunId   — TasteDive → TMDB resolve
//   GET /v1/similar/tv/:spunId      — TasteDive → TMDB resolve
//   GET /v1/similar/anime/:spunId   — AniList recommendations

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { ContentItem } from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import { getBySpunId, resolveFromTmdb, resolveFromAnilist } from '../identity/resolver.js';
import { searchTmdb, tmdbPoster, extractYear, tmdbFetch } from '../metadata/tmdb.js';
import { getAnilistMedia, anilistTitle } from '../metadata/anilist.js';
import { anilistToItem, tmdbResultToItem, jsonResponse, errorResponse } from '../normalizer.js';

const similar = new Hono<{ Bindings: Env }>();

// ─── TasteDive API ────────────────────────────────────────────────────────────

const TASTEDIVE_BASE = 'https://tastedive.com/api/similar';

interface TasteDiveResult {
  Name: string;
  Type: string;
}

interface TasteDiveResponse {
  Similar: {
    Info:    TasteDiveResult[];
    Results: TasteDiveResult[];
  };
}

async function fetchTasteDive(
  env:    Env,
  query:  string,        // e.g. "movie:Inception" or "show:Breaking Bad"
  type:   'movies' | 'shows',
  limit   = 20
): Promise<TasteDiveResult[]> {
  const url = new URL(TASTEDIVE_BASE);
  url.searchParams.set('q',     query);
  url.searchParams.set('type',  type);
  url.searchParams.set('limit', String(limit));
  
  if (env.TASTEDIVE_API_KEY) {
    url.searchParams.set('k', env.TASTEDIVE_API_KEY);
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'SpunMediaAPI/1.0'
      },
    });
    if (!res.ok) {
      console.error(`[TasteDive] Error ${res.status}: ${await res.text()}`);
      return [];
    }
    const data = await res.json() as TasteDiveResponse;
    return data?.Similar?.Results ?? [];
  } catch (err) {
    console.error('[TasteDive] Fetch error:', err);
    return [];
  }
}

// ─── Resolve TasteDive result → ContentItem via TMDB search ──────────────────

async function tasteDiveToItem(
  env:       Env,
  result:    TasteDiveResult,
  mediaType: 'movie' | 'tv'
): Promise<ContentItem | null> {
  try {
    const tmdb = await searchTmdb(env, result.Name, 1);
    if (!tmdb.results.length) return null;

    // Try exact match first, then partial, then just first result of correct type
    const normalizedName = result.Name.toLowerCase().trim();
    const match = tmdb.results.find((r) => 
      r.media_type === mediaType && 
      (r.title || r.name || '').toLowerCase().trim() === normalizedName
    ) ?? tmdb.results.find((r) => 
      r.media_type === mediaType && 
      (r.title || r.name || '').toLowerCase().includes(normalizedName)
    ) ?? tmdb.results.find((r) => r.media_type === mediaType);

    if (!match) return null;

    const title = match.title || match.name || result.Name;
    const row   = await resolveFromTmdb(env, match.id, mediaType, title);
    return tmdbResultToItem(match, row.spun_id, mediaType);
  } catch (err) {
    console.error(`[TasteDive] Resolution error for ${result.Name}:`, err);
    return null;
  }
}

// ─── Cache key helper ─────────────────────────────────────────────────────────

function similarCacheKey(type: string, spunId: string): string {
  return `similar:${type}:${spunId}`;
}

// ─── GET /similar/movie/:spunId ───────────────────────────────────────────────

similar.get('/movie/:spunId', async (c) => {
  const spunId   = c.req.param('spunId');
  const cacheKey = similarCacheKey('movie', spunId);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);
  if (row.content_type !== 'movie') {
    return errorResponse('INVALID_TYPE', 'This endpoint is for movies only.', 400);
  }

  let tasteResults = await fetchTasteDive(
    c.env,
    row.title,
    'movies'
  );

  let items = await Promise.all(
    tasteResults.map((r) => tasteDiveToItem(c.env, r, 'movie'))
  );

  let results = items.filter((i): i is ContentItem => i !== null);
  let source  = 'tastedive';

  // Fallback to TMDB recommendations if TasteDive returns nothing
  if (results.length === 0 && row.tmdb_id) {
    const tmdbRecs = await tmdbFetch<{ results: any[] }>(c.env, `/movie/${row.tmdb_id}/recommendations`);
    if (tmdbRecs?.results?.length) {
      results = tmdbRecs.results.slice(0, 20).map(r => tmdbResultToItem(r, `movie-${r.id}`, 'movie'));
      source  = 'tmdb';
    }
  }

  const payload = { spun_id: spunId, source, results };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

// ─── GET /similar/tv/:spunId ──────────────────────────────────────────────────

similar.get('/tv/:spunId', async (c) => {
  const spunId   = c.req.param('spunId');
  const cacheKey = similarCacheKey('tv', spunId);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);
  if (row.content_type !== 'tv') {
    return errorResponse('INVALID_TYPE', 'This endpoint is for TV shows only.', 400);
  }

  let tasteResults = await fetchTasteDive(
    c.env,
    row.title,
    'shows'
  );

  let items = await Promise.all(
    tasteResults.map((r) => tasteDiveToItem(c.env, r, 'tv'))
  );

  let results = items.filter((i): i is ContentItem => i !== null);
  let source  = 'tastedive';

  // Fallback to TMDB recommendations if TasteDive returns nothing
  if (results.length === 0 && row.tmdb_id) {
    const tmdbRecs = await tmdbFetch<{ results: any[] }>(c.env, `/tv/${row.tmdb_id}/recommendations`);
    if (tmdbRecs?.results?.length) {
      results = tmdbRecs.results.slice(0, 20).map(r => tmdbResultToItem(r, `tv-${r.id}`, 'tv'));
      source  = 'tmdb';
    }
  }

  const payload = { spun_id: spunId, source, results };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

// ─── GET /similar/anime/:spunId ───────────────────────────────────────────────

similar.get('/anime/:spunId', async (c) => {
  const spunId   = c.req.param('spunId');
  const cacheKey = similarCacheKey('anime', spunId);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);
  if (row.content_type !== 'anime' || !row.anilist_id) {
    return errorResponse('INVALID_TYPE', 'This endpoint is for anime only.', 400);
  }

  const media = await getAnilistMedia(c.env, row.anilist_id);
  if (!media) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

  const recNodes = (media.recommendations?.nodes ?? []).slice(0, 20);

  const items = await Promise.all(
    recNodes
      .filter((n: any) => n.mediaRecommendation)
      .map(async (n: any) => {
        const rec   = n.mediaRecommendation;
        const title = anilistTitle(rec);
        const relRow = await resolveFromAnilist(c.env, rec.id, title);
        return anilistToItem(rec, relRow.spun_id);
      })
  );

  const payload = { spun_id: spunId, source: 'anilist', results: items };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

export default similar;
