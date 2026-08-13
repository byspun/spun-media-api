// worker/src/config/franchises/attack-on-titan.ts

import type { FranchiseEntry } from '../types.js';

export const attackOnTitan: FranchiseEntry[] = [
  { order: 1, spun_id: 'attack-on-titan-xxxxxx',                              relation: 'main',   note: 'Start here' },
  { order: 2, spun_id: 'attack-on-titan-season-2-xxxxxx',                     relation: 'sequel', note: null },
  { order: 3, spun_id: 'attack-on-titan-season-3-xxxxxx',                     relation: 'sequel', note: null },
  { order: 4, spun_id: 'attack-on-titan-the-final-season-xxxxxx',             relation: 'sequel', note: null },
  { order: 5, spun_id: 'attack-on-titan-the-final-season-part-2-xxxxxx',      relation: 'sequel', note: null },
  { order: 6, spun_id: 'attack-on-titan-the-final-chapters-special-1-xxxxxx', relation: 'sequel', note: null },
  { order: 7, spun_id: 'attack-on-titan-the-final-chapters-special-2-xxxxxx', relation: 'sequel', note: 'Final entry' },
];
