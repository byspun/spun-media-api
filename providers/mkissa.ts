import { fetchJson, fetchWithTimeout } from './internal/http.js';
import { isSafeHttpUrl, detectFormat, normalizeQuality } from './internal/utils.js';
import type { AnimeProviderInput, MovieProviderInput, TvProviderInput, RawStream, RawDownload, RawSubtitle } from './internal/types.js';

const MKISSA_API = 'https://api.mkissa.net/api';
const MKISSA_CDN = 'https://cdn.mkissa.net/all/mk';
const REFERER = 'https://mkissa.to/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchWithMkissaHeaders(url: string, options: RequestInit = {}): Promise<Response> {
  return fetchWithTimeout(url, {
    ...options,
    headers: {
      'User-Agent': UA,
      'Referer': REFERER,
      'Accept': 'application/json, text/plain, */*',
      ...options.headers,
    },
    timeout: 15_000,
  });
}

async function resolveMkissaEpisode(input: AnimeProviderInput): Promise<{ showId: string; episodeId: string } | null> {
  try {
    // Search for the show by AniList ID
    const searchResponse = await fetchJson(`${MKISSA_API}/anime/${input.anilist_id}`, {
      headers: { 'Referer': REFERER, 'User-Agent': UA },
      timeout: 15_000,
    });

    const data = searchResponse as { data?: { id: string; episodes?: Array<{ number: number; id: string }> } } | null;
    if (!data?.data?.episodes?.length) return null;

    const episode = data.data.episodes.find((ep: { number: number; id: string }) => ep.number === input.episode);
    if (!episode) return null;

    return { showId: data.data.id, episodeId: episode.id };
  } catch {
    return null;
  }
}

async function getMkissaStreamUrl(episodeId: string): Promise<string | null> {
  try {
    const response = await fetchWithMkissaHeaders(`${MKISSA_API}/episode/${episodeId}/sources`);
    const data = await response.json().catch(() => null) as { sources?: Array<{ url: string; type: string }> } | null;

    if (!data?.sources?.length) return null;

    // Prefer HLS, then MP4
    const hlsSource = data.sources.find((s: { url: string; type: string }) => s.type === 'hls' || s.url.includes('.m3u8'));
    if (hlsSource) return hlsSource.url;

    const mp4Source = data.sources.find((s: { url: string; type: string }) => s.type === 'mp4' || s.url.includes('.mp4'));
    if (mp4Source) return mp4Source.url;

    return data.sources[0]?.url ?? null;
  } catch {
    return null;
  }
}

async function getMkissaSubtitles(episodeId: string): Promise<RawSubtitle[]> {
  try {
    const response = await fetchWithMkissaHeaders(`${MKISSA_API}/episode/${episodeId}/subtitles`);
    const data = await response.json().catch(() => null) as { subtitles?: Array<{ url: string; lang: string; lang_code: string; format: string }> } | null;

    if (!data?.subtitles?.length) return [];

    return data.subtitles
      .filter((sub) => isSafeHttpUrl(sub.url))
      .map((sub) => ({
        url: sub.url,
        language: sub.lang,
        language_code: sub.lang_code,
        format: sub.format as 'vtt' | 'srt',
        provider: 'mkissa' as const,
      }));
  } catch {
    return [];
  }
}

export async function getMkissaStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  const streams: RawStream[] = [];

  try {
    const resolved = await resolveMkissaEpisode(input);
    if (!resolved) return [];

    const streamUrl = await getMkissaStreamUrl(resolved.episodeId);
    if (!streamUrl || !isSafeHttpUrl(streamUrl)) return [];

    streams.push({
      url: streamUrl,
      format: detectFormat(streamUrl, 'hls') as 'hls' | 'mp4',
      quality: normalizeQuality('1080p'),
      audio: input.dub ? 'Dub' : 'Original',
      provider: 'mkissa',
      headers: { Referer: REFERER },
    });
  } catch (error) {
    console.error(`Mkissa error: ${String(error)}`);
  }

  return streams;
}

export async function getMkissaDownloads(input: MovieProviderInput | TvProviderInput, tmdbApiKey: string): Promise<RawDownload[]> {
  const downloads: RawDownload[] = [];

  try {
    // Search by TMDB ID
    const searchUrl = `${MKISSA_API}/search?tmdb_id=${input.tmdb_id}&type=${'season' in input ? 'tv' : 'movie'}&api_key=${tmdbApiKey}`;
    const searchResponse = await fetchWithMkissaHeaders(searchUrl);
    const searchData = await searchResponse.json().catch(() => null) as { data?: Array<{ id: string; title?: string }> } | null;

    if (!searchData?.data?.length) return [];

    const item = searchData.data[0];
    if ('season' in input) {
      // TV show - need to find specific episode
      const episodesUrl = `${MKISSA_API}/anime/${item.id}/episodes?season=${input.season}`;
      const epsResponse = await fetchWithMkissaHeaders(episodesUrl);
      const epsData = await epsResponse.json().catch(() => null) as { data?: { episodes?: Array<{ number: number; id: string }> } } | null;

      const episode = epsData?.data?.episodes?.find((ep) => ep.number === input.episode);
      if (!episode) return [];

      const streamUrl = await getMkissaStreamUrl(episode.id);
      if (streamUrl && isSafeHttpUrl(streamUrl)) {
        downloads.push({
          url: streamUrl,
          format: detectFormat(streamUrl, 'mp4') as 'mp4' | 'mkv' | 'dash',
          quality: normalizeQuality('1080p'),
          size: null,
          filename: `${item.title || 'download'}_S${String(input.season).padStart(2, '0')}E${String(input.episode).padStart(2, '0')}.mkv`,
          provider: 'mkissa',
          season: input.season,
          episode: input.episode,
        });
      }
    } else {
      // Movie
      const streamUrl = await getMkissaStreamUrl(item.id);
      if (streamUrl && isSafeHttpUrl(streamUrl)) {
        downloads.push({
          url: streamUrl,
          format: detectFormat(streamUrl, 'mp4') as 'mp4' | 'mkv' | 'dash',
          quality: normalizeQuality('1080p'),
          size: null,
          filename: `${item.title || 'download'}.mkv`,
          provider: 'mkissa',
        });
      }
    }
  } catch (error) {
    console.error(`Mkissa download error: ${String(error)}`);
  }

  return downloads;
}