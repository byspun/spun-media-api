// worker/src/config/types.ts
// Shared types for all franchise and hero config files.

export type FranchiseRelation =
  | 'main'
  | 'sequel'
  | 'prequel'
  | 'spinoff'
  | 'side_story';

export interface FranchiseEntry {
  order:    number;
  spun_id:  string;
  relation: FranchiseRelation | null;
  note:     string | null;
}
