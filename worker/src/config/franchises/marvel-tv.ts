// worker/src/config/franchises/marvel-tv.ts
// Marvel Disney+ shows in recommended watch order.

import type { FranchiseEntry } from '../types.js';

export const marvelTv: FranchiseEntry[] = [
  { order: 1,  spun_id: 'wandavision-xxxxxx',              relation: 'main',     note: 'Start here — Phase 4 TV begins' },
  { order: 2,  spun_id: 'the-falcon-and-the-winter-soldier-xxxxxx', relation: 'main', note: null },
  { order: 3,  spun_id: 'loki-xxxxxx',                     relation: 'main',     note: null },
  { order: 4,  spun_id: 'what-if-xxxxxx',                  relation: 'side_story', note: 'Animated anthology — can watch anytime' },
  { order: 5,  spun_id: 'hawkeye-xxxxxx',                  relation: 'sequel',   note: null },
  { order: 6,  spun_id: 'moon-knight-xxxxxx',              relation: 'main',     note: 'Mostly standalone' },
  { order: 7,  spun_id: 'ms-marvel-xxxxxx',                relation: 'main',     note: null },
  { order: 8,  spun_id: 'she-hulk-attorney-at-law-xxxxxx', relation: 'main',     note: null },
  { order: 9,  spun_id: 'secret-invasion-xxxxxx',          relation: 'sequel',   note: null },
  { order: 10, spun_id: 'echo-xxxxxx',                     relation: 'spinoff',  note: 'Spinoff of Hawkeye' },
  { order: 11, spun_id: 'agatha-all-along-xxxxxx',         relation: 'spinoff',  note: 'Spinoff of WandaVision' },
  { order: 12, spun_id: 'daredevil-born-again-xxxxxx',     relation: 'sequel',   note: null },
  { order: 13, spun_id: 'ironheart-xxxxxx',                relation: 'spinoff',  note: null },
];
