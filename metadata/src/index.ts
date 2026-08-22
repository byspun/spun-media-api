// metadata/src/index.ts
// Spün Media API — Cloudflare Worker entry point.
// All routes live under /v1. Root / and /docs are free for landing pages.

import { Hono }   from 'hono';
import { cors }   from 'hono/cors';
import type { Env } from './types/env.js';
import { errorResponse } from './normalizer.js';
import { metadataLogger } from './logger.js';
import {
  buildAndCacheGeneralHome,
  buildAndCacheMovieHome,
  buildAndCacheTvHome,
  buildAndCacheAnimeHome,
} from './cron/home.js';

import searchRoute    from './routes/search.js';
import infoRoute      from './routes/info.js';
import discoverRoute  from './routes/discover.js';
import homeRoute      from './routes/home.js';
import animeRoute     from './routes/anime.js';
import similarRoute   from './routes/similar.js';
import streamRoute    from './routes/stream.js';
import downloadRoute  from './routes/download.js';
import subtitlesRoute from './routes/subtitles.js';
import proxyRoute     from './routes/proxy.js';
import utilityRoute   from './routes/utility.js';
import franchiseRoute from './routes/franchise.js';
import adminRoute    from './routes/admin.js';
import accountRoute  from './routes/account.js';
import internalAccountRoute from './routes/internal-account.js';
import { authenticatePublic } from './account-auth.js';

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use('*', cors({
  origin:          '*',
  allowMethods:    ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowHeaders:    ['Content-Type', 'Authorization', 'X-User-Key', 'X-Admin-Key'],
  exposeHeaders:   ['X-Cache', 'X-Response-Time'],
  maxAge:          86400,
}));

// ─── Request timing ───────────────────────────────────────────────────────────

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  c.res.headers.set('X-Response-Time', `${duration}ms`);
  metadataLogger(c.env, c.executionCtx).info('request', `${c.req.method} ${c.req.path} status=${c.res.status} duration_ms=${duration}`);
});

// ─── /v1 routes ───────────────────────────────────────────────────────────────

const v1 = new Hono<{ Bindings: Env; Variables: { 'spun.principal': import('../../account/types.js').AuthPrincipal; 'spun.session': import('../../account/types.js').AuthSession } }>();

v1.use('*', authenticatePublic);

v1.route('/search',     searchRoute);
v1.route('/info',       infoRoute);
v1.route('/discover',   discoverRoute);
v1.route('/anime',      animeRoute);
v1.route('/similar',    similarRoute);
v1.route('/stream',     streamRoute);
v1.route('/download',   downloadRoute);
v1.route('/subtitles',  subtitlesRoute);
v1.route('/proxy',      proxyRoute);
v1.route('/utility',    utilityRoute);
  v1.route('/franchise',  franchiseRoute);
  v1.route('/admin',      adminRoute);
  v1.route('/account',    accountRoute);
  v1.route('/internal/accounts', internalAccountRoute);

v1.route('/home',       homeRoute);

// Flat convenience aliases inside /v1
v1.get('/resolve', (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/utility/resolve${qs}`, 307);
});
v1.get('/resolve/:namespace', (c) => {
  const namespace = c.req.param('namespace');
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/utility/resolve/${namespace}${qs}`, 307);
});
v1.get('/health', (c) => c.redirect('/v1/utility/health', 307));

// Trending/popular/new/genres/studios flat aliases inside /v1
v1.get('/trending', (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/discover/trending${qs}`, 307);
});
v1.get('/popular', (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/discover/popular${qs}`, 307);
});
v1.get('/new', (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/discover/new${qs}`, 307);
});
v1.get('/genres', (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/discover/genres${qs}`, 307);
});
v1.get('/studios', (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/discover/studios${qs}`, 307);
});

app.route('/v1', v1);

// ─── Root ─────────────────────────────────────────────────────────────────────

app.get('/', (c) => {
  return c.json({
    name:    'Spün Media API',
    version: '1.0.0',
    api:     '/v1',
    docs:    'https://media.byspun.xyz/docs',
  });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => {
  return errorResponse('ROUTE_NOT_FOUND', `Route ${c.req.path} not found.`, 404);
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError((err, c) => {
  metadataLogger(c.env, c.executionCtx).error('worker', `Unhandled request error: ${err.message}`);
  return errorResponse('INTERNAL_ERROR', 'Unexpected error', 500);
});

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    switch (event.cron) {
      case '0 * * * *':
        ctx.waitUntil(buildAndCacheGeneralHome(env));
        break;
      case '15 * * * *':
        ctx.waitUntil(buildAndCacheMovieHome(env));
        break;
      case '30 * * * *':
        ctx.waitUntil(buildAndCacheTvHome(env));
        break;
      case '45 * * * *':
        ctx.waitUntil(buildAndCacheAnimeHome(env));
        break;
    }
  },
};
