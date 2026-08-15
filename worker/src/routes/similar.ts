// worker/src/routes/similar.ts
// Similar content endpoints:
//   GET /v1/similar/movie/:spunId
//   GET /v1/similar/tv/:spunId
//   GET /v1/similar/anime/:spunId

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { ContentItem } from '../types/index.js';
import { kvGet, kvSet, TTL } from '../cache.js';
import { getBySpunId, resolveFromTmdb, resolveFromAnilist } from '../identity/resolver.js';
import { searchTmdb, tmdbFetch } from '../metadata/tmdb.js';
import { getAnilistRecommendations, anilistTitle } from '../metadata/anilist.js';
import { anilistToItem, tmdbResultToItem, jsonResponse, errorResponse } from '../normalizer.js';

const similar = new Hono<{ Bindings: Env }>();

// ─── TasteDive API ────────────────────────────────────────────────────────────

const TASTEDIVE_BASE = 'https://tastedive.com/api/similar';

type TasteDiveType = 'movie' | 'show';

interface TasteDiveResult {
  name:        string;
  type?:       string;
  description?: string;
}

interface TasteDiveResponse {
  similar?: {
    info?:    TasteDiveResult[];
    results?: TasteDiveResult[];
  };
}

async function fetchTasteDive(
  env:    Env,
  title:  string,
  type:   TasteDiveType,
  limit   = 20
): Promise<TasteDiveResult[]> {
  const url = new URL(TASTEDIVE_BASE);
  // A typed seed prevents ambiguous names from resolving to the wrong medium.
  url.searchParams.set('q', `${type}:${title}`);
  url.searchParams.set('type', type);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('info', '1');

  if (env.TASTEDIVE_API_KEY) {
    url.searchParams.set('k', env.TASTEDIVE_API_KEY);
  }

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SpunMediaAPI/1.0',
      },
    });

    if (!res.ok) {
      console.error(`[Similar] TasteDive request failed with status ${res.status}`);
      return [];
    }

    const data = await res.json() as TasteDiveResponse;
    return data?.similar?.results?.filter((result) => Boolean(result?.name)) ?? [];
  } catch (err) {
    console.error('[Similar] TasteDive request failed:', err);
    return [];
  }
}

// ─── Resolve TasteDive result → ContentItem ────────────────────────────────────

async function tasteDiveToItem(
  env:       Env,
  result:    TasteDiveResult,
  mediaType: 'movie' | 'tv'
): Promise<ContentItem | null> {
  try {
    const tmdb = await searchTmdb(env, result.name, 1);
    if (!tmdb.results.length) return null;

    const normalizedName = result.name.toLowerCase().trim();
    const match = tmdb.results.find((r) =>
      r.media_type === mediaType &&
      (r.title || r.name || '').toLowerCase().trim() === normalizedName
    ) ?? tmdb.results.find((r) =>
      r.media_type === mediaType &&
      (r.title || r.name || '').toLowerCase().includes(normalizedName)
    ) ?? tmdb.results.find((r) => r.media_type === mediaType);

    if (!match) return null;

    const title = match.title || match.name || result.name;
    const row = await resolveFromTmdb(env, match.id, mediaType, title);
    return tmdbResultToItem(match, row.spun_id, mediaType);
  } catch (err) {
    console.error(`[Similar] Recommendation resolution failed for ${result.name}:`, err);
    return null;
  }
}

// ─── Cache key helper ─────────────────────────────────────────────────────────

function similarCacheKey(type: string, spunId: string): string {
  return `similar:${type}:${spunId}`;
}

