// Authoritative registration for curated franchise entries.
// Configured identity data takes precedence over pre-existing conflicting rows.

import type { Env } from './types/env.js';
import { getDb } from './db.js';
import {
  getCuratedFranchise,
  getUniqueCuratedFranchiseEntries,
  listCuratedFranchises,
} from './config/franchises/index.js';

export interface FranchiseRegistrationResult {
  scope:                string;
  franchise_count:      number;
  configured_entries:   number;
  registered_titles:    number;
  overridden_conflicts: number;
}

export async function registerCuratedFranchises(
  env: Env,
  reference?: string
): Promise<FranchiseRegistrationResult | null> {
  if (reference && !getCuratedFranchise(reference)) return null;

  const entries = getUniqueCuratedFranchiseEntries(reference);
  const franchiseCount = reference ? 1 : listCuratedFranchises().length;
  if (!entries.length) {
    return {
      scope:                reference ?? 'all',
      franchise_count:      franchiseCount,
      configured_entries:   0,
      registered_titles:    0,
      overridden_conflicts: 0,
    };
  }

  const records = entries.map((entry) => ({
    spun_id:    entry.spun_id,
    slug:       entry.spun_id.replace(/-\d{6}$/, ''),
    content_type: entry.content_type,
    title:      entry.title,
    tmdb_id:    entry.content_type === 'anime' ? null : entry.primary_id,
    anilist_id: entry.content_type === 'anime' ? entry.primary_id : null,
  }));
  const payload = JSON.stringify(records);
  const sql = getDb(env);

  const result = await sql`
    WITH incoming AS (
      SELECT *
      FROM jsonb_to_recordset(${payload}::jsonb)
        AS values_row(
          spun_id TEXT,
          slug TEXT,
          content_type TEXT,
          title TEXT,
          tmdb_id BIGINT,
          anilist_id BIGINT
        )
    ),
    removed_conflicts AS (
      DELETE FROM media_titles AS existing
      USING incoming
      WHERE existing.content_type = incoming.content_type
        AND existing.spun_id <> incoming.spun_id
        AND (
          (incoming.tmdb_id IS NOT NULL AND existing.tmdb_id = incoming.tmdb_id)
          OR (incoming.anilist_id IS NOT NULL AND existing.anilist_id = incoming.anilist_id)
        )
      RETURNING existing.spun_id
    ),
    registered AS (
      INSERT INTO media_titles (
        spun_id, slug, content_type, title, tmdb_id, anilist_id
      )
      SELECT spun_id, slug, content_type, title, tmdb_id, anilist_id
      FROM incoming
      ON CONFLICT (spun_id) DO UPDATE SET
        slug = EXCLUDED.slug,
        content_type = EXCLUDED.content_type,
        title = EXCLUDED.title,
        tmdb_id = COALESCE(EXCLUDED.tmdb_id, media_titles.tmdb_id),
        anilist_id = COALESCE(EXCLUDED.anilist_id, media_titles.anilist_id),
        last_accessed_at = NOW()
      RETURNING spun_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM registered) AS registered_titles,
      (SELECT COUNT(*)::int FROM removed_conflicts) AS overridden_conflicts
  `;

  const counts = result[0] as { registered_titles: number; overridden_conflicts: number };
  return {
    scope:                reference ?? 'all',
    franchise_count:      franchiseCount,
    configured_entries:   entries.length,
    registered_titles:    Number(counts.registered_titles),
    overridden_conflicts: Number(counts.overridden_conflicts),
  };
}
