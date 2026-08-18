// metadata/src/routes/search.ts
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
import type { ContentItem, ContentType, MediaTitleRow } from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import { searchTmdb, extractYear, tmdbPoster } from '../meta/tmdb.js';
import { searchAnilist, isAnimeOnAnilist, anilistTitle } from '../meta/anilist.js';
import { batchResolveFromTmdb, batchResolveFromAnilist, resolveFromMoviebox } from '../identity/resolver.js';
import { tmdbResultToItem, anilistToItem, jsonResponse, errorResponse } from '../normalizer.js';
import { searchMoviebox as searchMovieboxMetadata } from '../meta/moviebox.js';

const search = new Hono<{ Bindings: Env }>();

interface MovieBoxSearchItem {
  subjectId: string;
  subjectType?: number | null;
  type?: string | null;
  title: string;
  releaseDate?: string | null;
  poster?: string | null;
  hasResource?: boolean | null;
}

function normalizedSearchTitle(value: string): string {
  return value.normalize('NFKC').replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

function isLanguageVariant(value: string): boolean {
  return /\[[^\]]+\]/.test(value);
}

async function searchMoviebox(env: Env, keyword: string): Promise<MovieBoxSearchItem[]> {
  return searchMovieboxMetadata(env, keyword) as Promise<MovieBoxSearchItem[]>;
}

async function batchMovieboxItems(env: Env, items: MovieBoxSearchItem[], type: 'movie' | 'tv', canonicalTitles: Set<string>): Promise<ContentItem[]> {
  const rows = await Promise.all(items.slice(0, 20).map(async (item) => {
    const movieboxId = String(item.subjectId ?? '').trim();
    if (!/^\d+$/.test(movieboxId) || !item.title) return null;
    const year = item.releaseDate ? Number(String(item.releaseDate).slice(0, 4)) || null : null;
    const row = await resolveFromMoviebox(env, movieboxId, type, item.title, {
      year,
      posterPath: item.poster ?? null,
    });
    return { item, row };
  }));
  return rows.filter((value): value is { item: MovieBoxSearchItem; row: MediaTitleRow } => value !== null).filter(({ item }) => retainMovieboxResult(item, canonicalTitles)).map(({ item, row }) => ({
    spun_id: row!.spun_id,
    type,
    title: row!.title || item.title,
    year: row!.year,
    rating: row!.rating,
    poster: row!.poster_path,
  }));
}

function retainMovieboxResult(item: MovieBoxSearchItem, canonicalTitles: Set<string>): boolean {
  const title = normalizedSearchTitle(item.title);
  return isLanguageVariant(item.title) || !canonicalTitles.has(title);
}

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

async function batchTmdbItems(
  env: Env,
  raw: Array<Awaited<ReturnType<typeof searchTmdb>>['results'][0]>,
): Promise<ContentItem[]> {
  const valid = raw.filter((item) => item.media_type === 'movie' || item.media_type === 'tv');
  if (!valid.length) return [];

  const byType = (type: 'movie' | 'tv') => valid.filter((item) => item.media_type === type);
  const resolveType = async (
    items: typeof valid,
    type: 'movie' | 'tv',
  ): Promise<Map<string, string>> => {
    if (!items.length) return new Map();
    const rows = await batchResolveFromTmdb(
      env,
      items.map((item) => ({
        id: item.id,
        title: item.title || item.name || '',
        summary: {
          year: extractYear(item.release_date || item.first_air_date),
          rating: typeof item.vote_average === 'number'
            ? Number(item.vote_average.toFixed(1))
            : null,
          posterPath: tmdbPoster(item.poster_path ?? null),
        },
      })),
      type,
    );
    return new Map(rows.map((row) => [
      `${type}:${Number(row.tmdb_id)}`,
      row.spun_id,
    ]));
  };

  const [movieIds, tvIds] = await Promise.all([
    resolveType(byType('movie'), 'movie'),
    resolveType(byType('tv'), 'tv'),
  ]);

  return valid.map((item) => {
    const type = item.media_type as 'movie' | 'tv';
    const spunId = (type === 'movie' ? movieIds : tvIds).get(`${type}:${item.id}`)
      || `pending-${item.id}`;
    return tmdbResultToItem(item, spunId, type);
  });
}

// ─── Build ContentItems from AniList results with batched registration ───────

