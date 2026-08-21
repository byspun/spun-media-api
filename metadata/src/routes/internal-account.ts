import { Hono } from 'hono';
import type { AccountHonoEnv } from '../account-auth.js';
import { requireInternal } from '../account-auth.js';
import { getDb } from '../db.js';
import { errorResponse, jsonResponse } from '../normalizer.js';
import { syncUserAccount } from '../../../account/users/service.js';

const internalAccount = new Hono<AccountHonoEnv>();

internalAccount.use('*', requireInternal);

internalAccount.put('/:authSubject', async (c) => {
  const authSubject = c.req.param('authSubject').trim();
  if (!authSubject) return errorResponse('AUTH_SUBJECT_REQUIRED', 'Authentication subject is required.', 400);

  let body: { email?: unknown; name?: unknown; status?: unknown };
  try {
    const value = await c.req.json();
    if (!value || typeof value !== 'object') return errorResponse('BAD_REQUEST', 'A JSON object is required.', 400);
    body = value as { email?: unknown; name?: unknown; status?: unknown };
  } catch {
    return errorResponse('BAD_REQUEST', 'A valid JSON body is required.', 400);
  }

  if (body.email !== undefined && body.email !== null && typeof body.email !== 'string') return errorResponse('ACCOUNT_EMAIL_INVALID', 'Account email is invalid.', 400);
  if (body.name !== undefined && body.name !== null && typeof body.name !== 'string') return errorResponse('BAD_REQUEST', 'Account name is invalid.', 400);
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'closed') return errorResponse('BAD_REQUEST', 'Account status is invalid.', 400);

  try {
    const result = await syncUserAccount(getDb(c.env), {
      authSubject,
      email: typeof body.email === 'string' ? body.email.trim() || null : null,
      name: typeof body.name === 'string' ? body.name.trim() || null : null,
      status: body.status === 'closed' ? 'closed' : 'active',
    });
    return jsonResponse({ success: true, action: result.created ? 'created' : 'updated', account: result.account }, result.created ? 201 : 200);
  } catch {
    return errorResponse('ACCOUNT_SYNC_FAILED', 'Account synchronization failed.', 500);
  }
});

export default internalAccount;
