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
import { batchResolveFromTmdb, getBySlugs } from './identity/resolver.js';
import { makeSlug } from './identity/slugger.js';
import { tmdbResultToItem } from './normalizer.js';
import { findFranchiseBySpunId } from './config/franchises/index.js';

function configSlug(spunId: string): string {
  return spunId.replace(/-(?:\d{6}|xxxxxx)$/i, '');
}

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

async function buildFranchiseGroup(
  env:     Env,
  spunId:  string
): Promise<RelatedGroup | null> {
  const membership = findFranchiseBySpunId(spunId);
  if (!membership) return null;

  const orderedEntries = [...membership.entries].sort((a, b) => a.order - b.order);
  const rows = await getBySlugs(
    env,
    orderedEntries.map((entry) => configSlug(entry.spun_id)),
    membership.type
  );
  const rowBySlug = new Map(rows.map((row) => [row.slug, row]));

  const items: RelatedGroupItem[] = orderedEntries.flatMap((entry) => {
    const row = rowBySlug.get(configSlug(entry.spun_id));
    if (!row) return [];

    return [{
      ...rowToItem(row),
      position:   entry.order,
      role:       entry.relation,
      note:       entry.note,
      is_current: row.spun_id === spunId,
    }];
  });

  // Do not expose a one-item partial group while a curated configuration is
  // still being backfilled. A group becomes public once it is genuinely useful.
  if (items.length < 2) return null;

  return {
    kind:  'franchise',
    id:    membership.key,
    title: membership.name,
    total: items.length,
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
    buildFranchiseGroup(env, row.spun_id),
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
