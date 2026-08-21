import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { getBySpunId, linkMovieboxId } from '../identity/resolver.js';
import { errorResponse } from '../normalizer.js';
import { createStreamProxyToken, createSubtitleProxyToken } from '../proxy-token.js';
import type { MediaTitleRow } from '../types/index.js';

const stream = new Hono<{ Bindings: Env }>();

function params(row: MediaTitleRow, type: string, extra: Record<string, string | undefined>): URLSearchParams {
  const p = new URLSearchParams({ spun_id: row.spun_id, type, title: row.title });
  for (const [key, value] of Object.entries(extra)) if (value) p.set(key, value);
  if (row.year != null) p.set('year', String(row.year));
  if (row.tmdb_id != null) p.set('tmdb_id', String(row.tmdb_id));
  if (row.anilist_id != null) p.set('anilist_id', String(row.anilist_id));
  if (row.mal_id != null) p.set('mal_id', String(row.mal_id));
  if (row.moviebox_id != null) p.set('moviebox_id', String(row.moviebox_id));
  return p;
}

function shouldProxyStream(url: string, format: string, headers: Record<string, string>): boolean {
  const normalized = format.toLowerCase();
  const isHls = normalized === 'hls' || url.toLowerCase().includes('.m3u8');
  const isHeaderBound = Object.keys(headers).length > 0 && (normalized === 'mp4' || normalized === 'dash');
  return isHls || isHeaderBound;
}

async function proxyStreamUrl(
  origin: string,
  c: any,
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const tokenSecret = c.env.STREAM_PROXY_TOKEN_SECRET || c.env.SUBTITLE_PROXY_TOKEN_SECRET;
  if (!tokenSecret) return url;
  const token = await createStreamProxyToken(tokenSecret, url, headers);
  return `${origin}/v1/proxy/stream?t=${encodeURIComponent(token.token)}`;
}

async function proxySubtitle(
  origin: string,
  c: any,
  subtitle: any,
): Promise<Record<string, unknown> | null> {
  const url = String(subtitle?.url ?? '');
  if (!/^https?:\/\//i.test(url)) return null;
  const tokenSecret = c.env.SUBTITLE_PROXY_TOKEN_SECRET || c.env.STREAM_PROXY_TOKEN_SECRET;
  if (!tokenSecret) return null;
  try {
    const token = await createSubtitleProxyToken(
      tokenSecret,
      url,
      String(subtitle.language_code ?? 'und'),
      { format: 'vtt', disposition: 'inline' },
    );
    return {
      language: subtitle.language ?? 'Unknown',
      language_code: String(subtitle.language_code ?? 'und').toLowerCase(),
      format: 'vtt',
      url: `${origin}/v1/proxy/subtitles?t=${encodeURIComponent(token.token)}`,
      expires_at: token.expiresAt,
    };
  } catch {
    return null;
  }
}

async function handle(c: any, type: string, id: string, extra: Record<string, string | undefined>): Promise<Response> {
  const row = await getBySpunId(c.env, id);
  if (!row) return errorResponse('INVALID_ID', 'Content not found.', 404);
  if (row.content_type !== type) return errorResponse('BAD_REQUEST', 'Content type mismatch.', 400);
  if (!c.env.RENDER_BACKEND_URL) return errorResponse('SERVICE_OFFLINE', 'Stream service is not configured yet.', 503);

  try {
    const r = await fetch(`${c.env.RENDER_BACKEND_URL.replace(/\/$/, '')}/stream?${params(row, type, extra)}`, {
      headers: { 'X-Internals-Key': c.env.INTERNALS_KEY ?? '', Accept: 'application/json' },
      signal: AbortSignal.timeout(28_000),
    });
    const raw: any = await r.json();
    if (!r.ok) return new Response(JSON.stringify(raw), { status: r.status, headers: { 'Content-Type': 'application/json' } });

    const mapped = String(raw?.mapping?.moviebox_id ?? '');
    if (/^\d+$/.test(mapped) && row.moviebox_id == null) {
      await linkMovieboxId(c.env, row.spun_id, mapped).catch(() => {});
    }

    const origin = new URL(c.req.url).origin;
    const subtitleValues = Array.isArray(raw.subtitles) ? raw.subtitles : [];
    const subtitles = (await Promise.all(subtitleValues.map((item: any) => proxySubtitle(origin, c, item)))).filter(Boolean);
    const streams = await Promise.all((Array.isArray(raw.streams) ? raw.streams : []).map(async (item: any) => {
      const url = String(item.url ?? '');
      const format = String(item.format ?? '').toLowerCase();
      const headers = item.headers && typeof item.headers === 'object' ? item.headers : {};
      return {
        quality: item.quality,
        format: item.format,
        audio: item.audio ?? 'Original',
        url: shouldProxyStream(url, format, headers)
          ? await proxyStreamUrl(origin, c, url, headers)
          : url,
      };
    }));

    return new Response(JSON.stringify({
      spun_id: row.spun_id,
      title: row.title,
      type,
      streams,
      subtitles,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return errorResponse('SERVICE_OFFLINE', 'Stream service unavailable.', 503);
  }
}

stream.get('/:type/:spunId/:season/:episode', (c) => handle(c, c.req.param('type'), c.req.param('spunId'), {
  season: c.req.param('season'),
  episode: c.req.param('episode'),
  quality: c.req.query('quality'),
  audio: c.req.query('audio'),
}));

stream.get('/:type/:spunId/:episode', async (c) => {
  if (c.req.param('type') !== 'anime') return errorResponse('BAD_REQUEST', 'Content type mismatch.', 400);
  return handle(c, 'anime', c.req.param('spunId'), {
    season: '1',
    episode: c.req.param('episode'),
    quality: c.req.query('quality'),
    audio: c.req.query('audio'),
  });
});

stream.get('/:type/:spunId', (c) => handle(c, c.req.param('type'), c.req.param('spunId'), {
  season: c.req.query('season'),
  episode: c.req.query('episode'),
  quality: c.req.query('quality'),
  audio: c.req.query('audio'),
}));

stream.get('/:spunId', async (c) => {
  const row = await getBySpunId(c.env, c.req.param('spunId'));
  if (!row) return errorResponse('INVALID_ID', 'Content not found.', 404);
  return handle(c, row.content_type, c.req.param('spunId'), {
    season: c.req.query('season'),
    episode: c.req.query('episode'),
    quality: c.req.query('quality'),
    audio: c.req.query('audio'),
  });
});

export default stream;
