import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { errorResponse, jsonResponse } from '../normalizer.js';
import { bumpCacheVersion } from '../cache.js';
import {
  buildAndCacheAnimeHome,
  buildAndCacheGeneralHome,
  buildAndCacheMovieHome,
  buildAndCacheTvHome,
} from '../cron/home.js';
import { backfillTitleSummaries } from '../cron/summary-backfill.js';
import { registerCuratedFranchises } from '../franchise-registration.js';
import { listLogArchives, readLogArchive, replaceLogArchive } from '../log-archive.js';
import { metadataLogger } from '../logger.js';
import { getDb } from '../db.js';
import { createApiKey, getAccountById, getApiKeyById, listApiKeys, revokeApiKey } from '../../../account/store.js';
import { createLocalUser } from '../../../account/users/service.js';

const admin = new Hono<{ Bindings: Env }>();

const ADMIN_ENDPOINTS = [
  { method: 'GET', path: '/v1/admin', description: 'List administrator endpoints', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/home/build', description: 'Build a homepage snapshot', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/home/backfill', description: 'Backfill metadata summaries', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/home/warm-cache', description: 'Warm homepage cache', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/cache/clear', description: 'Clear the API cache', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/franchise/register', description: 'Register curated franchises', authentication: 'X-Admin-Key' },
  { method: 'GET', path: '/v1/admin/diagnostics/:provider/:type', description: 'Run an allowlisted provider diagnostic', authentication: 'X-Admin-Key' },
  { method: 'GET', path: '/v1/admin/logs', description: 'List archived daily logs', authentication: 'X-Admin-Key' },
  { method: 'GET', path: '/v1/admin/logs/:service/:date', description: 'Read an archived daily log', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/logs/upload', description: 'Store supplied log content', authentication: 'X-Log-Upload-Key or X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/logs/flush', description: 'Flush and archive a running service log', authentication: 'X-Admin-Key' },
  { method: 'GET', path: '/v1/admin/keys/list', description: 'List masked API keys with filters and pagination', authentication: 'X-Admin-Key' },
  { method: 'GET', path: '/v1/admin/accounts/:account_id/keys/list', description: 'List keys for an account', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/accounts/create', description: 'Create a local account record manually', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/accounts/:account_id/keys/gen', description: 'Generate an API key for an account', authentication: 'X-Admin-Key' },
  { method: 'GET', path: '/v1/admin/keys/:key_id', description: 'Read masked API-key metadata', authentication: 'X-Admin-Key' },
  { method: 'POST', path: '/v1/admin/keys/:key_id/revoke', description: 'Permanently revoke an API key', authentication: 'X-Admin-Key' },
] as const;

function adminKey(env: Env): string {
  return env.ADMIN_KEY || '';
}

function authorized(c: { req: { header(name: string): string | undefined }; env: Env }): boolean {
  return Boolean(adminKey(c.env) && c.req.header('X-Admin-Key') === adminKey(c.env));
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function validService(value: string): value is 'metadata' | 'providers' {
  return value === 'metadata' || value === 'providers';
}

admin.use('*', async (c, next) => {
  const uploadRoute = c.req.path.endsWith('/logs/upload');
  const uploadKey = c.req.header('X-Log-Upload-Key');
  const uploadAuthorized = uploadRoute && Boolean(uploadKey && uploadKey === (c.env.LOG_UPLOAD_KEY || adminKey(c.env)));
  if (!authorized(c) && !uploadAuthorized) return errorResponse('UNAUTHORIZED', 'Administrator authentication required.', 401);
  await next();
});

admin.get('/', (_c) => jsonResponse({
  name: 'Spün Media API Administration',
  version: '1.0.0',
  endpoints: ADMIN_ENDPOINTS,
}));

admin.post('/home/build', async (c) => {
  const type = c.req.query('type') || 'all';
  const wait = c.req.query('wait') === 'true';
  const logger = metadataLogger(c.env, c.executionCtx);
  const buildPromise = (async () => {
    switch (type) {
      case 'movie': return buildAndCacheMovieHome(c.env);
      case 'tv': return buildAndCacheTvHome(c.env);
      case 'anime': return buildAndCacheAnimeHome(c.env);
      case 'all': return buildAndCacheGeneralHome(c.env);
      default: throw new Error(`Unsupported homepage type: ${type}`);
    }
  })();

  logger.info('home', `Homepage build requested for type=${type}`);
  if (wait) {
    try {
      await buildPromise;
      logger.info('home', `Homepage build completed for type=${type}`);
      return jsonResponse({ success: true, message: `Homepage build completed for type: ${type}.`, type });
    } catch (error) {
      logger.error('home', `Homepage build failed for type=${type}`, error);
      return errorResponse('INTERNAL_ERROR', 'Homepage build failed.', 500);
    }
  }
  c.executionCtx.waitUntil(buildPromise.catch((error) => logger.error('home', `Background homepage build failed for type=${type}`, error)));
  return jsonResponse({ success: true, message: `Homepage build triggered for type: ${type}. It will run in the background.`, status_url: '/v1/home/status', type });
});

admin.post('/home/backfill', async (c) => {
  const requested = Number(c.req.query('limit') ?? '5');
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 100) : 5;
  const result = await backfillTitleSummaries(c.env, limit);
  metadataLogger(c.env, c.executionCtx).info('home', `Summary backfill completed limit=${limit}`);
  return jsonResponse({ success: true, ...result });
});

admin.post('/home/warm-cache', async (c) => {
  const type = c.req.query('type') || 'all';
  const logger = metadataLogger(c.env, c.executionCtx);
  const task = type === 'movie'
    ? buildAndCacheMovieHome(c.env)
    : type === 'tv'
      ? buildAndCacheTvHome(c.env)
      : type === 'anime'
        ? buildAndCacheAnimeHome(c.env)
        : buildAndCacheGeneralHome(c.env);
  c.executionCtx.waitUntil(task.catch((error) => logger.error('home', `Cache warming failed for type=${type}`, error)));
  logger.info('home', `Cache warming requested for type=${type}`);
  return jsonResponse({ success: true, message: `Cache warming triggered for type: ${type}.`, type });
});

admin.post('/cache/clear', async (c) => {
  const version = await bumpCacheVersion(c.env);
  metadataLogger(c.env, c.executionCtx).info('cache', `Cache cleared version=${version}`);
  return jsonResponse({ success: true, message: 'Cache cleared successfully.', version });
});

admin.post('/franchise/register', async (c) => {
  const reference = c.req.query('id') || c.req.query('franchise') || undefined;
  const registration = await registerCuratedFranchises(c.env, reference);
  if (!registration) return errorResponse('NOT_FOUND', 'Franchise not found.', 404);

  let cacheVersion: string | null = null;
  try {
    cacheVersion = await bumpCacheVersion(c.env);
  } catch (error) {
    metadataLogger(c.env, c.executionCtx).warn('franchise', 'Cache invalidation deferred after registration', error);
  }
  return jsonResponse({
    success: true,
    ...registration,
    cache_invalidation: cacheVersion ? 'completed' : 'deferred',
    cache_version: cacheVersion,
  });
});

admin.get('/diagnostics/:provider/:type', async (c) => {
  const provider = c.req.param('provider');
  const type = c.req.param('type');
  const title = c.req.query('title')?.trim();
  if (!title) return errorResponse('MISSING_QUERY', 'A title is required.', 400);
  if (!c.env.RENDER_BACKEND_URL) return errorResponse('SERVICE_OFFLINE', 'Provider diagnostics are unavailable.', 503);

  const url = new URL(`/admin/diagnostics/${encodeURIComponent(provider)}/${encodeURIComponent(type)}`, c.env.RENDER_BACKEND_URL);
  url.search = new URLSearchParams(c.req.query()).toString();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Admin-Key': adminKey(c.env),
    },
  });
  const body = await response.text();
  metadataLogger(c.env, c.executionCtx).info('diagnostics', `Diagnostic completed provider=${provider} type=${type} status=${response.status}`);
  return new Response(body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
  });
});

