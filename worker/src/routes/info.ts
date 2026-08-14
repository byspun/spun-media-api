// worker/src/routes/info.ts
// Info endpoints:
//   GET /info/:spunId              — full metadata
//   GET /info/:spunId/episodes     — episode list (TV + anime)
//   GET /info/:spunId/cast         — cast list
//   GET /info/:spunId/related      — structural title relations and groups

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { RelatedEntry, RelatedResponse } from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import { getBySpunId } from '../identity/resolver.js';
import {
  getTmdbMovieDetail,
  getTmdbTvDetail,
  getTmdbSeasonDetail,
  tmdbProfile,
} from '../metadata/tmdb.js';
import { getAnilistMedia } from '../metadata/anilist.js';
import { getJikanEpisodes } from '../metadata/jikan.js';
import {
  normalizeMovieInfo,
  normalizeTvInfo,
  normalizeAnimeInfo,
  normalizeTvEpisodes,
  anilistToItem,
  jsonResponse,
  errorResponse,
} from '../normalizer.js';
import {
  resolveFromAnilist,
  linkMalId,
} from '../identity/resolver.js';
import { getMembershipSummaries, getRelationshipGroups } from '../relationships.js';

const info = new Hono<{ Bindings: Env }>();

// ─── GET /info/:spunId ────────────────────────────────────────────────────────

