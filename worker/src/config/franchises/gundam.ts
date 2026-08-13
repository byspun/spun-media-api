// worker/src/config/franchises/gundam.ts
// Gundam Universe — curated selection of the most accessible entries.
// Not every UC series — chosen for accessibility and quality.

import type { FranchiseEntry } from '../types.js';

export const gundam: FranchiseEntry[] = [
  { order: 1, spun_id: 'mobile-suit-gundam-xxxxxx',                              relation: 'main',      note: 'Start here — the original that started it all (1979)' },
  { order: 2, spun_id: 'mobile-suit-zeta-gundam-xxxxxx',                         relation: 'sequel',    note: 'Universal Century continues' },
  { order: 3, spun_id: 'mobile-suit-gundam-chars-counterattack-xxxxxx',          relation: 'sequel',    note: 'Film — UC saga conclusion' },
  { order: 4, spun_id: 'mobile-suit-gundam-seed-xxxxxx',                         relation: 'main',      note: 'Alternate universe — good standalone entry point' },
  { order: 5, spun_id: 'mobile-suit-gundam-00-xxxxxx',                           relation: 'main',      note: 'Modern alternate universe — recommended for newcomers' },
  { order: 6, spun_id: 'mobile-suit-gundam-iron-blooded-orphans-xxxxxx',         relation: 'main',      note: 'Best standalone modern entry — no prior Gundam knowledge needed' },
  { order: 7, spun_id: 'mobile-suit-gundam-the-witch-from-mercury-xxxxxx',       relation: 'main',      note: 'Most recent series — great entry point for new viewers' },
];
