// worker/src/routes/anime.ts
// Anime-specific endpoints (20 total):
//   GET /anime/seasons
//   GET /anime/seasons/:year/:season
//   GET /anime/schedule
//   GET /anime/rankings/alltime
//   GET /anime/rankings/popular
//   GET /anime/rankings/season/:year/:season
//   GET /anime/rankings/genre/:genre
//   GET /anime/airing
//   GET /anime/upcoming
//   GET /anime/format/:format
//   GET /anime/demographic/:demographic
//   GET /anime/source/:source
//   GET /anime/genre/:genre
//   GET /anime/studios
//   GET /anime/studio/:studioId
//   GET /anime/:spunId/themes
//   GET /anime/:spunId/fillers
//   GET /anime/:spunId/franchise
//   GET /anime/:spunId/characters
//   GET /anime/:spunId/related

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { ContentItem, RankedItem, AiringEntry } from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import {
  getAnilistAiring,
  getAnilistUpcoming,
  getAnilistSeasonal,
  getAnilistSeasonsList,
  getAnilistRankingsAlltime,
  getAnilistRankingsPopular,
  getAnilistRankingsSeason,
  getAnilistRankingsGenre,
  getAnilistByFormat,
  getAnilistByDemographic,
  getAnilistBySource,
  getAnilistByGenre,
  getAnilistStudios,
  getAnilistStudioWorks,
  getAnilistMedia,
  anilistTitle,
  normalizeAnilistItem,
  formatCountdown,
} from '../metadata/anilist.js';
import { getJikanThemes, getJikanFillers } from '../metadata/jikan.js';
import { resolveFromAnilist, getBySpunId } from '../identity/resolver.js';
import {
  normalizeRankedItem,
  normalizeAiringEntry,
  anilistToItem,
  normalizeAnimeInfo,
  jsonResponse,
  errorResponse,
} from '../normalizer.js';
import { getGenreById } from '../config/genres.js';

const anime = new Hono<{ Bindings: Env }>();

// ─── Helper: AniList media list → ContentItems with spun_ids ─────────────────

async function toItems(env: Env, media: any[]): Promise<ContentItem[]> {
  return Promise.all(
    media.map(async (m) => {
      const title = anilistTitle(m);
      const row   = await resolveFromAnilist(env, m.id, title, { malId: m.idMal ?? undefined });
      return anilistToItem(m, row.spun_id);
    })
  );
}

// ─── GET /anime/seasons ───────────────────────────────────────────────────────

anime.get('/seasons', async (c) => {
  const cacheKey = CacheKeys.animeSeasons();
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const seasons = await getAnilistSeasonsList(c.env);
  const payload = { seasons };
  await kvSet(c.env, cacheKey, payload, TTL.animeSchedule);
  return jsonResponse(payload);
});

// ─── GET /anime/seasons/:year/:season ─────────────────────────────────────────

