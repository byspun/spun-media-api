// worker/src/config/franchises/shounen-big-three.ts
// Naruto, One Piece, and Bleach — the Shounen Big Three mixed by original release order.
// One row, not three. These franchises coexist as the defining era of Shounen anime.

import type { FranchiseEntry } from '../types.js';

export const shounenBigThree: FranchiseEntry[] = [
  { order: 1, spun_id: "one-piece-470935", title: "ONE PIECE", primary_id: 21, relation: 'main',   note: 'One Piece — the ongoing legend (1999)' },
  { order: 2, spun_id: "naruto-998899", title: "Naruto", primary_id: 20, relation: 'main',   note: 'Naruto — original series (2002)' },
  { order: 3, spun_id: "bleach-389664", title: "Bleach", primary_id: 269, relation: 'main',   note: 'Bleach — original series (2004)' },
  { order: 4, spun_id: "naruto-shippuden-127176", title: "Naruto: Shippuden", primary_id: 1735, relation: 'sequel', note: 'Naruto — Shippuden continuation' },
  { order: 5, spun_id: "bleach-thousand-year-blood-war-443677", title: "BLEACH: Thousand-Year Blood War", primary_id: 116674, relation: 'sequel', note: 'Bleach — final arc adaptation (2022)' },
];
