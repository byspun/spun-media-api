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

// ─── Lookup by TMDB ID ────────────────────────────────────────────────────────

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

// ─── Register or retrieve — TMDB content ─────────────────────────────────────

export async function resolveFromTmdb(
  env:    Env,
  tmdbId: number,
  type:   'movie' | 'tv',
  title:  string,
  params: {
    imdbId?: string | null;
    tvdbId?: number | null;
  } = {}
): Promise<MediaTitleRow> {
  // Check existing
  const existing = await getByTmdbId(env, tmdbId, type);
  if (existing) return existing;

  // Generate new spun_id
  const spunId = await makeSpunId(title, type, tmdbId);
  const slug   = makeSlug(title);

  const sql = getDb(env);
  const rows = await sql`
    INSERT INTO media_titles (
      spun_id, slug, content_type, title,
      tmdb_id, imdb_id, tvdb_id
    )
    VALUES (
      ${spunId}, ${slug}, ${type}, ${title},
      ${tmdbId},
      ${params.imdbId ?? null},
      ${params.tvdbId ?? null}
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
  } = {}
): Promise<MediaTitleRow> {
  // Check existing
  const existing = await getByAnilistId(env, anilistId);
  if (existing) return existing;

  // Generate new spun_id
  const spunId = await makeSpunId(title, 'anime', anilistId);
  const slug   = makeSlug(title);

  const sql = getDb(env);
  const rows = await sql`
    INSERT INTO media_titles (
      spun_id, slug, content_type, title,
      anilist_id, tmdb_id, mal_id
    )
    VALUES (
      ${spunId}, ${slug}, 'anime', ${title},
      ${anilistId},
      ${params.tmdbId ?? null},
      ${params.malId  ?? null}
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
  items: Array<{ id: number; title: string }>,
  type:  'movie' | 'tv'
): Promise<MediaTitleRow[]> {
  if (!items.length) return [];

  // 1. Check KV cache first
  const results: MediaTitleRow[] = [];
  const missingFromKv: typeof items = [];

  await Promise.all(
    items.map(async (item) => {
      const cached = await kvGet<MediaTitleRow>(env, `row:tmdb:${type}:${item.id}`);
      if (cached) results.push(cached);
      else missingFromKv.push(item);
    })
  );

  if (!missingFromKv.length) return results;

  // 2. Check DB for missing items
  const sql = getDb(env);
  const tmdbIds = missingFromKv.map((i) => i.id);
  const dbRows = await sql`
    SELECT * FROM media_titles 
    WHERE tmdb_id = ANY(${tmdbIds}) AND content_type = ${type}
  ` as MediaTitleRow[];

  results.push(...dbRows);

  const foundTmdbIds = new Set(dbRows.map((r) => Number(r.tmdb_id)));
  const missingFromDb = missingFromKv.filter((i) => !foundTmdbIds.has(i.id));

  if (!missingFromDb.length) {
    // Cache the newly found DB rows
    await Promise.all(
      dbRows.map((row) => 
        Promise.all([
          kvSet(env, `row:${row.spun_id}`, row, TTL.idMap),
          kvSet(env, `row:tmdb:${type}:${row.tmdb_id}`, row, TTL.idMap),
        ])
      )
    );
    return results;
  }

  // 3. Create missing items
  const newRows = await Promise.all(
    missingFromDb.map(async (item) => {
      const spunId = await makeSpunId(item.title, type, item.id);
      const slug   = makeSlug(item.title);
      
      const rows = await sql`
        INSERT INTO media_titles (spun_id, slug, content_type, title, tmdb_id)
        VALUES (${spunId}, ${slug}, ${type}, ${item.title}, ${item.id})
        ON CONFLICT (spun_id) DO UPDATE SET last_accessed_at = NOW()
        RETURNING *
      ` as MediaTitleRow[];
      
      return rows[0];
    })
  );

  results.push(...newRows);

  // 4. Cache everything new
  const allNew = [...dbRows, ...newRows];
  await Promise.all(
    allNew.map((row) => 
      Promise.all([
        kvSet(env, `row:${row.spun_id}`, row, TTL.idMap),
        kvSet(env, `row:tmdb:${type}:${row.tmdb_id}`, row, TTL.idMap),
      ])
    )
  );

  return results;
}

// ─── Batch Resolve — AniList ──────────────────────────────────────────────────

export async function batchResolveFromAnilist(
  env:   Env,
  items: Array<{ id: number; title: string; malId?: number }>
): Promise<MediaTitleRow[]> {
  if (!items.length) return [];

  const results: MediaTitleRow[] = [];
  const missingFromKv: typeof items = [];

  await Promise.all(
    items.map(async (item) => {
      const cached = await kvGet<MediaTitleRow>(env, `row:anilist:${item.id}`);
      if (cached) results.push(cached);
      else missingFromKv.push(item);
    })
  );

  if (!missingFromKv.length) return results;

  const sql = getDb(env);
  const anilistIds = missingFromKv.map((i) => i.id);
  const dbRows = await sql`
    SELECT * FROM media_titles 
    WHERE anilist_id = ANY(${anilistIds}) AND content_type = 'anime'
  ` as MediaTitleRow[];

  results.push(...dbRows);

  const foundIds = new Set(dbRows.map((r) => Number(r.anilist_id)));
  const missingFromDb = missingFromKv.filter((i) => !foundIds.has(i.id));

  if (!missingFromDb.length) {
    await Promise.all(
      dbRows.map((row) => 
        Promise.all([
          kvSet(env, `row:${row.spun_id}`, row, TTL.idMap),
          kvSet(env, `row:anilist:${row.anilist_id}`, row, TTL.idMap),
        ])
      )
    );
    return results;
  }

  const newRows = await Promise.all(
    missingFromDb.map(async (item) => {
      const spunId = await makeSpunId(item.title, 'anime', item.id);
      const slug   = makeSlug(item.title);
      
      const rows = await sql`
        INSERT INTO media_titles (spun_id, slug, content_type, title, anilist_id, mal_id)
        VALUES (${spunId}, ${slug}, 'anime', ${item.title}, ${item.id}, ${item.malId ?? null})
        ON CONFLICT (spun_id) DO UPDATE SET last_accessed_at = NOW()
        RETURNING *
      ` as MediaTitleRow[];
      
      return rows[0];
    })
  );

  results.push(...newRows);

  const allNew = [...dbRows, ...newRows];
  await Promise.all(
    allNew.map((row) => 
      Promise.all([
        kvSet(env, `row:${row.spun_id}`, row, TTL.idMap),
        kvSet(env, `row:anilist:${row.anilist_id}`, row, TTL.idMap),
      ])
    )
  );

  return results;
}
