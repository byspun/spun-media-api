// worker/src/index.ts
// Spün Media API — Cloudflare Worker entry point.
// Built with Hono. All routes mounted here.
//
// Route map:
//   /search/*         → search.ts
//   /info/*           → info.ts
//   /discover/*       → discover.ts
//   /trending         → discover.ts
//   /popular          → discover.ts
//   /new              → discover.ts
//   /genres           → discover.ts
//   /studios          → discover.ts
//   /studio/*         → discover.ts
//   /home/*           → home.ts
//   /anime/*          → anime.ts
//   /stream/*         → stream.ts
//   /download/*       → download.ts
//   /subtitles/*      → subtitles.ts
//   /resolve          → utility.ts
//   /health           → utility.ts
//   /proxy            → utility.ts (HLS proxy)

import { Hono }   from 'hono';
import { cors }   from 'hono/cors';
import type { Env } from './types/env.js';

import searchRoute    from './routes/search.js';
import infoRoute      from './routes/info.js';
import discoverRoute  from './routes/discover.js';
import homeRoute      from './routes/home.js';
import animeRoute     from './routes/anime.js';
import streamRoute    from './routes/stream.js';
import downloadRoute  from './routes/download.js';
import subtitlesRoute from './routes/subtitles.js';
import utilityRoute   from './routes/utility.js';

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow all origins — Torii and any future Spün products need unrestricted access.
// Stream/proxy routes add their own CORS headers directly.

app.use('*', cors({
  origin:         '*',
  allowMethods:   ['GET', 'OPTIONS'],
  allowHeaders:   ['Content-Type', 'Authorization', 'X-Spun-Secret'],
  exposeHeaders:  ['X-Cache', 'X-Response-Time'],
  maxAge:         86400,
}));

// ─── Request timing ───────────────────────────────────────────────────────────

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  c.res.headers.set('X-Response-Time', `${Date.now() - start}ms`);
});

// ─── Internal auth middleware — for Render → Worker callbacks ─────────────────
// Routes prefixed with /internal/ require X-Spun-Secret header.
// Not used in Session 1 — reserved for Session 2.

app.use('/internal/*', async (c, next) => {
  const secret = c.req.header('X-Spun-Secret');
  if (!secret || secret !== c.env.X_SPUN_SECRET) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid secret.' } }, 401);
  }
  await next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Search
app.route('/search', searchRoute);

// Info
app.route('/info', infoRoute);

// Discover — all mounted under /discover
// e.g. /discover/movie, /discover/trending, /discover/genres, /discover/studio/:id
app.route('/discover', discoverRoute);

// Flat aliases — /trending → /discover/trending etc.
// These redirect so the spec's short-form URLs also work.
app.get('/trending', (c) => c.redirect(`/discover/trending${c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : ''}`, 307));
app.get('/popular',  (c) => c.redirect(`/discover/popular${c.req.url.includes('?')  ? '?' + c.req.url.split('?')[1] : ''}`, 307));
app.get('/new',      (c) => c.redirect(`/discover/new${c.req.url.includes('?')      ? '?' + c.req.url.split('?')[1] : ''}`, 307));
app.get('/genres',   (c) => c.redirect(`/discover/genres${c.req.url.includes('?')   ? '?' + c.req.url.split('?')[1] : ''}`, 307));
app.get('/studios',  (c) => c.redirect(`/discover/studios${c.req.url.includes('?')  ? '?' + c.req.url.split('?')[1] : ''}`, 307));

// Home
app.route('/home', homeRoute);

// Anime-specific
app.route('/anime', animeRoute);

// Stream (stub → Render in Session 2)
app.route('/stream', streamRoute);

// Download (stub → Render in Session 2)
app.route('/download', downloadRoute);

// Subtitles
app.route('/subtitles', subtitlesRoute);
// /subtitle-proxy?url= → handled by /subtitles/proxy handler
app.get('/subtitle-proxy', (c) => {
  const url = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/subtitles/proxy${url}`, 307);
});

// Utility routes — mounted at /utility so internal paths resolve correctly,
// then exposed at their canonical flat URLs via the same router.
app.route('/utility', utilityRoute);

// Canonical flat URLs the spec exposes:
app.get('/resolve', (c) => {
  const url = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/utility/resolve${url}`, 307);
});
app.get('/health', (c) => c.redirect('/utility/health', 307));
app.get('/proxy',  (c) => {
  const url = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
  return c.redirect(`/utility/proxy${url}`, 307);
});

// ─── Root ─────────────────────────────────────────────────────────────────────

app.get('/', (c) => {
  return c.json({
    name:    'Spün Media API',
    version: '1.0.0',
    status:  'ok',
    docs:    'https://media.byspun.xyz',
  });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json(
    { error: { code: 'NOT_FOUND', message: `Route ${c.req.path} not found.` } },
    404
  );
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error('[Worker Error]', err.message, err.stack);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
    500
  );
});

export default app;
