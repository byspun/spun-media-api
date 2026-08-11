// worker/src/normalizer.ts
// Public normalizer — everything that leaves the Worker goes through here.
// No provider names, no internal IDs, no raw external IDs ever hit a response.
// All shapes enforced here match the spec exactly.

import {
  tmdbPoster,
  tmdbBackdrop,
  tmdbStill,
  tmdbProfile,
  extractYear,
  mapTmdbStatus,
  type TmdbMovieDetail,
  type TmdbTvDetail,
  type TmdbSeasonDetail,
} from './metadata/tmdb.js';

import {
  anilistTitle,
  mapAnilistStatus,
  formatCountdown,
} from './metadata/anilist.js';

import { GENRES } from './config/genres.js';

import type {
  ContentItem,
  ContentType,
  InfoResponse,
  EpisodesResponse,
  EpisodeInfo,
  SeasonSummary,
  SeasonDetail,
  CastMember,
  AiringEntry,
  RankedItem,
  TrailerInfo,
  AniListMedia,
} from './types/index.js';

// ─── Genre mapping helpers ────────────────────────────────────────────────────

const TMDB_MOVIE_GENRE_MAP: Record<number, string> = {};
const TMDB_TV_GENRE_MAP:    Record<number, string> = {};
const ANILIST_GENRE_MAP:    Record<string, string> = {};

// Build lookup maps from GENRES config at startup
for (const g of GENRES) {
  for (const id of g.tmdb_movie_genre_ids ?? []) TMDB_MOVIE_GENRE_MAP[id] = g.id;
  for (const id of g.tmdb_tv_genre_ids   ?? []) TMDB_TV_GENRE_MAP[id]    = g.id;
  for (const al of g.anilist_genres      ?? []) ANILIST_GENRE_MAP[al.toLowerCase()] = g.id;
}

export function mapTmdbGenres(ids: number[], mediaType: 'movie' | 'tv'): string[] {
  const map = mediaType === 'movie' ? TMDB_MOVIE_GENRE_MAP : TMDB_TV_GENRE_MAP;
  return [...new Set(ids.map((id) => map[id]).filter((g): g is string => Boolean(g)))];
}

export function mapAnilistGenres(genres: string[]): string[] {
  return [...new Set(
    genres
      .map((g) => ANILIST_GENRE_MAP[g.toLowerCase()])
      .filter((g): g is string => Boolean(g))
  )];
}

// ─── Trailer extraction ───────────────────────────────────────────────────────

function extractTrailers(
  videos: Array<{ key: string; site: string; type: string }>
): TrailerInfo[] {
  return videos
    .filter((v) => v.type === 'Trailer' || v.type === 'Teaser')
    .slice(0, 3)
    .map((v) => ({ key: v.key, site: v.site }));
}

// ─── Movie → InfoResponse ─────────────────────────────────────────────────────

export function normalizeMovieInfo(
  spunId: string,
  movie:  TmdbMovieDetail
): InfoResponse {
  const cast: CastMember[] = movie.credits.cast
    .sort((a, b) => a.order - b.order)
    .slice(0, 20)
    .map((m) => ({
      image:     tmdbProfile(m.profile_path),
      character: m.character || null,
      name:      m.name,
    }));

  const stills = movie.images.backdrops
    .slice(0, 8)
    .map((b) => tmdbBackdrop(b.file_path, 'w780'))
    .filter((s): s is string => s !== null);

  const genres = mapTmdbGenres(movie.genres.map((g) => g.id), 'movie');

  const studios = [
    ...movie.production_companies.map((c) => c.name),
  ].slice(0, 5);

  return {
    spun_id:  spunId,
    type:     'movie',
    title:    movie.title,
    year:     extractYear(movie.release_date),
    rating:   movie.vote_average
      ? parseFloat(movie.vote_average.toFixed(1))
      : null,
    overview: movie.overview ?? null,
    status:   mapTmdbStatus(movie.status),
    tagline:  movie.tagline ?? null,
    runtime:  movie.runtime ?? null,
    genres,
    format:   null,
    tags:     null,
    studios,
    poster:   tmdbPoster(movie.poster_path, 'w500'),
    backdrop: tmdbBackdrop(movie.backdrop_path),
    trailers: extractTrailers(movie.videos.results),
    stills,
    cast,
    episodes: null,
  };
}

