// worker/src/config/franchises/fate-universe.ts
// Fate Universe — recommended watch order, NOT chronological or release order.
// The notes are the product here — Fate's entry point debate is legendary.

import type { FranchiseEntry } from '../types.js';

export const fateUniverse: FranchiseEntry[] = [
  { order: 1, spun_id: 'fate-zero-xxxxxx',                                    relation: 'prequel',   note: 'Start here — chronologically first and the best hook for new viewers' },
  { order: 2, spun_id: 'fate-stay-night-unlimited-blade-works-xxxxxx',        relation: 'sequel',    note: 'Watch after Fate/Zero — UBW route' },
  { order: 3, spun_id: 'fate-stay-night-heavens-feel-i-xxxxxx',               relation: 'sequel',    note: 'Heaven\'s Feel route — Part 1 of 3' },
  { order: 4, spun_id: 'fate-stay-night-heavens-feel-ii-xxxxxx',              relation: 'sequel',    note: 'Heaven\'s Feel route — Part 2 of 3' },
  { order: 5, spun_id: 'fate-stay-night-heavens-feel-iii-xxxxxx',             relation: 'sequel',    note: 'Heaven\'s Feel route — Part 3 of 3 — Final chapter' },
  { order: 6, spun_id: 'fate-grand-order-first-order-xxxxxx',                 relation: 'side_story', note: 'Separate story in the Fate universe — standalone' },
];
