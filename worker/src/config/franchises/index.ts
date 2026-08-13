// worker/src/config/franchises/index.ts
// Central registry of all franchise configs.
// Keys match the row IDs used in home route files.

export { mcu }              from './mcu.js';
export { dceu }             from './dceu.js';
export { dcu }              from './dcu.js';
export { fastFurious }      from './fast-furious.js';
export { missionImpossible } from './mission-impossible.js';
export { jamesBond }        from './james-bond.js';
export { marvelTv }         from './marvel-tv.js';
export { starWars }         from './star-wars.js';
export { attackOnTitan }    from './attack-on-titan.js';
export { fateUniverse }     from './fate-universe.js';
export { shounenBigThree }  from './shounen-big-three.js';
export { dragonBall }       from './dragon-ball.js';
export { monogatari }       from './monogatari.js';
export { gundam }           from './gundam.js';
export { typeMoon }         from './type-moon.js';

// Lookup map — used by /anime/franchise/:spunId and /anime/:spunId/watch-order
// to find which franchise a given spun_id belongs to.
import { mcu }              from './mcu.js';
import { dceu }             from './dceu.js';
import { dcu }              from './dcu.js';
import { fastFurious }      from './fast-furious.js';
import { missionImpossible } from './mission-impossible.js';
import { jamesBond }        from './james-bond.js';
import { marvelTv }         from './marvel-tv.js';
import { starWars }         from './star-wars.js';
import { attackOnTitan }    from './attack-on-titan.js';
import { fateUniverse }     from './fate-universe.js';
import { shounenBigThree }  from './shounen-big-three.js';
import { dragonBall }       from './dragon-ball.js';
import { monogatari }       from './monogatari.js';
import { gundam }           from './gundam.js';
import { typeMoon }         from './type-moon.js';
import type { FranchiseEntry } from '../types.js';

export const FRANCHISE_REGISTRY: Record<string, { name: string; entries: FranchiseEntry[] }> = {
  mcu:               { name: 'MCU Line-Up',           entries: mcu },
  dceu:              { name: 'DC Extended Universe',  entries: dceu },
  dcu:               { name: 'DC Universe',           entries: dcu },
  'fast-furious':    { name: 'Fast & Furious',        entries: fastFurious },
  'mission-impossible': { name: 'Mission: Impossible', entries: missionImpossible },
  'james-bond':      { name: 'James Bond',            entries: jamesBond },
  'marvel-tv':       { name: 'Marvel TV',             entries: marvelTv },
  'star-wars':       { name: 'Star Wars Universe',    entries: starWars },
  'attack-on-titan': { name: 'Attack on Titan',       entries: attackOnTitan },
  'fate-universe':   { name: 'Fate Universe',         entries: fateUniverse },
  'shounen-big-three': { name: 'Shounen Big Three',   entries: shounenBigThree },
  'dragon-ball':     { name: 'Dragon Ball',           entries: dragonBall },
  monogatari:        { name: 'Monogatari Series',     entries: monogatari },
  gundam:            { name: 'Gundam Universe',       entries: gundam },
  'type-moon':       { name: 'Type-Moon Universe',    entries: typeMoon },
};

/**
 * Find which franchise a spun_id belongs to.
 * Returns the franchise key and the entry, or null if not found.
 */
export function findFranchiseBySpunId(spunId: string): {
  key:      string;
  name:     string;
  entries:  FranchiseEntry[];
  entry:    FranchiseEntry;
} | null {
  for (const [key, franchise] of Object.entries(FRANCHISE_REGISTRY)) {
    const entry = franchise.entries.find((e) => e.spun_id === spunId);
    if (entry) {
      return { key, name: franchise.name, entries: franchise.entries, entry };
    }
  }
  return null;
}
