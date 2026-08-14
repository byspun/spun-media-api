// Curated franchise endpoints.
// Public listing and detail responses are provider-neutral; registration is management-only.

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { errorResponse, jsonResponse } from '../normalizer.js';
import {
  getCuratedFranchise,
  listCuratedFranchises,
} from '../config/franchises/index.js';
import { registerCuratedFranchises } from '../franchise-registration.js';
import { bumpCacheVersion } from '../cache.js';

const franchise = new Hono<{ Bindings: Env }>();

function isAuthorized(secret: string | undefined, env: Env): boolean {
  return Boolean(secret && secret === env.X_SPUN_SECRET);
}

franchise.get('/', (_c) => {
  const results = listCuratedFranchises().map((item) => ({
    id:    item.id,
    title: item.name,
    type:  item.type,
    total: item.entries.length,
  }));

  return jsonResponse({ total: results.length, results });
});

franchise.post('/register', async (c) => {
  if (!isAuthorized(c.req.header('X-Spun-Secret'), c.env)) {
    return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const reference = c.req.query('id') || c.req.query('franchise') || undefined;
  const registration = await registerCuratedFranchises(c.env, reference);
  if (!registration) {
    return errorResponse('NOT_FOUND', 'Franchise not found.', 404);
  }

  const cache_version = await bumpCacheVersion(c.env);
  return jsonResponse({
    success: true,
    ...registration,
    cache_version,
  });
});

franchise.get('/:reference', (c) => {
  const item = getCuratedFranchise(c.req.param('reference'));
  if (!item) return errorResponse('NOT_FOUND', 'Franchise not found.', 404);

  return jsonResponse({
    id:    item.id,
    title: item.name,
    type:  item.type,
    total: item.entries.length,
    entries: item.entries.map((entry) => ({
      position: entry.order,
      spun_id:  entry.spun_id,
      title:    entry.title,
      relation: entry.relation,
      note:     entry.note,
    })),
  });
});

export default franchise;
