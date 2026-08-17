// worker/src/resolve.ts
// Lazy identifier resolution: local identity first, metadata lookup second,
// database registration third, normalized ContentItem last.
// Public responses never expose adapter or infrastructure identities.

import type { Env } from './types/env.js';
import type { ContentItem, ContentType, MediaTitleRow } from './types/index.js';
import {
  findTmdbByExternalId,
  getTmdbMovieDetail,
  getTmdbTvDetail,
  searchTmdb,
  tmdbPoster,
  extractYear,
  type TmdbMovieDetail,
  type TmdbSearchResult,
  type TmdbTvDetail,
} from './metadata/tmdb.js';
import { getAnilistMedia, anilistTitle } from './metadata/anilist.js';
import { getMovieboxInfoById } from './metadata/moviebox.js';
import { getJikanAnimeDetail } from './metadata/jikan.js';
import {
  getKitsuAnime,
  KitsuUnavailableError,
  kitsuMappingId,
  kitsuRating,
  kitsuTitle,
  kitsuType,
} from './metadata/kitsu.js';
import {
  getByAnilistId,
  getByImdbId,
  getByMalId,
  getByTmdbId,
  getByTvdbId,
  getByMovieboxId,
  resolveFromMoviebox,
  resolveFromAnilist,
  resolveFromMal,
  resolveFromTmdb,
  resolveFromKitsu,
  getByKitsuId,
} from './identity/resolver.js';
import { anilistToItem, tmdbResultToItem } from './normalizer.js';

export type ResolveNamespace = 'tmdb' | 'imdb' | 'tvdb' | 'anilist' | 'mal' | 'kitsu' | 'moviebox';

function storedSummaryItem(row: MediaTitleRow): ContentItem | null {
  if (!row.summary_synced_at) return null;
  return {
    spun_id: row.spun_id,
    type: row.content_type,
    title: row.title,
    year: row.year,
    rating: row.rating,
    poster: row.poster_path,
  };
}

export interface ResolveNamespaceInfo {
  namespace: ResolveNamespace;
  content_types: ContentType[];
  parameter: 'id';
}

export const RESOLVE_NAMESPACES: ResolveNamespaceInfo[] = [
  { namespace: 'tmdb', content_types: ['movie', 'tv'], parameter: 'id' },
  { namespace: 'imdb', content_types: ['movie', 'tv'], parameter: 'id' },
  { namespace: 'tvdb', content_types: ['tv'], parameter: 'id' },
  { namespace: 'anilist', content_types: ['anime'], parameter: 'id' },
  { namespace: 'mal', content_types: ['anime'], parameter: 'id' },
  { namespace: 'kitsu', content_types: ['anime'], parameter: 'id' },
  { namespace: 'moviebox', content_types: ['movie', 'tv'], parameter: 'id' },
];

const RESOLVE_TIMEOUT_MS = 10_000;

export class ResolveFailure extends Error {
  constructor(
    public readonly code:
      | 'RESOLVE_NAMESPACE_UNSUPPORTED'
      | 'RESOLVE_IDENTIFIER_REQUIRED'
      | 'RESOLVE_IDENTIFIER_INVALID'
      | 'RESOLVE_NAMESPACE_TYPE_MISMATCH'
      | 'RESOLVE_CONTENT_NOT_FOUND'
      | 'RESOLVE_AMBIGUOUS'
      | 'RESOLVE_METADATA_UNAVAILABLE'
      | 'RESOLVE_METADATA_TIMEOUT'
      | 'RESOLVE_REGISTRATION_FAILED'
      | 'RESOLVE_CONFLICT'
      | 'RESOLVE_UNSUPPORTED_RESULT'
      | 'UNSUPPORTED_SUBJECT_TYPE',
    public readonly status: number,
  ) {
    super(code);
    this.name = 'ResolveFailure';
  }
}

