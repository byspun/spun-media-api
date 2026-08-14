// worker/src/config/franchises/dragon-ball.ts
// Dragon Ball — canon series and films in chronological order.

import type { FranchiseEntry } from '../types.js';

export const dragonBall: FranchiseEntry[] = [
  { order: 1, spun_id: "dragon-ball-329083", title: "Dragon Ball", primary_id: 223, relation: 'main',      note: 'Start here — original series' },
  { order: 2, spun_id: "dragon-ball-z-010124", title: "Dragon Ball Z", primary_id: 813, relation: 'sequel',    note: null },
  { order: 3, spun_id: "dragon-ball-super-675803", title: "Dragon Ball Super", primary_id: 21175, relation: 'sequel',    note: 'Follows Z' },
  { order: 4, spun_id: "dragon-ball-super-broly-366137", title: "Dragon Ball Super: Broly", primary_id: 101302, relation: 'sequel',    note: 'Canon film — watch after Super' },
  { order: 5, spun_id: "dragon-ball-super-super-hero-821367", title: "Dragon Ball Super: SUPER HERO", primary_id: 133898, relation: 'sequel',    note: 'Canon film — latest theatrical entry' },
  { order: 6, spun_id: "dragon-ball-daima-147216", title: "Dragon Ball DAIMA", primary_id: 170083, relation: 'sequel',    note: 'New series — watch after Super Hero' },
];
