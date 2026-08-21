import type { Context, Next } from 'hono';
import type { Env } from './types/env.js';
import { getDb } from './db.js';
import { errorResponse } from './normalizer.js';
import { secureEqual, hashApiKey } from '../../account/keys/crypto.js';
import { getAccountByAuthSubject, getAccountById, findApiKeyByHash, touchApiKey } from '../../account/store.js';
import { spunAuthAdapter, AuthAdapterNotConfiguredError } from '../../account/auth/spun.js';
import { readAdminKey, readInternalsKey, readUserKey } from '../../account/auth/headers.js';
import type { AuthPrincipal, AuthSession } from '../../account/types.js';

export type AccountHonoEnv = {
  Bindings: Env;
  Variables: {
    'spun.principal': AuthPrincipal;
    'spun.session': AuthSession;
  };
};

function adminKey(env: Env): string | null {
  return env.ADMIN_KEY?.trim() || null;
}

function internalKey(env: Env): string | null {
  return env.INTERNALS_KEY?.trim() || null;
}

function setPrincipal(c: Context<AccountHonoEnv>, principal: AuthPrincipal): void {
  c.set('spun.principal', principal);
}

export function getPrincipal(c: Context<AccountHonoEnv>): AuthPrincipal | undefined {
  return c.get('spun.principal');
}

export function getSession(c: Context<AccountHonoEnv>): AuthSession | undefined {
  return c.get('spun.session');
}

export async function isAdminRequest(c: Context<AccountHonoEnv>): Promise<boolean> {
  const presented = readAdminKey(c.req.raw.headers);
  const configured = adminKey(c.env);
  return Boolean(presented && configured && await secureEqual(presented, configured));
}

export async function requireAdmin(c: Context<AccountHonoEnv>, next: Next): Promise<Response | void> {
  if (!(await isAdminRequest(c))) return errorResponse('INVALID_ADMIN_KEY', 'Administrator authentication required.', 401);
  setPrincipal(c, { kind: 'admin' });
  return next();
}

export async function requireInternal(c: Context<AccountHonoEnv>, next: Next): Promise<Response | void> {
  const presented = readInternalsKey(c.req.raw.headers);
  const configured = internalKey(c.env);
  if (!presented || !configured || !(await secureEqual(presented, configured))) {
    return errorResponse('INVALID_INTERNAL_KEY', 'Internal authentication required.', 401);
  }
  setPrincipal(c, { kind: 'internal' });
  return next();
}

export async function authenticateUserSession(c: Context<AccountHonoEnv>): Promise<AuthSession | null> {
  try {
    return await spunAuthAdapter.verify(c.req.raw, c.env as unknown as Record<string, unknown>);
  } catch (error) {
    if (error instanceof AuthAdapterNotConfiguredError) return null;
    return null;
  }
}

export async function requireUserSession(c: Context<AccountHonoEnv>, next: Next): Promise<Response | void> {
  const session = await authenticateUserSession(c);
  if (!session) return errorResponse('USER_AUTH_REQUIRED', 'A valid Spün Auth session is required.', 401);
  const sql = getDb(c.env);
  const account = await getAccountByAuthSubject(sql, session.subject);
  if (!account) return errorResponse('ACCOUNT_NOT_FOUND', 'Account not found.', 404);
  if (account.status !== 'active') return errorResponse('ACCOUNT_INACTIVE', 'Account is not active.', 403);
  session.accountId = account.id;
  c.set('spun.session', session);
  setPrincipal(c, { kind: 'user', subject: session.subject, accountId: account.id });
  return next();
}

export async function authenticatePublic(c: Context<AccountHonoEnv>, next: Next): Promise<Response | void> {
  const path = c.req.path;
  if (path === '/v1/health' || path === '/v1/utility/health' || path === '/v1/admin' || path.startsWith('/v1/admin/') || path === '/v1/account' || path.startsWith('/v1/account/') || path.startsWith('/v1/internal/')) {
    return next();
  }

  const userKey = readUserKey(c.req.raw.headers);
  const admin = readAdminKey(c.req.raw.headers);
  if (userKey && admin) return errorResponse('MULTIPLE_AUTH_METHODS', 'Multiple authentication methods supplied.', 400);

  if (admin) {
    if (!(await isAdminRequest(c))) return errorResponse('INVALID_ADMIN_KEY', 'Administrator authentication required.', 401);
    setPrincipal(c, { kind: 'admin' });
    return next();
  }

  if (!userKey) return errorResponse('USER_KEY_REQUIRED', 'A user API key is required.', 401);
  const sql = getDb(c.env);
  const hash = await hashApiKey(userKey);
  const record = await findApiKeyByHash(sql, hash);
  if (!record) return errorResponse('INVALID_USER_KEY', 'Invalid user API key.', 401);
  if (record.status === 'revoked') return errorResponse('USER_KEY_REVOKED', 'This user API key has been revoked.', 401);
  if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) return errorResponse('USER_KEY_EXPIRED', 'This user API key has expired.', 401);
  const account = await getAccountById(sql, record.account_id);
  if (!account) return errorResponse('ACCOUNT_NOT_FOUND', 'The account for this API key was not found.', 404);
  if (account.status !== 'active') return errorResponse('ACCOUNT_INACTIVE', 'The account for this API key is not active.', 403);
  setPrincipal(c, { kind: 'user', accountId: record.account_id, keyId: record.id });
  c.executionCtx.waitUntil(touchApiKey(sql, record.id).catch(() => {}));
  return next();
}