function fail(code: ResolveFailure['code'], status: number): never {
  throw new ResolveFailure(code, status);
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validateIdentifier(namespace: ResolveNamespace, id: string): void {
  if (namespace === 'imdb') {
    if (!/^tt\d{7,12}$/.test(id)) fail('RESOLVE_IDENTIFIER_INVALID', 400);
    return;
  }
  if (namespace === 'moviebox') {
    if (!/^\d{19}$/.test(id)) fail('RESOLVE_IDENTIFIER_INVALID', 400);
    return;
  }
  if (!positiveInteger(id)) fail('RESOLVE_IDENTIFIER_INVALID', 400);
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ResolveFailure('RESOLVE_METADATA_TIMEOUT', 504)), RESOLVE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function movieSearchResult(detail: TmdbMovieDetail): TmdbSearchResult {
  return {
    id: detail.id,
    media_type: 'movie',
    title: detail.title,
    overview: detail.overview ?? undefined,
    release_date: detail.release_date ?? undefined,
    vote_average: detail.vote_average,
    poster_path: detail.poster_path,
    backdrop_path: detail.backdrop_path,
  };
}

function tvSearchResult(detail: TmdbTvDetail): TmdbSearchResult {
  return {
    id: detail.id,
    media_type: 'tv',
    name: detail.name,
    overview: detail.overview ?? undefined,
    first_air_date: detail.first_air_date ?? undefined,
    vote_average: detail.vote_average,
    poster_path: detail.poster_path,
    backdrop_path: detail.backdrop_path,
  };
}

async function registerTmdb(
  env: Env,
  detail: TmdbMovieDetail | TmdbTvDetail,
  type: 'movie' | 'tv',
): Promise<ContentItem> {
  const title = type === 'movie'
    ? (detail as TmdbMovieDetail).title
    : (detail as TmdbTvDetail).name;
  if (!title) fail('RESOLVE_UNSUPPORTED_RESULT', 422);

  const external = detail.external_ids;
  const row = await resolveFromTmdb(env, detail.id, type, title, {
    imdbId: external?.imdb_id ?? null,
    tvdbId: type === 'tv' ? (external as TmdbTvDetail['external_ids'])?.tvdb_id ?? null : null,
    summary: {
      year: extractYear(type === 'movie' ? (detail as TmdbMovieDetail).release_date : (detail as TmdbTvDetail).first_air_date),
      rating: typeof detail.vote_average === 'number' ? Number(detail.vote_average.toFixed(1)) : null,
      posterPath: detail.poster_path ? tmdbPoster(detail.poster_path, 'w342') : null,
    },
  });
  const result = type === 'movie'
    ? movieSearchResult(detail as TmdbMovieDetail)
    : tvSearchResult(detail as TmdbTvDetail);
  return tmdbResultToItem(result, row.spun_id, type);
}

async function resolveTmdbId(
  env: Env,
  id: number,
  requestedType?: 'movie' | 'tv',
): Promise<ContentItem> {
  if (requestedType) {
    const detail = requestedType === 'movie'
      ? await withTimeout(getTmdbMovieDetail(env, id))
      : await withTimeout(getTmdbTvDetail(env, id));
    if (!detail) fail('RESOLVE_CONTENT_NOT_FOUND', 404);
    return registerTmdb(env, detail, requestedType);
  }

  const [movie, tv] = await withTimeout(Promise.all([
    getTmdbMovieDetail(env, id),
    getTmdbTvDetail(env, id),
  ]));
  if (movie && tv) fail('RESOLVE_AMBIGUOUS', 409);
  if (movie) return registerTmdb(env, movie, 'movie');
  if (tv) return registerTmdb(env, tv, 'tv');
  fail('RESOLVE_CONTENT_NOT_FOUND', 404);
}

async function resolveTmdbExternal(
  env: Env,
  namespace: 'imdb' | 'tvdb',
  id: string,
): Promise<ContentItem> {
  const source = namespace === 'imdb' ? 'imdb_id' : 'tvdb_id';
  const matches = await withTimeout(findTmdbByExternalId(env, id, source));
  if (!matches.length) fail('RESOLVE_CONTENT_NOT_FOUND', 404);
  if (matches.length > 1) fail('RESOLVE_AMBIGUOUS', 409);

  const match = matches[0];
  if (namespace === 'tvdb' && match.media_type !== 'tv') {
    fail('RESOLVE_NAMESPACE_TYPE_MISMATCH', 400);
  }

  const detail = match.media_type === 'movie'
    ? await withTimeout(getTmdbMovieDetail(env, match.id))
    : await withTimeout(getTmdbTvDetail(env, match.id));
  if (!detail) fail('RESOLVE_METADATA_UNAVAILABLE', 503);
  if (match.media_type !== 'movie' && match.media_type !== 'tv') {
    fail('RESOLVE_NAMESPACE_TYPE_MISMATCH', 400);
  }
  return registerTmdb(env, detail, match.media_type);
}

async function resolveAnilist(env: Env, id: number): Promise<ContentItem> {
  const media = await withTimeout(getAnilistMedia(env, id));
  if (!media) fail('RESOLVE_CONTENT_NOT_FOUND', 404);
  const title = anilistTitle(media);
  if (!title) fail('RESOLVE_UNSUPPORTED_RESULT', 422);

  const row = await resolveFromAnilist(env, media.id, title, {
    malId: media.idMal ?? null,
    summary: {
      year: media.startDate?.year ?? null,
      rating: typeof media.averageScore === 'number' ? Number((media.averageScore / 10).toFixed(1)) : null,
      posterPath: media.coverImage?.large ?? media.coverImage?.medium ?? null,
    },
  });
  return anilistToItem(media, row.spun_id);
}

function comparableTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function findTmdbForKitsu(
  env: Env,
  anime: Awaited<ReturnType<typeof getKitsuAnime>>,
): Promise<number | null> {
  if (!anime) return null;
  const title = kitsuTitle(anime);
  const year = anime.attributes.startDate ? Number(anime.attributes.startDate.slice(0, 4)) : null;
  const expectedType = kitsuType(anime);
  const search = await withTimeout(searchTmdb(env, title, 1));
  const candidates = search.results.filter((candidate) => {
    const candidateTitle = candidate.media_type === 'movie' ? candidate.title : candidate.name;
    if (!candidateTitle || candidate.media_type !== expectedType) return false;
    if (comparableTitle(candidateTitle) !== comparableTitle(title)) return false;
    const candidateDate = candidate.media_type === 'movie'
      ? candidate.release_date
      : candidate.first_air_date;
    if (!year || !candidateDate) return true;
    return Math.abs(Number(candidateDate.slice(0, 4)) - year) <= 1;
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

async function resolveKitsu(env: Env, id: number): Promise<ContentItem> {
  let anime: Awaited<ReturnType<typeof getKitsuAnime>>;
  try {
    anime = await withTimeout(getKitsuAnime(id, ['mappings']));
  } catch (error) {
    if (error instanceof KitsuUnavailableError) fail('RESOLVE_METADATA_UNAVAILABLE', 503);
    throw error;
  }
  if (!anime) fail('RESOLVE_CONTENT_NOT_FOUND', 404);

  const title = kitsuTitle(anime);
  const anilistId = kitsuMappingId(anime, ['anilist/anime']);
  const malId = kitsuMappingId(anime, ['myanimelist/anime']);
  const tvdbId = kitsuMappingId(anime, ['thetvdb/series', 'thetvdb']);

  // Prefer an existing canonical AniList/MAL row when Kitsu exposes a mapping.
  const existing = anilistId
    ? await getByAnilistId(env, anilistId)
    : malId
      ? await getByMalId(env, malId)
      : null;

  let tmdbId: number | null = existing?.tmdb_id ?? null;
  if (!tmdbId && tvdbId) {
    const matches = await withTimeout(findTmdbByExternalId(env, String(tvdbId), 'tvdb_id'));
    const tvMatches = matches.filter((match) => match.media_type === 'tv');
    if (tvMatches.length === 1) tmdbId = tvMatches[0].id;
  }
  if (!tmdbId) tmdbId = await findTmdbForKitsu(env, anime);

  if (existing) {
    const row = await resolveFromKitsu(env, id, title, {
      anilistId,
      malId,
      tmdbId,
      tvdbId,
      summary: {
        year: anime.attributes.startDate ? Number(anime.attributes.startDate.slice(0, 4)) : null,
        rating: kitsuRating(anime),
        posterPath: anime.attributes.posterImage?.large ?? anime.attributes.posterImage?.medium ?? null,
      },
    });
    return {
      spun_id: row.spun_id,
      type: 'anime',
      title,
      year: anime.attributes.startDate ? Number(anime.attributes.startDate.slice(0, 4)) : null,
      rating: kitsuRating(anime),
      poster: anime.attributes.posterImage?.large ?? anime.attributes.posterImage?.medium ?? null,
    };
  }

  const row = await resolveFromKitsu(env, id, title, {
    anilistId,
    malId,
    tmdbId,
    tvdbId,
    summary: {
      year: anime.attributes.startDate ? Number(anime.attributes.startDate.slice(0, 4)) : null,
      rating: null,
      posterPath: anime.attributes.posterImage?.large ?? anime.attributes.posterImage?.medium ?? null,
    },
  });

  return {
    spun_id: row.spun_id,
    type: 'anime',
    title,
    year: anime.attributes.startDate ? Number(anime.attributes.startDate.slice(0, 4)) : null,
    rating: null,
    poster: anime.attributes.posterImage?.large ?? anime.attributes.posterImage?.medium ?? null,
  };
}

async function resolveMoviebox(
  env: Env,
  id: string,
  requestedType?: 'movie' | 'tv',
): Promise<ContentItem> {
  const info = await withTimeout(getMovieboxInfoById(env, id));
  if (!info) fail('RESOLVE_CONTENT_NOT_FOUND', 404);

  const subjectType = Number(info.subjectType);
  if (subjectType !== 1 && subjectType !== 2) {
    fail('UNSUPPORTED_SUBJECT_TYPE', 422);
  }

  const type: 'movie' | 'tv' = subjectType === 1 ? 'movie' : 'tv';
  if (requestedType && requestedType !== type) {
    fail('RESOLVE_NAMESPACE_TYPE_MISMATCH', 400);
  }

  const title = info.title.trim();
  if (!title) fail('RESOLVE_UNSUPPORTED_RESULT', 422);
  const yearMatch = String(info.releaseDate ?? '').match(/(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const row = await resolveFromMoviebox(env, id, type, title, {
    year,
    rating: typeof info.rating === 'number' ? Number(info.rating.toFixed(1)) : null,
    posterPath: info.poster ?? null,
  });

  return {
    spun_id: row.spun_id,
    type,
    title,
    year: year ?? row.year ?? null,
    rating: typeof info.rating === 'number' ? Number(info.rating.toFixed(1)) : row.rating ?? null,
    poster: info.poster ?? row.poster_path ?? null,
  };
}

async function resolveMal(env: Env, id: number): Promise<ContentItem> {
  const detail = await withTimeout(getJikanAnimeDetail(env, id));
  if (!detail) fail('RESOLVE_CONTENT_NOT_FOUND', 404);
  const title = detail.title_english || detail.title;
  if (!title) fail('RESOLVE_UNSUPPORTED_RESULT', 422);

  const year = detail.year ?? (detail.aired?.from ? Number(detail.aired.from.slice(0, 4)) : null);
  const row = await resolveFromMal(env, id, title, {
    summary: {
      year: Number.isFinite(year) ? year : null,
      rating: typeof detail.score === 'number' ? Number(detail.score.toFixed(1)) : null,
      posterPath: detail.images?.jpg?.large_image_url ?? detail.images?.jpg?.image_url ?? null,
    },
  });
  return {
    spun_id: row.spun_id,
    type: 'anime',
    title,
    year: Number.isFinite(year) ? year : null,
    rating: typeof detail.score === 'number' ? Number(detail.score.toFixed(1)) : null,
    poster: detail.images?.jpg?.large_image_url ?? detail.images?.jpg?.image_url ?? null,
  };
}

async function resolveExisting(
  env: Env,
  namespace: ResolveNamespace,
  id: string,
  requestedType?: 'movie' | 'tv',
): Promise<ContentItem | null> {
  if (namespace === 'tmdb') {
    const numericId = Number(id);
    const row = requestedType
      ? await getByTmdbId(env, numericId, requestedType)
      : (await getByTmdbId(env, numericId, 'movie')) ?? (await getByTmdbId(env, numericId, 'tv'));
    if (!row) return null;
    return storedSummaryItem(row) ?? resolveTmdbId(env, numericId, row.content_type === 'anime' ? undefined : row.content_type);
  }

  if (namespace === 'imdb') {
    const row = await getByImdbId(env, id);
    if (!row || row.content_type === 'anime' || row.tmdb_id === null) return null;
    const detail = row.content_type === 'movie'
      ? await withTimeout(getTmdbMovieDetail(env, row.tmdb_id))
      : await withTimeout(getTmdbTvDetail(env, row.tmdb_id));
    if (!detail) fail('RESOLVE_METADATA_UNAVAILABLE', 503);
    return registerTmdb(env, detail, row.content_type);
  }

  if (namespace === 'tvdb') {
    const row = await getByTvdbId(env, Number(id));
    if (!row) return null;
    return storedSummaryItem(row) ?? resolveTmdbExternal(env, namespace, id);
  }

  if (namespace === 'anilist') {
    const row = await getByAnilistId(env, Number(id));
    if (!row) return null;
    return storedSummaryItem(row) ?? resolveAnilist(env, Number(id));
  }

  if (namespace === 'kitsu') {
    const row = await getByKitsuId(env, Number(id));
    if (!row) return null;
    return storedSummaryItem(row) ?? resolveKitsu(env, Number(id));
  }

  if (namespace === 'moviebox') {
    const row = await getByMovieboxId(env, id, requestedType);
    if (!row) return null;
    return storedSummaryItem(row) ?? resolveMoviebox(env, id, requestedType);
  }

  const row = await getByMalId(env, Number(id));
  if (!row) return null;
  return storedSummaryItem(row) ?? resolveMal(env, Number(id));
}

export async function resolveIdentifier(
  env: Env,
  namespace: string,
  id: string,
  requestedType?: string,
): Promise<ContentItem> {
  const normalizedNamespace = namespace.toLowerCase() as ResolveNamespace;
  if (!RESOLVE_NAMESPACES.some((item) => item.namespace === normalizedNamespace)) {
    fail('RESOLVE_NAMESPACE_UNSUPPORTED', 400);
  }
  if (!id.trim()) fail('RESOLVE_IDENTIFIER_REQUIRED', 400);
  validateIdentifier(normalizedNamespace, id.trim());

  let type: 'movie' | 'tv' | undefined;
  if (requestedType !== undefined) {
    if (requestedType !== 'movie' && requestedType !== 'tv') {
      fail('RESOLVE_NAMESPACE_TYPE_MISMATCH', 400);
    }
    type = requestedType;
    const supported = RESOLVE_NAMESPACES.find((item) => item.namespace === normalizedNamespace);
    if (!supported?.content_types.includes(type)) fail('RESOLVE_NAMESPACE_TYPE_MISMATCH', 400);
  }

  const existing = await resolveExisting(env, normalizedNamespace, id.trim(), type);
  if (existing) return existing;

  try {
    if (normalizedNamespace === 'tmdb') return resolveTmdbId(env, Number(id), type);
    if (normalizedNamespace === 'imdb') return resolveTmdbExternal(env, 'imdb', id.trim());
    if (normalizedNamespace === 'tvdb') return resolveTmdbExternal(env, 'tvdb', id.trim());
    if (normalizedNamespace === 'anilist') return resolveAnilist(env, Number(id));
    if (normalizedNamespace === 'kitsu') return resolveKitsu(env, Number(id));
    if (normalizedNamespace === 'moviebox') return resolveMoviebox(env, id.trim(), type);
    return resolveMal(env, Number(id));
  } catch (error) {
    if (error instanceof ResolveFailure) throw error;
    throw new ResolveFailure('RESOLVE_REGISTRATION_FAILED', 500);
  }
}

export function isResolveNamespace(value: string): value is ResolveNamespace {
  return RESOLVE_NAMESPACES.some((item) => item.namespace === value.toLowerCase());
}