info.get('/:spunId', async (c) => {
  const spunId   = c.req.param('spunId');
  const cacheKey = CacheKeys.info(spunId);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  let payload: unknown;
  if (row.content_type === 'movie' && row.tmdb_id) {
    const movie = await getTmdbMovieDetail(c.env, row.tmdb_id);
    if (!movie) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

    const movieInfo = normalizeMovieInfo(spunId, movie);
    try {
      movieInfo.part_of = await getMembershipSummaries(c.env, row, movie.belongs_to_collection);
    } catch (err) {
      console.error('[Info] Movie relationship context failed:', err);
    }
    payload = movieInfo;

  } else if (row.content_type === 'tv' && row.tmdb_id) {
    const tv = await getTmdbTvDetail(c.env, row.tmdb_id);
    if (!tv) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

    const tvInfo = normalizeTvInfo(spunId, tv);
    try {
      tvInfo.part_of = await getMembershipSummaries(c.env, row);
    } catch (err) {
      console.error('[Info] TV relationship context failed:', err);
    }
    payload = tvInfo;

  } else if (row.content_type === 'anime' && row.anilist_id) {
    const media = await getAnilistMedia(c.env, row.anilist_id);
    if (!media) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

    // Back-fill MAL ID if we now have it
    if (media.idMal && !row.mal_id) {
      linkMalId(c.env, spunId, media.idMal).catch(() => {});
    }

    const animeInfo = normalizeAnimeInfo(spunId, media);
    try {
      animeInfo.part_of = await getMembershipSummaries(c.env, row);
    } catch (err) {
      console.error('[Info] Anime relationship context failed:', err);
    }
    payload = animeInfo;
    // Use shorter TTL for airing anime
    const ttl = media.status === 'RELEASING' ? TTL.metadataAiring : TTL.metadata;
    await kvSet(c.env, cacheKey, payload, ttl);
    return jsonResponse(payload);

  } else {
    return errorResponse('MISSING_EXTERNAL_ID', 'Title has no external ID mapped.', 500);
  }

  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

// ─── GET /info/:spunId/episodes ───────────────────────────────────────────────

info.get('/:spunId/episodes', async (c) => {
  const spunId   = c.req.param('spunId');
  const season   = c.req.query('season');
  const cacheKey = CacheKeys.episodes(spunId);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  if (row.content_type === 'movie') {
    return errorResponse('INVALID_TYPE', 'Movies do not have episodes.', 400);
  }

  if (row.content_type === 'tv' && row.tmdb_id) {
    const tv = await getTmdbTvDetail(c.env, row.tmdb_id);
    if (!tv) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

    // Determine which seasons to fetch
    const realSeasons = tv.seasons.filter((s) => s.season_number > 0);
    const targets     = season
      ? realSeasons.filter((s) => s.season_number === parseInt(season))
      : realSeasons;

    // Fetch season details in parallel (up to 5 seasons at once to stay safe)
    const CHUNK = 5;
    const detailedSeasons: Array<{ season: any; airingFilter: boolean }> = [];

    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      const details = await Promise.all(
        chunk.map((s) => getTmdbSeasonDetail(c.env, row.tmdb_id!, s.season_number))
      );
      details.forEach((detail) => {
        if (detail) {
          detailedSeasons.push({
            season:       detail,
            airingFilter: tv.status === 'Returning Series',
          });
        }
      });
    }

    const payload = normalizeTvEpisodes(spunId, detailedSeasons);
    const ttl     = tv.status === 'Returning Series' ? TTL.episodesAiring : TTL.episodes;
    await kvSet(c.env, cacheKey, payload, ttl);
    return jsonResponse(payload);
  }

  if (row.content_type === 'anime' && row.anilist_id) {
    const media = await getAnilistMedia(c.env, row.anilist_id);
    if (!media) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

    const malId = media.idMal ?? row.mal_id;
    if (!malId) {
      // No MAL ID — return episode count stubs from AniList
      const episodeCount = media.episodes ?? 0;
      const payload = {
        spun_id: spunId,
        type:    'anime',
        seasons: [{
          season:   1,
          count:    episodeCount,
          episodes: Array.from({ length: episodeCount }, (_, i) => ({
            number:    i + 1,
            season:    1,
            title:     null,
            overview:  null,
            thumbnail: null,
            runtime:   null,
            air_date:  null,
          })),
        }],
      };
      return jsonResponse(payload);
    }

    // Fetch full episode list from Jikan
    const episodes   = await getJikanEpisodes(c.env, malId);
    const isAiring   = media.status === 'RELEASING';

    // For airing shows, only include aired episodes
    const filtered = isAiring
      ? episodes.filter((ep) => ep.aired && new Date(ep.aired) <= new Date())
      : episodes;

    const payload = {
      spun_id: spunId,
      type:    'anime',
      seasons: [{
        season:   1,
        count:    filtered.length,
        episodes: filtered.map((ep) => ({
          number:    ep.mal_id,
          season:    1,
          title:     ep.title      ?? null,
          overview:  null,
          thumbnail: null,
          runtime:   null,
          air_date:  ep.aired      ?? null,
        })),
      }],
    };

    const ttl = isAiring ? TTL.episodesAiring : TTL.episodes;
    await kvSet(c.env, cacheKey, payload, ttl);
    return jsonResponse(payload);
  }

  return errorResponse('MISSING_EXTERNAL_ID', 'No external ID mapped.', 500);
});

// ─── GET /info/:spunId/cast ───────────────────────────────────────────────────

info.get('/:spunId/cast', async (c) => {
  const spunId   = c.req.param('spunId');
  const cacheKey = CacheKeys.cast(spunId);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  let cast: Array<{ image: string | null; character: string | null; name: string }> = [];

  if ((row.content_type === 'movie' || row.content_type === 'tv') && row.tmdb_id) {
    // Fetch full credits directly
    const data = await (row.content_type === 'movie'
      ? getTmdbMovieDetail(c.env, row.tmdb_id)
      : getTmdbTvDetail(c.env, row.tmdb_id));

    if (data) {
      cast = (data as any).credits.cast
        .sort((a: any, b: any) => a.order - b.order)
        .slice(0, 50)
        .map((m: any) => ({
          image:     tmdbProfile(m.profile_path),
          character: m.character || null,
          name:      m.name,
        }));
    }
  }

  if (row.content_type === 'anime' && row.anilist_id) {
    const media = await getAnilistMedia(c.env, row.anilist_id);
    if (media) {
      cast = (media.characters?.edges ?? [])
        .slice(0, 50)
        .map((edge) => {
          const va = edge.voiceActors?.[0];
          return {
            image:     edge.node.image?.large ?? null,
            character: edge.node.name?.full   ?? null,
            name:      va?.name?.full         ?? edge.node.name?.full ?? '',
          };
        });
    }
  }

  const payload = { spun_id: spunId, cast };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

// ─── GET /info/:spunId/related ────────────────────────────────────────────────

info.get('/:spunId/related', async (c) => {
  const spunId   = c.req.param('spunId');
  const cacheKey = CacheKeys.related(spunId);
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  const related: RelatedEntry[] = [];

  // Movies and TV titles do not receive generic recommendations here. Their
  // factual membership is represented by the `groups` array below.
  if (row.content_type === 'anime' && row.anilist_id) {
    const media = await getAnilistMedia(c.env, row.anilist_id);
    if (media) {
      const relationEdges = (media.relations?.edges ?? [])
        .filter((edge) => edge.node && (edge.node as any).type === 'ANIME')
        .slice(0, 10);

      const entries = await Promise.all(
        relationEdges.map(async (edge) => {
          try {
            const node = edge.node as any;
            const title = node.title?.english || node.title?.romaji || '';
            const relationRow = await resolveFromAnilist(c.env, node.id, title);
            return {
              relation: edge.relationType,
              item: anilistToItem(node, relationRow.spun_id),
            } satisfies RelatedEntry;
          } catch (err) {
            console.error('[Related] Anime relation resolution failed:', err);
            return null;
          }
        })
      );

      related.push(...entries.filter((entry): entry is RelatedEntry => entry !== null));
    }
  }

  let groups: RelatedResponse['groups'] = [];
  try {
    groups = await getRelationshipGroups(c.env, row);
  } catch (err) {
    // Relationship context is optional enrichment. A valid title with no
    // available group data remains a successful empty result.
    console.error('[Related] Group assembly failed:', err);
  }

  const payload: RelatedResponse = { spun_id: spunId, related, groups };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

export default info;
