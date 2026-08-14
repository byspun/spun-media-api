// worker/src/routes/utility.ts
// Utility endpoints:
//   GET /resolve                         — list supported identifier namespaces
//   GET /resolve/:namespace?id=           — resolve and register an identifier
//   GET /health
//   GET /proxy?url=              — HLS/M3U8 proxy (delegated to proxy.ts)

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
import { proxyHls } from '../proxy.js';

const utility = new Hono<{ Bindings: Env }>();

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

    console.error('[Resolve] Registration or metadata error:', error);
    return errorResponse('RESOLVE_REGISTRATION_FAILED', 'Resolution failed.', 500);
  }
});

// ─── GET /health ──────────────────────────────────────────────────────────────

utility.get('/health', async (c) => {
  try {
    const cacheKey = CacheKeys.health();
    const cached   = await kvGet(c.env, cacheKey);
    if (cached) return jsonResponse(cached);

    const baseUrl = c.env.PROXY_BASE_URL.replace(/\/$/, '');

    const [tmdbRes, anilistRes, jikanRes, providerStatus] = await Promise.all([
      fetch('https://api.themoviedb.org/3/configuration', {
        headers: { Authorization: `Bearer ${c.env.TMDB_BEARER_TOKEN}` },
      }).catch(() => null),

      fetch(`${baseUrl}/api/anilist`, {
        method:  'POST',
        headers: {
          'Content-Type':        'application/json',
          'x-spun-proxy-secret': c.env.SPUN_PROXY_SECRET ?? '',
        },
        body: JSON.stringify({ query: '{ Page(page:1,perPage:1) { media(type:ANIME) { id } } }' }),
      }).catch(() => null),

      fetch(`${baseUrl}/api/jikan/anime/1`, {
        headers: { 'x-spun-proxy-secret': c.env.SPUN_PROXY_SECRET ?? '' },
      }).catch(() => null),

      (async (): Promise<string> => {
        try {
          const sql  = getDb(c.env);
          const rows = await sql`
            SELECT status, COUNT(*) as count
            FROM provider_health
            GROUP BY status
          `;
          const counts: Record<string, number> = {};
          for (const row of rows as Array<{ status: string; count: string }>) {
            counts[row.status] = parseInt(row.count);
          }
          if (!counts.healthy && !counts.degraded && !counts.down) return 'ok';
          if (counts.down && counts.down > (counts.healthy ?? 0)) return 'down';
          if (counts.degraded) return 'degraded';
          return 'ok';
        } catch {
          return 'ok';
        }
      })(),
    ]);

    const tmdbOk    = tmdbRes?.ok ?? false;
    const anilistOk = anilistRes?.ok ?? false;
    const jikanOk   = jikanRes?.ok ?? false;

    const allOk = tmdbOk && anilistOk && jikanOk;
    const overallStatus = allOk ? 'ok' : 'degraded';

    const payload = {
      status:   overallStatus,
      services: {
        tmdb:      tmdbOk    ? 'ok' : 'down',
        anilist:   anilistOk ? 'ok' : 'down',
        jikan:     jikanOk   ? 'ok' : 'down',
        providers: providerStatus,
      },
    };

    await kvSet(c.env, cacheKey, payload, TTL.health);
    return jsonResponse(payload);
  } catch (err) {
    console.error('[Health] Error:', err);
    return jsonResponse({
      status: 'degraded',
      services: { tmdb: 'down', anilist: 'down', jikan: 'down', providers: 'ok' },
    });
  }
});

// ─── GET /proxy ───────────────────────────────────────────────────────────────
// HLS stream proxy — rewrites M3U8 manifests and proxies segments.
// All stream URL rewriting happens in proxy.ts.

utility.get('/proxy', async (c) => {
  return proxyHls(c.req.raw, c.env);
});

export default utility;
