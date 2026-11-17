// FlixHQ movie provider — embed-only (disabled in manifest).
// Upstream: flixhq.to → mfw09.org (React SPA, WebSocket wss://socket.byse.sx).
// Direct extraction requires reimplementing the WebSocket protocol; the alternate
// Vidmoly server (kaembed.net) is unreachable from this environment. Until a
// WebSocket-capable extractor exists, the provider is registered but disabled.

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

    // Embed URL — not a direct media URL. format 'embed' signals the client to
    // render it in an iframe. No HLS proxying (shouldProxyStream skips non-HLS).
    const subtitles: RawSubtitle[] = [];
    return [{
      url: embedUrl,
      format: 'embed',
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