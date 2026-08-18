// metadata/src/routes/subtitles.ts
// Subtitle discovery returns only Spün-owned, browser-playable WebVTT proxy URLs.
// Archive retrieval and SRT conversion happen lazily at /v1/proxy/subtitles.

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { getBySpunId } from '../identity/resolver.js';
import { jsonResponse, errorResponse } from '../normalizer.js';
import { resolveSubtitleTracks } from '../subtitles.js';

const subtitles = new Hono<{ Bindings: Env }>();

// GET /v1/subtitles/:spunId?season=&episode=&lang=
subtitles.get('/:spunId', async (c) => {
  const spunId = c.req.param('spunId');
  const season = c.req.query('season') ? parseInt(c.req.query('season')!, 10) : undefined;
  const episode = c.req.query('episode') ? parseInt(c.req.query('episode')!, 10) : undefined;
  const languageFilter = c.req.query('lang');

  if (
    (season !== undefined && (!Number.isInteger(season) || season < 1)) ||
    (episode !== undefined && (!Number.isInteger(episode) || episode < 1))
  ) {
    return errorResponse('BAD_REQUEST', 'Invalid episode reference.', 400);
  }

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);
  if (!c.env.SUBTITLE_PROXY_TOKEN_SECRET || !c.env.SUBDL_API_KEY) {
    return errorResponse('SERVICE_OFFLINE', 'Subtitle delivery is unavailable.', 503);
  }

  try {
    const tracks = await resolveSubtitleTracks(c.env, row, {
      season,
      episode,
      language: languageFilter,
      disposition: 'inline',
    }, new URL(c.req.url).origin);
    return jsonResponse({ spun_id: spunId, subtitles: tracks });
  } catch {
    return errorResponse('SERVICE_OFFLINE', 'Subtitle catalog unavailable.', 502);
  }
});

export default subtitles;
