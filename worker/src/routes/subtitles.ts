// worker/src/routes/subtitles.ts
// Subtitle discovery returns only Spün-owned, browser-playable WebVTT proxy URLs.
// Archive retrieval and SRT conversion happen lazily at /v1/proxy/subtitles.

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { getBySpunId } from '../identity/resolver.js';
import { createSubtitleProxyToken } from '../proxy-token.js';
import { jsonResponse, errorResponse } from '../normalizer.js';

const subtitles = new Hono<{ Bindings: Env }>();

const SUBTITLE_CATALOG_BASE = 'https://api.subdl.com/api/v1';

interface SubtitleCatalogItem {
  lang: string;
  language: string;
  url: string;
  full_link?: string;
  season?: number;
  episode?: number;
}

interface SubtitleCatalogResponse {
  status: boolean;
  subtitles: SubtitleCatalogItem[];
}

const LANG_MAP: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  portuguese: 'pt',
  arabic: 'ar',
  japanese: 'ja',
  chinese: 'zh',
  korean: 'ko',
  italian: 'it',
  russian: 'ru',
};

function toLangCode(language: string): string {
  return LANG_MAP[language.toLowerCase()] ?? language.toLowerCase().slice(0, 2);
}

function toArchiveUrl(item: SubtitleCatalogItem): string | null {
  const candidate = item.full_link || item.url;
  if (!candidate) return null;

  try {
    if (candidate.startsWith('https://')) return new URL(candidate).toString();
    return new URL(candidate, 'https://dl.subdl.com').toString();
  } catch {
    return null;
  }
}

// Legacy raw-url proxy deliberately retired. Raw archive URLs must never be
// accepted from a consumer because they can expose a source location or secret.
subtitles.get('/proxy', async () =>
  errorResponse('BAD_REQUEST', 'Use the subtitle track URL returned by the subtitles endpoint.', 400),
);

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
  if (!c.env.SUBTITLE_PROXY_TOKEN_SECRET) {
    return errorResponse('SERVICE_OFFLINE', 'Subtitle delivery is unavailable.', 503);
  }

  const params = new URLSearchParams({
    api_key: c.env.SUBDL_API_KEY,
    languages: languageFilter ?? 'EN',
    subs_per_page: '5',
    type: row.content_type === 'movie' ? 'movie' : 'tv',
  });

  if (row.imdb_id) params.set('imdb_id', row.imdb_id.replace('tt', ''));
  else if (row.tmdb_id) params.set('tmdb_id', String(row.tmdb_id));

  if (season !== undefined) params.set('season_number', String(season));
  if (episode !== undefined) params.set('episode_number', String(episode));

  try {
    const response = await fetch(`${SUBTITLE_CATALOG_BASE}/subtitles?${params.toString()}`);
    if (!response.ok) return errorResponse('SERVICE_OFFLINE', 'Subtitle catalog unavailable.', 502);

    const data = await response.json() as SubtitleCatalogResponse;
    if (!data.status || !Array.isArray(data.subtitles)) {
      return jsonResponse({ spun_id: spunId, subtitles: [] });
    }

    const origin = new URL(c.req.url).origin;
    const tracks = await Promise.all(
      data.subtitles
        .slice(0, 5)
        .map(async (item) => {
          const archiveUrl = toArchiveUrl(item);
          if (!archiveUrl) return null;

          const language = item.language || item.lang || 'Unknown';
          const languageCode = toLangCode(language);
          const { token, expiresAt } = await createSubtitleProxyToken(
            c.env.SUBTITLE_PROXY_TOKEN_SECRET,
            archiveUrl,
            languageCode,
          );

          return {
            language,
            language_code: languageCode,
            label: language,
            format: 'vtt' as const,
            url: `${origin}/v1/proxy/subtitles?t=${encodeURIComponent(token)}`,
            expires_at: expiresAt,
          };
        }),
    );

    return jsonResponse({
      spun_id: spunId,
      subtitles: tracks.filter((track): track is NonNullable<typeof track> => track !== null),
    });
  } catch {
    return errorResponse('SERVICE_OFFLINE', 'Subtitle catalog unavailable.', 502);
  }
});

export default subtitles;
