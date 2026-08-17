// worker/src/identity/resolver.ts
// Universal ID resolver. Assigns spun_ids lazily on first metadata encounter.
// Every piece of content gets one row in media_titles — identified by spun_id.
//
// ID Assignment Flow:
//   1. Check KV cache for spun_id by external ID
//   2. Check Neon media_titles by external ID
//   3. If not found → generate spun_id → insert row → cache → return
//
// The deterministic hash means if a row is lost and recreated, it gets
// the same spun_id back. No bulk import needed.

import { getDb } from '../db.js';
import { kvGet, kvSet, kvDel, TTL } from '../cache.js';
import { makeSpunId, makeSlug } from './slugger.js';
import type { Env } from '../types/env.js';
import type { ContentType, MediaTitleRow } from '../types/index.js';

export interface TitleSummary {
  year?: number | null;
  rating?: number | null;
  posterPath?: string | null;
}

async function persistSummaryIfMissing(
  env: Env,
  row: MediaTitleRow,
  summary?: TitleSummary,
): Promise<MediaTitleRow> {
  if (!summary || row.summary_synced_at) return row;

  const sql = getDb(env);
  const updated = await sql`
    UPDATE media_titles
    SET year = ${summary.year ?? null},
        rating = ${summary.rating ?? null},
        poster_path = ${summary.posterPath ?? null},
        summary_synced_at = NOW()
    WHERE spun_id = ${row.spun_id}
    RETURNING *
  `;
  const next = (updated[0] as MediaTitleRow | undefined) ?? {
    ...row,
    year: summary.year ?? null,
    rating: summary.rating ?? null,
    poster_path: summary.posterPath ?? null,
    summary_synced_at: new Date().toISOString(),
  };
  await kvSet(env, `row:${row.spun_id}`, next, TTL.idMap);
  return next;
}

// ─── Lookup by spun_id ────────────────────────────────────────────────────────

export async function getBySpunId(
  env: Env,
  spunId: string
): Promise<MediaTitleRow | null> {
  const cached = await kvGet<MediaTitleRow>(env, `row:${spunId}`);
  if (cached) return cached;

  const sql  = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles WHERE spun_id = ${spunId} LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as MediaTitleRow;
  await kvSet(env, `row:${spunId}`, row, TTL.idMap);

  // Touch last_accessed_at in background — don't await
  sql`
    UPDATE media_titles
    SET last_accessed_at = NOW()
    WHERE spun_id = ${spunId}
  `.catch(() => {});

  return row;
}

export async function getBySpunIds(
  env: Env,
  spunIds: string[],
): Promise<MediaTitleRow[]> {
  const uniqueIds = [...new Set(spunIds.filter(Boolean))];
  if (!uniqueIds.length) return [];

  const sql = getDb(env);
  return await sql`
    SELECT * FROM media_titles
    WHERE spun_id = ANY(${uniqueIds})
  ` as MediaTitleRow[];
}

// ─── Lookup by TMDB ID ───────────────────────────────────────────────────────


export async function getByTmdbId(
  env:     Env,
  tmdbId:  number,
  type:    'movie' | 'tv'
): Promise<MediaTitleRow | null> {
  const cacheKey = `row:tmdb:${type}:${tmdbId}`;
  const cached   = await kvGet<MediaTitleRow>(env, cacheKey);
  if (cached) return cached;

  const sql  = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles
    WHERE tmdb_id = ${tmdbId} AND content_type = ${type}
    LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as MediaTitleRow;
  await kvSet(env, cacheKey, row, TTL.idMap);
  return row;
}

// ─── Lookup by AniList ID ─────────────────────────────────────────────────────

export async function getByMalId(
  env:   Env,
  malId: number,
): Promise<MediaTitleRow | null> {
  const cacheKey = `row:mal:${malId}`;
  const cached = await kvGet<MediaTitleRow>(env, cacheKey);
  if (cached) return cached;

  const sql = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles
    WHERE mal_id = ${malId} AND content_type = 'anime'
    LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as MediaTitleRow;
  await kvSet(env, cacheKey, row, TTL.idMap);
  return row;
}

