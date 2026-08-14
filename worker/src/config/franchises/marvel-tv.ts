// worker/src/config/franchises/marvel-tv.ts
// Marvel Disney+ shows in recommended watch order.

import type { FranchiseEntry } from '../types.js';

export const marvelTv: FranchiseEntry[] = [
  { order: 1, spun_id: "wandavision-990192", title: "WandaVision", primary_id: 85271, relation: 'main',     note: 'Start here — Phase 4 TV begins' },
  { order: 2, spun_id: "the-falcon-and-the-winter-soldier-291182", title: "The Falcon and the Winter Soldier", primary_id: 88396, relation: 'main', note: null },
  { order: 3, spun_id: "loki-296329", title: "Loki", primary_id: 84958, relation: 'main',     note: null },
  { order: 4, spun_id: "what-if-113309", title: "What If...?", primary_id: 91363, relation: 'side_story', note: 'Animated anthology — can watch anytime' },
  { order: 5, spun_id: "hawkeye-885388", title: "Hawkeye", primary_id: 88329, relation: 'sequel',   note: null },
  { order: 6, spun_id: "moon-knight-008184", title: "Moon Knight", primary_id: 92749, relation: 'main',     note: 'Mostly standalone' },
  { order: 7, spun_id: "ms-marvel-398722", title: "Ms. Marvel", primary_id: 92782, relation: 'main',     note: null },
  { order: 8, spun_id: "she-hulk-attorney-at-law-882173", title: "She-Hulk: Attorney at Law", primary_id: 92783, relation: 'main',     note: null },
  { order: 9, spun_id: "secret-invasion-359003", title: "Secret Invasion", primary_id: 114472, relation: 'sequel',   note: null },
  { order: 10, spun_id: "echo-017947", title: "Echo", primary_id: 122226, relation: 'spinoff',  note: 'Spinoff of Hawkeye' },
  { order: 11, spun_id: "agatha-all-along-734488", title: "Agatha All Along", primary_id: 138501, relation: 'spinoff',  note: 'Spinoff of WandaVision' },
  { order: 12, spun_id: "daredevil-born-again-240993", title: "Daredevil: Born Again", primary_id: 202555, relation: 'sequel',   note: null },
  { order: 13, spun_id: "ironheart-460682", title: "Ironheart", primary_id: 114471, relation: 'spinoff',  note: null },
];
