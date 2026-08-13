// worker/src/config/franchises/shounen-big-three.ts
// Naruto, One Piece, and Bleach — the Shounen Big Three mixed by original release order.
// One row, not three. These franchises coexist as the defining era of Shounen anime.

import type { FranchiseEntry } from '../types.js';

export const shounenBigThree: FranchiseEntry[] = [
  { order: 1, spun_id: 'one-piece-xxxxxx',                            relation: 'main',   note: 'One Piece — the ongoing legend (1999)' },
  { order: 2, spun_id: 'naruto-xxxxxx',                               relation: 'main',   note: 'Naruto — original series (2002)' },
  { order: 3, spun_id: 'bleach-xxxxxx',                               relation: 'main',   note: 'Bleach — original series (2004)' },
  { order: 4, spun_id: 'naruto-shippuden-xxxxxx',                     relation: 'sequel', note: 'Naruto — Shippuden continuation' },
  { order: 5, spun_id: 'bleach-thousand-year-blood-war-xxxxxx',       relation: 'sequel', note: 'Bleach — final arc adaptation (2022)' },
];
