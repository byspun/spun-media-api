// worker/src/config/franchises/monogatari.ts
// Monogatari Series — recommended watch order (not release or chronological order).
// This config takes a deliberate position on the watch order debate.

import type { FranchiseEntry } from '../types.js';

export const monogatari: FranchiseEntry[] = [
  { order: 1,  spun_id: 'bakemonogatari-xxxxxx',            relation: 'main',      note: 'Start here — recommended watch order, not chronological' },
  { order: 2,  spun_id: 'nisemonogatari-xxxxxx',            relation: 'sequel',    note: null },
  { order: 3,  spun_id: 'nekomonogatari-black-xxxxxx',      relation: 'prequel',   note: 'Chronological prequel — placed here in recommended order' },
  { order: 4,  spun_id: 'monogatari-series-second-season-xxxxxx', relation: 'sequel', note: null },
  { order: 5,  spun_id: 'hanamonogatari-xxxxxx',            relation: 'side_story', note: 'Side story — can watch after Second Season' },
  { order: 6,  spun_id: 'tsukimonogatari-xxxxxx',           relation: 'sequel',    note: null },
  { order: 7,  spun_id: 'owarimonogatari-xxxxxx',           relation: 'sequel',    note: null },
  { order: 8,  spun_id: 'koyomimonogatari-xxxxxx',          relation: 'side_story', note: 'Watch before Owarimonogatari Season 2' },
  { order: 9,  spun_id: 'owarimonogatari-season-2-xxxxxx',  relation: 'sequel',    note: null },
  { order: 10, spun_id: 'zoku-owarimonogatari-xxxxxx',      relation: 'sequel',    note: 'Final entry' },
];
