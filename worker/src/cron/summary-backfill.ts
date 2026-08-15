import type { Env } from '../types/env.js';
import type { MediaTitleRow } from '../types/index.js';
import { getDb } from '../db.js';
import { kvSet, TTL } from '../cache.js';
import {
  extractYear,
  getTmdbMovieDetail,
  getTmdbTvDetail,
  tmdbPoster,
} from '../metadata/tmdb.js';
import { getAnilistSummary } from '../metadata/anilist.js';
import { getJikanAnimeDetail } from '../metadata/jikan.js';

interface SummaryValues {
  year: number | null;
  rating: number | null;
  posterPath: string | null;
}

export interface SummaryBackfillResult {
  requested: number;
  processed: number;
  updated: number;
  failed: number;
  remaining: number;
  failed_spun_ids: string[];
}

function tmdbSummary(detail: Awaited<ReturnType<typeof getTmdbMovieDetail>> | Awaited<ReturnType<typeof getTmdbTvDetail>>, type: 'movie' | 'tv'): SummaryValues | null {
  if (!detail) return null;
  const date = type === 'movie'
    ? (detail as NonNullable<Awaited<ReturnType<typeof getTmdbMovieDetail>>>).release_date
    : (detail as NonNullable<Awaited<ReturnType<typeof getTmdbTvDetail>>>).first_air_date;
  return {
    year: extractYear(date),
    rating: typeof detail.vote_average === 'number' ? Number(detail.vote_average.toFixed(1)) : null,
    posterPath: tmdbPoster(detail.poster_path ?? null),
  };
}

async function lookupSummary(env: Env, row: MediaTitleRow): Promise<SummaryValues | null> {
  if (row.content_type === 'movie' && row.tmdb_id) {
    return tmdbSummary(await getTmdbMovieDetail(env, row.tmdb_id), 'movie');
  }

  if (row.content_type === 'tv' && row.tmdb_id) {
    return tmdbSummary(await getTmdbTvDetail(env, row.tmdb_id), 'tv');
  }

  if (row.content_type === 'anime' && row.anilist_id) {
    const media = await getAnilistSummary(env, row.anilist_id);
    if (!media) return null;
    return {
      year: media.startDate?.year ?? null,
      rating: typeof media.averageScore === 'number' ? Number((media.averageScore / 10).toFixed(1)) : null,
      posterPath: media.coverImage?.large ?? media.coverImage?.medium ?? null,
    };
  }

  if (row.content_type === 'anime' && row.mal_id) {
    const detail = await getJikanAnimeDetail(env, row.mal_id);
    if (!detail) return null;
    const year = detail.year ?? (detail.aired?.from ? Number(detail.aired.from.slice(0, 4)) : null);
    return {
      year: Number.isFinite(year) ? year : null,
      rating: typeof detail.score === 'number' ? Number(detail.score.toFixed(1)) : null,
      posterPath: detail.images?.jpg?.large_image_url ?? detail.images?.jpg?.image_url ?? null,
    };
  }

  return { year: null, rating: null, posterPath: null };
}

export async function backfillTitleSummaries(env: Env, requestedLimit = 5): Promise<SummaryBackfillResult> {
  const limit = Math.max(1, Math.min(5, Math.floor(requestedLimit)));
  const sql = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles
    WHERE summary_synced_at IS NULL
    ORDER BY created_at ASC
    LIMIT ${limit}
  ` as MediaTitleRow[];

  let updated = 0;
  let failed = 0;
  const failedSpunIds: string[] = [];

  for (const row of rows) {
    try {
      const summary = await lookupSummary(env, row);
      if (!summary) {
        failed++;
        failedSpunIds.push(row.spun_id);
        continue;
      }

      const updatedRows = await sql`
        UPDATE media_titles
        SET year = ${summary.year},
            rating = ${summary.rating},
            poster_path = ${summary.posterPath},
            summary_synced_at = NOW()
        WHERE spun_id = ${row.spun_id}
        RETURNING *
      ` as MediaTitleRow[];
      const updatedRow = updatedRows[0] ?? {
        ...row,
        year: summary.year,
        rating: summary.rating,
        poster_path: summary.posterPath,
        summary_synced_at: new Date().toISOString(),
      };
      await kvSet(env, `row:${row.spun_id}`, updatedRow, TTL.idMap);
      updated++;
    } catch (error) {
      console.error(`[SummaryBackfill] Failed for ${row.spun_id}:`, error);
      failed++;
      failedSpunIds.push(row.spun_id);
    }
  }

  const remainingRows = await sql`
    SELECT COUNT(*)::int AS count
    FROM media_titles
    WHERE summary_synced_at IS NULL
  ` as Array<{ count: number }>;

  return {
    requested: limit,
    processed: rows.length,
    updated,
    failed,
    remaining: remainingRows[0]?.count ?? 0,
    failed_spun_ids: failedSpunIds,
  };
}
