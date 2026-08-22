import { Hono } from 'hono';
import type { AccountHonoEnv } from '../account-auth.js';
import { authenticateUserSession, getSession, requireUserSession } from '../account-auth.js';
import { getDb } from '../db.js';
import { errorResponse, jsonResponse } from '../normalizer.js';
import {
  createApiKey,
  getApiKeyById,
  getAccountByAuthSubject,
  getAccountById,
  listApiKeys,
  revokeApiKey,
  upsertAccount,
  countActiveKeys,
} from '../../../account/store.js';
import { defaultApiKeyExpiry, policyFromEnv } from '../../../account/policy.js';

const account = new Hono<AccountHonoEnv>();

type BodyValue = { label?: unknown; expires_at?: unknown; reason?: unknown };

function pagination(c: { req: { query(name: string): string | undefined } }): { page: number; limit: number } | Response {
  const page = Number(c.req.query('page') ?? '1');
  const limit = Number(c.req.query('limit') ?? '25');
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return errorResponse('INVALID_PAGINATION', 'Invalid pagination.', 400);
  }
  return { page, limit };
}

function parseExpiry(value: string | undefined): string | null | Response {
  if (value === undefined || value === '') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return errorResponse('INVALID_KEY_EXPIRY', 'Invalid key expiry.', 400);
  return new Date(timestamp).toISOString();
}

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<BodyValue | Response> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object') return errorResponse('BAD_REQUEST', 'A JSON object is required.', 400);
    return body as BodyValue;
  } catch {
    return errorResponse('BAD_REQUEST', 'A valid JSON body is required.', 400);
  }
}

account.get('/me', async (c) => {
  const session = await authenticateUserSession(c);
  if (!session) return errorResponse('USER_AUTH_REQUIRED', 'A valid Spün Auth session is required.', 401);
  const sql = getDb(c.env);
  const existing = await getAccountByAuthSubject(sql, session.subject);
  const result = existing
    ? { account: existing, created: false }
    : { account: (await upsertAccount(sql, { authSubject: session.subject, email: session.email ?? null, name: session.name ?? null, status: 'active' })).account, created: true };
  return jsonResponse({ account: result.account, provisioned: result.created });
});

account.use('/keys/*', requireUserSession);

account.get('/keys/list', async (c) => {
  const session = getSession(c);
  if (!session?.accountId) return errorResponse('USER_AUTH_REQUIRED', 'A valid Spün Auth session is required.', 401);
  const pageValue = pagination(c);
  if (pageValue instanceof Response) return pageValue;
  const status = c.req.query('status');
  if (status && status !== 'active' && status !== 'revoked') return errorResponse('INVALID_STATUS_FILTER', 'Invalid key status filter.', 400);
  const result = await listApiKeys(getDb(c.env), { accountId: session.accountId, status: status as 'active' | 'revoked' | undefined, ...pageValue });
  return jsonResponse({ keys: result.keys, pagination: { ...pageValue, total: result.total, total_pages: result.total ? Math.ceil(result.total / pageValue.limit) : 0, has_next: pageValue.page * pageValue.limit < result.total, has_previous: pageValue.page > 1 && result.total > 0 } });
});

account.post('/keys/gen', async (c) => {
  const session = getSession(c);
  if (!session?.accountId) return errorResponse('USER_AUTH_REQUIRED', 'A valid Spün Auth session is required.', 401);
  const bodyValue = await jsonBody(c);
  if (bodyValue instanceof Response) return bodyValue;
  if (typeof bodyValue.label !== 'string' || !bodyValue.label.trim() || bodyValue.label.trim().length > 100) return errorResponse('INVALID_KEY_LABEL', 'A valid key label is required.', 400);
  if (bodyValue.expires_at !== undefined && bodyValue.expires_at !== null && typeof bodyValue.expires_at !== 'string') return errorResponse('INVALID_KEY_EXPIRY', 'Invalid key expiry.', 400);
  const requestedExpiry = typeof bodyValue.expires_at === 'string' ? parseExpiry(bodyValue.expires_at) : null;
  if (requestedExpiry instanceof Response) return requestedExpiry;
  const sql = getDb(c.env);
  const accountRecord = await getAccountById(sql, session.accountId);
  if (!accountRecord) return errorResponse('ACCOUNT_NOT_FOUND', 'Account not found.', 404);
  const policy = policyFromEnv(c.env as unknown as Record<string, unknown>);
  const expiryValue = requestedExpiry ?? defaultApiKeyExpiry(policy);
  if (policy.plansEnabled) {
    const activeKeys = await countActiveKeys(sql, session.accountId);
    const limitRows = await sql`SELECT p.api_key_limit FROM public.subscriptions s JOIN public.plans p ON p.id = s.plan_id WHERE s.account_id = ${session.accountId} AND s.status IN ('trialing', 'active') AND now() < s.current_period_end ORDER BY s.current_period_end DESC LIMIT 1`;
    const planLimit = Number((limitRows[0] as { api_key_limit?: number | null } | undefined)?.api_key_limit ?? 0);
    if (planLimit > 0 && activeKeys >= planLimit) return errorResponse('API_KEY_LIMIT_REACHED', 'API key limit reached.', 409);
  }
  const created = await createApiKey(sql, session.accountId, bodyValue.label.trim(), expiryValue);
  return jsonResponse({ success: true, message: 'API key generated successfully. Copy it now; it will not be shown again.', api_key: { ...created.record, key: created.key } }, 201);
});

account.get('/keys/:id', async (c) => {
  const session = getSession(c);
  if (!session?.accountId) return errorResponse('USER_AUTH_REQUIRED', 'A valid Spün Auth session is required.', 401);
  const record = await getApiKeyById(getDb(c.env), c.req.param('id'));
  if (!record || record.account_id !== session.accountId) return errorResponse('API_KEY_NOT_FOUND', 'API key not found.', 404);
  return jsonResponse({ key: record });
});

account.post('/keys/:id/revoke', async (c) => {
  const session = getSession(c);
  if (!session?.accountId) return errorResponse('USER_AUTH_REQUIRED', 'A valid Spün Auth session is required.', 401);
  const record = await getApiKeyById(getDb(c.env), c.req.param('id'));
  if (!record || record.account_id !== session.accountId) return errorResponse('API_KEY_NOT_FOUND', 'API key not found.', 404);
  if (record.status === 'revoked') return errorResponse('KEY_ALREADY_REVOKED', 'API key is already revoked.', 409);
  const bodyValue = await jsonBody(c);
  if (bodyValue instanceof Response) return bodyValue;
  if (typeof bodyValue.reason !== 'string' || !bodyValue.reason.trim() || bodyValue.reason.trim().length > 500) return errorResponse('INVALID_REVOCATION_REASON', 'A valid revocation reason is required.', 400);
  const revoked = await revokeApiKey(getDb(c.env), record.id, bodyValue.reason.trim());
  if (!revoked || revoked.status !== 'revoked') return errorResponse('INTERNAL_ERROR', 'API key revocation failed.', 500);
  return jsonResponse({ success: true, message: 'API key revoked successfully.', key: revoked });
});

export default account;
