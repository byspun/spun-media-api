// metadata/src/config/franchises/fate-universe.ts
// Fate Universe — recommended watch order, NOT chronological or release order.
// The notes are the product here — Fate's entry point debate is legendary.

import type { FranchiseEntry } from '../types.js';

export const fateUniverse: FranchiseEntry[] = [
  { order: 1, spun_id: "fatezero-941530", title: "Fate/Zero", primary_id: 10087, relation: 'prequel',   note: 'Start here — chronologically first and the best hook for new viewers' },
  { order: 2, spun_id: "fatestay-night-unlimited-blade-works-264166", title: "Fate/stay night: Unlimited Blade Works", primary_id: 19603, relation: 'sequel',    note: 'Watch after Fate/Zero — UBW route' },
  { order: 3, spun_id: "fatestay-night-heavens-feel-i-presage-flower-705755", title: "Fate/stay night [Heaven's Feel] I. presage flower", primary_id: 20791, relation: 'sequel',    note: 'Heaven\'s Feel route — Part 1 of 3' },
  { order: 4, spun_id: "fatestay-night-heavens-feel-ii-lost-butterfly-543844", title: "Fate/stay night [Heaven's Feel] II. lost butterfly", primary_id: 21718, relation: 'sequel',    note: 'Heaven\'s Feel route — Part 2 of 3' },
  { order: 5, spun_id: "fatestay-night-heavens-feel-iii-spring-song-615517", title: "Fate/stay night [Heaven’s Feel] III. spring song", primary_id: 21719, relation: 'sequel',    note: 'Heaven\'s Feel route — Part 3 of 3 — Final chapter' },
  { order: 6, spun_id: "fategrand-order-first-order-114748", title: "Fate/Grand Order: First Order", primary_id: 97815, relation: 'side_story', note: 'Separate story in the Fate universe — standalone' },
];
