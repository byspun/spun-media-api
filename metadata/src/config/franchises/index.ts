// metadata/src/config/franchises/index.ts
// Central registry of all curated franchise configurations.

export { mcu }                from './mcu.js';
export { dceu }               from './dceu.js';
export { dcu }                from './dcu.js';
export { fastFurious }        from './fast-furious.js';
export { missionImpossible }  from './mission-impossible.js';
export { jamesBond }          from './james-bond.js';
export { marvelTv }           from './marvel-tv.js';
export { starWars }           from './star-wars.js';
export { attackOnTitan }      from './attack-on-titan.js';
export { fateUniverse }       from './fate-universe.js';
export { shounenBigThree }    from './shounen-big-three.js';
export { dragonBall }         from './dragon-ball.js';
export { monogatari }         from './monogatari.js';
export { gundam }             from './gundam.js';
export { typeMoon }           from './type-moon.js';

import { mcu }                from './mcu.js';
import { dceu }               from './dceu.js';
import { dcu }                from './dcu.js';
import { fastFurious }        from './fast-furious.js';
import { missionImpossible }  from './mission-impossible.js';
import { jamesBond }          from './james-bond.js';
import { marvelTv }           from './marvel-tv.js';
import { starWars }           from './star-wars.js';
import { attackOnTitan }      from './attack-on-titan.js';
import { fateUniverse }       from './fate-universe.js';
import { shounenBigThree }    from './shounen-big-three.js';
import { dragonBall }         from './dragon-ball.js';
import { monogatari }         from './monogatari.js';
import { gundam }             from './gundam.js';
import { typeMoon }           from './type-moon.js';
import type { FranchiseDefinition, FranchiseEntry } from '../types.js';

export const FRANCHISE_REGISTRY: Record<string, FranchiseDefinition> = {
  mcu:                 { name: 'MCU Line-Up',          type: 'movie', entries: mcu },
  dceu:                { name: 'DC Extended Universe', type: 'movie', entries: dceu },
  dcu:                 { name: 'DC Universe',          type: 'movie', entries: dcu },
  'fast-furious':      { name: 'Fast & Furious',       type: 'movie', entries: fastFurious },
  'mission-impossible': { name: 'Mission: Impossible', type: 'movie', entries: missionImpossible },
  'james-bond':        { name: 'James Bond',           type: 'movie', entries: jamesBond },
  'marvel-tv':         { name: 'Marvel TV',            type: 'tv',    entries: marvelTv },
  'star-wars':         { name: 'Star Wars Universe',   type: 'tv',    entries: starWars },
  'attack-on-titan':   { name: 'Attack on Titan',      type: 'anime', entries: attackOnTitan },
  'fate-universe':     { name: 'Fate Universe',        type: 'anime', entries: fateUniverse },
  'shounen-big-three': { name: 'Shounen Big Three',    type: 'anime', entries: shounenBigThree },
  'dragon-ball':       { name: 'Dragon Ball',          type: 'anime', entries: dragonBall },
  monogatari:          { name: 'Monogatari Series',    type: 'anime', entries: monogatari },
  gundam:              { name: 'Gundam Universe',      type: 'anime', entries: gundam },
  'type-moon':         { name: 'Type-Moon Universe',   type: 'anime', entries: typeMoon },
};

function identitySlug(spunId: string): string {
  return spunId.replace(/-(?:\d{6}|xxxxxx)$/i, '');
}

/**
 * Finds a curated franchise for a live Spün ID. Configs may use an `xxxxxx`
 * suffix while they await full ID backfill, so membership matches on the stable
 * title slug while group items resolve only from verified catalog rows.
 */
export interface FranchiseMembership {
  key:      string;
  name:     string;
  type:     FranchiseDefinition['type'];
  entries:  FranchiseEntry[];
  entry:    FranchiseEntry;
}

function makeMembership(
  key: string,
  franchise: FranchiseDefinition,
  entry: FranchiseEntry
): FranchiseMembership {
  return {
    key,
    name: franchise.name,
    type: franchise.type,
    entries: franchise.entries,
    entry,
  };
}

export function findFranchiseBySpunId(spunId: string): FranchiseMembership | null {
  const slug = identitySlug(spunId);

  for (const [key, franchise] of Object.entries(FRANCHISE_REGISTRY)) {
    const entry = franchise.entries.find((candidate) => identitySlug(candidate.spun_id) === slug);
    if (entry) return makeMembership(key, franchise, entry);
  }

  return null;
}

export function findFranchiseByPrimaryId(
  type: FranchiseDefinition['type'],
  primaryId: number
): FranchiseMembership | null {
  for (const [key, franchise] of Object.entries(FRANCHISE_REGISTRY)) {
    if (franchise.type !== type) continue;
    const entry = franchise.entries.find((candidate) => candidate.primary_id === primaryId);
    if (entry) return makeMembership(key, franchise, entry);
  }

  return null;
}

export interface CuratedFranchise {
  id:         string;
  name:       string;
  type:       FranchiseDefinition['type'];
  entries:    FranchiseEntry[];
}

function normalizeFranchiseReference(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function listCuratedFranchises(): CuratedFranchise[] {
  return Object.entries(FRANCHISE_REGISTRY).map(([id, franchise]) => ({
    id,
    name:    franchise.name,
    type:    franchise.type,
    entries: [...franchise.entries].sort((a, b) => a.order - b.order),
  }));
}

export function getCuratedFranchise(reference: string): CuratedFranchise | null {
  const normalized = normalizeFranchiseReference(reference);

  for (const [id, franchise] of Object.entries(FRANCHISE_REGISTRY)) {
    if (id === normalized || normalizeFranchiseReference(franchise.name) === normalized) {
      return {
        id,
        name:    franchise.name,
        type:    franchise.type,
        entries: [...franchise.entries].sort((a, b) => a.order - b.order),
      };
    }
  }

  return null;
}

export interface CuratedFranchiseEntry extends FranchiseEntry {
  franchise_id: string;
  content_type: FranchiseDefinition['type'];
}

export function getUniqueCuratedFranchiseEntries(
  reference?: string
): CuratedFranchiseEntry[] {
  const franchises = reference
    ? [getCuratedFranchise(reference)].filter((franchise): franchise is CuratedFranchise => franchise !== null)
    : listCuratedFranchises();
  const unique = new Map<string, CuratedFranchiseEntry>();

  for (const franchise of franchises) {
    for (const entry of franchise.entries) {
      if (!unique.has(entry.spun_id)) {
        unique.set(entry.spun_id, {
          ...entry,
          franchise_id: franchise.id,
          content_type: franchise.type,
        });
      }
    }
  }

  return [...unique.values()];
}
