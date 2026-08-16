import { createRequire } from 'node:module';
import {
  chooseMovieBoxCandidate,
  detectFormat,
  normalizeQuality,
  isSafeHttpUrl,
  type MappingInput,
  type MovieBoxCandidate,
  uniqueBy,
} from '../mappers/mapper.js';
import type { RawDownload, RawStream, RawSubtitle } from '../shared/types.js';

export interface MovieBoxEnv {
  MOVIEBOX_API_BASE: string;
  MOVIEBOX_API_SECRET: string;
  MOVIEBOX_RELAY_BASE?: string;
  TMDB_API_KEY?: string;
}

export interface ProviderInput extends MappingInput {
  movieboxId?: string | null;
  imdbId?: string | null;
  season?: number;
  episode?: number;
  quality?: string | null;
  audio?: string | null;
}

interface MovieBoxResponse {
  ok: boolean;
  status: number;
  data: any;
}

function base(env: MovieBoxEnv): string {
  return env.MOVIEBOX_API_BASE.replace(/\/$/, '');
}

async function movieBoxRequest(env: MovieBoxEnv, path: string, init: RequestInit = {}): Promise<MovieBoxResponse> {
  const headers = new Headers(init.headers);
  headers.set('X-Worker-Secret', env.MOVIEBOX_API_SECRET);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(`${base(env)}${path}`, { ...init, headers, signal: AbortSignal.timeout(25_000) });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 599, data: null };
  }
}

export async function movieBoxSearch(env: MovieBoxEnv, keyword: string): Promise<MovieBoxCandidate[]> {
  const result = await movieBoxRequest(env, '/search', {
    method: 'POST',
    body: JSON.stringify({ keyword, page: 1, perPage: 10 }),
  });
  if (!result.ok) return [];
  const items = Array.isArray(result.data?.items) ? result.data.items : Array.isArray(result.data?.results) ? result.data.results : [];
  return items
    .map((item: any) => ({
      subjectId: String(item.subjectId ?? item.id ?? ''),
      subjectType: item.subjectType ?? null,
      type: item.type ?? null,
      title: String(item.title ?? item.name ?? ''),
      releaseDate: item.releaseDate ?? item.year ?? null,
      genre: item.genre ?? null,
      country: item.country ?? null,
      language: item.language ?? null,
      hasResource: item.hasResource ?? null,
      poster: item.poster ?? item.posterUrl ?? item.cover ?? item.coverUrl ?? null,
    }))
    .filter((item: MovieBoxCandidate) => item.subjectId && item.title);
}

export async function resolveMovieBoxSubject(env: MovieBoxEnv, input: MappingInput & { movieboxId?: string | null }): Promise<MovieBoxCandidate | null> {
  if (input.movieboxId) {
    const detail = await movieBoxInfo(env, input.movieboxId);
    if (detail && chooseMovieBoxCandidate(input, [detail])) return detail;
  }
  const searches = uniqueBy(
    [input.title],
    (value) => value.toLocaleLowerCase(),
  );
  const candidates: MovieBoxCandidate[] = [];
  for (const query of searches) candidates.push(...await movieBoxSearch(env, query));
  return chooseMovieBoxCandidate(input, candidates);
}

export async function movieBoxInfo(env: MovieBoxEnv, subjectId: string): Promise<MovieBoxCandidate | null> {
  const result = await movieBoxRequest(env, `/info/${encodeURIComponent(subjectId)}`);
  if (!result.ok || !result.data) return null;
  const value = result.data?.subject ?? result.data?.item ?? result.data;
  if (!value) return null;
  return {
    subjectId: String(value.subjectId ?? value.id ?? subjectId),
    subjectType: value.subjectType ?? null,
    type: value.type ?? null,
    title: String(value.title ?? value.name ?? ''),
    releaseDate: value.releaseDate ?? value.year ?? null,
    genre: value.genre ?? null,
    country: value.country ?? null,
    language: value.language ?? null,
    hasResource: value.hasResource ?? null,
    poster: value.poster ?? value.posterUrl ?? value.cover ?? value.coverUrl ?? null,
  };
}

function subtitleFromValue(value: any): RawSubtitle | null {
  const url = value?.url ?? value?.file ?? value?.link;
  if (!isSafeHttpUrl(url)) return null;
  return {
    url,
    language: String(value?.language ?? value?.lanName ?? value?.lang ?? 'Unknown'),
    language_code: String(value?.language_code ?? value?.languageCode ?? value?.lang ?? 'und').toLowerCase(),
    format: String(value?.format ?? 'vtt').toLowerCase() === 'srt' ? 'srt' : 'vtt',
  };
}

function collectSubtitleValues(value: any): RawSubtitle[] {
  const candidates = [value?.subtitles, value?.subtitle, value?.captions, value?.subtitles?.tracks]
    .flatMap((item) => Array.isArray(item) ? item : item ? [item] : []);
  return uniqueBy(candidates.map(subtitleFromValue).filter(Boolean) as RawSubtitle[], (item) => `${item.language_code}:${item.url}`);
}

function qualityAllowed(value: string, wanted?: string | null): boolean {
  return !wanted || wanted.toLocaleLowerCase() === 'auto' || value.toLocaleLowerCase() === wanted.toLocaleLowerCase();
}

