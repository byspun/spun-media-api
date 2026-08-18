// metadata/src/config/franchises/monogatari.ts
// Monogatari Series — recommended watch order (not release or chronological order).
// This config takes a deliberate position on the watch order debate.

import type { FranchiseEntry } from '../types.js';

export const monogatari: FranchiseEntry[] = [
  { order: 1, spun_id: "bakemonogatari-571921", title: "Bakemonogatari", primary_id: 5081, relation: 'main',      note: 'Start here — recommended watch order, not chronological' },
  { order: 2, spun_id: "nisemonogatari-537237", title: "Nisemonogatari", primary_id: 11597, relation: 'sequel',    note: null },
  { order: 3, spun_id: "nekomonogatari-black-522203", title: "Nekomonogatari Black", primary_id: 15689, relation: 'prequel',   note: 'Chronological prequel — placed here in recommended order' },
  { order: 4, spun_id: "monogatari-series-second-season-912677", title: "Monogatari Series Second Season", primary_id: 17074, relation: 'sequel', note: null },
  { order: 5, spun_id: "hanamonogatari-215253", title: "Hanamonogatari", primary_id: 20593, relation: 'side_story', note: 'Side story — can watch after Second Season' },
  { order: 6, spun_id: "tsukimonogatari-297159", title: "Tsukimonogatari", primary_id: 20918, relation: 'sequel',    note: null },
  { order: 7, spun_id: "owarimonogatari-010799", title: "Owarimonogatari", primary_id: 21262, relation: 'sequel',    note: null },
  { order: 8, spun_id: "koyomimonogatari-463502", title: "Koyomimonogatari", primary_id: 21520, relation: 'side_story', note: 'Watch before Owarimonogatari Season 2' },
  { order: 9, spun_id: "owarimonogatari-second-season-843848", title: "Owarimonogatari Second Season", primary_id: 21745, relation: 'sequel',    note: null },
  { order: 10, spun_id: "zoku-owarimonogatari-928262", title: "Zoku Owarimonogatari", primary_id: 100815, relation: 'sequel',    note: 'Final entry' },
];