// ─── TV → InfoResponse ────────────────────────────────────────────────────────

export function normalizeTvInfo(
  spunId: string,
  tv:     TmdbTvDetail
): InfoResponse {
  const cast: CastMember[] = tv.credits.cast
    .sort((a, b) => a.order - b.order)
    .slice(0, 20)
    .map((m) => ({
      image:     tmdbProfile(m.profile_path),
      character: m.character || null,
      name:      m.name,
    }));

  const stills = tv.images.backdrops
    .slice(0, 8)
    .map((b) => tmdbBackdrop(b.file_path, 'w780'))
    .filter((s): s is string => s !== null);

  const genres = mapTmdbGenres(tv.genres.map((g) => g.id), 'tv');

  const studios = [
    ...tv.networks.map((n) => n.name),
    ...tv.production_companies.map((c) => c.name),
  ].slice(0, 5);

  // Filter out season 0 (specials), count only real seasons
  const realSeasons = tv.seasons.filter((s) => s.season_number > 0);

  const seasonSummaries: SeasonSummary[] = realSeasons.map((s) => ({
    season: s.season_number,
    count:  s.episode_count,
  }));

  const totalEpisodes = realSeasons.reduce((acc, s) => acc + s.episode_count, 0);

  return {
    spun_id:  spunId,
    type:     'tv',
    title:    tv.name,
    year:     extractYear(tv.first_air_date),
    rating:   tv.vote_average
      ? parseFloat(tv.vote_average.toFixed(1))
      : null,
    overview: tv.overview ?? null,
    status:   mapTmdbStatus(tv.status),
    tagline:  tv.tagline ?? null,
    runtime:  tv.episode_run_time?.[0] ?? null,
    genres,
    format:   null,
    tags:     null,
    studios,
    poster:   tmdbPoster(tv.poster_path, 'w500'),
    backdrop: tmdbBackdrop(tv.backdrop_path),
    trailers: extractTrailers(tv.videos.results),
    stills,
    cast,
    episodes: {
      total:   totalEpisodes,
      seasons: seasonSummaries,
    },
  };
}

// ─── AniList → InfoResponse ───────────────────────────────────────────────────

export function normalizeAnimeInfo(
  spunId: string,
  media:  AniListMedia
): InfoResponse {
  const title = anilistTitle(media);

  const cast: CastMember[] = (media.characters?.edges ?? [])
    .slice(0, 20)
    .map((edge) => {
      const va = edge.voiceActors?.[0];
      return {
        image:     edge.node.image?.large ?? null,
        character: edge.node.name?.full   ?? null,
        name:      va?.name?.full         ?? edge.node.name?.full ?? '',
      };
    });

  const genres   = mapAnilistGenres(media.genres ?? []);
  const tags     = (media.tags ?? [])
    .filter((t) => !t.isMediaSpoiler && t.rank >= 60)
    .slice(0, 10)
    .map((t) => t.name);

  const studios = (media.studios?.nodes ?? [])
    .filter((s) => s.isAnimationStudio)
    .map((s) => s.name)
    .slice(0, 3);

  const trailers: TrailerInfo[] = media.trailer
    ? [{ key: media.trailer.id, site: media.trailer.site }]
    : [];

  const episodeCount = media.episodes ?? null;

  return {
    spun_id:  spunId,
    type:     'anime',
    title,
    year:     media.startDate?.year ?? null,
    rating:   media.averageScore
      ? parseFloat((media.averageScore / 10).toFixed(1))
      : null,
    overview: media.description
      ?.replace(/<[^>]*>/g, '')    // strip HTML
      ?.replace(/\n{3,}/g, '\n\n') // collapse extra newlines
      ?? null,
    status:   mapAnilistStatus(media.status),
    tagline:  null,
    runtime:  null,
    genres,
    format:   media.format ?? null,
    tags,
    studios,
    poster:   media.coverImage?.large ?? media.coverImage?.medium ?? null,
    backdrop: media.bannerImage ?? null,
    trailers,
    stills:   [],
    cast,
    episodes: episodeCount !== null
      ? { total: episodeCount, seasons: [{ season: 1, count: episodeCount }] }
      : null,
  };
}

