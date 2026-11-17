// CineSrc movie/TV provider — embed-only.
// Upstream: cinesrc.st (Next.js frontend, client-side player).
// Direct HLS extraction requires a headless browser (CDP automation), which is
// not available in this environment. Until then, the provider returns its embed
// URL with format 'embed' so the client can render it in an iframe. This is the
// last-resort fallback: embeds take the lowest streaming priority.

import type { MovieProviderInput, TvProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const BASE = 'https://cinesrc.st';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

function buildHeaders(): Record<string, string> {
  return { 'User-Agent': UA, Referer: `${BASE}/` };
}

function isTvInput(input: MovieProviderInput | TvProviderInput): input is TvProviderInput {
  return 'season' in input && 'episode' in input;
}

export async function getCinesrcStreams(input: MovieProviderInput | TvProviderInput): Promise<RawStream[]> {
  try {
    const isTv = isTvInput(input);
    const type = isTv ? 'tv' : 'movie';

    if (!input.tmdb_id) return [];

    const embedUrl = `${BASE}/embed/${type}/${input.tmdb_id}${isTv ? `?s=${input.season}&e=${input.episode}` : ''}`;

    // Embed URL — not a direct media URL. format 'embed' signals the client to
    // render it in an iframe. No HLS proxying (shouldProxyStream skips non-HLS).
    const subtitles: RawSubtitle[] = [];
    return [{
      url: embedUrl,
      format: 'embed',
      quality: 'auto',
      audio: 'Original',
      provider: 'cinesrc',
      headers: buildHeaders(),
    }];
  } catch (error) {
    console.error(`CineSrc error: ${String(error)}`);
    return [];
  }
}