// worker/src/index.ts
// Spün Media API — Cloudflare Worker entry point.
// All routes live under /v1. Root / and /docs are free for landing pages.

import { Hono }   from 'hono';
import { cors }   from 'hono/cors';
import type { Env } from './types/env.js';
import { errorResponse } from './normalizer.js';

import searchRoute    from './routes/search.js';
import infoRoute      from './routes/info.js';
import discoverRoute  from './routes/discover.js';
import homeRoute      from './routes/home.js';
import animeRoute     from './routes/anime.js';
import similarRoute   from './routes/similar.js';
import streamRoute    from './routes/stream.js';
import downloadRoute  from './routes/download.js';
import subtitlesRoute from './routes/subtitles.js';
import utilityRoute   from './routes/utility.js';

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use('*', cors({
  origin:          '*',
  allowMethods:    ['GET', 'OPTIONS'],
  allowHeaders:    ['Content-Type', 'Authorization', 'X-Spun-Secret'],
  exposeHeaders:   ['X-Cache', 'X-Response-Time'],
  maxAge:          86400,
}));

// ─── Request timing ───────────────────────────────────────────────────────────

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  c.res.headers.set('X-Response-Time', `${Date.now() - start}ms`);
});

// ─── Internal auth — Render → Worker callbacks ────────────────────────────────

app.use('/v1/internal/*', async (c, next) => {
  const secret = c.req.header('X-Spun-Secret');
  if (!secret || secret !== c.env.X_SPUN_SECRET) {
    return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }
  await next();
});

// ─── /v1 routes ───────────────────────────────────────────────────────────────

const v1 = new Hono<{ Bindings: Env }>();

v1.route('/search',     searchRoute);
v1.route('/info',       infoRoute);
v1.route('/discover',   discoverRoute);
v1.route('/home',       homeRoute);
v1.route('/anime',      animeRoute);
v1.route('/similar',    similarRoute);
v1.route('/stream',     streamRoute);
v1.route('/download',   downloadRoute);
v1.route('/subtitles',  subtitlesRoute);
v1.route('/utility',    utilityRoute);

// Flat convenience aliases inside /v1
v1.get('/resolve', (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/utility/resolve${qs}`, 307);
});
v1.get('/health', (c) => c.redirect('/v1/utility/health', 307));
v1.get('/proxy',  (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/utility/proxy${qs}`, 307);
});
v1.get('/subtitle-proxy', (c) => {
  const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/v1/subtitles/proxy${qs}`, 307);
});

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
  console.error('[Worker Error]', err.message, err.stack);
  return errorResponse('INTERNAL_ERROR', 'Unexpected error', 500);
});

export default app;
