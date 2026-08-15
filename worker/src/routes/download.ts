// worker/src/routes/download.ts
// Download endpoints — proxied to Render providers backend.
// Stubs in Session 1, wired in Session 2.
//
//   GET /download/:spunId?season=&episode=&quality=
//   GET /download/:spunId/:provider?season=&episode=

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { getBySpunId } from '../identity/resolver.js';
import { errorResponse } from '../normalizer.js';

const download = new Hono<{ Bindings: Env }>();

async function forwardToRender(
  env:    Env,
  path:   string,
  params: URLSearchParams
): Promise<Response> {
  if (!env.RENDER_BACKEND_URL) {
    return errorResponse('SERVICE_OFFLINE', 'Download service is not configured yet.', 503);
  }

  const url = `${env.RENDER_BACKEND_URL}${path}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        'X-Spun-Secret': env.X_SPUN_SECRET,
        'Content-Type':  'application/json',
      },
    });
    const body = await res.text();
    return new Response(body, {
      status:  res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return errorResponse('BACKEND_ERROR', 'Download backend unavailable.', 503);
  }
}

download.get('/:spunId', async (c) => {
  const spunId  = c.req.param('spunId');
  const season  = c.req.query('season')  ?? '';
  const episode = c.req.query('episode') ?? '';
  const quality = c.req.query('quality') ?? '';

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  const params = new URLSearchParams({ spun_id: spunId });
  if (season)  params.set('season',  season);
  if (episode) params.set('episode', episode);
  if (quality) params.set('quality', quality);

  return forwardToRender(c.env, '/download', params);
});

download.get('/:spunId/:provider', async (c) => {
  const spunId   = c.req.param('spunId');
  const provider = c.req.param('provider');
  const season   = c.req.query('season')  ?? '';
  const episode  = c.req.query('episode') ?? '';

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  const params = new URLSearchParams({ spun_id: spunId, provider });
  if (season)  params.set('season',  season);
  if (episode) params.set('episode', episode);

  return forwardToRender(c.env, '/download/provider', params);
});

export default download;