export async function getByKitsuId(
  env:     Env,
  kitsuId: number,
): Promise<MediaTitleRow | null> {
  const cacheKey = `row:kitsu:${kitsuId}`;
  const cached = await kvGet<MediaTitleRow>(env, cacheKey);
  if (cached) return cached;

  const sql = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles
    WHERE kitsu_id = ${kitsuId} AND content_type = 'anime'
    LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as MediaTitleRow;
  await kvSet(env, cacheKey, row, TTL.idMap);
  return row;
}

export async function getByMovieboxId(
  env: Env,
  movieboxId: string,
  type?: 'movie' | 'tv' | 'anime',
): Promise<MediaTitleRow | null> {
  const cacheKey = `row:moviebox:${movieboxId}`;
  const cached = await kvGet<MediaTitleRow>(env, cacheKey);
  if (cached && (!type || cached.content_type === type)) return cached;

  const sql = getDb(env);
  const rows = type
    ? await sql`
        SELECT * FROM media_titles
        WHERE moviebox_id = ${movieboxId}
          AND content_type = ${type}
        LIMIT 1
      `
    : await sql`
        SELECT * FROM media_titles
        WHERE moviebox_id = ${movieboxId}
        LIMIT 1
      `;
  if (!rows.length) return null;

  const row = rows[0] as MediaTitleRow;
  await kvSet(env, cacheKey, row, TTL.idMap);
  return row;
}

export async function linkMovieboxId(
  env: Env,
  spunId: string,
  movieboxId: string,
): Promise<void> {
  const sql = getDb(env);
  await sql`
    UPDATE media_titles
    SET moviebox_id = ${movieboxId}
    WHERE spun_id = ${spunId} AND moviebox_id IS NULL
  `;
  await Promise.all([
    kvDel(env, `row:${spunId}`),
    kvDel(env, `row:moviebox:${movieboxId}`),
  ]);
}

export async function getByAnilistId(
  env:       Env,
  anilistId: number
): Promise<MediaTitleRow | null> {
  const cacheKey = `row:anilist:${anilistId}`;
  const cached   = await kvGet<MediaTitleRow>(env, cacheKey);
  if (cached) return cached;

  const sql  = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles
    WHERE anilist_id = ${anilistId} AND content_type = 'anime'
    LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as MediaTitleRow;
  await kvSet(env, cacheKey, row, TTL.idMap);
  return row;
}

export async function getByTvdbId(
  env:    Env,
  tvdbId: number,
): Promise<MediaTitleRow | null> {
  const cacheKey = `row:tvdb:${tvdbId}`;
  const cached = await kvGet<MediaTitleRow>(env, cacheKey);
  if (cached) return cached;

  const sql = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles
    WHERE tvdb_id = ${tvdbId} AND content_type = 'tv'
    LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as MediaTitleRow;
  await kvSet(env, cacheKey, row, TTL.idMap);
  return row;
}

// ─── Lookup by IMDb ID ────────────────────────────────────────────────────────

