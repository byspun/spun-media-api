import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { getBySpunId, linkMovieboxId } from '../identity/resolver.js';
import { errorResponse } from '../normalizer.js';
import type { MediaTitleRow } from '../types/index.js';

const download = new Hono<{ Bindings: Env }>();

type DownloadParams = {
  season?: string;
  episode?: string;
  quality?: string;
};

function addRowParams(params: URLSearchParams, row: MediaTitleRow, type: string, extra: DownloadParams): void {
  params.set('spun_id', row.spun_id);
  params.set('type', type);
  params.set('title', row.title);
  if (row.year != null) params.set('year', String(row.year));
  if (row.tmdb_id != null) params.set('tmdb_id', String(row.tmdb_id));
  if (row.anilist_id != null) params.set('anilist_id', String(row.anilist_id));
  if (row.mal_id != null) params.set('mal_id', String(row.mal_id));
  if (row.moviebox_id != null) params.set('moviebox_id', String(row.moviebox_id));
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
}

async function forwardToRender(env: Env, path: string, row: MediaTitleRow, type: string, extra: DownloadParams): Promise<Response> {
  if (!env.RENDER_BACKEND_URL) return errorResponse('SERVICE_OFFLINE', 'Download service is not configured yet.', 503);
  const params = new URLSearchParams();
  addRowParams(params, row, type, extra);
  const url = `${env.RENDER_BACKEND_URL.replace(/\/$/, '')}${path}?${params.toString()}`;
  try {
    const response = await fetch(url, {
      headers: { 'X-Spun-Secret': env.X_SPUN_SECRET, Accept: 'application/json' },
      signal: AbortSignal.timeout(28_000),
    });
    const text = await response.text();
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { code: 'INTERNAL_ERROR', error: 'Unexpected error', description: 'The provider response was not valid JSON.', action: 'Please try again later.' }; }

    const mappedId = Number(body?.mapping?.moviebox_id);
    if (response.ok && Number.isSafeInteger(mappedId) && mappedId > 0 && row.moviebox_id == null) {
      await linkMovieboxId(env, row.spun_id, mappedId).catch(() => {});
    }
    if (response.ok && Array.isArray(body?.downloads)) {
      body.downloads = body.downloads.map((download: any) => {
        const { provider: _provider, ...publicDownload } = download ?? {};
        return publicDownload;
      });
    }
    if (body && typeof body === 'object' && 'mapping' in body) delete body.mapping;
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return errorResponse('SERVICE_OFFLINE', 'Download service unavailable.', 503);
  }
}

async function handle(c: any, type: string, spunId: string, extra: DownloadParams): Promise<Response> {
  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('INVALID_ID', 'Content not found.', 404);
  if (row.content_type !== type) return errorResponse('BAD_REQUEST', 'Content type mismatch.', 400);
  return forwardToRender(c.env, '/download', row, type, extra);
}

download.get('/:type/:spunId/:season/:episode', async (c) => handle(c, c.req.param('type'), c.req.param('spunId'), {
  season: c.req.param('season'), episode: c.req.param('episode'), quality: c.req.query('quality'),
}));

download.get('/:type/:spunId', async (c) => handle(c, c.req.param('type'), c.req.param('spunId'), {
  season: c.req.query('season'), episode: c.req.query('episode'), quality: c.req.query('quality'),
}));

download.get('/:spunId', async (c) => {
  const row = await getBySpunId(c.env, c.req.param('spunId'));
  if (!row) return errorResponse('INVALID_ID', 'Content not found.', 404);
  return forwardToRender(c.env, '/download', row, row.content_type, {
    season: c.req.query('season'), episode: c.req.query('episode'), quality: c.req.query('quality'),
  });
});


export default download;
