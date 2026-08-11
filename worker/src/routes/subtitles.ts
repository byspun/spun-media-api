// worker/src/routes/subtitles.ts
// Subtitle endpoints:
//   GET /subtitles/:spunId?season=&episode=&lang=
//   GET /subtitle-proxy?url=              — SRT→VTT conversion + CORS proxy
//
// Subtitle source: SubDL API
// SRT files are fetched and converted to VTT on the fly.

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { getBySpunId } from '../identity/resolver.js';
import { srtToVtt } from '../utils/srtToVtt.js';
import { jsonResponse, errorResponse } from '../normalizer.js';

const subtitles = new Hono<{ Bindings: Env }>();

const SUBDL_BASE = 'https://api.subdl.com/api/v1';

// ─── SubDL response types ─────────────────────────────────────────────────────

interface SubDLSubtitle {
  sd_id:       string;
  lang:        string;
  language:    string;
  url:         string;
  full_link:   string;
  season?:     number;
  episode?:    number;
  release_name: string;
}

interface SubDLResponse {
  status:    boolean;
  subtitles: SubDLSubtitle[];
}

// ─── Language code normalizer ─────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  english:    'en',
  spanish:    'es',
  french:     'fr',
  german:     'de',
  portuguese: 'pt',
  arabic:     'ar',
  japanese:   'ja',
  chinese:    'zh',
  korean:     'ko',
  italian:    'it',
  russian:    'ru',
};

function toLangCode(lang: string): string {
  return LANG_MAP[lang.toLowerCase()] ?? lang.toLowerCase().slice(0, 2);
}

// ─── GET /subtitles/:spunId ───────────────────────────────────────────────────

subtitles.get('/:spunId', async (c) => {
  const spunId  = c.req.param('spunId');
  const season  = c.req.query('season')  ? parseInt(c.req.query('season')!)  : undefined;
  const episode = c.req.query('episode') ? parseInt(c.req.query('episode')!) : undefined;
  const langFilter = c.req.query('lang');

  const row = await getBySpunId(c.env, spunId);
  if (!row) return errorResponse('NOT_FOUND', 'Title not found.', 404);

  // Build SubDL query params
  const params = new URLSearchParams({
    api_key:    c.env.SUBDL_API_KEY,
    languages:  langFilter ?? 'EN',
    subs_per_page: '5',
    type:       row.content_type === 'movie' ? 'movie' : 'tv',
  });

  if (row.imdb_id)   params.set('imdb_id', row.imdb_id.replace('tt', ''));
  else if (row.tmdb_id) params.set('tmdb_id', String(row.tmdb_id));

  if (season  !== undefined) params.set('season_number',  String(season));
  if (episode !== undefined) params.set('episode_number', String(episode));

  try {
    const res = await fetch(`${SUBDL_BASE}/subtitles?${params.toString()}`);
    if (!res.ok) return errorResponse('SUBDL_ERROR', 'SubDL API error.', 502);

    const data = await res.json() as SubDLResponse;
    if (!data.status) return jsonResponse({ subtitles: [] });

    const result = (data.subtitles ?? []).map((s) => ({
      url:           `https://dl.subdl.com${s.url}`,
      language:      s.language,
      language_code: toLangCode(s.language),
      format:        'srt' as const,
    }));

    return jsonResponse({ spun_id: spunId, subtitles: result });
  } catch {
    return errorResponse('SUBDL_ERROR', 'Failed to fetch subtitles.', 502);
  }
});

// ─── GET /subtitle-proxy ──────────────────────────────────────────────────────
// Fetches a remote SRT file, converts it to VTT, and returns it.
// Allows frontend to load subtitle tracks cross-origin.

subtitles.get('/proxy', async (c) => {
  const rawUrl = c.req.query('url');
  if (!rawUrl) return errorResponse('MISSING_URL', 'Missing url param.', 400);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return errorResponse('INVALID_URL', 'Invalid subtitle URL.', 400);
  }

  // Allowlist: only proxy from known subtitle hosts
  const ALLOWED_HOSTS = ['dl.subdl.com', 'subdl.com', 'opensubtitles.com'];
  if (!ALLOWED_HOSTS.some((h) => url.hostname.endsWith(h))) {
    return errorResponse('FORBIDDEN_HOST', 'Subtitle host not permitted.', 403);
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return errorResponse('FETCH_ERROR', 'Failed to fetch subtitle file.', 502);

    const raw = await res.text();
    const vtt = raw.trimStart().startsWith('WEBVTT') ? raw : srtToVtt(raw);

    return new Response(vtt, {
      headers: {
        'Content-Type':  'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return errorResponse('FETCH_ERROR', 'Failed to process subtitle.', 502);
  }
});

export default subtitles;
