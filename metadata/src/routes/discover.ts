// metadata/src/routes/discover.ts
// Discover endpoints:
//   GET /discover/:type?genre=&studio=&page=
//   GET /trending?type=&page=
//   GET /popular?type=&page=
//   GET /new?type=&page=
//   GET /genres
//   GET /studios
//   GET /studio/:studioId?page=

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { ContentItem } from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import {
  tmdbDiscover,
  getTmdbTrending,
} from '../meta/tmdb.js';
import {
  getAnilistTrending,
  getAnilistPopular,
  getAnilistByGenre,
  getAnilistByTag,
  getAnilistStudioWorks,
  anilistTitle,
} from '../meta/anilist.js';
import { resolveFromTmdb, resolveFromAnilist } from '../identity/resolver.js';
import {
  tmdbResultToItem,
  anilistToItem,
  jsonResponse,
  errorResponse,
} from '../normalizer.js';
import { getGenreById, getGenresByContentType, GENRES, GENRE_GROUPS } from '../config/genres.js';
import { getDb } from '../db.js';

const discover = new Hono<{ Bindings: Env }>();

// ─── Studio discover params builder ──────────────────────────────────────────

interface StudioRow {
  spun_studio_id: string;
  name:           string;
  category:       string;
  query_type:     string;
  query_value:    string;
  description:    string | null;
  logo_url:       string | null;
}

function buildStudioDiscoverParams(
  studio:    StudioRow,
  mediaType: 'movie' | 'tv'
): Record<string, string | number> | null {
  switch (studio.query_type) {
    case 'watch_provider':
      return {
        with_watch_providers: studio.query_value,
        watch_region:         'US',
      };
    case 'network':
      if (mediaType !== 'tv') return null;
      return { with_networks: studio.query_value };
    case 'company':
      return { with_companies: studio.query_value };
    default:
      return null;
  }
}

// ─── GET /discover/:type ──────────────────────────────────────────────────────

// ─── GET /trending ────────────────────────────────────────────────────────────

discover.get('/trending', async (c) => {
  // Note: registered before /:type so "trending" isn't treated as a type param
  const rawType = c.req.query('type') ?? 'all';
  const page    = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.trending(rawType);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  let results: ContentItem[] = [];

  if (rawType === 'anime') {
    const media = await getAnilistTrending(c.env, page);
    results = await Promise.all(
      media.map(async (m) => {
        const title = anilistTitle(m);
        const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
        return anilistToItem(m, row.spun_id);
      })
    );
  } else if (rawType === 'movie' || rawType === 'tv') {
    const raw = await getTmdbTrending(c.env, rawType, page);
    results   = await Promise.all(
      raw.filter((r) => r.media_type === rawType).map(async (r) => {
        const title = r.title || r.name || '';
        const row   = await resolveFromTmdb(c.env, r.id, rawType, title);
        return tmdbResultToItem(r, row.spun_id, rawType);
      })
    );
  } else {
    // All — fan-out TMDB + AniList
    const [tmdbRaw, animeMedia] = await Promise.all([
      getTmdbTrending(c.env, 'all', page),
      getAnilistTrending(c.env, page, 10),
    ]);
    const [tmdbItems, animeItems] = await Promise.all([
      Promise.all(
        tmdbRaw
          .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
          .slice(0, 20)
          .map(async (r) => {
            const type  = r.media_type as 'movie' | 'tv';
            const title = r.title || r.name || '';
            const row   = await resolveFromTmdb(c.env, r.id, type, title);
            return tmdbResultToItem(r, row.spun_id, type);
          })
      ),
      Promise.all(
        animeMedia.map(async (m) => {
          const title = anilistTitle(m);
          const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
          return anilistToItem(m, row.spun_id);
        })
      ),
    ]);
    results = [...tmdbItems, ...animeItems];
  }

  const payload = { page, has_more: results.length >= 20, results };
  await kvSet(c.env, cacheKey, payload, TTL.discover);
  return jsonResponse(payload);
});

// ─── GET /popular ─────────────────────────────────────────────────────────────