function flattenQualityItems(payload: any, requestedSeason?: number, requestedEpisode?: number): Array<{ season: number; episode: number; item: any }> {
  const output: Array<{ season: number; episode: number; item: any }> = [];
  const seasons = Array.isArray(payload?.seasons) ? payload.seasons : [];
  for (const season of seasons) {
    const seasonNumber = Number(season.season ?? season.seasonNumber ?? 1);
    if (requestedSeason != null && seasonNumber !== requestedSeason) continue;
    const episodes = Array.isArray(season.episodes) ? season.episodes : [];
    for (const episode of episodes) {
      const episodeNumber = Number(episode.episode ?? episode.episodeNumber ?? episode.number ?? 1);
      if (requestedEpisode != null && episodeNumber !== requestedEpisode) continue;
      const qualities = Array.isArray(episode.qualities) ? episode.qualities : Array.isArray(episode.downloads) ? episode.downloads : [];
      for (const item of qualities) output.push({ season: seasonNumber, episode: episodeNumber, item });
    }
  }
  return output;
}

export async function movieBoxDownloads(env: MovieBoxEnv, input: ProviderInput): Promise<RawDownload[]> {
  const subject = await resolveMovieBoxSubject(env, input);
  if (!subject) return [];
  const result = await movieBoxRequest(env, `/download/${encodeURIComponent(subject.subjectId)}`);
  if (!result.ok || !result.data) return [];
  const rows = flattenQualityItems(result.data, input.season, input.episode);
  return rows.map(({ item }) => {
    const url = item?.url ?? item?.downloadUrl ?? item?.link;
    const format = detectFormat(url ?? '', item?.format);
    if (!isSafeHttpUrl(url) || !['mp4', 'mkv'].includes(format)) return null;
    const quality = normalizeQuality(item?.quality ?? item?.resolution ?? item?.label);
    if (!qualityAllowed(quality, input.quality)) return null;
    const subtitles = collectSubtitleValues(item);
    return {
      url,
      format: format as 'mp4' | 'mkv',
      quality: quality as any,
      size: item?.size ? String(item.size) : null,
      filename: item?.filename ? String(item.filename) : null,
      subtitles: subtitles.map((subtitle) => ({ ...subtitle, format: subtitle.format as 'srt' | 'vtt' })),
      provider: 'moviebox' as const,
    };
  }).filter(Boolean) as RawDownload[];
}

export async function movieBoxStreamsViaNuvio(_env: MovieBoxEnv, input: ProviderInput): Promise<RawStream[]> {
  if (!input.tmdbId) return [];
  try {
    const require = createRequire(import.meta.url);
    const mod = require('../vendor/nuvio-moviebox.cjs');
    const streams = await mod.getStreams(input.tmdbId, input.type === 'anime' ? 'tv' : input.type, input.season ?? 1, input.episode ?? 1);
    return (Array.isArray(streams) ? streams : []).map((item: any) => {
      const url = String(item?.url ?? '');
      const format = detectFormat(url, item?.format);
      const quality = normalizeQuality(item?.quality);
      if (!isSafeHttpUrl(url) || format === 'unknown') return null;
      if (!qualityAllowed(quality, input.quality)) return null;
      const subtitles = uniqueBy((Array.isArray(item?.subtitles) ? item.subtitles : []).map(subtitleFromValue).filter(Boolean) as RawSubtitle[], (value) => `${value.language_code}:${value.url}`);
      return {
        url,
        format: format as any,
        quality: quality as any,
        audio: String(item?.audio ?? item?.lang ?? item?.language ?? 'Original'),
        subtitles,
        provider: 'moviebox' as const,
        headers: item?.headers ?? undefined,
      };
    }).filter(Boolean) as RawStream[];
  } catch {
    return [];
  }
}

export interface RegionalMovieCandidate {
  moviebox_id: string;
  title: string;
  year: number | null;
  poster: string | null;
  rating: number | null;
  type: 'movie';
}

export async function movieBoxMadeInNaija(env: MovieBoxEnv): Promise<RegionalMovieCandidate[]> {
  const rowsResponse = await movieBoxRequest(env, '/home/rows');
  if (!rowsResponse.ok) return [];
  const rows = Array.isArray(rowsResponse.data?.rows) ? rowsResponse.data.rows : Array.isArray(rowsResponse.data) ? rowsResponse.data : [];
  const row = rows.find((item: any) => /nollywood|naija|nigerian/i.test(String(item?.title ?? item?.name ?? '')));
  const opId = row?.opId ?? row?.op_id ?? row?.id;
  if (!opId) return [];
  const subjectsResponse = await movieBoxRequest(env, `/home/subjects?opId=${encodeURIComponent(String(opId))}`);
  if (!subjectsResponse.ok) return [];
  const subjects = Array.isArray(subjectsResponse.data?.subjects) ? subjectsResponse.data.subjects : Array.isArray(subjectsResponse.data?.items) ? subjectsResponse.data.items : Array.isArray(subjectsResponse.data) ? subjectsResponse.data : [];
  return subjects.map((item: any) => ({
    moviebox_id: String(item?.subjectId ?? item?.id ?? ''),
    title: String(item?.title ?? item?.name ?? ''),
    year: Number(String(item?.releaseDate ?? item?.year ?? '').slice(0, 4)) || null,
    poster: item?.poster ?? item?.posterUrl ?? item?.cover ?? item?.coverUrl ?? null,
    rating: typeof item?.rating === 'number' ? item.rating : null,
    type: 'movie' as const,
  })).filter((item: RegionalMovieCandidate) => item.moviebox_id && item.title);
}
