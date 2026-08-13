// worker/src/config/franchises/fast-furious.ts
// Fast & Furious — release order with Tokyo Drift placed in its canonical
// chronological position (after Fast & Furious 6).

import type { FranchiseEntry } from '../types.js';

export const fastFurious: FranchiseEntry[] = [
  { order: 1,  spun_id: 'the-fast-and-the-furious-xxxxxx',  relation: 'main',    note: 'Start here' },
  { order: 2,  spun_id: '2-fast-2-furious-xxxxxx',           relation: 'sequel',  note: null },
  { order: 3,  spun_id: 'fast-furious-xxxxxx',               relation: 'sequel',  note: null },
  { order: 4,  spun_id: 'fast-five-xxxxxx',                  relation: 'sequel',  note: null },
  { order: 5,  spun_id: 'fast-furious-6-xxxxxx',             relation: 'sequel',  note: null },
  { order: 6,  spun_id: 'the-fast-and-the-furious-tokyo-drift-xxxxxx', relation: 'side_story', note: 'Released 3rd but set after F6 — watch here for chronological order' },
  { order: 7,  spun_id: 'furious-7-xxxxxx',                  relation: 'sequel',  note: null },
  { order: 8,  spun_id: 'the-fate-of-the-furious-xxxxxx',   relation: 'sequel',  note: null },
  { order: 9,  spun_id: 'fast-furious-presents-hobbs-shaw-xxxxxx', relation: 'spinoff', note: 'Spinoff — can watch anytime after F8' },
  { order: 10, spun_id: 'f9-the-fast-saga-xxxxxx',           relation: 'sequel',  note: null },
  { order: 11, spun_id: 'fast-x-xxxxxx',                     relation: 'sequel',  note: null },
];
