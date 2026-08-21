// Curated franchise endpoints.
// Public listing and detail responses are provider-neutral; registration is management-only.

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { errorResponse, jsonResponse } from '../normalizer.js';
import {
  getCuratedFranchise,
  listCuratedFranchises,
} from '../config/franchises/index.js';

const franchise = new Hono<{ Bindings: Env }>();

franchise.get('/', (_c) => {
  const results = listCuratedFranchises().map((item) => ({
    id:    item.id,
    title: item.name,
    type:  item.type,
    total: item.entries.length,
  }));

  return jsonResponse({ total: results.length, results });
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