export async function getByImdbId(
  env:    Env,
  imdbId: string
): Promise<MediaTitleRow | null> {
  const cacheKey = `row:imdb:${imdbId}`;
  const cached   = await kvGet<MediaTitleRow>(env, cacheKey);
  if (cached) return cached;

  const sql  = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles WHERE imdb_id = ${imdbId} LIMIT 1
  `;
  if (!rows.length) return null;

  const row = rows[0] as MediaTitleRow;
  await kvSet(env, cacheKey, row, TTL.idMap);
  return row;
}

// ─── Register or retrieve — MovieBox content ───────────────────────────────────

export async function resolveFromMoviebox(
  env: Env,
  movieboxId: string,
  type: 'movie' | 'tv' | 'anime',
  title: string,
  params: { year?: number | null; rating?: number | null; posterPath?: string | null } = {},
): Promise<MediaTitleRow> {
  const existing = await getByMovieboxId(env, movieboxId, type);
  if (existing) return persistSummaryIfMissing(env, existing, {
    year: params.year,
    rating: params.rating,
    posterPath: params.posterPath,
  });

  const sql = getDb(env);
  const candidates = await sql`
    SELECT * FROM media_titles
    WHERE content_type = ${type}
      AND LOWER(title) = LOWER(${title})
      AND (${params.year ?? null}::int IS NULL OR year IS NULL OR ABS(year - ${params.year ?? null}::int) <= 1)
    LIMIT 2
  ` as MediaTitleRow[];
  if (candidates.length === 1) {
    const updated = await sql`
      UPDATE media_titles
      SET moviebox_id = ${movieboxId},
          year = COALESCE(year, ${params.year ?? null}),
          rating = COALESCE(rating, ${params.rating ?? null}),
          poster_path = COALESCE(poster_path, ${params.posterPath ?? null})
      WHERE spun_id = ${candidates[0].spun_id} AND moviebox_id IS NULL
      RETURNING *
    `;
    const row = (updated[0] as MediaTitleRow | undefined) ?? candidates[0];
    await Promise.all([
      kvSet(env, `row:${row.spun_id}`, row, TTL.idMap),
      kvSet(env, `row:moviebox:${movieboxId}`, row, TTL.idMap),
    ]);
    return row;
  }

  const spunId = await makeSpunId(title, type, movieboxId);
  const slug = makeSlug(title);
  const rows = await sql`
    INSERT INTO media_titles (
      spun_id, slug, content_type, title, moviebox_id,
      year, rating, poster_path, summary_synced_at
    ) VALUES (
      ${spunId}, ${slug}, ${type}, ${title}, ${movieboxId},
      ${params.year ?? null}, ${params.rating ?? null}, ${params.posterPath ?? null}, NOW()
    )
    ON CONFLICT (spun_id) DO UPDATE
      SET moviebox_id = COALESCE(media_titles.moviebox_id, EXCLUDED.moviebox_id),
          last_accessed_at = NOW()
    RETURNING *
  `;
  const row = rows[0] as MediaTitleRow;
  await Promise.all([
    kvSet(env, `row:${row.spun_id}`, row, TTL.idMap),
    kvSet(env, `row:moviebox:${movieboxId}`, row, TTL.idMap),
  ]);
  return row;
}

// ─── Register or retrieve — TMDB content ─────────────────────────────────────

export async function resolveFromTmdb(
  env:    Env,
  tmdbId: number,
  type:   'movie' | 'tv',
  title:  string,
  params: {
    imdbId?: string | null;
    tvdbId?: number | null;
    summary?: TitleSummary;
  } = {}
): Promise<MediaTitleRow> {
  // Check existing
  const existing = await getByTmdbId(env, tmdbId, type);
  if (existing) return persistSummaryIfMissing(env, existing, params.summary);

  // Generate new spun_id
  const spunId = await makeSpunId(title, type, tmdbId);
  const slug   = makeSlug(title);

  const sql = getDb(env);
  const rows = await sql`
    INSERT INTO media_titles (
      spun_id, slug, content_type, title,
      tmdb_id, imdb_id, tvdb_id, year, rating, poster_path, summary_synced_at
    )
    VALUES (
      ${spunId}, ${slug}, ${type}, ${title},
      ${tmdbId},
      ${params.imdbId ?? null},
      ${params.tvdbId ?? null},
      ${params.summary?.year ?? null},
      ${params.summary?.rating ?? null},
      ${params.summary?.posterPath ?? null},
      NOW()
    )
    ON CONFLICT (spun_id) DO UPDATE
      SET last_accessed_at = NOW()
    RETURNING *
  `;

  const row = rows[0] as MediaTitleRow;

  // Cache both lookup paths
  await Promise.all([
    kvSet(env, `row:${spunId}`,           row, TTL.idMap),
    kvSet(env, `row:tmdb:${type}:${tmdbId}`, row, TTL.idMap),
  ]);

  return row;
}

// ─── Register or retrieve — AniList content ───────────────────────────────────

export async function resolveFromAnilist(
  env:       Env,
  anilistId: number,
  title:     string,
  params: {
    tmdbId?: number | null;
    malId?:  number | null;
    summary?: TitleSummary;
  } = {}
): Promise<MediaTitleRow> {
  // Check existing
  const existing = await getByAnilistId(env, anilistId);
  if (existing) return persistSummaryIfMissing(env, existing, params.summary);

  // Generate new spun_id
  const spunId = await makeSpunId(title, 'anime', anilistId);
  const slug   = makeSlug(title);

  const sql = getDb(env);
  const rows = await sql`
    INSERT INTO media_titles (
      spun_id, slug, content_type, title,
      anilist_id, tmdb_id, mal_id, year, rating, poster_path, summary_synced_at
    )
    VALUES (
      ${spunId}, ${slug}, 'anime', ${title},
      ${anilistId},
      ${params.tmdbId ?? null},
      ${params.malId  ?? null},
      ${params.summary?.year ?? null},
      ${params.summary?.rating ?? null},
      ${params.summary?.posterPath ?? null},
      NOW()
    )
    ON CONFLICT (spun_id) DO UPDATE
      SET last_accessed_at = NOW()
    RETURNING *
  `;

  const row = rows[0] as MediaTitleRow;

  await Promise.all([
    kvSet(env, `row:${spunId}`,            row, TTL.idMap),
    kvSet(env, `row:anilist:${anilistId}`, row, TTL.idMap),
  ]);

  return row;
}

// ─── Register or retrieve — Kitsu anime ───────────────────────────────────────

export async function resolveFromKitsu(
  env:     Env,
  kitsuId: number,
  title:   string,
  params: {
    anilistId?: number | null;
    malId?:     number | null;
    tmdbId?:    number | null;
    tvdbId?:    number | null;
    summary?:   TitleSummary;
  } = {},
): Promise<MediaTitleRow> {
  const existing = await getByKitsuId(env, kitsuId);
  if (existing) {
    const sql = getDb(env);
    const updated = await sql`
      UPDATE media_titles
      SET anilist_id = COALESCE(anilist_id, ${params.anilistId ?? null}),
          mal_id = COALESCE(mal_id, ${params.malId ?? null}),
          tmdb_id = COALESCE(tmdb_id, ${params.tmdbId ?? null}),
          tvdb_id = COALESCE(tvdb_id, ${params.tvdbId ?? null})
      WHERE spun_id = ${existing.spun_id}
      RETURNING *
    `;
    const row = (updated[0] as MediaTitleRow | undefined) ?? existing;
    await kvSet(env, `row:kitsu:${kitsuId}`, row, TTL.idMap);
    return persistSummaryIfMissing(env, row, params.summary);
  }

  const linked = params.anilistId
    ? await getByAnilistId(env, params.anilistId)
    : params.malId
      ? await getByMalId(env, params.malId)
      : null;

  if (linked) {
    const sql = getDb(env);
    const updated = await sql`
      UPDATE media_titles
      SET kitsu_id = COALESCE(kitsu_id, ${kitsuId}),
          tmdb_id = COALESCE(tmdb_id, ${params.tmdbId ?? null}),
          tvdb_id = COALESCE(tvdb_id, ${params.tvdbId ?? null})
      WHERE spun_id = ${linked.spun_id}
      RETURNING *
    `;
    const row = (updated[0] as MediaTitleRow | undefined) ?? linked;
    await Promise.all([
      kvSet(env, `row:${row.spun_id}`, row, TTL.idMap),
      kvSet(env, `row:kitsu:${kitsuId}`, row, TTL.idMap),
    ]);
    return persistSummaryIfMissing(env, row, params.summary);
  }

  const spunId = await makeSpunId(title, 'anime', kitsuId);
  const slug = makeSlug(title);
  const sql = getDb(env);
  const rows = await sql`
    INSERT INTO media_titles (
      spun_id, slug, content_type, title,
      tmdb_id, anilist_id, mal_id, tvdb_id, kitsu_id,
      year, rating, poster_path, summary_synced_at
    )
    VALUES (
      ${spunId}, ${slug}, 'anime', ${title},
      ${params.tmdbId ?? null}, ${params.anilistId ?? null},
      ${params.malId ?? null}, ${params.tvdbId ?? null}, ${kitsuId},
      ${params.summary?.year ?? null}, ${params.summary?.rating ?? null},
      ${params.summary?.posterPath ?? null}, NOW()
    )
    ON CONFLICT (spun_id) DO UPDATE
      SET kitsu_id = COALESCE(media_titles.kitsu_id, EXCLUDED.kitsu_id),
          last_accessed_at = NOW()
    RETURNING *
  `;
  const row = rows[0] as MediaTitleRow;
  await Promise.all([
    kvSet(env, `row:${row.spun_id}`, row, TTL.idMap),
    kvSet(env, `row:kitsu:${kitsuId}`, row, TTL.idMap),
  ]);
  return row;
}

// ─── Register or retrieve — MAL anime ─────────────────────────────────────────

export async function resolveFromMal(
  env:   Env,
  malId: number,
  title: string,
  params: {
    anilistId?: number | null;
    tmdbId?: number | null;
    summary?: TitleSummary;
  } = {},
): Promise<MediaTitleRow> {
  const existing = await getByMalId(env, malId);
  if (existing) return persistSummaryIfMissing(env, existing, params.summary);

  const spunId = await makeSpunId(title, 'anime', malId);
  const slug = makeSlug(title);
  const sql = getDb(env);
  const rows = await sql`
    INSERT INTO media_titles (
      spun_id, slug, content_type, title,
      anilist_id, tmdb_id, mal_id, year, rating, poster_path, summary_synced_at
    )
    VALUES (
      ${spunId}, ${slug}, 'anime', ${title},
      ${params.anilistId ?? null},
      ${params.tmdbId ?? null},
      ${malId},
      ${params.summary?.year ?? null},
      ${params.summary?.rating ?? null},
      ${params.summary?.posterPath ?? null},
      NOW()
    )
    ON CONFLICT (spun_id) DO UPDATE
      SET last_accessed_at = NOW()
    RETURNING *
  `;

  const row = rows[0] as MediaTitleRow;
  await Promise.all([
    kvSet(env, `row:${spunId}`, row, TTL.idMap),
    kvSet(env, `row:mal:${malId}`, row, TTL.idMap),
  ]);
  return row;
}

// ─── Update Kitsu ID after discovery ──────────────────────────────────────────

export async function linkKitsuId(
  env:     Env,
  spunId:  string,
  kitsuId: number,
): Promise<void> {
  const sql = getDb(env);
  await sql`
    UPDATE media_titles SET kitsu_id = ${kitsuId}
    WHERE spun_id = ${spunId} AND kitsu_id IS NULL
  `;
  await Promise.all([
    kvDel(env, `row:${spunId}`),
    kvDel(env, `row:kitsu:${kitsuId}`),
  ]);
}

// ─── Update MAL ID after discovery ───────────────────────────────────────────

export async function linkMalId(
  env:    Env,
  spunId: string,
  malId:  number
): Promise<void> {
  const sql = getDb(env);
  await sql`
    UPDATE media_titles SET mal_id = ${malId}
    WHERE spun_id = ${spunId} AND mal_id IS NULL
  `;
  // Invalidate cached row so next read picks up malId
  await kvDel(env, `row:${spunId}`);
}

// ─── Update TMDB ID on anime row ──────────────────────────────────────────────

export async function linkTmdbId(
  env:    Env,
  spunId: string,
  tmdbId: number
): Promise<void> {
  const sql = getDb(env);
  await sql`
    UPDATE media_titles SET tmdb_id = ${tmdbId}
    WHERE spun_id = ${spunId} AND tmdb_id IS NULL
  `;
  await kvDel(env, `row:${spunId}`);
}

// ─── Batch lookup — curated franchise entries ─────────────────────────────────

export async function getBySlugs(
  env:   Env,
  slugs: string[],
  type:  ContentType
): Promise<MediaTitleRow[]> {
  const uniqueSlugs = [...new Set(slugs.filter(Boolean))];
  if (!uniqueSlugs.length) return [];

  const sql = getDb(env);
  const rows = await sql`
    SELECT * FROM media_titles
    WHERE slug = ANY(${uniqueSlugs}) AND content_type = ${type}
  ` as MediaTitleRow[];

  await Promise.all(
    rows.map((row) => kvSet(env, `row:${row.spun_id}`, row, TTL.idMap))
  );

  return rows;
}

// ─── Batch Resolve — TMDB ─────────────────────────────────────────────────────

export async function batchResolveFromTmdb(
  env:   Env,
  items: Array<{ id: number; title: string; summary?: TitleSummary }>,
  type:  'movie' | 'tv'
): Promise<MediaTitleRow[]> {
  if (!items.length) return [];

  const results: MediaTitleRow[] = [];
  const sql = getDb(env);
  const tmdbIds = items.map((i) => i.id);
  const dbRows = await sql`
    SELECT * FROM media_titles 
    WHERE tmdb_id = ANY(${tmdbIds}) AND content_type = ${type}
  ` as MediaTitleRow[];

  results.push(...dbRows);

  const foundTmdbIds = new Set(dbRows.map((r) => Number(r.tmdb_id)));
  const missingFromDb = items.filter((i) => !foundTmdbIds.has(i.id));

  if (!missingFromDb.length) {
    return results;
  }

  // 3. Create missing items
  const preparedItems = await Promise.all(
    missingFromDb.map(async (item) => ({
      item,
      spunId: await makeSpunId(item.title, type, item.id),
      slug: makeSlug(item.title),
    }))
  );
  const newQueries = preparedItems.map(({ item, spunId, slug }) => sql`
            INSERT INTO media_titles (spun_id, slug, content_type, title, tmdb_id, year, rating, poster_path, summary_synced_at)
        VALUES (${spunId}, ${slug}, ${type}, ${item.title}, ${item.id}, ${item.summary?.year ?? null}, ${item.summary?.rating ?? null}, ${item.summary?.posterPath ?? null}, NOW())

    ON CONFLICT (spun_id) DO UPDATE SET last_accessed_at = NOW()
    RETURNING *
  `);
  const inserted = await sql.transaction(newQueries);
  const newRows = inserted.map((rows) => rows[0] as MediaTitleRow);

  results.push(...newRows);

  return results;
}

// ─── Batch Resolve — AniList ──────────────────────────────────────────────────

export async function batchResolveFromAnilist(
  env:   Env,
  items: Array<{ id: number; title: string; malId?: number; summary?: TitleSummary }>
): Promise<MediaTitleRow[]> {
  if (!items.length) return [];

  const results: MediaTitleRow[] = [];
  const sql = getDb(env);
  const anilistIds = items.map((i) => i.id);
  const dbRows = await sql`
    SELECT * FROM media_titles 
    WHERE anilist_id = ANY(${anilistIds}) AND content_type = 'anime'
  ` as MediaTitleRow[];

  results.push(...dbRows);

  const foundIds = new Set(dbRows.map((r) => Number(r.anilist_id)));
  const missingFromDb = items.filter((i) => !foundIds.has(i.id));

  if (!missingFromDb.length) return results;

  const preparedItems = await Promise.all(
    missingFromDb.map(async (item) => ({
      item,
      spunId: await makeSpunId(item.title, 'anime', item.id),
      slug: makeSlug(item.title),
    }))
  );
  const newQueries = preparedItems.map(({ item, spunId, slug }) => sql`
            INSERT INTO media_titles (spun_id, slug, content_type, title, anilist_id, mal_id, year, rating, poster_path, summary_synced_at)
        VALUES (${spunId}, ${slug}, 'anime', ${item.title}, ${item.id}, ${item.malId ?? null}, ${item.summary?.year ?? null}, ${item.summary?.rating ?? null}, ${item.summary?.posterPath ?? null}, NOW())

    ON CONFLICT (spun_id) DO UPDATE SET last_accessed_at = NOW()
    RETURNING *
  `);
  const inserted = await sql.transaction(newQueries);
  const newRows = inserted.map((rows) => rows[0] as MediaTitleRow);

  results.push(...newRows);

  return results;
}