async function batchAnilistItems(
  env: Env,
  media: Awaited<ReturnType<typeof searchAnilist>>['media'],
): Promise<ContentItem[]> {
  if (!media.length) return [];

  const rows = await batchResolveFromAnilist(
    env,
    media.map((item) => ({
      id: item.id,
      title: anilistTitle(item),
      malId: item.idMal ?? undefined,
      summary: {
        year: item.startDate?.year ?? null,
        rating: typeof item.averageScore === 'number'
          ? Number((item.averageScore / 10).toFixed(1))
          : null,
        posterPath: item.coverImage?.large ?? item.coverImage?.medium ?? null,
      },
    })),
  );
  const byId = new Map(rows.map((row) => [Number(row.anilist_id), row.spun_id]));

  return media.map((item) => anilistToItem(item, byId.get(item.id) || `pending-${item.id}`));
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
    const items = await batchAnilistItems(c.env, media);
    results      = items;
    totalPages   = hasNextPage ? page + 1 : page;
    totalResults = items.length;

  } else if (normalizedType === 'movie') {
    const [tmdb, moviebox] = await Promise.all([
      searchTmdb(c.env, q, page),
      searchMoviebox(c.env, q),
    ]);
    const movieOnly = tmdb.results.filter((r) => r.media_type === 'movie');
    const tmdbItems = await batchTmdbItems(c.env, movieOnly as any);
    const canonicalTitles = new Set(tmdbItems.map((item) => normalizedSearchTitle(item.title)));
    const movieboxItems = await batchMovieboxItems(c.env, moviebox.filter((item) => item.subjectType === 1 || item.type === 'movie'), 'movie', canonicalTitles);
    results = [...tmdbItems, ...movieboxItems];

    totalPages = tmdb.total_pages;
    totalResults = tmdb.total_results + movieboxItems.length;

  } else if (normalizedType === 'tv') {
    const [tmdb, moviebox] = await Promise.all([
      searchTmdb(c.env, q, page),
      searchMoviebox(c.env, q),
    ]);
    const tvOnly = tmdb.results.filter((r) => r.media_type === 'tv');
    const tmdbItems = await batchTmdbItems(c.env, tvOnly as any);
    const canonicalTitles = new Set(tmdbItems.map((item) => normalizedSearchTitle(item.title)));
    const movieboxItems = await batchMovieboxItems(c.env, moviebox.filter((item) => item.subjectType === 2 || item.type === 'tv'), 'tv', canonicalTitles);
    results = [...tmdbItems, ...movieboxItems];

    totalPages = tmdb.total_pages;
    totalResults = tmdb.total_results + movieboxItems.length;

  } else {
    // All — fan-out TMDB + AniList in parallel
    const [tmdb, anilistResult, moviebox] = await Promise.all([
      searchTmdb(c.env, q, page),
      searchAnilist(c.env, q, page, 10),
      searchMoviebox(c.env, q),
    ]);

    // TMDB supplies movies and TV; AniList supplies anime. Avoid one metadata
    // check per TMDB result so fresh all-search requests stay within limits.
    const noAnime = tmdb.results as any[];

    const [tmdbItems, animeItems] = await Promise.all([
      batchTmdbItems(c.env, noAnime as any),
      batchAnilistItems(c.env, anilistResult.media),
    ]);
    const canonicalTitles = new Set([
      ...tmdbItems.map((item) => normalizedSearchTitle(item.title)),
      ...animeItems.map((item) => normalizedSearchTitle(item.title)),
    ]);
    const [movieboxMovies, movieboxTv] = await Promise.all([
      batchMovieboxItems(c.env, moviebox.filter((item) => item.subjectType === 1 || item.type === 'movie'), 'movie', canonicalTitles),
      batchMovieboxItems(c.env, moviebox.filter((item) => item.subjectType === 2 || item.type === 'tv'), 'tv', canonicalTitles),
    ]);

    // Interleave: canonical TMDB/AniList results first, then permitted MovieBox variants.
    results = [
      ...tmdbItems.filter((i): i is ContentItem => i !== null),
      ...animeItems,
      ...movieboxMovies,
      ...movieboxTv,
    ];
    totalPages = Math.max(tmdb.total_pages, anilistResult.hasNextPage ? page + 1 : page);
    totalResults = tmdb.total_results + animeItems.length + movieboxMovies.length + movieboxTv.length;
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
    batchTmdbItems(c.env, noAnime.slice(0, 5) as any),
    batchAnilistItems(c.env, anilistResult.media.slice(0, 5)),
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

  const [tmdb, moviebox] = await Promise.all([searchTmdb(c.env, q, page), searchMoviebox(c.env, q)]);
  const movieOnly = tmdb.results.filter((r) => r.media_type === 'movie');
  const tmdbItems = await batchTmdbItems(c.env, movieOnly as any);
  const canonicalTitles = new Set(tmdbItems.map((item) => normalizedSearchTitle(item.title)));
  const movieboxItems = await batchMovieboxItems(c.env, moviebox.filter((item) => item.subjectType === 1 || item.type === 'movie'), 'movie', canonicalTitles);
  const results = [...tmdbItems, ...movieboxItems];

  const payload = { page, total_pages: tmdb.total_pages, total_results: tmdb.total_results + movieboxItems.length, results };
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

  const [tmdb, moviebox] = await Promise.all([searchTmdb(c.env, q, page), searchMoviebox(c.env, q)]);
  const tvOnly = tmdb.results.filter((r) => r.media_type === 'tv');
  const tmdbItems = await batchTmdbItems(c.env, tvOnly as any);
  const canonicalTitles = new Set(tmdbItems.map((item) => normalizedSearchTitle(item.title)));
  const movieboxItems = await batchMovieboxItems(c.env, moviebox.filter((item) => item.subjectType === 2 || item.type === 'tv'), 'tv', canonicalTitles);
  const results = [...tmdbItems, ...movieboxItems];

  const payload = { page, total_pages: tmdb.total_pages, total_results: tmdb.total_results + movieboxItems.length, results };
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
  const items = await batchAnilistItems(c.env, media);

  const payload = { page, total_pages: hasNextPage ? page + 1 : page, total_results: items.length, results: items };
  await kvSet(c.env, cacheKey, payload, TTL.search);
  return jsonResponse(payload);
});

export default search;
