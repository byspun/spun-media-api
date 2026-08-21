import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { getBySpunId, linkMovieboxId } from '../identity/resolver.js';
import { errorResponse } from '../normalizer.js';
import { resolveSubtitleTracks } from '../subtitles.js';
import type { MediaTitleRow } from '../types/index.js';

const download = new Hono<{ Bindings: Env }>();

type DownloadRequestOptions = {
  season?: string;
  episode?: string;
  quality?: string;
  language?: string;
};

function qs(row: MediaTitleRow, type: string, extra: DownloadRequestOptions): URLSearchParams {
  const params = new URLSearchParams({ spun_id: row.spun_id, type, title: row.title });
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  if (row.year != null) params.set('year', String(row.year));
  if (row.tmdb_id != null) params.set('tmdb_id', String(row.tmdb_id));
  if (row.anilist_id != null) params.set('anilist_id', String(row.anilist_id));
  if (row.mal_id != null) params.set('mal_id', String(row.mal_id));
  if (row.moviebox_id != null) params.set('moviebox_id', String(row.moviebox_id));
  return params;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function mapDownloadItem(item: any) {
  return {
    quality: item.quality,
    format: item.format,
    audio: item.audio ?? 'Original',
    url: item.url,
    filename: item.filename ?? null,
    size: item.size ?? null,
  };
}

async function downloadableSubtitles(
  c: any,
  row: MediaTitleRow,
  options: DownloadRequestOptions,
): Promise<unknown[]> {
  const season = positiveInteger(options.season);
  const episode = positiveInteger(options.episode);
  try {
    return await resolveSubtitleTracks(c.env, row, {
      season,
      episode,
      language: options.language,
      disposition: 'attachment',
    }, new URL(c.req.url).origin);
  } catch {
    // Download links remain usable if the subtitle catalogue is temporarily unavailable.
    return [];
  }
}

async function handle(
  c: any,
  type: string,
  id: string,
  options: DownloadRequestOptions,
): Promise<Response> {
  const row = await getBySpunId(c.env, id);
  if (!row) return errorResponse('INVALID_ID', 'Content not found.', 404);
  if (row.content_type !== type) return errorResponse('BAD_REQUEST', 'Content type mismatch.', 400);
  if (!c.env.RENDER_BACKEND_URL) return errorResponse('SERVICE_OFFLINE', 'Download service is not configured yet.', 503);

  try {
    const response = await fetch(`${c.env.RENDER_BACKEND_URL.replace(/\/$/, '')}/download?${qs(row, type, options)}`, {
      headers: { 'X-Internals-Key': c.env.INTERNALS_KEY ?? '', Accept: 'application/json' },
      signal: AbortSignal.timeout(28_000),
    });
    const raw: any = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify(raw), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const mappedMovieboxId = String(raw?.mapping?.moviebox_id ?? '');
    if (/^\d+$/.test(mappedMovieboxId) && row.moviebox_id == null) {
      await linkMovieboxId(c.env, row.spun_id, mappedMovieboxId).catch(() => {});
    }

    const downloads = Array.isArray(raw.downloads)
      ? raw.downloads.map((item: any) => Array.isArray(item?.options)
        ? {
            season: Number(item.season),
            episode: Number(item.episode),
            options: item.options.map(mapDownloadItem),
          }
        : mapDownloadItem(item))
      : [];

    const subtitles = await downloadableSubtitles(c, row, options);
    return new Response(JSON.stringify({
      spun_id: row.spun_id,
      title: row.title,
      type,
      downloads,
      subtitles,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return errorResponse('SERVICE_OFFLINE', 'Download service unavailable.', 503);
  }
}

download.get('/:type/:spunId/:season/:episode', (c) => handle(
  c,
  c.req.param('type'),
  c.req.param('spunId'),
  {
    season: c.req.param('season'),
    episode: c.req.param('episode'),
    quality: c.req.query('quality'),
    language: c.req.query('lang'),
  },
));

download.get('/:type/:spunId/:episode', async (c) => {
  if (c.req.param('type') !== 'anime') return errorResponse('BAD_REQUEST', 'Content type mismatch.', 400);
  return handle(c, 'anime', c.req.param('spunId'), {
    season: '1',
    episode: c.req.param('episode'),
    quality: c.req.query('quality'),
    language: c.req.query('lang'),
  });
});

download.get('/:type/:spunId', (c) => handle(
  c,
  c.req.param('type'),
  c.req.param('spunId'),
  {
    season: c.req.query('season'),
    episode: c.req.query('episode'),
    quality: c.req.query('quality'),
    language: c.req.query('lang'),
  },
));

download.get('/:spunId', async (c) => {
  const row = await getBySpunId(c.env, c.req.param('spunId'));
  if (!row) return errorResponse('INVALID_ID', 'Content not found.', 404);
  return handle(c, row.content_type, c.req.param('spunId'), {
    season: c.req.query('season'),
    episode: c.req.query('episode'),
    quality: c.req.query('quality'),
    language: c.req.query('lang'),
  });
});

export default download;
