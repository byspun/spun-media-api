// worker/src/routes/info.ts
// Info endpoints:
//   GET /info/:spunId              — full metadata
//   GET /info/:spunId/episodes     — episode list (TV + anime)
//   GET /info/:spunId/cast         — cast list
//   GET /info/:spunId/related      — related titles / recommendations

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { ContentItem, RelatedEntry } from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import { getBySpunId } from '../identity/resolver.js';
import {
  getTmdbMovieDetail,
  getTmdbTvDetail,
  getTmdbSeasonDetail,
  getTmdbSimilar,
  getTmdbRecommendations,
  tmdbProfile,
  tmdbPoster,
  extractYear,
} from '../metadata/tmdb.js';
import { getAnilistMedia, anilistTitle } from '../metadata/anilist.js';
import { getAllJikanEpisodes } from '../metadata/jikan.js';
import {
  normalizeMovieInfo,
  normalizeTvInfo,
  normalizeAnimeInfo,
  normalizeTvEpisodes,
  tmdbResultToItem,
  anilistToItem,
  jsonResponse,
  errorResponse,
} from '../normalizer.js';
import {
  resolveFromTmdb,
  resolveFromAnilist,
  linkMalId,
} from '../identity/resolver.js';

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
  const isAiring = row.content_type === 'anime'; // TTL decision

  if (row.content_type === 'movie' && row.tmdb_id) {
    const movie = await getTmdbMovieDetail(c.env, row.tmdb_id);
    if (!movie) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);
    payload = normalizeMovieInfo(spunId, movie);

  } else if (row.content_type === 'tv' && row.tmdb_id) {
    const tv = await getTmdbTvDetail(c.env, row.tmdb_id);
    if (!tv) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);
    payload = normalizeTvInfo(spunId, tv);

  } else if (row.content_type === 'anime' && row.anilist_id) {
    const media = await getAnilistMedia(row.anilist_id);
    if (!media) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

    // Back-fill MAL ID if we now have it
    if (media.idMal && !row.mal_id) {
      linkMalId(c.env, spunId, media.idMal).catch(() => {});
    }

    payload  = normalizeAnimeInfo(spunId, media);
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
    const media = await getAnilistMedia(row.anilist_id);
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
    const episodes   = await getAllJikanEpisodes(malId);
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
    const endpoint = row.content_type === 'movie'
      ? `/movie/${row.tmdb_id}/credits`
      : `/tv/${row.tmdb_id}/credits`;

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
    const media = await getAnilistMedia(row.anilist_id);
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

  if ((row.content_type === 'movie' || row.content_type === 'tv') && row.tmdb_id) {
    const mediaType = row.content_type;
    const [similar, recs] = await Promise.all([
      getTmdbSimilar(c.env, row.tmdb_id, mediaType),
      getTmdbRecommendations(c.env, row.tmdb_id, mediaType),
    ]);

    // Deduplicate: prefer recommendations, fill with similar
    const seen = new Set<number>();
    const all  = [...recs, ...similar].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, 20);

    const items = await Promise.all(
      all.map(async (r) => {
        const title = r.title || r.name || '';
        const type  = (r.media_type === 'movie' || r.media_type === 'tv')
          ? r.media_type
          : mediaType;
        const relRow = await resolveFromTmdb(c.env, r.id, type as 'movie' | 'tv', title);
        return {
          relation: recs.find((rec) => rec.id === r.id) ? 'Recommendation' : 'Similar',
          item:     tmdbResultToItem(r, relRow.spun_id, type),
        };
      })
    );

    related.push(...items);
  }

  if (row.content_type === 'anime' && row.anilist_id) {
    const media = await getAnilistMedia(row.anilist_id);
    if (media) {
      // Relations (sequels, prequels, etc.)
      const relationEdges = (media.relations?.edges ?? [])
        .filter((e) => e.node && (e.node as any).type === 'ANIME')
        .slice(0, 10);

      for (const edge of relationEdges) {
        const node  = edge.node as any;
        const title = node.title?.english || node.title?.romaji || '';
        const relRow = await resolveFromAnilist(c.env, node.id, title);
        related.push({
          relation: edge.relationType,
          item:     anilistToItem(node, relRow.spun_id),
        });
      }

      // Recommendations
      const recNodes = (media.recommendations?.nodes ?? []).slice(0, 10);
      for (const node of recNodes) {
        if (!node.mediaRecommendation) continue;
        const rec   = node.mediaRecommendation;
        const title = anilistTitle(rec);
        const relRow = await resolveFromAnilist(c.env, rec.id, title);
        related.push({
          relation: 'Recommendation',
          item:     anilistToItem(rec, relRow.spun_id),
        });
      }
    }
  }

  const payload = { spun_id: spunId, related };
  await kvSet(c.env, cacheKey, payload, TTL.metadata);
  return jsonResponse(payload);
});

export default info;