admin.get('/logs', async (c) => {
  const filters = {
    service: c.req.query('service'),
    from: c.req.query('from'),
    to: c.req.query('to'),
  };
  if (filters.service && !validService(filters.service)) return errorResponse('BAD_REQUEST', 'Invalid log service.', 400);
  if ((filters.from && !validDate(filters.from)) || (filters.to && !validDate(filters.to))) return errorResponse('BAD_REQUEST', 'Dates must use YYYY-MM-DD.', 400);
  const logs = await listLogArchives(c.env, filters);
  return jsonResponse({ total: logs.length, logs });
});

admin.get('/logs/:service/:date', async (c) => {
  const service = c.req.param('service');
  const date = c.req.param('date');
  if (!validService(service) || !validDate(date)) return errorResponse('BAD_REQUEST', 'Invalid log service or date.', 400);
  const content = await readLogArchive(c.env, service, date, {
    level: c.req.query('level'),
    namespace: c.req.query('namespace'),
  });
  if (content === null) return errorResponse('NOT_FOUND', 'Log archive not found.', 404);
  return new Response(content || `No logs for ${date}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
});

admin.post('/logs/upload', async (c) => {
  const uploadKey = c.req.header('X-Log-Upload-Key');
  if (!authorized(c) && uploadKey !== (c.env.LOG_UPLOAD_KEY || adminKey(c.env))) {
    return errorResponse('UNAUTHORIZED', 'Log upload authentication required.', 401);
  }
  let body: { service?: string; date?: string; content?: string };
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('BAD_REQUEST', 'A JSON upload body is required.', 400);
  }
  if (!body.service || !validService(body.service) || !body.date || !validDate(body.date) || typeof body.content !== 'string') {
    return errorResponse('BAD_REQUEST', 'service, date, and content are required.', 400);
  }
  await replaceLogArchive(c.env, body.service, body.date, body.content);
  return jsonResponse({ success: true, service: body.service, date: body.date, path: `${body.service}/${body.date.slice(0, 4)}/${body.date.slice(5, 7)}/${body.date}.log` });
});

function pagination(c: { req: { query(name: string): string | undefined } }): { page: number; limit: number } | Response {
  const page = Number(c.req.query('page') ?? '1');
  const limit = Number(c.req.query('limit') ?? '25');
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse('INVALID_PAGINATION', 'Invalid pagination.', 400);
  return { page, limit };
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | Response> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse('BAD_REQUEST', 'A JSON object is required.', 400);
    return body as Record<string, unknown>;
  } catch {
    return errorResponse('BAD_REQUEST', 'A valid JSON body is required.', 400);
  }
}

function isoFuture(value: unknown): string | null | Response {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return errorResponse('INVALID_KEY_EXPIRY', 'Invalid key expiry.', 400);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return errorResponse('INVALID_KEY_EXPIRY', 'Invalid key expiry.', 400);
  return new Date(timestamp).toISOString();
}

admin.get('/keys/list', async (c) => {
  const pageValue = pagination(c);
  if (pageValue instanceof Response) return pageValue;
  const status = c.req.query('status');
  const accountId = c.req.query('account_id');
  if (status && status !== 'active' && status !== 'revoked') return errorResponse('INVALID_STATUS_FILTER', 'Invalid key status filter.', 400);
  const result = await listApiKeys(getDb(c.env), { page: pageValue.page, limit: pageValue.limit, status: status as 'active' | 'revoked' | undefined, accountId });
  return jsonResponse({ keys: result.keys, pagination: { ...pageValue, total: result.total, total_pages: result.total ? Math.ceil(result.total / pageValue.limit) : 0, has_next: pageValue.page * pageValue.limit < result.total, has_previous: pageValue.page > 1 && result.total > 0 } });
});

admin.post('/accounts/create', async (c) => {
  const bodyValue = await readJson(c);
  if (bodyValue instanceof Response) return bodyValue;
  const authSubject = typeof bodyValue.auth_subject === 'string' ? bodyValue.auth_subject.trim() : '';
  if (!authSubject) return errorResponse('AUTH_SUBJECT_REQUIRED', 'Authentication subject is required.', 400);
  const email = bodyValue.email === undefined || bodyValue.email === null ? null : typeof bodyValue.email === 'string' ? bodyValue.email.trim() || null : null;
  if (bodyValue.email !== undefined && bodyValue.email !== null && typeof bodyValue.email !== 'string') return errorResponse('ACCOUNT_EMAIL_INVALID', 'Account email is invalid.', 400);
  if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return errorResponse('ACCOUNT_EMAIL_INVALID', 'Account email is invalid.', 400);
  const name = bodyValue.name === undefined || bodyValue.name === null ? null : typeof bodyValue.name === 'string' ? bodyValue.name.trim() || null : null;
  if (bodyValue.name !== undefined && bodyValue.name !== null && typeof bodyValue.name !== 'string') return errorResponse('BAD_REQUEST', 'Account name is invalid.', 400);
  const status = bodyValue.status === undefined ? 'active' : bodyValue.status;
  if (status !== 'active' && status !== 'closed') return errorResponse('BAD_REQUEST', 'Account status is invalid.', 400);
  try {
    const account = await createLocalUser(getDb(c.env), { authSubject, email, name, status });
    return jsonResponse({ success: true, action: 'created', account }, 201);
  } catch {
    return errorResponse('ACCOUNT_CONFLICT', 'An account with this authentication subject already exists.', 409);
  }
});

admin.get('/accounts/:accountId/keys/list', async (c) => {
  const accountId = c.req.param('accountId');
  const account = await getAccountById(getDb(c.env), accountId);
  if (!account) return errorResponse('ACCOUNT_NOT_FOUND', 'Account not found.', 404);
  const pageValue = pagination(c);
  if (pageValue instanceof Response) return pageValue;
  const status = c.req.query('status');
  if (status && status !== 'active' && status !== 'revoked') return errorResponse('INVALID_STATUS_FILTER', 'Invalid key status filter.', 400);
  const result = await listApiKeys(getDb(c.env), { page: pageValue.page, limit: pageValue.limit, status: status as 'active' | 'revoked' | undefined, accountId });
  return jsonResponse({ account_id: accountId, keys: result.keys, pagination: { ...pageValue, total: result.total, total_pages: result.total ? Math.ceil(result.total / pageValue.limit) : 0, has_next: pageValue.page * pageValue.limit < result.total, has_previous: pageValue.page > 1 && result.total > 0 } });
});

admin.post('/accounts/:accountId/keys/gen', async (c) => {
  const accountId = c.req.param('accountId');
  const account = await getAccountById(getDb(c.env), accountId);
  if (!account) return errorResponse('ACCOUNT_NOT_FOUND', 'Account not found.', 404);
  if (account.status !== 'active') return errorResponse('ACCOUNT_INACTIVE', 'Account is not active.', 403);
  const bodyValue = await readJson(c);
  if (bodyValue instanceof Response) return bodyValue;
  if (typeof bodyValue.label !== 'string' || !bodyValue.label.trim() || bodyValue.label.trim().length > 100) return errorResponse('INVALID_KEY_LABEL', 'A valid key label is required.', 400);
  const expiry = isoFuture(bodyValue.expires_at);
  if (expiry instanceof Response) return expiry;
  try {
    const created = await createApiKey(getDb(c.env), accountId, bodyValue.label.trim(), expiry);
    return jsonResponse({ success: true, message: 'API key generated successfully. Copy it now; it will not be shown again.', api_key: { ...created.record, key: created.key } }, 201);
  } catch {
    return errorResponse('INTERNAL_ERROR', 'API key generation failed.', 500);
  }
});

admin.get('/keys/:keyId', async (c) => {
  const record = await getApiKeyById(getDb(c.env), c.req.param('keyId'));
  if (!record) return errorResponse('API_KEY_NOT_FOUND', 'API key not found.', 404);
  return jsonResponse({ key: record });
});

admin.post('/keys/:keyId/revoke', async (c) => {
  const keyId = c.req.param('keyId');
  const existing = await getApiKeyById(getDb(c.env), keyId);
  if (!existing) return errorResponse('API_KEY_NOT_FOUND', 'API key not found.', 404);
  if (existing.status === 'revoked') return errorResponse('KEY_ALREADY_REVOKED', 'API key is already revoked.', 409);
  const bodyValue = await readJson(c);
  if (bodyValue instanceof Response) return bodyValue;
  if (typeof bodyValue.reason !== 'string' || !bodyValue.reason.trim() || bodyValue.reason.trim().length > 500) return errorResponse('INVALID_REVOCATION_REASON', 'A valid revocation reason is required.', 400);
  const revoked = await revokeApiKey(getDb(c.env), keyId, bodyValue.reason.trim());
  if (!revoked || revoked.status !== 'revoked') return errorResponse('INTERNAL_ERROR', 'API key revocation failed.', 500);
  return jsonResponse({ success: true, message: 'API key revoked successfully.', key: revoked });
});

admin.post('/logs/flush', async (c) => {
  const service = c.req.query('service') || 'providers';
  if (!validService(service)) return errorResponse('BAD_REQUEST', 'Invalid log service.', 400);
  if (service === 'providers' && c.env.RENDER_BACKEND_URL) {
    const response = await fetch(new URL('/admin/logs/flush', c.env.RENDER_BACKEND_URL), {
      method: 'POST',
      headers: { 'X-Admin-Key': adminKey(c.env), Accept: 'application/json' },
    });
    const body = await response.text();
    return new Response(body, { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' } });
  }
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  const content = await readLogArchive(c.env, service, date);
  return jsonResponse({ success: true, service, date, archived: content !== null, message: 'The current metadata log is persisted continuously.' });
});

export default admin;
