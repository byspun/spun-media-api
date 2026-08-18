// metadata/src/config/franchises/star-wars.ts
// Star Wars Disney+ live-action series in recommended watch order.

import type { FranchiseEntry } from '../types.js';

export const starWars: FranchiseEntry[] = [
  { order: 1, spun_id: "the-mandalorian-567912", title: "The Mandalorian", primary_id: 82856, relation: 'main',      note: 'Start here — sets up the entire Disney+ era' },
  { order: 2, spun_id: "the-book-of-boba-fett-366503", title: "The Book of Boba Fett", primary_id: 115036, relation: 'spinoff',  note: 'Watch Mandalorian S2 first — contains Mando episodes' },
  { order: 3, spun_id: "obi-wan-kenobi-568038", title: "Obi-Wan Kenobi", primary_id: 92830, relation: 'side_story', note: 'Set between Episodes III and IV' },
  { order: 4, spun_id: "andor-653851", title: "Andor", primary_id: 83867, relation: 'prequel',   note: 'Prequel to Rogue One — the most grounded Star Wars story' },
  { order: 5, spun_id: "ahsoka-787678", title: "Ahsoka", primary_id: 114461, relation: 'sequel',    note: 'Sequel to Mandalorian + Rebels — watch those first' },
  { order: 6, spun_id: "star-wars-skeleton-crew-012127", title: "Star Wars: Skeleton Crew", primary_id: 202879, relation: 'side_story', note: 'Set in the Mandalorian era — mostly standalone' },
  { order: 7, spun_id: "the-acolyte-229495", title: "The Acolyte", primary_id: 114479, relation: 'prequel',   note: 'Set 100 years before The Phantom Menace' },
];
