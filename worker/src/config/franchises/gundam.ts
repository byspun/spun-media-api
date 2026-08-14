// worker/src/config/franchises/gundam.ts
// Gundam Universe — curated selection of the most accessible entries.
// Not every UC series — chosen for accessibility and quality.

import type { FranchiseEntry } from '../types.js';

export const gundam: FranchiseEntry[] = [
  { order: 1, spun_id: "mobile-suit-gundam-472128", title: "Mobile Suit Gundam", primary_id: 80, relation: 'main',      note: 'Start here — the original that started it all (1979)' },
  { order: 2, spun_id: "mobile-suit-zeta-gundam-719825", title: "Mobile Suit Zeta Gundam", primary_id: 85, relation: 'sequel',    note: 'Universal Century continues' },
  { order: 3, spun_id: "mobile-suit-gundam-chars-counterattack-162895", title: "Mobile Suit Gundam: Char's Counterattack", primary_id: 87, relation: 'sequel',    note: 'Film — UC saga conclusion' },
  { order: 4, spun_id: "mobile-suit-gundam-seed-434521", title: "Mobile Suit Gundam Seed", primary_id: 93, relation: 'main',      note: 'Alternate universe — good standalone entry point' },
  { order: 5, spun_id: "mobile-suit-gundam-00-256082", title: "Mobile Suit Gundam 00", primary_id: 2581, relation: 'main',      note: 'Modern alternate universe — recommended for newcomers' },
  { order: 6, spun_id: "mobile-suit-gundam-iron-blooded-orphans-929236", title: "Mobile Suit GUNDAM Iron Blooded Orphans", primary_id: 21268, relation: 'main',      note: 'Best standalone modern entry — no prior Gundam knowledge needed' },
  { order: 7, spun_id: "mobile-suit-gundam-the-witch-from-mercury-408067", title: "Mobile Suit Gundam: The Witch from Mercury", primary_id: 139274, relation: 'main',      note: 'Most recent series — great entry point for new viewers' },
];
