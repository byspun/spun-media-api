// worker/src/config/franchises/star-wars.ts
// Star Wars Disney+ live-action series in recommended watch order.

import type { FranchiseEntry } from '../types.js';

export const starWars: FranchiseEntry[] = [
  { order: 1, spun_id: 'the-mandalorian-xxxxxx',      relation: 'main',      note: 'Start here — sets up the entire Disney+ era' },
  { order: 2, spun_id: 'the-book-of-boba-fett-xxxxxx', relation: 'spinoff',  note: 'Watch Mandalorian S2 first — contains Mando episodes' },
  { order: 3, spun_id: 'obi-wan-kenobi-xxxxxx',       relation: 'side_story', note: 'Set between Episodes III and IV' },
  { order: 4, spun_id: 'andor-xxxxxx',                relation: 'prequel',   note: 'Prequel to Rogue One — the most grounded Star Wars story' },
  { order: 5, spun_id: 'ahsoka-xxxxxx',               relation: 'sequel',    note: 'Sequel to Mandalorian + Rebels — watch those first' },
  { order: 6, spun_id: 'skeleton-crew-xxxxxx',        relation: 'side_story', note: 'Set in the Mandalorian era — mostly standalone' },
  { order: 7, spun_id: 'the-acolyte-xxxxxx',          relation: 'prequel',   note: 'Set 100 years before The Phantom Menace' },
];
