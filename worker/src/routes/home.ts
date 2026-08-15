// worker/src/routes/home.ts
// Homepage endpoints:
//   GET /home          — general (all types mixed)
//   GET /home/movie    — movie-specific
//   GET /home/tv       — TV-specific
//   GET /home/anime    — anime-specific
//
// These routes are now pure KV reads. The heavy lifting is done
// by Cloudflare Cron Triggers in src/cron/home.ts.

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { kvGet, CacheKeys } from '../cache.js';
import { jsonResponse, errorResponse } from '../normalizer.js';

const home = new Hono<{ Bindings: Env }>();

home.get('/movie', async (c) => {
  const cached = await kvGet(c.env, CacheKeys.home('movie'));
  if (!cached) {
    return errorResponse('SERVICE_OFFLINE', 'Homepage is being built. Try again in a moment.', 503);
  }
  return jsonResponse(cached);
});

home.get('/tv', async (c) => {
  const cached = await kvGet(c.env, CacheKeys.home('tv'));
  if (!cached) {
    return errorResponse('SERVICE_OFFLINE', 'Homepage is being built. Try again in a moment.', 503);
  }
  return jsonResponse(cached);
});

home.get('/anime', async (c) => {
  const cached = await kvGet(c.env, CacheKeys.home('anime'));
  if (!cached) {
    return errorResponse('SERVICE_OFFLINE', 'Homepage is being built. Try again in a moment.', 503);
  }
  return jsonResponse(cached);
});

home.get('/', async (c) => {
  const cached = await kvGet(c.env, CacheKeys.home('all'));
  if (!cached) {
    return errorResponse('SERVICE_OFFLINE', 'Homepage is being built. Try again in a moment.', 503);
  }
  return jsonResponse(cached);
});

home.get('/status', async (c) => {
  const types = ['all', 'movie', 'tv', 'anime'];
  const statuses = await Promise.all(
    types.map(async (type) => {
      const status = await kvGet(c.env, CacheKeys.homeBuildStatus(type));
      return { type, status: status || { status: 'never_run', started_at: null, finished_at: null, error: null } };
    })
  );

  return jsonResponse({
    builds: statuses
  });
});

export default home;