discover.get('/popular', async (c) => {
  const rawType = c.req.query('type') ?? 'all';
  const page    = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.popular(rawType);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  let results: ContentItem[] = [];

  if (rawType === 'anime') {
    const media = await getAnilistPopular(c.env, page);
    results = await Promise.all(
      media.map(async (m) => {
        const title = anilistTitle(m);
        const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
        return anilistToItem(m, row.spun_id);
      })
    );
  } else {
    const type   = (rawType === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv';
    const params: Record<string, string | number> = { sort_by: 'popularity.desc' };
    
    if (type === 'tv') {
      params['vote_count.gte']   = 50;
      params['vote_average.gte'] = 5.0;
    }

    const raw = await tmdbDiscover(c.env, type, params, page);
    results      = await Promise.all(
      raw.map(async (r) => {
        const title = r.title || r.name || '';
        const row   = await resolveFromTmdb(c.env, r.id, type, title);
        return tmdbResultToItem(r, row.spun_id, type);
      })
    );
  }

  const payload = { page, has_more: results.length >= 20, results };
  await kvSet(c.env, cacheKey, payload, TTL.discover);
  return jsonResponse(payload);
});

// ─── GET /new ─────────────────────────────────────────────────────────────────

discover.get('/new', async (c) => {
  const rawType = c.req.query('type') ?? 'all';
  const page    = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.newContent(rawType);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const currentYear = new Date().getFullYear();
  let results: ContentItem[] = [];

  if (rawType === 'anime') {
    const media = await getAnilistTrending(c.env, page);
    const recent = media.filter((m) =>
      m.startDate?.year && m.startDate.year >= currentYear - 1
    );
    results = await Promise.all(
      recent.map(async (m) => {
        const title = anilistTitle(m);
        const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
        return anilistToItem(m, row.spun_id);
      })
    );
  } else {
    const type   = (rawType === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv';
    const dateField = type === 'movie' ? 'primary_release_date' : 'first_air_date';
    const raw    = await tmdbDiscover(c.env, type, {
      sort_by:                   'release_date.desc',
      [`${dateField}.gte`]:      `${currentYear - 1}-01-01`,
      [`${dateField}.lte`]:      new Date().toISOString().slice(0, 10),
      'vote_count.gte':          50,
    }, page);
    results = await Promise.all(
      raw.map(async (r) => {
        const title = r.title || r.name || '';
        const row   = await resolveFromTmdb(c.env, r.id, type, title);
        return tmdbResultToItem(r, row.spun_id, type);
      })
    );
  }

  const payload = { page, has_more: results.length >= 20, results };
  await kvSet(c.env, cacheKey, payload, TTL.discover);
  return jsonResponse(payload);
});

// ─── GET /genres ──────────────────────────────────────────────────────────────

discover.get('/genres', async (c) => {
  const typeFilter = c.req.query('type') as 'movie' | 'tv' | 'anime' | undefined;
  const cacheKey   = CacheKeys.genres();
  const cached     = await kvGet(c.env, cacheKey);
  if (cached && !typeFilter) return jsonResponse(cached);

  const allGenres = typeFilter ? getGenresByContentType(typeFilter) : GENRES;

  // Build groups
  const payload = {
    groups: GENRE_GROUPS.map((group) => ({
      id:     group.id,
      label:  group.label,
      genres: group.genreIds
        .map((gid) => allGenres.find((g) => g.id === gid))
        .filter((g): g is NonNullable<typeof g> => g !== undefined)
        .map((g) => ({
          id:            g.id,
          name:          g.name,
          description:   g.description,
          content_types: g.content_types,
        })),
    })).filter((group) => group.genres.length > 0),
  };

  if (!typeFilter) await kvSet(c.env, cacheKey, payload, TTL.genres);
  return jsonResponse(payload);
});

// ─── GET /studios ─────────────────────────────────────────────────────────────

discover.get('/studios', async (c) => {
  const category = c.req.query('category');
  const cacheKey = CacheKeys.studios();
  const cached   = await kvGet(c.env, cacheKey);
  if (cached && !category) return jsonResponse(cached);

  const sql  = getDb(c.env);
  const rows = category
    ? await sql`SELECT * FROM studio_ids WHERE category = ${category} ORDER BY name`
    : await sql`SELECT * FROM studio_ids ORDER BY category, name`;

  const studios = (rows as StudioRow[]).map((s) => ({
    spun_studio_id: s.spun_studio_id,
    name:           s.name,
    category:       s.category,
    description:    s.description ?? '',
    logo:           s.logo_url    ?? '',
  }));

  const payload = { studios };
  if (!category) await kvSet(c.env, cacheKey, payload, TTL.genres);
  return jsonResponse(payload);
});

// ─── GET /studio/:studioId ────────────────────────────────────────────────────

discover.get('/studio/:studioId', async (c) => {
  const studioId = c.req.param('studioId');
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.studio(studioId, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const sql  = getDb(c.env);
  const rows = await sql`
    SELECT * FROM studio_ids WHERE spun_studio_id = ${studioId} LIMIT 1
  `;
  if (!rows.length) return errorResponse('NOT_FOUND', 'Studio not found.', 404);

  const studio = rows[0] as StudioRow;
  let results:  ContentItem[] = [];
  let hasMore = false;

  if (studio.query_type === 'anilist_studio') {

    const anilistStudioId = parseInt(studio.query_value);
    const { media, hasNextPage } = await getAnilistStudioWorks(
      c.env, anilistStudioId, page
    );

    results = await Promise.all(
      media.map(async (m) => {
        const title = anilistTitle(m);
        const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
        return anilistToItem(m, row.spun_id);
      })
    );
    hasMore = hasNextPage;
  } else {
    // TMDB-based studio (watch_provider, network, company)
    for (const type of ['movie', 'tv'] as const) {
      const params = buildStudioDiscoverParams(studio, type);
      if (!params) continue;

      if (type === 'tv') {
        params['vote_count.gte'] = 100;
      }

      const raw = await tmdbDiscover(c.env, type, params, page);
      const items = await Promise.all(
        raw.map(async (r) => {
          const title = r.title || r.name || '';
          const row   = await resolveFromTmdb(c.env, r.id, type, title);
          return tmdbResultToItem(r, row.spun_id, type);
        })
      );
      results.push(...items);
    }
    // Sort by rating desc
    results.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    hasMore = results.length >= 20;
  }

  const payload = {
    studio: {
      spun_studio_id: studio.spun_studio_id,
      name:           studio.name,
      category:       studio.category,
      description:    studio.description ?? '',
      logo:           studio.logo_url    ?? '',
    },
    page,
    has_more: hasMore,
    results,
  };

  await kvSet(c.env, cacheKey, payload, TTL.studio);
  return jsonResponse(payload);
});

discover.get('/:type', async (c) => {
  const rawType = c.req.param('type');
  const genre   = c.req.query('genre');
  const studio  = c.req.query('studio');
  const page    = parseInt(c.req.query('page') ?? '1');

  if (!['movie', 'tv', 'anime'].includes(rawType)) {
    return errorResponse('INVALID_TYPE', 'Type must be movie, tv, or anime.', 400);
  }

  const cacheKey = CacheKeys.discover(rawType, genre ?? studio ?? 'all', page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  let results:  ContentItem[] = [];
  let hasMore = false;

  if (rawType === 'anime') {
    if (genre) {
      const genreDef = getGenreById(genre);
      if (!genreDef) return errorResponse('INVALID_GENRE', 'Unknown genre.', 400);

      const anilistGenre = genreDef.anilist_genres?.[0];
      const anilistTag   = genreDef.anilist_tags?.[0];
      
      if (!anilistGenre && !anilistTag) {
        return errorResponse('INVALID_GENRE', 'Genre not available for anime.', 400);
      }

      const media = anilistTag
        ? await getAnilistByTag(c.env, anilistTag, page)
        : await getAnilistByGenre(c.env, anilistGenre!, page);

      const items = await Promise.all(
        media.map(async (m) => {
          const title = anilistTitle(m);
          const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
          return anilistToItem(m, row.spun_id);
        })
      );
      results = items;
      hasMore = media.length === 20;
    } else {
      const media = await getAnilistPopular(c.env, page);
      const items = await Promise.all(
        media.map(async (m) => {
          const title = anilistTitle(m);
          const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
          return anilistToItem(m, row.spun_id);
        })
      );
      results = items;
      hasMore = media.length === 20;
    }
  } else {
    const mediaType = rawType as 'movie' | 'tv';
    let params: Record<string, string | number | boolean> = {
      sort_by: 'popularity.desc',
    };

    if (mediaType === 'tv') {
      params['vote_count.gte']   = 50;
      params['vote_average.gte'] = 5.0;
    }

    if (studio) {
      // Fetch studio from DB
      const sql  = getDb(c.env);
      const rows = await sql`
        SELECT * FROM studio_ids WHERE spun_studio_id = ${studio} LIMIT 1
      `;
      if (!rows.length) return errorResponse('INVALID_STUDIO', 'Unknown studio.', 400);

      const studioRow   = rows[0] as StudioRow;
      const studioParams = buildStudioDiscoverParams(studioRow, mediaType);
      if (!studioParams) {
        return errorResponse('INVALID_STUDIO', 'Studio not available for this content type.', 400);
      }
      params = { ...params, ...studioParams };

      if (mediaType === 'tv') {
        params['vote_count.gte'] = 100;
      }
    }

    if (genre) {
      const genreDef = getGenreById(genre);
      if (!genreDef) return errorResponse('INVALID_GENRE', 'Unknown genre.', 400);

      const genreIds = mediaType === 'movie'
        ? genreDef.tmdb_movie_genre_ids ?? []
        : genreDef.tmdb_tv_genre_ids    ?? [];

      if (!genreIds.length) {
        return errorResponse('INVALID_GENRE', 'Genre not available for this content type.', 400);
      }
      params.with_genres = genreIds.join(',');
    }

    const raw   = await tmdbDiscover(c.env, mediaType, params, page);
    const items = await Promise.all(
      raw.map(async (r) => {
        const title = r.title || r.name || '';
        const row   = await resolveFromTmdb(c.env, r.id, mediaType, title);
        return tmdbResultToItem(r, row.spun_id, mediaType);
      })
    );
    results = items;
    hasMore = raw.length === 20;
  }

  const payload = { page, has_more: hasMore, results };
  await kvSet(c.env, cacheKey, payload, TTL.discover);
  return jsonResponse(payload);
});
export default discover;
