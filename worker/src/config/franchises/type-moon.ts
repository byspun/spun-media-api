// worker/src/config/franchises/type-moon.ts
// Type-Moon Universe — for users who've seen Fate and want the broader universe.
// Fate entries intentionally overlap with fate-universe.ts.

import type { FranchiseEntry } from '../types.js';

export const typeMoon: FranchiseEntry[] = [
  { order: 1, spun_id: 'fate-zero-xxxxxx',                                  relation: 'main',      note: 'Best entry point into the Type-Moon universe' },
  { order: 2, spun_id: 'fate-stay-night-unlimited-blade-works-xxxxxx',      relation: 'sequel',    note: null },
  { order: 3, spun_id: 'fate-stay-night-heavens-feel-i-xxxxxx',             relation: 'sequel',    note: 'Heaven\'s Feel — Part 1 of 3' },
  { order: 4, spun_id: 'fate-stay-night-heavens-feel-ii-xxxxxx',            relation: 'sequel',    note: 'Heaven\'s Feel — Part 2 of 3' },
  { order: 5, spun_id: 'fate-stay-night-heavens-feel-iii-xxxxxx',           relation: 'sequel',    note: 'Heaven\'s Feel — Part 3 of 3' },
  { order: 6, spun_id: 'kara-no-kyoukai-the-garden-of-sinners-xxxxxx',      relation: 'side_story', note: 'Separate story — same Type-Moon universe, watch after Fate' },
];
