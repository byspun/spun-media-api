// worker/src/config/franchises/dragon-ball.ts
// Dragon Ball — canon series and films in chronological order.

import type { FranchiseEntry } from '../types.js';

export const dragonBall: FranchiseEntry[] = [
  { order: 1, spun_id: 'dragon-ball-xxxxxx',                   relation: 'main',      note: 'Start here — original series' },
  { order: 2, spun_id: 'dragon-ball-z-xxxxxx',                 relation: 'sequel',    note: null },
  { order: 3, spun_id: 'dragon-ball-super-xxxxxx',             relation: 'sequel',    note: 'Follows Z' },
  { order: 4, spun_id: 'dragon-ball-super-broly-xxxxxx',       relation: 'sequel',    note: 'Canon film — watch after Super' },
  { order: 5, spun_id: 'dragon-ball-super-super-hero-xxxxxx',  relation: 'sequel',    note: 'Canon film — latest theatrical entry' },
  { order: 6, spun_id: 'dragon-ball-daima-xxxxxx',             relation: 'sequel',    note: 'New series — watch after Super Hero' },
];
