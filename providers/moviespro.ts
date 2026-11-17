// MoviesPro movie/TV provider.
// Upstream: moviespro.watch → player.cinezo.live (P-Stream) → proxy1.flikhub.net.
// The cinezo player is a React SPA that fetches sources from the flikhub proxy API
// (no inline sources in the embed HTML). We call that API directly.
// The manifest URL returned by flikhub carries its own proxy + token; we pass it
// through as-is and the client fetches the inner URL with embedded credentials.

import { attachSubtitles } from './internal/normalizer.js';
import { extractFlikhub, flikhubToRawStreams, flikhubToRawSubtitles } from './internal/extractors/flikhub.js';
import type { MovieProviderInput, TvProviderInput, RawStream } from './internal/types.js';

function isTvInput(input: MovieProviderInput | TvProviderInput): input is TvProviderInput {
  return 'season' in input && 'episode' in input;
}

export async function getMoviesproStreams(input: MovieProviderInput | TvProviderInput): Promise<RawStream[]> {
  try {
    if (!input.tmdb_id) return [];
    const isTv = isTvInput(input);
    const result = await extractFlikhub(
      String(input.tmdb_id),
      isTv,
      isTv ? input.season : undefined,
      isTv ? input.episode : undefined,
    );
    const streams = flikhubToRawStreams(result, 'moviespro', 'Original');
    const subtitles = flikhubToRawSubtitles(result, 'moviespro');
    return attachSubtitles(streams, subtitles);
  } catch (error) {
    console.error(`MoviesPro error: ${String(error)}`);
    return [];
  }
}