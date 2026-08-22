// metadata/src/routes/utility.ts
// Utility endpoints:
//   GET /resolve                         — list supported identifier namespaces
//   GET /resolve/:namespace?id=           — resolve and register an identifier
//   GET /health

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import {
  RESOLVE_NAMESPACES,
  ResolveFailure,
  resolveIdentifier,
} from '../resolve.js';
import { getDb } from '../db.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import { jsonResponse, errorResponse } from '../normalizer.js';
import { metadataLogger } from '../logger.js';

const utility = new Hono<{ Bindings: Env }>();

async function healthFetch(input: string | URL, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(5_000) });
  } catch {
    return null;
  }
}

// ─── Resolve namespace listing and lazy resolution ─────────────────────────────

utility.get('/resolve', (_c) => {
  return jsonResponse({ supported: RESOLVE_NAMESPACES });
});

utility.get('/resolve/:namespace', async (c) => {
  const namespace = c.req.param('namespace');
  const id = c.req.query('id') ?? '';
  const requestedType = c.req.query('type');

  try {
    const item = await resolveIdentifier(c.env, namespace, id, requestedType);
    return jsonResponse(item);
  } catch (error) {
    if (error instanceof ResolveFailure) {
      return errorResponse(error.code, error.message, error.status);
    }

    metadataLogger(c.env).error('resolve', 'Registration or metadata error', error);
    return errorResponse('RESOLVE_REGISTRATION_FAILED', 'Resolution failed.', 500);
  }
});

// ─── GET /health ──────────────────────────────────────────────────────────────

utility.get('/health', async (c) => {
  try {
    const cacheKey = CacheKeys.health();
    const cached   = await kvGet(c.env, cacheKey);
    if (cached) return jsonResponse(cached);

    const baseUrl = c.env.PROXY_BASE_URL?.replace(/\/$/, '');

    const [tmdbRes, anilistRes, jikanRes, kitsuRes, movieboxRes, renderRes, providerStatus] = await Promise.all([
      healthFetch('https://api.themoviedb.org/3/configuration', {
        headers: { Authorization: `Bearer ${c.env.TMDB_BEARER_TOKEN}` },
      }),

      baseUrl
        ? healthFetch(`${baseUrl}/api/anilist`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-spun-proxy-secret': c.env.SPUN_PROXY_SECRET ?? '',
            },
            body: JSON.stringify({ query: '{ Page(page:1,perPage:1) { media(type:ANIME) { id } } }' }),
          })
        : Promise.resolve(null),

      baseUrl
        ? healthFetch(`${baseUrl}/api/jikan/anime/1`, {
            headers: { 'x-spun-proxy-secret': c.env.SPUN_PROXY_SECRET ?? '' },
          })
        : Promise.resolve(null),

      healthFetch('https://kitsu.io/api/edge/anime/1', {
        headers: { Accept: 'application/vnd.api+json' },
      }),

      c.env.MOVIEBOX_API_BASE
        ? healthFetch(`${c.env.MOVIEBOX_API_BASE.replace(/\/$/, '')}/health`, {
            headers: { 'X-Worker-Secret': c.env.MOVIEBOX_API_SECRET ?? '' },
          })
        : Promise.resolve(null),

      c.env.RENDER_BACKEND_URL
        ? healthFetch(`${c.env.RENDER_BACKEND_URL.replace(/\/$/, '')}/health`, {
            headers: { 'X-Internals-Key': c.env.INTERNALS_KEY ?? '' },
          })
        : Promise.resolve(null),

      (async (): Promise<'healthy' | 'degraded' | 'down' | 'unknown'> => {
        try {
          const sql  = getDb(c.env);
          const rows = await sql`
            SELECT status, COUNT(*) as count
            FROM provider_health
            WHERE checked_at >= now() - interval '15 minutes'
            GROUP BY status
          `;
          const counts: Record<string, number> = {};
          for (const row of rows as Array<{ status: string; count: string }>) {
            counts[row.status] = parseInt(row.count, 10);
          }
          if (!Object.keys(counts).length) return 'unknown';
          if (counts.down && counts.down > (counts.healthy ?? 0) + (counts.degraded ?? 0)) return 'down';
          if (counts.degraded || counts.down) return 'degraded';
          return 'healthy';
        } catch {
          return 'unknown';
        }
      })(),
    ]);

    const tmdbStatus = c.env.TMDB_BEARER_TOKEN ? (tmdbRes?.ok ? 'ok' : 'down') : 'not_configured';
    const anilistStatus = baseUrl ? (anilistRes?.ok ? 'ok' : 'down') : 'not_configured';
    const jikanStatus = baseUrl ? (jikanRes?.ok ? 'ok' : 'down') : 'not_configured';
    const kitsuStatus = kitsuRes?.ok ? 'ok' : 'down';
    const movieboxStatus = c.env.MOVIEBOX_API_BASE ? (movieboxRes?.ok ? 'ok' : 'down') : 'not_configured';
    const renderStatus = c.env.RENDER_BACKEND_URL ? (renderRes?.ok ? 'ok' : 'down') : 'not_configured';
    const providersStatus = renderStatus === 'not_configured'
      ? 'not_configured'
      : renderStatus === 'down'
        ? 'down'
        : providerStatus;

    const statuses = [tmdbStatus, anilistStatus, jikanStatus, kitsuStatus, movieboxStatus, providersStatus];
    const overallStatus = statuses.every((status) => status === 'ok')
      ? 'ok'
      : statuses.some((status) => status === 'down')
        ? 'degraded'
        : 'unknown';

    const payload = {
      status:   overallStatus,
      services: {
        tmdb: tmdbStatus,
        anilist: anilistStatus,
        jikan: jikanStatus,
        kitsu: kitsuStatus,
        moviebox: movieboxStatus,
        providers: providersStatus,
      },
    };

    await kvSet(c.env, cacheKey, payload, TTL.health);
    return jsonResponse(payload);
  } catch (err) {
    metadataLogger(c.env).error('health', 'Health aggregation failed', err);
    return jsonResponse({
      status: 'unknown',
      services: { tmdb: 'unknown', anilist: 'unknown', jikan: 'unknown', kitsu: 'unknown', moviebox: 'unknown', providers: 'unknown' },
    });
  }
});


export default utility;
