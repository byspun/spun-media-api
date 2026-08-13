// worker/src/routes/search.ts
// Search endpoints:
//   GET /search?q=&page=&type=
//   GET /search/:type?q=&page=
//   GET /search/suggestions?q=
//
// Unified fan-out: TMDB multi-search + AniList search run in parallel.
// Anime titles appearing in TMDB results are deduplicated against AniList results.
// All results get spun_ids assigned (lazy, idempotent).

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { ContentItem, ContentType } from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import { searchTmdb } from '../metadata/tmdb.js';
import { searchAnilist, isAnimeOnAnilist, anilistTitle } from '../metadata/anilist.js';
import { resolveFromTmdb, resolveFromAnilist } from '../identity/resolver.js';
import { tmdbResultToItem, anilistToItem, jsonResponse, errorResponse } from '../normalizer.js';

const search = new Hono<{ Bindings: Env }>();

// ─── Known anime on TMDB — titles we strip from TMDB results ─────────────────
// We do a cheap title check first, then confirm via AniList only if needed.

async function isAnime(
  env:   Env,
  title: string
): Promise<boolean> {
  const cacheKey = `anime_check:${title.toLowerCase().slice(0, 50)}`;
  const cached   = await kvGet<boolean>(env, cacheKey);
  if (cached !== null) return cached;

  const match = await isAnimeOnAnilist(env, title);
  const result = match !== null;
  await kvSet(env, cacheKey, result, TTL.search);
  return result;
}

// ─── Dedup helper — remove TMDB results that are anime ───────────────────────

async function filterOutAnime(
  env:     Env,
  results: Array<{ title?: string; name?: string; id: number; media_type: string }>
): Promise<typeof results> {
  const checks = await Promise.all(
    results.map(async (r) => {
      const title = r.title || r.name || '';
      const anime = await isAnime(env, title);
      return { r, anime };
    })
  );
  return checks.filter((c) => !c.anime).map((c) => c.r);
}

// ─── Build ContentItem from TMDB result with spun_id ─────────────────────────

async function tmdbToItem(
  env: Env,
  raw: Awaited<ReturnType<typeof searchTmdb>>['results'][0]
): Promise<ContentItem | null> {
  if (raw.media_type !== 'movie' && raw.media_type !== 'tv') return null;

  const title    = (raw.title || raw.name || '');
  const row      = await resolveFromTmdb(env, raw.id, raw.media_type, title);
  const type: ContentType = raw.media_type;

  return tmdbResultToItem(raw, row.spun_id, type);
}

// ─── Build ContentItem from AniList result with spun_id ──────────────────────

async function anilistToItemWithId(
  env:   Env,
  media: Awaited<ReturnType<typeof searchAnilist>>['media'][0]
): Promise<ContentItem> {
  const title = anilistTitle(media);
  const row   = await resolveFromAnilist(env, media.id, title, {
    malId: media.idMal ?? undefined,
  });
  return anilistToItem(media, row.spun_id);
}

// ─── GET /search ──────────────────────────────────────────────────────────────

search.get('/', async (c) => {
  const q    = c.req.query('q')?.trim();
  const page = parseInt(c.req.query('page') ?? '1');
  const type = c.req.query('type') as ContentType | 'all' | undefined;

  if (!q || q.length < 2) {
    return errorResponse('MISSING_QUERY', 'Query must be at least 2 characters.', 400);
  }

  const normalizedType = type ?? 'all';
  const cacheKey       = CacheKeys.search(q, normalizedType, page);
  const cached         = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  let results: ContentItem[] = [];
  let totalPages             = 1;
  let totalResults           = 0;

  if (normalizedType === 'anime') {
    // AniList only
    const { media, hasNextPage } = await searchAnilist(c.env, q, page, 20);
    const items = await Promise.all(media.map((m) => anilistToItemWithId(c.env, m)));
    results      = items;
    totalPages   = hasNextPage ? page + 1 : page;
    totalResults = items.length;

  } else if (normalizedType === 'movie') {
    const tmdb       = await searchTmdb(c.env, q, page);
    const movieOnly  = tmdb.results.filter((r) => r.media_type === 'movie');
    const noAnime    = await filterOutAnime(c.env, movieOnly);
    const items      = await Promise.all(noAnime.map((r) => tmdbToItem(c.env, r as any)));
    results          = items.filter((i): i is ContentItem => i !== null);
    totalPages       = tmdb.total_pages;
    totalResults     = tmdb.total_results;

  } else if (normalizedType === 'tv') {
    const tmdb      = await searchTmdb(c.env, q, page);
    const tvOnly    = tmdb.results.filter((r) => r.media_type === 'tv');
    const noAnime   = await filterOutAnime(c.env, tvOnly);
    const items     = await Promise.all(noAnime.map((r) => tmdbToItem(c.env, r as any)));
    results         = items.filter((i): i is ContentItem => i !== null);
    totalPages      = tmdb.total_pages;
    totalResults    = tmdb.total_results;

  } else {
    // All — fan-out TMDB + AniList in parallel
    const [tmdb, anilistResult] = await Promise.all([
      searchTmdb(c.env, q, page),
      searchAnilist(c.env, q, page, 10),
    ]);

    // Filter TMDB: remove anime entries (they come from AniList instead)
    const noAnime = await filterOutAnime(c.env, tmdb.results as any[]);

    const [tmdbItems, animeItems] = await Promise.all([
      Promise.all(noAnime.map((r) => tmdbToItem(c.env, r as any))),
      Promise.all(anilistResult.media.map((m) => anilistToItemWithId(c.env, m))),
    ]);

    // Interleave: movies/TV first, then anime
    results      = [
      ...tmdbItems.filter((i): i is ContentItem => i !== null),
      ...animeItems,
    ];
    totalPages   = Math.max(tmdb.total_pages, anilistResult.hasNextPage ? page + 1 : page);
    totalResults = tmdb.total_results + animeItems.length;
  }

  const payload = {
    page,
    total_pages:   totalPages,
    total_results: totalResults,
    results,
  };

  await kvSet(c.env, cacheKey, payload, TTL.search);
  return jsonResponse(payload);
});

