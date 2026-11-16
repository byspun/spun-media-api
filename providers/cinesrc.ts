// CineSrc movie/TV provider — embed-only (requires headless browser for direct HLS).
// Upstream: cinesrc.st (Next.js frontend, client-side player).
// Returns embed URL as a placeholder stream until browser-based extraction is available.

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

    const params = new URLSearchParams({ type, id: String(input.tmdb_id) });
    if (isTv) {
      params.set('s', String(input.season));
      params.set('e', String(input.episode));
    }

    const embedUrl = `${BASE}/embed/${type}/${input.tmdb_id}${isTv ? `?s=${input.season}&e=${input.episode}` : ''}`;

    // Return embed URL as a placeholder — real HLS extraction requires headless Chrome
    const subtitles: RawSubtitle[] = [];
    return [{
      url: embedUrl,
      format: 'hls',
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