// worker/src/config/franchises/dceu.ts
// DC Extended Universe — Zack Snyder / WB era, ends with The Flash.

import type { FranchiseEntry } from '../types.js';

export const dceu: FranchiseEntry[] = [
  { order: 1,  spun_id: 'man-of-steel-xxxxxx',                         relation: 'main',   note: 'Start here — Snyder era begins' },
  { order: 2,  spun_id: 'batman-v-superman-dawn-of-justice-xxxxxx',    relation: 'sequel', note: null },
  { order: 3,  spun_id: 'suicide-squad-xxxxxx',                        relation: 'spinoff', note: null },
  { order: 4,  spun_id: 'wonder-woman-xxxxxx',                         relation: 'main',   note: null },
  { order: 5,  spun_id: 'justice-league-xxxxxx',                       relation: 'sequel', note: null },
  { order: 6,  spun_id: 'aquaman-xxxxxx',                              relation: 'spinoff', note: null },
  { order: 7,  spun_id: 'shazam-xxxxxx',                               relation: 'spinoff', note: null },
  { order: 8,  spun_id: 'birds-of-prey-xxxxxx',                        relation: 'spinoff', note: null },
  { order: 9,  spun_id: 'wonder-woman-1984-xxxxxx',                    relation: 'sequel', note: null },
  { order: 10, spun_id: 'zack-snyders-justice-league-xxxxxx',          relation: 'sequel', note: "Snyder's director's cut — watch after theatrical if curious" },
  { order: 11, spun_id: 'the-suicide-squad-xxxxxx',                    relation: 'sequel', note: 'Soft reboot of Suicide Squad' },
  { order: 12, spun_id: 'black-adam-xxxxxx',                           relation: 'spinoff', note: null },
  { order: 13, spun_id: 'shazam-fury-of-the-gods-xxxxxx',              relation: 'sequel', note: null },
  { order: 14, spun_id: 'aquaman-and-the-lost-kingdom-xxxxxx',         relation: 'sequel', note: null },
  { order: 15, spun_id: 'the-flash-xxxxxx',                            relation: 'spinoff', note: 'Final DCEU film — bridges to the new DCU continuity' },
];
