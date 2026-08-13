// worker/src/config/franchises/mission-impossible.ts

import type { FranchiseEntry } from '../types.js';

export const missionImpossible: FranchiseEntry[] = [
  { order: 1, spun_id: 'mission-impossible-1996-xxxxxx',                       relation: 'main',   note: 'Start here' },
  { order: 2, spun_id: 'mission-impossible-2-xxxxxx',                          relation: 'sequel', note: null },
  { order: 3, spun_id: 'mission-impossible-iii-xxxxxx',                        relation: 'sequel', note: null },
  { order: 4, spun_id: 'mission-impossible-ghost-protocol-xxxxxx',             relation: 'sequel', note: null },
  { order: 5, spun_id: 'mission-impossible-rogue-nation-xxxxxx',               relation: 'sequel', note: null },
  { order: 6, spun_id: 'mission-impossible-fallout-xxxxxx',                    relation: 'sequel', note: null },
  { order: 7, spun_id: 'mission-impossible-dead-reckoning-part-one-xxxxxx',    relation: 'sequel', note: null },
  { order: 8, spun_id: 'mission-impossible-the-final-reckoning-xxxxxx',        relation: 'sequel', note: 'Series finale' },
];
