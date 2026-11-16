// Framextv movie/TV provider — direct HLS streams via api.framextv.tech.
// Upstream: api.framextv.tech (REST API returning HLS sources + subtitles).
// Fastest provider in testing (~2.4s, 6 playable quality rungs).

import { detectFormat, isSafeHttpUrl, normalizeQuality, uniqueBy } from './internal/utils.js';
import { attachSubtitles } from './internal/normalizer.js';
import type { MovieProviderInput, TvProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const API = 'https://api.framextv.tech';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://framextv.tech/' };

interface FrameSource {
  url?: unknown;
  quality?: unknown;
  type?: unknown;
  server?: unknown;
}

interface FrameSubtitle {
  url?: unknown;
  label?: unknown;
  lang?: unknown;
  format?: unknown;
}

async function apiJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`framextv ${path.split('?')[0]} -> HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function isTvInput(input: MovieProviderInput | TvProviderInput): input is TvProviderInput {
  return 'season' in input && 'episode' in input;
}

export async function getFramextvStreams(input: MovieProviderInput | TvProviderInput): Promise<RawStream[]> {
  try {
    const isTv = isTvInput(input);
    const type = isTv ? 'tv' : 'movie';

    if (!input.tmdb_id) return [];

    const params = new URLSearchParams({ type, id: String(input.tmdb_id) });
    if (isTv) {
      params.set('season', String(input.season));
      params.set('episode', String(input.episode));
    }

    const payload = await apiJson(`/api/stream?${params.toString()}`) as { sources?: FrameSource[] };
    const rawSources = Array.isArray(payload?.sources) ? payload.sources : [];

    const audio = 'Original';
    const streams: RawStream[] = [];
    const subtitles: RawSubtitle[] = [];
    const seen = new Set<string>();

    for (const source of rawSources) {
      if (!source || typeof source.url !== 'string' || !isSafeHttpUrl(source.url)) continue;
      if (typeof source.type === 'string' && source.type.toLowerCase() !== 'hls') continue;
      if (seen.has(source.url)) continue;
      seen.add(source.url);

      const quality = typeof source.quality === 'string' && source.quality.trim()
        ? source.quality.trim() : 'auto';

      streams.push({
        url: source.url,
        format: detectFormat(source.url) as 'hls',
        quality: normalizeQuality(quality),
        audio,
        provider: 'framextv',
        headers: { 'User-Agent': UA, Referer: 'https://framextv.tech/' },
      });
    }

    // Fetch subtitles (non-blocking)
    try {
      const subs = await apiJson(`/api/subtitles?${params.toString()}`) as { subtitles?: FrameSubtitle[] };
      const subSeen = new Set<string>();
      for (const row of (subs?.subtitles ?? []).slice(0, 10)) {
        const url = typeof row.url === 'string' ? row.url : '';
        if (!isSafeHttpUrl(url) || subSeen.has(url)) continue;
        subSeen.add(url);
        subtitles.push({
          url,
          language: String(row.label ?? row.lang ?? 'English'),
          language_code: String(row.lang ?? 'en').slice(0, 2).toLowerCase(),
          format: String(row.format ?? 'vtt') === 'srt' ? 'srt' : 'vtt',
          provider: 'framextv',
        });
      }
    } catch { /* subtitles are optional */ }

    return attachSubtitles(uniqueBy(streams, s => `${s.url}:${s.quality}`), subtitles);
  } catch (error) {
    console.error(`Framextv error: ${String(error)}`);
    return [];
  }
}