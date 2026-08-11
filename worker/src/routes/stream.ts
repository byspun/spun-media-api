// worker/src/routes/stream.ts
// Stream endpoints — proxied to Render providers backend.
// In Session 1 these are stubs that return a clear 503 explaining the dependency.
// In Session 2 these forward to the Render backend with X-Spun-Secret auth.
//
//   GET /stream/:spunId?season=&episode=&quality=&audio=
//   GET /stream/:spunId/:provider?season=&episode=

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { getBySpunId } from '../identity/resolver.js';
import { jsonResponse, errorResponse } from '../normalizer.js';

const stream = new Hono<{ Bindings: Env }>();

// ─── Forward to Render backend ────────────────────────────────────────────────

async function forwardToRender(
  env:     Env,
  path:    string,
  params:  URLSearchParams
): Promise<Response> {
  if (!env.RENDER_BACKEND_URL) {
    return new Response(
      JSON.stringify({
        error: {
          code:    'PROVIDERS_NOT_READY',
          message: 'Stream providers are not configured yet. Coming in Session 2.',
        },
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
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
    return errorResponse('BACKEND_ERROR', 'Stream backend unavailable.', 503);
  }
}

// ─── GET /stream/:spunId ─────────────────────────────────────────────────────

stream.get('/:spunId', async (c) => {
  const spunId  = c.req.param('spunId');
  const season  = c.req.query('season')  ?? '';
  const episode = c.req.query('episode') ?? '';
  const quality = c.req.query('quality') ?? '';
  const audio   = c.req.query('audio')   ?? '';

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  const params = new URLSearchParams({ spun_id: spunId });
  if (season)  params.set('season',  season);
  if (episode) params.set('episode', episode);
  if (quality) params.set('quality', quality);
  if (audio)   params.set('audio',   audio);

  return forwardToRender(c.env, '/stream', params);
});

// ─── GET /stream/:spunId/:provider ───────────────────────────────────────────

stream.get('/:spunId/:provider', async (c) => {
  const spunId   = c.req.param('spunId');
  const provider = c.req.param('provider');
  const season   = c.req.query('season')  ?? '';
  const episode  = c.req.query('episode') ?? '';

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  const params = new URLSearchParams({ spun_id: spunId, provider });
  if (season)  params.set('season',  season);
  if (episode) params.set('episode', episode);

  return forwardToRender(c.env, `/stream/provider`, params);
});

export default stream;
