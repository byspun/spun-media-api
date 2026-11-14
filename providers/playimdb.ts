import { fetchJson, fetchWithTimeout } from './internal/http.js';
import { isSafeHttpUrl, detectFormat, normalizeQuality } from './internal/utils.js';
import type { MovieProviderInput, TvProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const BASE_API = 'https://streamdata.vaplayer.ru/api.php';
const TMDB_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJlYjdkMWM0ZTgwMGUzM2FiMmE3Y2I3NDA5YmM4NjQ2YSIsIm5iZiI6MTc3OTUzMDcxOS40MzIsInN1YiI6IjZhMTE3YmRmYTlhNjNlYmFiOWUzYjc4YyIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.Z9pa96oJEyicf6wAoaKGKJd9ldapeiOdktoJd4xcgLo';

const HEADERS = {
  'Origin': 'https://nextgencloudfabric.com',
  'Referer': 'https://nextgencloudfabric.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

async function fetchWithTimeoutInternal(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, {
      ...options,
      headers: { ...HEADERS, ...options.headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonInternal(url: string, options: RequestInit = {}): Promise<any | null> {
  try {
    const response = await fetchWithTimeoutInternal(url, options);
    if (response.ok) return await response.json();
    return null;
  } catch {
    return null;
  }
}

export async function getPlayimdbStreams(input: MovieProviderInput | TvProviderInput, tmdbApiKey: string): Promise<RawStream[]> {
  const streams: RawStream[] = [];
  const subtitles: RawSubtitle[] = [];

  try {
    const isTv = 'season' in input;
    const type = isTv ? 'tv' : 'movie';

    if (!input.tmdb_id) return [];

    // Build API URL
    let apiUrl = `${BASE_API}?imdb_id=&tmdb_id=${input.tmdb_id}&type=${type}`;
    if (isTv) {
      if (!input.season || !input.episode) return [];
      apiUrl += `&season=${input.season}&episode=${input.episode}`;
    }

    const data = await fetchJsonInternal(apiUrl, { headers: HEADERS });
    if (!data || data.status_code !== 200 || !data.data?.stream_urls) return [];

    const fileName = String(data.data.file_name || '').toLowerCase();
    let quality = '1080p';
    let qualityLabel = '1080P';

    if (fileName.includes('2160') || fileName.includes('4k') || fileName.includes('uhd')) {
      quality = '4k';
      qualityLabel = '2160P';
    } else if (fileName.includes('720p')) {
      quality = '720p';
      qualityLabel = '720P';
    }

    let audio = 'Original-Audio';
    let audioLabel = 'Original';
    if (fileName.includes('dual') || (fileName.includes('multi') && fileName.includes('english'))) {
      audio = 'Dual-Audio';
      audioLabel = 'Dual';
    } else if (fileName.includes('multi')) {
      audio = 'Multi-Audio';
      audioLabel = 'Multi';
    } else if (fileName.includes('hindi')) {
      audio = 'Hindi-Audio';
      audioLabel = 'Hindi';
    } else if (fileName.includes('english')) {
      audio = 'English-Audio';
      audioLabel = 'English';
    }

    const year = data.data.year || '';
    const seasonEpisode = isTv ? `S${String(input.season).padStart(2, '0')}E${String(input.episode).padStart(2, '0')}` : '';

    for (const streamUrl of data.data.stream_urls) {
      if (!isSafeHttpUrl(streamUrl)) continue;

      const format = streamUrl.includes('.m3u8') ? 'hls' :
                     streamUrl.includes('.mp4') ? 'mp4' : 'mp4';

      streams.push({
        url: streamUrl,
        format: detectFormat(streamUrl, format) as 'hls' | 'mp4' | 'dash' | 'mkv',
        quality: normalizeQuality(qualityLabel),
        audio: audioLabel,
        provider: 'playimdb',
        headers: HEADERS,
      });

      // Subtitles if available
      if (data.default_subs && Array.isArray(data.default_subs) && data.default_subs.length > 0) {
        for (const sub of data.default_subs) {
          if (isSafeHttpUrl(sub.url)) {
            subtitles.push({
              url: sub.url,
              language: sub.lang || 'English',
              language_code: sub.code || 'en',
              format: 'vtt',
              provider: 'playimdb',
              headers: HEADERS,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(`PlayIMDB error: ${String(error)}`);
  }

  return streams;
}