// ─── TV season → EpisodesResponse ────────────────────────────────────────────

export function normalizeTvEpisodes(
  spunId:  string,
  seasons: Array<{ season: TmdbSeasonDetail; airingFilter?: boolean }>
): EpisodesResponse {
  const normalizedSeasons: SeasonDetail[] = seasons.map(({ season, airingFilter }) => {
    let eps = season.episodes.map((ep): EpisodeInfo => ({
      number:    ep.episode_number,
      season:    season.season_number,
      title:     ep.name     ?? null,
      overview:  ep.overview ?? null,
      thumbnail: tmdbStill(ep.still_path),
      runtime:   ep.runtime  ?? null,
      air_date:  ep.air_date ?? null,
    }));

    // Filter out un-aired episodes if requested
    if (airingFilter) {
      const now = new Date();
      eps = eps.filter((ep) => ep.air_date && new Date(ep.air_date) <= now);
    }

    return {
      season:   season.season_number,
      count:    eps.length,
      episodes: eps,
    };
  });

  return {
    spun_id: spunId,
    type:    'tv',
    seasons: normalizedSeasons,
  };
}

// ─── AniList airing → AiringEntry ─────────────────────────────────────────────

export function normalizeAiringEntry(
  media:  AniListMedia,
  spunId: string
): AiringEntry | null {
  if (!media.nextAiringEpisode) return null;

  return {
    spun_id:   spunId,
    title:     anilistTitle(media),
    poster:    media.coverImage?.large ?? null,
    episode:   media.nextAiringEpisode.episode,
    airing_at: new Date(media.nextAiringEpisode.airingAt * 1000).toISOString(),
    countdown: formatCountdown(media.nextAiringEpisode.airingAt),
  };
}

// ─── Ranked item ──────────────────────────────────────────────────────────────

export function normalizeRankedItem(
  media:  AniListMedia,
  spunId: string,
  rank:   number
): RankedItem {
  return {
    spun_id: spunId,
    type:    'anime',
    title:   anilistTitle(media),
    year:    media.startDate?.year ?? null,
    rating:  media.averageScore
      ? parseFloat((media.averageScore / 10).toFixed(1))
      : null,
    poster:  media.coverImage?.large ?? null,
    rank,
    format:  media.format ?? null,
  };
}

// ─── Slim ContentItem from TMDB search result ─────────────────────────────────

export function tmdbResultToItem(
  raw:    { title?: string; name?: string; release_date?: string; first_air_date?: string; vote_average?: number; poster_path?: string | null },
  spunId: string,
  type:   ContentType
): ContentItem {
  const title   = (raw.title || raw.name || '') as string;
  const dateStr = (raw.release_date || raw.first_air_date || '') as string;

  return {
    spun_id: spunId,
    type,
    title,
    year:   extractYear(dateStr),
    rating: raw.vote_average
      ? parseFloat(raw.vote_average.toFixed(1))
      : null,
    poster: tmdbPoster(raw.poster_path ?? null),
  };
}

// ─── Slim ContentItem from AniList ───────────────────────────────────────────

export function anilistToItem(
  media:  AniListMedia,
  spunId: string
): ContentItem {
  return {
    spun_id: spunId,
    type:    'anime',
    title:   anilistTitle(media),
    year:    media.startDate?.year ?? null,
    rating:  media.averageScore
      ? parseFloat((media.averageScore / 10).toFixed(1))
      : null,
    poster:  media.coverImage?.large ?? media.coverImage?.medium ?? null,
  };
}

// ─── Standard JSON error response ────────────────────────────────────────────

export function errorResponse(
  code:    string,
  message: string,
  status:  number
): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// ─── Standard JSON success response ──────────────────────────────────────────

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
