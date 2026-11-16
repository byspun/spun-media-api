// MoviesPro movie provider — embed-only.
// Upstream: moviespro.to → player.cinezo.live (catalog-player embeds).
// Returns embed URL as a placeholder stream until CatalogPlayerExtractor integration.

import type { MovieProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const BASE = 'https://moviespro.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

function buildHeaders(): Record<string, string> {
  return { 'User-Agent': UA, Referer: `${BASE}/` };
}

export async function getMoviesproStreams(input: MovieProviderInput): Promise<RawStream[]> {
  try {
    if (!input.tmdb_id && !input.imdb_id) return [];

    // MoviesPro uses IMDb ID for its embed URLs
    const id = input.imdb_id ?? String(input.tmdb_id);
    const embedUrl = `${BASE}/embed/movie/${id}`;

    const subtitles: RawSubtitle[] = [];
    return [{
      url: embedUrl,
      format: 'hls',
      quality: 'auto',
      audio: 'Original',
      provider: 'moviespro',
      headers: buildHeaders(),
    }];
  } catch (error) {
    console.error(`MoviesPro error: ${String(error)}`);
    return [];
  }
}