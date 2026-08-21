import type { AccountRecord, SqlExecutor } from '../types.js';
import { createAccount, upsertAccount } from '../store.js';

export interface UserAccountInput {
  authSubject: string;
  email?: string | null;
  name?: string | null;
  status?: 'active' | 'closed';
}

export async function createLocalUser(sql: SqlExecutor, input: UserAccountInput): Promise<AccountRecord> {
  return createAccount(sql, input);
}

export async function syncUserAccount(sql: SqlExecutor, input: UserAccountInput): Promise<{ account: AccountRecord; created: boolean }> {
  return upsertAccount(sql, input);
}
