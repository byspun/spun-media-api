// worker/src/relationships.ts
// Provider-neutral relationship assembly for title information.

import type {
  ContentItem,
  MediaTitleRow,
  MembershipSummary,
  RelatedGroup,
  RelatedGroupItem,
} from './types/index.js';
import type { Env } from './types/env.js';
import { getTmdbCollection, getTmdbMovieDetail } from './metadata/tmdb.js';
import { getDb } from './db.js';
import { batchResolveFromTmdb } from './identity/resolver.js';
import { makeSlug, makeSpunId } from './identity/slugger.js';
import { tmdbResultToItem } from './normalizer.js';
import { findFranchiseByPrimaryId, findFranchiseBySpunId } from './config/franchises/index.js';

function rowToItem(row: MediaTitleRow): ContentItem {
  return {
    spun_id: row.spun_id,
    type:    row.content_type,
    title:   row.title,
    year:    null,
    rating:  null,
    poster:  null,
  };
}

async function buildCollectionGroup(
  env: Env,
  collectionRef: { id: number; name: string } | null
): Promise<RelatedGroup | null> {
  if (!collectionRef) return null;

  const collection = await getTmdbCollection(env, collectionRef.id);
  if (!collection?.parts?.length) return null;

  const parts = collection.parts.filter((part) => Boolean(part.id && part.title));
  if (!parts.length) return null;

  const rows = await batchResolveFromTmdb(
    env,
    parts.map((part) => ({ id: part.id, title: part.title })),
    'movie'
  );
  const rowByTmdbId = new Map(rows.map((row) => [Number(row.tmdb_id), row]));

  const items: RelatedGroupItem[] = parts.flatMap((part, index) => {
    const row = rowByTmdbId.get(part.id);
    if (!row) return [];

    return [{
      ...tmdbResultToItem(part, row.spun_id, 'movie'),
      position:   index + 1,
      role:       null,
      note:       null,
      is_current: false,
    }];
  });

  if (!items.length) return null;

  return {
    kind:  'collection',
    id:    makeSlug(collection.name || collectionRef.name),
    title: collection.name || collectionRef.name,
    total: items.length,
    items,
  };
}

async function seedFranchiseRows(
  env: Env,
  type: 'movie' | 'tv' | 'anime',
  entries: Array<{ title: string; primary_id: number }>
): Promise<MediaTitleRow[]> {
  const sql = getDb(env);
  const ids = entries.map((entry) => entry.primary_id);
  const existing = type === 'anime'
    ? await sql`SELECT * FROM media_titles WHERE anilist_id = ANY(${ids}) AND content_type = 'anime'`
    : await sql`SELECT * FROM media_titles WHERE tmdb_id = ANY(${ids}) AND content_type = ${type}`;
  const rows = existing as MediaTitleRow[];
  const knownIds = new Set(rows.map((row) => type === 'anime' ? Number(row.anilist_id) : Number(row.tmdb_id)));

  for (const entry of entries) {
    if (knownIds.has(entry.primary_id)) continue;

    const spunId = await makeSpunId(entry.title, type, entry.primary_id);
    const slug = makeSlug(entry.title);
    const inserted = type === 'anime'
      ? await sql`
          INSERT INTO media_titles (spun_id, slug, content_type, title, anilist_id)
          VALUES (${spunId}, ${slug}, 'anime', ${entry.title}, ${entry.primary_id})
          ON CONFLICT (spun_id) DO UPDATE SET last_accessed_at = NOW()
          RETURNING *
        `
      : await sql`
          INSERT INTO media_titles (spun_id, slug, content_type, title, tmdb_id)
          VALUES (${spunId}, ${slug}, ${type}, ${entry.title}, ${entry.primary_id})
          ON CONFLICT (spun_id) DO UPDATE SET last_accessed_at = NOW()
          RETURNING *
        `;

    const row = inserted[0] as MediaTitleRow;
    rows.push(row);
    knownIds.add(entry.primary_id);
  }

  return rows;
}

async function buildFranchiseGroup(
  env: Env,
  row: MediaTitleRow
): Promise<RelatedGroup | null> {
  const primaryId = row.content_type === 'anime' ? row.anilist_id : row.tmdb_id;
  const membership = primaryId
    ? findFranchiseByPrimaryId(row.content_type, Number(primaryId))
    : findFranchiseBySpunId(row.spun_id);
  if (!membership) return null;

  const orderedEntries = [...membership.entries].sort((a, b) => a.order - b.order);
  const rows = await seedFranchiseRows(
    env,
    membership.type,
    orderedEntries.map((entry) => ({ title: entry.title, primary_id: entry.primary_id }))
  );

  const rowByPrimaryId = new Map(
    rows.map((row) => [
      membership.type === 'anime' ? Number(row.anilist_id) : Number(row.tmdb_id),
      row,
    ])
  );

  const items: RelatedGroupItem[] = orderedEntries.flatMap((entry) => {
    const entryRow = rowByPrimaryId.get(entry.primary_id);
    if (!entryRow) return [];

    return [{
      ...rowToItem(entryRow),
      position:   entry.order,
      role:       entry.relation,
      note:       entry.note,
      is_current: entryRow.spun_id === row.spun_id,
    }];
  });

  if (items.length < 2) return null;

  return {
    kind:  'franchise',
    id:    membership.key,
    title: membership.name,
    total: orderedEntries.length,
    items,
  };
}

export async function getRelationshipGroups(
  env: Env,
  row: MediaTitleRow,
  knownCollection: { id: number; name: string } | null | undefined = undefined
): Promise<RelatedGroup[]> {
  let collectionRef = knownCollection;

  if (row.content_type === 'movie' && collectionRef === undefined && row.tmdb_id) {
    const movie = await getTmdbMovieDetail(env, row.tmdb_id);
    collectionRef = movie?.belongs_to_collection ?? null;
  }

  const [collection, franchise] = await Promise.all([
    row.content_type === 'movie'
      ? buildCollectionGroup(env, collectionRef ?? null)
      : Promise.resolve(null),
    buildFranchiseGroup(env, row),
  ]);

  const groups = [collection, franchise].filter((group): group is RelatedGroup => group !== null);

  for (const group of groups) {
    group.items = group.items.map((item) => ({
      ...item,
      is_current: item.spun_id === row.spun_id,
    }));
  }

  return groups;
}

export async function getMembershipSummaries(
  env: Env,
  row: MediaTitleRow,
  knownCollection: { id: number; name: string } | null | undefined = undefined
): Promise<MembershipSummary[]> {
  const groups = await getRelationshipGroups(env, row, knownCollection);

  return groups.flatMap((group) => {
    const current = group.items.find((item) => item.is_current);
    if (!current) return [];

    return [{
      kind:     group.kind,
      id:       group.id,
      title:    group.title,
      position: current.position,
      total:    group.total,
    }];
  });
}
