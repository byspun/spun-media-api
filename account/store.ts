import type {
  AccountRecord,
  ApiKeyCreationResult,
  ApiKeyRecord,
  ApiKeyStatus,
  SqlExecutor,
} from './types.js';
import { generateApiKey, hashApiKey, keyPrefix } from './keys/crypto.js';

interface AccountInput {
  authSubject: string;
  email?: string | null;
  name?: string | null;
  status?: 'active' | 'closed';
}

interface ApiKeyRow extends ApiKeyRecord {
  key_hash: string;
}

function asAccount(row: Record<string, unknown>): AccountRecord {
  return row as unknown as AccountRecord;
}

function asApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return row as unknown as ApiKeyRecord;
}

export async function getAccountById(sql: SqlExecutor, accountId: string): Promise<AccountRecord | null> {
  const rows = await sql`
    SELECT id, auth_subject, email, name, status, created_at, updated_at
    FROM public.accounts
    WHERE id = ${accountId}
    LIMIT 1
  `;
  return rows.length ? asAccount(rows[0] as Record<string, unknown>) : null;
}

export async function getAccountByAuthSubject(sql: SqlExecutor, authSubject: string): Promise<AccountRecord | null> {
  const rows = await sql`
    SELECT id, auth_subject, email, name, status, created_at, updated_at
    FROM public.accounts
    WHERE auth_subject = ${authSubject}
    LIMIT 1
  `;
  return rows.length ? asAccount(rows[0] as Record<string, unknown>) : null;
}

export async function upsertAccount(sql: SqlExecutor, input: AccountInput): Promise<{ account: AccountRecord; created: boolean }> {
  const existing = await getAccountByAuthSubject(sql, input.authSubject);
  const rows = await sql`
    INSERT INTO public.accounts (auth_subject, email, name, status)
    VALUES (${input.authSubject}, ${input.email ?? null}, ${input.name ?? null}, ${input.status ?? 'active'})
    ON CONFLICT (auth_subject) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, public.accounts.email),
      name = COALESCE(EXCLUDED.name, public.accounts.name),
      status = EXCLUDED.status,
      updated_at = now()
    RETURNING id, auth_subject, email, name, status, created_at, updated_at
  `;
  return {
    account: asAccount(rows[0] as Record<string, unknown>),
    created: !existing,
  };
}

export async function findApiKeyByHash(sql: SqlExecutor, hash: string): Promise<ApiKeyRow | null> {
  const rows = await sql`
    SELECT id, account_id, key_prefix, key_hash, label, status, expires_at,
           created_at, updated_at, last_used_at, revoked_at, revocation_reason
    FROM public.api_keys
    WHERE key_hash = ${hash}
    LIMIT 1
  `;
  return rows.length ? rows[0] as ApiKeyRow : null;
}

export async function touchApiKey(sql: SqlExecutor, id: string): Promise<void> {
  await sql`
    UPDATE public.api_keys
    SET last_used_at = now(), updated_at = now()
    WHERE id = ${id}
  `;
}

export async function countActiveKeys(sql: SqlExecutor, accountId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM public.api_keys
    WHERE account_id = ${accountId} AND status = 'active'
  `;
  return Number((rows[0] as { count?: number | string } | undefined)?.count ?? 0);
}

export async function createApiKey(
  sql: SqlExecutor,
  accountId: string,
  label: string,
  expiresAt?: string | null,
): Promise<ApiKeyCreationResult> {
  const key = generateApiKey();
  const hash = await hashApiKey(key);
  const prefix = keyPrefix(key);
  const rows = await sql`
    INSERT INTO public.api_keys (account_id, key_prefix, key_hash, label, status, expires_at)
    VALUES (${accountId}, ${prefix}, ${hash}, ${label}, 'active', ${expiresAt ?? null})
    RETURNING id, account_id, key_prefix, label, status, expires_at,
              created_at, updated_at, last_used_at, revoked_at, revocation_reason
  `;
  return { record: asApiKey(rows[0] as Record<string, unknown>), key };
}

export async function getApiKeyById(sql: SqlExecutor, keyId: string): Promise<ApiKeyRecord | null> {
  const rows = await sql`
    SELECT id, account_id, key_prefix, label, status, expires_at,
           created_at, updated_at, last_used_at, revoked_at, revocation_reason
    FROM public.api_keys
    WHERE id = ${keyId}
    LIMIT 1
  `;
  return rows.length ? asApiKey(rows[0] as Record<string, unknown>) : null;
}

export async function revokeApiKey(sql: SqlExecutor, keyId: string, reason: string): Promise<ApiKeyRecord | null> {
  const rows = await sql`
    UPDATE public.api_keys
    SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()),
        revocation_reason = COALESCE(revocation_reason, ${reason}), updated_at = now()
    WHERE id = ${keyId} AND status = 'active'
    RETURNING id, account_id, key_prefix, label, status, expires_at,
              created_at, updated_at, last_used_at, revoked_at, revocation_reason
  `;
  if (rows.length) return asApiKey(rows[0] as Record<string, unknown>);
  return getApiKeyById(sql, keyId);
}

export interface ListApiKeyOptions {
  accountId?: string;
  status?: ApiKeyStatus;
  page: number;
  limit: number;
}

export async function listApiKeys(sql: SqlExecutor, options: ListApiKeyOptions): Promise<{ keys: ApiKeyRecord[]; total: number }> {
  const offset = (options.page - 1) * options.limit;
  const status = options.status ?? null;
  const accountId = options.accountId ?? null;
  const rows = await sql`
    SELECT id, account_id, key_prefix, label, status, expires_at,
           created_at, updated_at, last_used_at, revoked_at, revocation_reason,
           COUNT(*) OVER()::int AS total_count
    FROM public.api_keys
    WHERE (${status}::text IS NULL OR status = ${status})
      AND (${accountId}::uuid IS NULL OR account_id = ${accountId})
    ORDER BY created_at DESC
    LIMIT ${options.limit} OFFSET ${offset}
  `;
  const total = rows.length ? Number((rows[0] as { total_count?: number | string }).total_count ?? 0) : 0;
  return {
    keys: rows.map((row) => asApiKey(row as Record<string, unknown>)),
    total,
  };
}
