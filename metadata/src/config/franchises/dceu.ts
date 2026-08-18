// metadata/src/config/franchises/dceu.ts
// DC Extended Universe — Zack Snyder / WB era, ends with The Flash.

import type { FranchiseEntry } from '../types.js';

export const dceu: FranchiseEntry[] = [
  { order: 1, spun_id: "man-of-steel-795827", title: "Man of Steel", primary_id: 49521, relation: 'main',   note: 'Start here — Snyder era begins' },
  { order: 2, spun_id: "batman-v-superman-dawn-of-justice-018157", title: "Batman v Superman: Dawn of Justice", primary_id: 209112, relation: 'sequel', note: null },
  { order: 3, spun_id: "the-suicide-squad-024329", title: "The Suicide Squad", primary_id: 436969, relation: 'spinoff', note: null },
  { order: 4, spun_id: "wonder-woman-575796", title: "Wonder Woman", primary_id: 297762, relation: 'main',   note: null },
  { order: 5, spun_id: "justice-league-201325", title: "Justice League", primary_id: 141052, relation: 'sequel', note: null },
  { order: 6, spun_id: "aquaman-242021", title: "Aquaman", primary_id: 297802, relation: 'spinoff', note: null },
  { order: 7, spun_id: "shazam-686009", title: "Shazam!", primary_id: 287947, relation: 'spinoff', note: null },
  { order: 8, spun_id: "birds-of-prey-and-the-fantabulous-emancipation-of-one-harley-quinn-994540", title: "Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn)", primary_id: 495764, relation: 'spinoff', note: null },
  { order: 9, spun_id: "wonder-woman-1984-716351", title: "Wonder Woman 1984", primary_id: 464052, relation: 'sequel', note: null },
  { order: 10, spun_id: "zack-snyders-justice-league-195622", title: "Zack Snyder's Justice League", primary_id: 791373, relation: 'sequel', note: "Snyder's director's cut — watch after theatrical if curious" },
  { order: 11, spun_id: "the-suicide-squad-024329", title: "The Suicide Squad", primary_id: 436969, relation: 'sequel', note: 'Soft reboot of Suicide Squad' },
  { order: 12, spun_id: "black-adam-275509", title: "Black Adam", primary_id: 436270, relation: 'spinoff', note: null },
  { order: 13, spun_id: "shazam-fury-of-the-gods-252639", title: "Shazam! Fury of the Gods", primary_id: 594767, relation: 'sequel', note: null },
  { order: 14, spun_id: "aquaman-and-the-lost-kingdom-807685", title: "Aquaman and the Lost Kingdom", primary_id: 572802, relation: 'sequel', note: null },
  { order: 15, spun_id: "the-flash-254134", title: "The Flash", primary_id: 298618, relation: 'spinoff', note: 'Final DCEU film — bridges to the new DCU continuity' },
];