// ─── GET /search/suggestions ──────────────────────────────────────────────────
// Universal — fans out TMDB + AniList, returns mixed top results.

search.get('/suggestions', async (c) => {
  const q = c.req.query('q')?.trim();

  if (!q || q.length < 2) {
    return jsonResponse({ suggestions: [] });
  }

  const cacheKey = CacheKeys.suggestions(q);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  // Fan-out: 5 from TMDB, 5 from AniList
  const [tmdb, anilistResult] = await Promise.all([
    searchTmdb(c.env, q, 1),
    searchAnilist(c.env, q, 1, 5),
  ]);

  const noAnime = await filterOutAnime(c.env, tmdb.results.slice(0, 10) as any[]);

  const [tmdbItems, animeItems] = await Promise.all([
    Promise.all(noAnime.slice(0, 5).map((r) => tmdbToItem(c.env, r as any))),
    Promise.all(anilistResult.media.slice(0, 5).map((m) => anilistToItemWithId(c.env, m))),
  ]);

  const suggestions = [
    ...tmdbItems.filter((i): i is ContentItem => i !== null),
    ...animeItems,
  ].slice(0, 10);

  const payload = { suggestions };
  await kvSet(c.env, cacheKey, payload, TTL.suggestions);
  return jsonResponse(payload);
});

// ─── GET /search/movie ────────────────────────────────────────────────────────

search.get('/movie', async (c) => {
  const q    = c.req.query('q')?.trim();
  const page = parseInt(c.req.query('page') ?? '1');
  if (!q || q.length < 2) return errorResponse('MISSING_QUERY', 'Query must be at least 2 characters.', 400);

  const cacheKey = CacheKeys.search(q, 'movie', page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const tmdb      = await searchTmdb(c.env, q, page);
  const movieOnly = tmdb.results.filter((r) => r.media_type === 'movie');
  const noAnime   = await filterOutAnime(c.env, movieOnly);
  const items     = await Promise.all(noAnime.map((r) => tmdbToItem(c.env, r as any)));
  const results   = items.filter((i): i is ContentItem => i !== null);

  const payload = { page, total_pages: tmdb.total_pages, total_results: tmdb.total_results, results };
  await kvSet(c.env, cacheKey, payload, TTL.search);
  return jsonResponse(payload);
});

// ─── GET /search/tv ───────────────────────────────────────────────────────────

search.get('/tv', async (c) => {
  const q    = c.req.query('q')?.trim();
  const page = parseInt(c.req.query('page') ?? '1');
  if (!q || q.length < 2) return errorResponse('MISSING_QUERY', 'Query must be at least 2 characters.', 400);

  const cacheKey = CacheKeys.search(q, 'tv', page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const tmdb    = await searchTmdb(c.env, q, page);
  const tvOnly  = tmdb.results.filter((r) => r.media_type === 'tv');
  const noAnime = await filterOutAnime(c.env, tvOnly);
  const items   = await Promise.all(noAnime.map((r) => tmdbToItem(c.env, r as any)));
  const results = items.filter((i): i is ContentItem => i !== null);

  const payload = { page, total_pages: tmdb.total_pages, total_results: tmdb.total_results, results };
  await kvSet(c.env, cacheKey, payload, TTL.search);
  return jsonResponse(payload);
});

// ─── GET /search/anime ────────────────────────────────────────────────────────

search.get('/anime', async (c) => {
  const q    = c.req.query('q')?.trim();
  const page = parseInt(c.req.query('page') ?? '1');
  if (!q || q.length < 2) return errorResponse('MISSING_QUERY', 'Query must be at least 2 characters.', 400);

  const cacheKey = CacheKeys.search(q, 'anime', page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const { media, hasNextPage } = await searchAnilist(c.env, q, page, 20);
  const items = await Promise.all(media.map((m) => anilistToItemWithId(c.env, m)));

  const payload = { page, total_pages: hasNextPage ? page + 1 : page, total_results: items.length, results: items };
  await kvSet(c.env, cacheKey, payload, TTL.search);
  return jsonResponse(payload);
});

export default search;