anime.get('/seasons/:year/:season', async (c) => {
  const year   = parseInt(c.req.param('year'));
  const season = c.req.param('season').toUpperCase();
  const page   = parseInt(c.req.query('page') ?? '1');

  if (!['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(season)) {
    return errorResponse('INVALID_SEASON', 'Season must be winter, spring, summer, or fall.', 400);
  }

  const cacheKey = CacheKeys.animeSeason(year, season, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const media   = await getAnilistSeasonal(c.env, season, year, page);
  const results = await toItems(c.env, media);
  const payload = { year, season: season.toLowerCase(), page, has_more: media.length >= 20, results };
  await kvSet(c.env, cacheKey, payload, TTL.animeSchedule);
  return jsonResponse(payload);
});

// ─── GET /anime/schedule ──────────────────────────────────────────────────────

anime.get('/schedule', async (c) => {
  const cacheKey = CacheKeys.animeSchedule();
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const airing = await getAnilistAiring(c.env, 1, 50);

  const entries: (AiringEntry | null)[] = await Promise.all(
    airing.map(async (m) => {
      if (!m.nextAiringEpisode) return null;
      const title = anilistTitle(m);
      const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
      return normalizeAiringEntry(m, row.spun_id);
    })
  );

  const schedule = entries.filter((e): e is AiringEntry => e !== null);

  // Group by day of week
  const grouped: Record<string, AiringEntry[]> = {
    monday: [], tuesday: [], wednesday: [], thursday: [],
    friday: [], saturday: [], sunday: [],
  };

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const entry of schedule) {
    const day = days[new Date(entry.airing_at).getDay()];
    if (day) grouped[day].push(entry);
  }

  const payload = { schedule: grouped };
  await kvSet(c.env, cacheKey, payload, TTL.animeSchedule);
  return jsonResponse(payload);
});

// ─── GET /anime/rankings/alltime ──────────────────────────────────────────────

anime.get('/rankings/alltime', async (c) => {
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeRankAlltime(page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const media = await getAnilistRankingsAlltime(c.env, page);
  const results: RankedItem[] = await Promise.all(
    media.map(async (m, i) => {
      const title = anilistTitle(m);
      const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
      return normalizeRankedItem(m, row.spun_id, (page - 1) * 25 + i + 1);
    })
  );

  const payload = { page, has_more: media.length >= 25, results };
  await kvSet(c.env, cacheKey, payload, TTL.animeRankings);
  return jsonResponse(payload);
});

// ─── GET /anime/rankings/popular ──────────────────────────────────────────────

anime.get('/rankings/popular', async (c) => {
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeRankPopular(page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const media = await getAnilistRankingsPopular(c.env, page);
  const results: RankedItem[] = await Promise.all(
    media.map(async (m, i) => {
      const title = anilistTitle(m);
      const row   = await resolveFromAnilist(c.env, m.id, title, { malId: m.idMal ?? undefined });
      return normalizeRankedItem(m, row.spun_id, (page - 1) * 25 + i + 1);
    })
  );

  const payload = { page, has_more: media.length >= 25, results };
  await kvSet(c.env, cacheKey, payload, TTL.animeRankings);
  return jsonResponse(payload);
});

// ─── GET /anime/rankings/season/:year/:season ─────────────────────────────────

anime.get('/rankings/season/:year/:season', async (c) => {
  const year   = parseInt(c.req.param('year'));
  const season = c.req.param('season').toUpperCase();
  const page   = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeRankSeason(year, season, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const media = await getAnilistRankingsSeason(c.env, year, season, page);
  const results: RankedItem[] = await Promise.all(
    media.map(async (m, i) => {
      const title = anilistTitle(m);
      const row   = await resolveFromAnilist(c.env, m.id, title);
      return normalizeRankedItem(m, row.spun_id, (page - 1) * 25 + i + 1);
    })
  );

  const payload = { year, season: season.toLowerCase(), page, has_more: media.length >= 25, results };
  await kvSet(c.env, cacheKey, payload, TTL.animeRankings);
  return jsonResponse(payload);
});

// ─── GET /anime/rankings/genre/:genre ────────────────────────────────────────

anime.get('/rankings/genre/:genre', async (c) => {
  const genreId  = c.req.param('genre');
  const page     = parseInt(c.req.query('page') ?? '1');
  const genreDef = getGenreById(genreId);
  if (!genreDef?.anilist_genres?.[0]) {
    return errorResponse('INVALID_GENRE', 'Genre not found or not available for anime.', 400);
  }
  const cacheKey = CacheKeys.animeRankGenre(genreId, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const media = await getAnilistRankingsGenre(c.env, genreDef.anilist_genres[0], page);
  const results: RankedItem[] = await Promise.all(
    media.map(async (m, i) => {
      const title = anilistTitle(m);
      const row   = await resolveFromAnilist(c.env, m.id, title);
      return normalizeRankedItem(m, row.spun_id, (page - 1) * 25 + i + 1);
    })
  );

  const payload = { genre: genreId, page, has_more: media.length >= 25, results };
  await kvSet(c.env, cacheKey, payload, TTL.animeRankings);
  return jsonResponse(payload);
});

// ─── GET /anime/airing ────────────────────────────────────────────────────────

anime.get('/airing', async (c) => {
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeAiring(page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const media   = await getAnilistAiring(c.env, page);
  const results = await toItems(c.env, media);
  const payload = { page, has_more: media.length >= 20, results };
  await kvSet(c.env, cacheKey, payload, TTL.animeSchedule);
  return jsonResponse(payload);
});

// ─── GET /anime/upcoming ──────────────────────────────────────────────────────

anime.get('/upcoming', async (c) => {
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeUpcoming(page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const media   = await getAnilistUpcoming(c.env, page);
  const results = await toItems(c.env, media);
  const payload = { page, has_more: media.length >= 20, results };
  await kvSet(c.env, cacheKey, payload, TTL.animeSchedule);
  return jsonResponse(payload);
});

// ─── GET /anime/format/:format ────────────────────────────────────────────────

anime.get('/format/:format', async (c) => {
  const format   = c.req.param('format');
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeFormat(format, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const { media, total, hasNextPage } = await getAnilistByFormat(c.env, format, page);
  const results = await toItems(c.env, media);
  const payload = { format, page, total, has_more: hasNextPage, results };
  await kvSet(c.env, cacheKey, payload, TTL.discover);
  return jsonResponse(payload);
});

// ─── GET /anime/demographic/:demographic ─────────────────────────────────────

anime.get('/demographic/:demographic', async (c) => {
  const demographic = c.req.param('demographic');
  const page        = parseInt(c.req.query('page') ?? '1');
  const cacheKey    = CacheKeys.animeDemographic(demographic, page);
  const cached      = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const { media, total, hasNextPage } = await getAnilistByDemographic(c.env, demographic, page);
  const results = await toItems(c.env, media);
  const payload = { demographic, page, total, has_more: hasNextPage, results };
  await kvSet(c.env, cacheKey, payload, TTL.discover);
  return jsonResponse(payload);
});

// ─── GET /anime/source/:source ────────────────────────────────────────────────

anime.get('/source/:source', async (c) => {
  const source   = c.req.param('source');
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeSource(source, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const { media, total, hasNextPage } = await getAnilistBySource(c.env, source, page);
  const results = await toItems(c.env, media);
  const payload = { source, page, total, has_more: hasNextPage, results };
  await kvSet(c.env, cacheKey, payload, TTL.discover);
  return jsonResponse(payload);
});

// ─── GET /anime/genre/:genre ──────────────────────────────────────────────────

anime.get('/genre/:genre', async (c) => {
  const genreId  = c.req.param('genre');
  const page     = parseInt(c.req.query('page') ?? '1');
  const genreDef = getGenreById(genreId);
  
  if (!genreDef) {
    return errorResponse('INVALID_GENRE', 'Unknown genre.', 400);
  }

  const anilistGenre = genreDef.anilist_genres?.[0];
  const anilistTag   = genreDef.anilist_tags?.[0];
  
  if (!anilistGenre && !anilistTag) {
    return errorResponse('INVALID_GENRE', 'Genre not available for anime.', 400);
  }

  const cacheKey = CacheKeys.animeGenre(genreId, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const media = anilistTag
    ? await getAnilistByTag(c.env, anilistTag, page)
    : await getAnilistByGenre(c.env, anilistGenre!, page);

  const results = await toItems(c.env, media);
  const payload = { genre: genreId, page, has_more: media.length >= 20, results };
  await kvSet(c.env, cacheKey, payload, TTL.discover);
  return jsonResponse(payload);
});

// ─── GET /anime/studios ───────────────────────────────────────────────────────

anime.get('/studios', async (c) => {
  const q        = c.req.query('q');
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeStudios(q ?? '', page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const { studios, hasNextPage } = await getAnilistStudios(c.env, q, page);
  const payload = { page, has_more: hasNextPage, studios };
  await kvSet(c.env, cacheKey, payload, TTL.studio);
  return jsonResponse(payload);
});

// ─── GET /anime/studio/:studioId ─────────────────────────────────────────────

anime.get('/studio/:studioId', async (c) => {
  const studioId = parseInt(c.req.param('studioId'));
  const page     = parseInt(c.req.query('page') ?? '1');
  if (isNaN(studioId)) return errorResponse('INVALID_ID', 'Studio ID must be a number.', 400);

  const cacheKey = CacheKeys.animeStudio(studioId, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const { name, works_count, media, hasNextPage } = await getAnilistStudioWorks(c.env, studioId, page);
  const results = await toItems(c.env, media);
  const payload = {
    studio:      { id: studioId, name },
    works_count,
    page,
    has_more:    hasNextPage,
    results,
  };
  await kvSet(c.env, cacheKey, payload, TTL.studio);
  return jsonResponse(payload);
});

// ─── GET /anime/:spunId/themes ────────────────────────────────────────────────

anime.get('/:spunId/themes', async (c) => {
  const spunId   = c.req.param('spunId');
  const cacheKey = CacheKeys.animeThemes(spunId);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row || row.content_type !== 'anime') {
    return errorResponse('NOT_FOUND', 'Anime not found.', 404);
  }

  const malId = row.mal_id;
  if (!malId) {
    // Try to get it from AniList
    if (row.anilist_id) {
      const media = await getAnilistMedia(c.env, row.anilist_id);
      if (media?.idMal) {
        const themes = await getJikanThemes(c.env, media.idMal);
        const payload = { spun_id: spunId, themes };
        await kvSet(c.env, cacheKey, payload, TTL.metadata);
        return jsonResponse(payload);
      }
    }
    return jsonResponse({ spun_id: spunId, themes: [] });
  }

  const themes  = await getJikanThemes(c.env, malId);
  const payload = { spun_id: spunId, themes };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

// ─── GET /anime/:spunId/fillers ───────────────────────────────────────────────

anime.get('/:spunId/fillers', async (c) => {
  const spunId   = c.req.param('spunId');
  const page     = parseInt(c.req.query('page') ?? '1');
  const cacheKey = CacheKeys.animeFillers(spunId, page);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row || row.content_type !== 'anime') {
    return errorResponse('NOT_FOUND', 'Anime not found.', 404);
  }

  let malId = row.mal_id;
  if (!malId && row.anilist_id) {
    const media = await getAnilistMedia(c.env, row.anilist_id);
    malId = media?.idMal ?? null;
  }

  if (!malId) return jsonResponse({ spun_id: spunId, fillers: [], has_more: false });

  const allFillers = await getJikanFillers(c.env, malId);
  // JikanFillers isn't paginated in the proxy yet, return all
  const payload = { spun_id: spunId, page, has_more: false, fillers: allFillers };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

// ─── GET /anime/:spunId/franchise ─────────────────────────────────────────────

anime.get('/:spunId/franchise', async (c) => {
  const spunId = c.req.param('spunId');

  const row = await getBySpunId(c.env, spunId);
  if (!row || row.content_type !== 'anime' || !row.anilist_id) {
    return errorResponse('NOT_FOUND', 'Anime not found.', 404);
  }

  const media = await getAnilistMedia(c.env, row.anilist_id);
  if (!media) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

  const relationEdges = (media.relations?.edges ?? [])
    .filter((e: any) => e.node?.type === 'ANIME')
    .sort((a: any, b: any) => (a.node.startDate?.year ?? 9999) - (b.node.startDate?.year ?? 9999));

  const franchise = await Promise.all(
    relationEdges.map(async (edge: any, i: number) => {
      const node  = edge.node;
      const title = node.title?.english || node.title?.romaji || '';
      const relRow = await resolveFromAnilist(c.env, node.id, title);
      return {
        order:    i + 1,
        spun_id:  relRow.spun_id,
        title,
        year:     node.startDate?.year     ?? null,
        format:   node.format              ?? null,
        poster:   node.coverImage?.large   ?? null,
        relation: edge.relationType,
        note:     null,
      };
    })
  );

  return jsonResponse({ spun_id: spunId, franchise });
});

// ─── GET /anime/:spunId/characters ────────────────────────────────────────────

anime.get('/:spunId/characters', async (c) => {
  const spunId = c.req.param('spunId');

  const row = await getBySpunId(c.env, spunId);
  if (!row || row.content_type !== 'anime' || !row.anilist_id) {
    return errorResponse('NOT_FOUND', 'Anime not found.', 404);
  }

  const media = await getAnilistMedia(c.env, row.anilist_id);
  if (!media) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

  const characters = (media.characters?.edges ?? []).map((edge: any) => {
    const va = edge.voiceActors?.[0];
    return {
      image:     edge.node.image?.large ?? null,
      character: edge.node.name?.full   ?? null,
      name:      va?.name?.full         ?? edge.node.name?.full ?? '',
    };
  });

  return jsonResponse({ spun_id: spunId, characters });
});

// ─── GET /anime/:spunId/related ───────────────────────────────────────────────
// Handled in info route — mounted separately as /anime/:spunId/related
// to avoid duplication. Redirect to /info/:spunId/related.

anime.get('/:spunId/related', async (c) => {
  const spunId = c.req.param('spunId');
  return c.redirect(`/info/${spunId}/related`, 307);
});

export default anime;
