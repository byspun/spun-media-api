// worker/src/config/franchises/type-moon.ts
// Type-Moon Universe — for users who've seen Fate and want the broader universe.
// Fate entries intentionally overlap with fate-universe.ts.

import type { FranchiseEntry } from '../types.js';

export const typeMoon: FranchiseEntry[] = [
  { order: 1, spun_id: "fatezero-941530", title: "Fate/Zero", primary_id: 10087, relation: 'main',      note: 'Best entry point into the Type-Moon universe' },
  { order: 2, spun_id: "fatestay-night-unlimited-blade-works-264166", title: "Fate/stay night: Unlimited Blade Works", primary_id: 19603, relation: 'sequel',    note: null },
  { order: 3, spun_id: "fatestay-night-heavens-feel-i-presage-flower-705755", title: "Fate/stay night [Heaven's Feel] I. presage flower", primary_id: 20791, relation: 'sequel',    note: 'Heaven\'s Feel — Part 1 of 3' },
  { order: 4, spun_id: "fatestay-night-heavens-feel-ii-lost-butterfly-543844", title: "Fate/stay night [Heaven's Feel] II. lost butterfly", primary_id: 21718, relation: 'sequel',    note: 'Heaven\'s Feel — Part 2 of 3' },
  { order: 5, spun_id: "fatestay-night-heavens-feel-iii-spring-song-615517", title: "Fate/stay night [Heaven’s Feel] III. spring song", primary_id: 21719, relation: 'sequel',    note: 'Heaven\'s Feel — Part 3 of 3' },
  { order: 6, spun_id: "the-garden-of-sinners-chapter-1-thanatos-overlooking-view-152780", title: "the Garden of sinners Chapter 1: Thanatos. (Overlooking View)", primary_id: 2593, relation: 'side_story', note: 'Separate story — same Type-Moon universe, watch after Fate' },
];
