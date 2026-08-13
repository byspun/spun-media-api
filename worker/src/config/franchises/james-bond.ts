// worker/src/config/franchises/james-bond.ts
// All 25 EON Productions Bond films in release order.
// Notes indicate actor era so users know what they're getting into.

import type { FranchiseEntry } from '../types.js';

export const jamesBond: FranchiseEntry[] = [
  // Connery era
  { order: 1,  spun_id: 'dr-no-xxxxxx',                           relation: 'main',   note: 'Connery era — Start here' },
  { order: 2,  spun_id: 'from-russia-with-love-xxxxxx',           relation: 'sequel', note: 'Connery era' },
  { order: 3,  spun_id: 'goldfinger-xxxxxx',                      relation: 'sequel', note: 'Connery era' },
  { order: 4,  spun_id: 'thunderball-xxxxxx',                     relation: 'sequel', note: 'Connery era' },
  { order: 5,  spun_id: 'you-only-live-twice-xxxxxx',             relation: 'sequel', note: 'Connery era' },
  // Lazenby era
  { order: 6,  spun_id: 'on-her-majestys-secret-service-xxxxxx', relation: 'sequel', note: 'Lazenby era — only film' },
  // Moore era
  { order: 7,  spun_id: 'live-and-let-die-xxxxxx',                relation: 'sequel', note: 'Moore era begins' },
  { order: 8,  spun_id: 'the-man-with-the-golden-gun-xxxxxx',     relation: 'sequel', note: 'Moore era' },
  { order: 9,  spun_id: 'the-spy-who-loved-me-xxxxxx',            relation: 'sequel', note: 'Moore era' },
  { order: 10, spun_id: 'moonraker-xxxxxx',                       relation: 'sequel', note: 'Moore era' },
  { order: 11, spun_id: 'for-your-eyes-only-xxxxxx',              relation: 'sequel', note: 'Moore era' },
  { order: 12, spun_id: 'octopussy-xxxxxx',                       relation: 'sequel', note: 'Moore era' },
  { order: 13, spun_id: 'a-view-to-a-kill-xxxxxx',                relation: 'sequel', note: 'Moore era — final Moore film' },
  // Dalton era
  { order: 14, spun_id: 'the-living-daylights-xxxxxx',            relation: 'sequel', note: 'Dalton era begins' },
  { order: 15, spun_id: 'licence-to-kill-xxxxxx',                 relation: 'sequel', note: 'Dalton era — final Dalton film' },
  // Brosnan era
  { order: 16, spun_id: 'goldeneye-xxxxxx',                       relation: 'sequel', note: 'Brosnan era begins' },
  { order: 17, spun_id: 'tomorrow-never-dies-xxxxxx',             relation: 'sequel', note: 'Brosnan era' },
  { order: 18, spun_id: 'the-world-is-not-enough-xxxxxx',         relation: 'sequel', note: 'Brosnan era' },
  { order: 19, spun_id: 'die-another-day-xxxxxx',                 relation: 'sequel', note: 'Brosnan era — final Brosnan film' },
  // Craig era
  { order: 20, spun_id: 'casino-royale-2006-xxxxxx',              relation: 'sequel', note: 'Craig era — soft reboot, start here for modern Bond' },
  { order: 21, spun_id: 'quantum-of-solace-xxxxxx',               relation: 'sequel', note: 'Craig era' },
  { order: 22, spun_id: 'skyfall-xxxxxx',                         relation: 'sequel', note: 'Craig era' },
  { order: 23, spun_id: 'spectre-xxxxxx',                         relation: 'sequel', note: 'Craig era' },
  { order: 24, spun_id: 'no-time-to-die-xxxxxx',                  relation: 'sequel', note: 'Craig era — series finale for Craig' },
];
