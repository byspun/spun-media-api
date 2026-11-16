// FlixHQ movie provider — embed-only (JWPlayer + WebSocket protocol).
// Upstream: flixhq.to → mfw09.org (JWPlayer with wss://socket.byse.sx).
// Returns embed URL as a placeholder stream until WebSocket protocol reimplementation.

import type { MovieProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const BASE = 'https://flixhq.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

function buildHeaders(): Record<string, string> {
  return { 'User-Agent': UA, Referer: `${BASE}/` };
}

export async function getFlixhqStreams(input: MovieProviderInput): Promise<RawStream[]> {
  try {
    if (!input.tmdb_id && !input.imdb_id) return [];

    const id = input.imdb_id ?? String(input.tmdb_id);
    const embedUrl = `${BASE}/embed/movie/${id}`;

    const subtitles: RawSubtitle[] = [];
    return [{
      url: embedUrl,
      format: 'hls',
      quality: 'auto',
      audio: 'Original',
      provider: 'flixhq',
      headers: buildHeaders(),
    }];
  } catch (error) {
    console.error(`FlixHQ error: ${String(error)}`);
    return [];
  }
}