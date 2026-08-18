// metadata/src/config/franchises/james-bond.ts
// All 25 EON Productions Bond films in release order.
// Notes indicate actor era so users know what they're getting into.

import type { FranchiseEntry } from '../types.js';

export const jamesBond: FranchiseEntry[] = [
  // Connery era
  { order: 1, spun_id: "dr-no-178090", title: "Dr. No", primary_id: 646, relation: 'main',   note: 'Connery era — Start here' },
  { order: 2, spun_id: "from-russia-with-love-793069", title: "From Russia with Love", primary_id: 657, relation: 'sequel', note: 'Connery era' },
  { order: 3, spun_id: "goldfinger-065665", title: "Goldfinger", primary_id: 658, relation: 'sequel', note: 'Connery era' },
  { order: 4, spun_id: "thunderball-046809", title: "Thunderball", primary_id: 660, relation: 'sequel', note: 'Connery era' },
  { order: 5, spun_id: "you-only-live-twice-352145", title: "You Only Live Twice", primary_id: 667, relation: 'sequel', note: 'Connery era' },
  // Lazenby era
  { order: 6, spun_id: "on-her-majestys-secret-service-596658", title: "On Her Majesty's Secret Service", primary_id: 668, relation: 'sequel', note: 'Lazenby era — only film' },
  // Moore era
  { order: 7, spun_id: "live-and-let-die-502853", title: "Live and Let Die", primary_id: 253, relation: 'sequel', note: 'Moore era begins' },
  { order: 8, spun_id: "the-man-with-the-golden-gun-872978", title: "The Man with the Golden Gun", primary_id: 682, relation: 'sequel', note: 'Moore era' },
  { order: 9, spun_id: "the-spy-who-loved-me-777134", title: "The Spy Who Loved Me", primary_id: 691, relation: 'sequel', note: 'Moore era' },
  { order: 10, spun_id: "moonraker-626734", title: "Moonraker", primary_id: 698, relation: 'sequel', note: 'Moore era' },
  { order: 11, spun_id: "for-your-eyes-only-685620", title: "For Your Eyes Only", primary_id: 699, relation: 'sequel', note: 'Moore era' },
  { order: 12, spun_id: "octopussy-106801", title: "Octopussy", primary_id: 700, relation: 'sequel', note: 'Moore era' },
  { order: 13, spun_id: "a-view-to-a-kill-534342", title: "A View to a Kill", primary_id: 707, relation: 'sequel', note: 'Moore era — final Moore film' },
  // Dalton era
  { order: 14, spun_id: "the-living-daylights-336669", title: "The Living Daylights", primary_id: 708, relation: 'sequel', note: 'Dalton era begins' },
  { order: 15, spun_id: "licence-to-kill-573979", title: "Licence to Kill", primary_id: 709, relation: 'sequel', note: 'Dalton era — final Dalton film' },
  // Brosnan era
  { order: 16, spun_id: "goldeneye-422309", title: "GoldenEye", primary_id: 710, relation: 'sequel', note: 'Brosnan era begins' },
  { order: 17, spun_id: "tomorrow-never-dies-285392", title: "Tomorrow Never Dies", primary_id: 714, relation: 'sequel', note: 'Brosnan era' },
  { order: 18, spun_id: "the-world-is-not-enough-476653", title: "The World Is Not Enough", primary_id: 36643, relation: 'sequel', note: 'Brosnan era' },
  { order: 19, spun_id: "die-another-day-356345", title: "Die Another Day", primary_id: 36669, relation: 'sequel', note: 'Brosnan era — final Brosnan film' },
  // Craig era
  { order: 20, spun_id: "casino-royale-760518", title: "Casino Royale", primary_id: 36557, relation: 'sequel', note: 'Craig era — soft reboot, start here for modern Bond' },
  { order: 21, spun_id: "quantum-of-solace-875688", title: "Quantum of Solace", primary_id: 10764, relation: 'sequel', note: 'Craig era' },
  { order: 22, spun_id: "skyfall-603321", title: "Skyfall", primary_id: 37724, relation: 'sequel', note: 'Craig era' },
  { order: 23, spun_id: "spectre-468073", title: "Spectre", primary_id: 206647, relation: 'sequel', note: 'Craig era' },
  { order: 24, spun_id: "no-time-to-die-905243", title: "No Time to Die", primary_id: 370172, relation: 'sequel', note: 'Craig era — series finale for Craig' },
];
