// FlikHub / P-Stream extractor (used by moviespro's cinezo player).
// Resolves a P-Stream embed into direct DASH/HLS stream URLs + subtitle tracks.
//
// Flow (discovered by reading cinezo's JS bundle — there is no inline `sources: [...]`
// in the embed HTML; the SPA fetches sources from the flikhub proxy API):
//   1. GET https://proxy1.flikhub.net/{movie|tv}?id={tmdbId}&mode=json&sources={name}&hevc=1
//      — REQUIRES Referer/Origin = https://player.cinezo.live/ (Cloudflare gate)
//      — `sources` is the server name: zendaya (works), scarlet/berlin (often null)
//   2. Response: { meta, subtitles[], source: { url, type, qualities[] } | null }
//   3. The `source.url` is a manifest (DASH .mpd or HLS .m3u8) possibly wrapped in
//      a proxy (manifest.mpd?url=...&t=...) — pass it through as-is; the player fetches
//      the inner URL with the embedded X-MB-Token/cookie recipe.

import type { RawStream, RawSubtitle, StreamFormat } from '../types.js';
import { detectFormat, isSafeHttpUrl, normalizeQuality } from '../utils.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const FLIKHUB_BASE = 'https://proxy1.flikhub.net';
const PLAYER_REFERER = 'https://player.cinezo.live/';
const PLAYER_ORIGIN = 'https://player.cinezo.live';

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  Referer: PLAYER_REFERER,
  Origin: PLAYER_ORIGIN,
};

export interface FlikhubSource {
  url: string;
  type: string;
  quality?: string;
}

export interface FlikhubTrack {
  file: string;
  label?: string;
  lang?: string;
}

export interface FlikhubResult {
  sources: FlikhubSource[];
  subtitles: FlikhubTrack[];
  type: 'hls' | 'dash' | 'mp4';
}

interface FlikhubSourceJson {
  source?: string;
  label?: string;
  url?: string;
  type?: string;
  qualities?: Array<{ quality?: string; codec?: string; url?: string; type?: string }>;
}

interface FlikhubResponse {
  meta?: { title?: string };
  subtitles?: Array<{ label?: string; file?: string; lang?: string; type?: string }>;
  source?: FlikhubSourceJson | null;
}

/**
 * Resolve a P-Stream title into direct stream URLs.
 *
 * @param tmdbId    TMDB ID of the movie or show.
 * @param isTv      true for TV (episode-level), false for movie.
 * @param season    Season number (TV only).
 * @param episode   Episode number (TV only).
 * @param sources   Source names to try in order. Defaults to ['zendaya', 'scarlet', 'berlin', 'jennifer'].
 */
export async function extractFlikhub(
  tmdbId: string | number,
  isTv: boolean,
  season?: number,
  episode?: number,
  sources: string[] = ['zendaya', 'scarlet', 'berlin', 'jennifer'],
): Promise<FlikhubResult> {
  const path = isTv ? 'tv' : 'movie';
  const baseParams = isTv
    ? `id=${encodeURIComponent(String(tmdbId))}&season=${season ?? 1}&episode=${episode ?? 1}`
    : `id=${encodeURIComponent(String(tmdbId))}`;

  let lastError: Error | null = null;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const url = `${FLIKHUB_BASE}/${path}?${baseParams}&mode=json&sources=${encodeURIComponent(source)}&hevc=1`;
    try {
      const res = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { lastError = new Error(`flikhub HTTP ${res.status} for source=${source}`); continue; }
      const json = await res.json() as FlikhubResponse;
      const src = json?.source;
      if (!src?.url || !isSafeHttpUrl(src.url)) { lastError = new Error(`flikhub: no source url for source=${source}`); continue; }

      const sources_out: FlikhubSource[] = [];
      const seen = new Set<string>();
      const pushSource = (rawUrl: string, typeHint?: string, quality?: string) => {
        if (!isSafeHttpUrl(rawUrl) || seen.has(rawUrl)) return;
        seen.add(rawUrl);
        sources_out.push({ url: rawUrl, type: typeHint ?? '', quality });
      };

      pushSource(src.url, src.type, src.label);
      for (const q of Array.isArray(src.qualities) ? src.qualities : []) {
        if (q?.url) pushSource(q.url, q.type ?? src.type, q.quality);
      }
      if (!sources_out.length) { lastError = new Error(`flikhub: source ${source} produced no playable urls`); continue; }

      const subtitles: FlikhubTrack[] = [];
      for (const t of Array.isArray(json.subtitles) ? json.subtitles.slice(0, 30) : []) {
        if (!t?.file || !isSafeHttpUrl(t.file)) continue;
        subtitles.push({ file: t.file, label: t.label, lang: t.lang });
      }

      const primaryType = (sources_out[0].type || src.type || 'hls').toLowerCase();
      const type: FlikhubResult['type'] = primaryType.includes('dash') || primaryType.includes('mpd') ? 'dash'
        : primaryType.includes('mp4') ? 'mp4'
        : 'hls';

      return { sources: sources_out, subtitles, type };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
    // Be gentle with the upstream proxy: pause between source attempts (it
    // rate-limits rapid sequential requests). Skip the wait after the last try.
    if (i < sources.length - 1) await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`flikhub: no usable source (${lastError?.message ?? 'all sources failed'})`);
}

/**
 * Convert a FlikhubResult into RawStream[] / RawSubtitle[] for the provider layer.
 * The manifest URL is passed through as-is (it carries its own proxy + token);
 * the client/player fetches the inner URL with the embedded credentials.
 */
export function flikhubToRawStreams(
  result: FlikhubResult,
  provider: RawStream['provider'],
  audio: string,
): RawStream[] {
  const streams: RawStream[] = [];
  for (const src of result.sources) {
    const format: StreamFormat = result.type === 'dash' ? 'dash'
      : result.type === 'mp4' ? 'mp4'
      : detectFormat(src.url, src.type) === 'dash' ? 'dash'
      : detectFormat(src.url, src.type) === 'mp4' ? 'mp4'
      : 'hls';
    streams.push({
      url: src.url,
      format,
      quality: normalizeQuality(src.quality),
      audio,
      provider,
      headers: { Referer: PLAYER_REFERER, Origin: PLAYER_ORIGIN },
    });
  }
  return streams;
}

export function flikhubToRawSubtitles(result: FlikhubResult, provider: RawSubtitle['provider']): RawSubtitle[] {
  const subs: RawSubtitle[] = [];
  for (const t of result.subtitles) {
    if (!isSafeHttpUrl(t.file)) continue;
    const label = t.label ?? t.lang ?? 'English';
    const code = (t.lang ?? label).slice(0, 2).toLowerCase();
    subs.push({
      url: t.file,
      language: label,
      language_code: code || 'en',
      format: /\.srt(?:$|[?#])/i.test(t.file) ? 'srt' : 'vtt',
      provider,
    });
  }
  return subs;
}