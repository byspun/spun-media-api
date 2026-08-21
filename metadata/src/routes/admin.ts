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
] as const;

function adminKey(env: Env): string {
  return env.ADMIN_KEY || env.X_SPUN_SECRET;
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