async function movieOrTvSimilar(
  env:       Env,
  spunId:    string,
  contentType: 'movie' | 'tv'
): Promise<{ results: ContentItem[] }> {
  const row = await getBySpunId(env, spunId);
  if (!row) throw new Error('NOT_FOUND');
  if (row.content_type !== contentType) throw new Error('INVALID_TYPE');

  const tasteType: TasteDiveType = contentType === 'movie' ? 'movie' : 'show';
  const tasteResults = await fetchTasteDive(env, row.title, tasteType);
  const tasteItems = await Promise.all(
    tasteResults.map((result) => tasteDiveToItem(env, result, contentType))
  );

  let results = tasteItems.filter((item): item is ContentItem => item !== null);

  // A successful empty result is valid. The internal fallback is attempted only
  // when the first enrichment path produced no usable catalog entries.
  if (!results.length && row.tmdb_id) {
    const recs = await tmdbFetch<{ results: any[] }>(
      env,
      `/${contentType}/${row.tmdb_id}/recommendations`
    );

    if (recs?.results?.length) {
      const resolvedItems = await Promise.all(
        recs.results.slice(0, 20).map(async (result) => {
          const title = contentType === 'movie'
            ? (result.title || result.original_title || '')
            : (result.name || result.original_name || '');
          const resolved = await resolveFromTmdb(env, result.id, contentType, title);
          return tmdbResultToItem(result, resolved.spun_id, contentType);
        })
      );
      results = resolvedItems;
    }
  }

  return { results };
}

// ─── GET /similar/movie/:spunId ───────────────────────────────────────────────

similar.get('/movie/:spunId', async (c) => {
  const spunId = c.req.param('spunId');
  const cacheKey = similarCacheKey('movie', spunId);
  const cached = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  try {
    const payload = { spun_id: spunId, ...(await movieOrTvSimilar(c.env, spunId, 'movie')) };
    await kvSet(c.env, cacheKey, payload, TTL.metadata);
    return jsonResponse(payload);
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return errorResponse('NOT_FOUND', 'Title not found.', 404);
    }
    if (err instanceof Error && err.message === 'INVALID_TYPE') {
      return errorResponse('INVALID_TYPE', 'This endpoint is for movies only.', 400);
    }
    console.error('[Similar] Movie endpoint failed:', err);
    return errorResponse('UPSTREAM_ERROR', 'Could not retrieve similar titles.', 502);
  }
});

// ─── GET /similar/tv/:spunId ──────────────────────────────────────────────────

similar.get('/tv/:spunId', async (c) => {
  const spunId = c.req.param('spunId');
  const cacheKey = similarCacheKey('tv', spunId);
  const cached = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  try {
    const payload = { spun_id: spunId, ...(await movieOrTvSimilar(c.env, spunId, 'tv')) };
    await kvSet(c.env, cacheKey, payload, TTL.metadata);
    return jsonResponse(payload);
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return errorResponse('NOT_FOUND', 'Title not found.', 404);
    }
    if (err instanceof Error && err.message === 'INVALID_TYPE') {
      return errorResponse('INVALID_TYPE', 'This endpoint is for TV shows only.', 400);
    }
    console.error('[Similar] TV endpoint failed:', err);
    return errorResponse('UPSTREAM_ERROR', 'Could not retrieve similar titles.', 502);
  }
});

// ─── GET /similar/anime/:spunId ───────────────────────────────────────────────

similar.get('/anime/:spunId', async (c) => {
  const spunId = c.req.param('spunId');
  const cacheKey = similarCacheKey('anime', spunId);
  const cached = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);
  if (row.content_type !== 'anime' || !row.anilist_id) {
    return errorResponse('INVALID_TYPE', 'This endpoint is for anime only.', 400);
  }

  const recommendations = await getAnilistRecommendations(c.env, row.anilist_id);
  if (!recommendations) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

  const settled = await Promise.allSettled(
    recommendations.slice(0, 20).map(async (rec) => {
      const title = anilistTitle(rec);
      const relRow = await resolveFromAnilist(c.env, rec.id, title);
      return anilistToItem(rec, relRow.spun_id);
    })
  );
  const items = settled
    .filter((result): result is PromiseFulfilledResult<ContentItem> => result.status === 'fulfilled')
    .map((result) => result.value);

  const payload = { spun_id: spunId, results: items };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

export default similar;
