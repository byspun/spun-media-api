// worker/src/routes/info.ts
// Info endpoints:
//   GET /info/:spunId              — full metadata
//   GET /info/:spunId/episodes     — episode list (TV + anime)
//   GET /info/:spunId/cast         — cast list
//   GET /info/:spunId/related      — structural title relations and groups

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type {
  EpisodeInfo,
  EpisodesResponse,
  RelatedEntry,
  RelatedResponse,
} from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import { getBySpunId } from '../identity/resolver.js';
import {
  getTmdbMovieDetail,
  getTmdbTvDetail,
  getTmdbSeasonDetail,
  tmdbProfile,
} from '../metadata/tmdb.js';
import { getAnilistMedia, anilistTitle } from '../metadata/anilist.js';
import {
  findKitsuAnimeByExternalId,
  getKitsuAnime,
  getKitsuAnimeEpisodes,
  type KitsuEpisode,
} from '../metadata/kitsu.js';
import { linkKitsuId } from '../identity/resolver.js';
import {
  normalizeMovieInfo,
  normalizeTvInfo,
  normalizeAnimeInfo,
  normalizeKitsuInfo,
  normalizeMovieboxInfo,
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
import { getMovieboxInfo } from '../metadata/moviebox.js';

const info = new Hono<{ Bindings: Env }>();

function normalizeKitsuEpisodes(
  spunId: string,
  episodes: KitsuEpisode[],
  requestedSeason?: number,
  airingOnly = false,
): EpisodesResponse {
  const grouped = new Map<number, EpisodeInfo[]>();
  const now = new Date();

  for (const episode of episodes) {
    const attrs = episode.attributes;
    const season = attrs.seasonNumber ?? 1;
    if (requestedSeason !== undefined && season !== requestedSeason) continue;
    if (airingOnly && attrs.airdate && new Date(attrs.airdate) > now) continue;

    const list = grouped.get(season) ?? [];
    list.push({
      number: attrs.number ?? attrs.relativeNumber ?? list.length + 1,
      season,
      title: attrs.canonicalTitle ?? attrs.titles?.en_us ?? attrs.titles?.en_jp ?? null,
      overview: attrs.description ?? attrs.synopsis ?? null,
      thumbnail: attrs.thumbnail?.original ?? attrs.thumbnail?.large ?? attrs.thumbnail?.medium ?? null,
      runtime: attrs.length ?? null,
      air_date: attrs.airdate ?? null,
    });
    grouped.set(season, list);
  }

  const seasons = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, seasonEpisodes]) => ({
      season,
      count: seasonEpisodes.length,
      episodes: seasonEpisodes.sort((a, b) => a.number - b.number),
    }));

  return { spun_id: spunId, type: 'anime', seasons };
}

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

  } else if (row.content_type === 'anime' && row.kitsu_id) {
    const anime = await getKitsuAnime(row.kitsu_id);
    if (!anime) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);

    const animeInfo = normalizeKitsuInfo(spunId, anime);
    try {
      animeInfo.part_of = await getMembershipSummaries(c.env, row);
    } catch (err) {
      console.error('[Info] Kitsu relationship context failed:', err);
    }
    payload = animeInfo;
    await kvSet(c.env, cacheKey, payload, TTL.metadata);
    return jsonResponse(payload);

  } else if (row.moviebox_id != null) {
    const moviebox = await getMovieboxInfo(c.env, row);
    if (!moviebox) return errorResponse('UPSTREAM_ERROR', 'Could not fetch metadata.', 502);
    const movieboxInfo = normalizeMovieboxInfo(spunId, moviebox, row.content_type);
    try {
      movieboxInfo.part_of = await getMembershipSummaries(c.env, row);
    } catch (err) {
      console.error('[Info] MovieBox relationship context failed:', err);
    }
    payload = movieboxInfo;
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
  const cacheKey = CacheKeys.episodes(spunId, season ?? 'all');
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

  if (row.content_type === 'anime') {
    const media = row.anilist_id ? await getAnilistMedia(c.env, row.anilist_id) : null;
    const titleHint = media ? anilistTitle(media) : row.title;
    let kitsuAnime = null;
    try {
      kitsuAnime = row.kitsu_id ? await getKitsuAnime(row.kitsu_id) : null;
      // Discover and persist Kitsu through the canonical AniList mapping when needed.
      if (!kitsuAnime && row.anilist_id) {
        kitsuAnime = await findKitsuAnimeByExternalId('anilist/anime', row.anilist_id, titleHint);
        if (kitsuAnime) linkKitsuId(c.env, spunId, kitsuAnime.id).catch(() => {});
      }
    } catch (err) {
      console.error('[Info] Kitsu anime lookup failed; using fallback:', err);
    }

    const isAiring = media?.status === 'RELEASING'
      || kitsuAnime?.attributes.status?.toUpperCase() === 'CURRENT';

    if (kitsuAnime) {
      try {
        const kitsuResult = await getKitsuAnimeEpisodes(kitsuAnime.id, 0, 20);
        if (kitsuResult.episodes.length) {
          const payload = normalizeKitsuEpisodes(
            spunId,
            kitsuResult.episodes,
            season ? parseInt(season, 10) : undefined,
            isAiring,
          );
          if (payload.seasons.length || season) {
            const ttl = isAiring ? TTL.episodesAiring : TTL.episodes;
            await kvSet(c.env, cacheKey, payload, ttl);
            return jsonResponse(payload);
          }
        }
      } catch (err) {
        console.error('[Info] Kitsu episode lookup failed; using TMDB fallback:', err);
      }
    }

    // TMDB is the fallback episodic source for anime rows with a mapped TV ID.
    if (row.tmdb_id) {
      const tv = await getTmdbTvDetail(c.env, row.tmdb_id);
      if (tv) {
        const realSeasons = tv.seasons.filter((s) => s.season_number > 0);
        const targets = season
          ? realSeasons.filter((s) => s.season_number === parseInt(season, 10))
          : realSeasons;
        const details: Array<{ season: any; airingFilter: boolean }> = [];
        for (let i = 0; i < targets.length; i += 5) {
          const chunk = targets.slice(i, i + 5);
          const fetched = await Promise.all(
            chunk.map((item) => getTmdbSeasonDetail(c.env, row.tmdb_id!, item.season_number)),
          );
          fetched.forEach((detail) => {
            if (detail) details.push({ season: detail, airingFilter: isAiring });
          });
        }
        const payload = normalizeTvEpisodes(spunId, details);
        if (payload.seasons.length || season) {
          const ttl = isAiring ? TTL.episodesAiring : TTL.episodes;
          await kvSet(c.env, cacheKey, payload, ttl);
          return jsonResponse(payload);
        }
      }
    }

    // Last-resort stable shape from AniList’s known episode count.
    const episodeCount = media?.episodes ?? kitsuAnime?.attributes.episodeCount ?? 0;
    const payload: EpisodesResponse = {
      spun_id: spunId,
      type: 'anime',
      seasons: [{
        season: 1,
        count: episodeCount,
        episodes: Array.from({ length: episodeCount }, (_, i) => ({
          number: i + 1,
          season: 1,
          title: null,
          overview: null,
          thumbnail: null,
          runtime: null,
          air_date: null,
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
