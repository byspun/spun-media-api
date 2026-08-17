import { attachSubtitles } from '../normalizer.js';
import type { MovieProviderInput, RawStream, RawSubtitle, TvProviderInput } from './types.js';

interface MovieboxApiConfig {
  baseUrl: string;
  secret: string;
}

interface MovieboxStreamItem {
  url?: string;
  quality?: string | number;
  resolution?: string | number;
  format?: string;
  audio?: string;
  language?: string;
  captions?: Array<{ url?: string; language?: string; language_code?: string }>;
}

function quality(value: unknown): RawStream['quality'] {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('2160') || normalized.includes('4k')) return '4k';
  if (normalized.includes('1080')) return '1080p';
  if (normalized.includes('720')) return '720p';
  if (normalized.includes('480')) return '480p';
  if (normalized.includes('360')) return '360p';
  return 'auto';
}

function format(value: unknown, url: string): RawStream['format'] {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('m3u8') || normalized.includes('hls')) return 'hls';
  if (normalized.includes('mpd') || normalized.includes('dash')) return 'dash';
  if (/\.mkv(?:$|[?#])/i.test(url)) return 'mkv';
  return 'mp4';
}

function audio(value: unknown): string {
  return String(value ?? '').trim() || 'Original';
}

async function request(
  config: MovieboxApiConfig,
  subjectId: string,
  season: number,
  episode: number,
): Promise<MovieboxStreamItem[]> {
  if (!config.baseUrl || !config.secret || !/^\d+$/.test(subjectId)) return [];
  const url = new URL(`/stream/${encodeURIComponent(String(subjectId))}`, config.baseUrl.replace(/\/$/, ''));
  url.searchParams.set('se', String(season));
  url.searchParams.set('ep', String(episode));
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Worker-Secret': config.secret },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return [];
  const payload = await response.json() as { streams?: MovieboxStreamItem[] } | MovieboxStreamItem[];
  return Array.isArray(payload) ? payload : Array.isArray(payload.streams) ? payload.streams : [];
}

function mapStreams(items: MovieboxStreamItem[]): RawStream[] {
  const subtitles: RawSubtitle[] = [];
  const streams: RawStream[] = [];
  for (const item of items) {
    const url = String(item.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    streams.push({
      url,
      format: format(item.format, url),
      quality: quality(item.quality ?? item.resolution),
      audio: audio(item.audio ?? item.language),
      provider: 'moviebox',
    });
    for (const caption of item.captions ?? []) {
      const captionUrl = String(caption.url ?? '').trim();
      if (!/^https?:\/\//i.test(captionUrl)) continue;
      subtitles.push({
        url: captionUrl,
        language: String(caption.language ?? caption.language_code ?? 'Unknown'),
        language_code: String(caption.language_code ?? 'und').toLowerCase(),
        format: /\.vtt(?:$|[?#])/i.test(captionUrl) ? 'vtt' : 'srt',
        provider: 'subtitle-catalog',
      });
    }
  }
  return attachSubtitles(streams, subtitles);
}

export async function getMovieboxApiMovieStreams(
  input: MovieProviderInput,
  config: MovieboxApiConfig,
): Promise<RawStream[]> {
  if (!input.moviebox_id) return [];
  return mapStreams(await request(config, input.moviebox_id, 0, 0));
}

export async function getMovieboxApiTvStreams(
  input: TvProviderInput,
  config: MovieboxApiConfig,
): Promise<RawStream[]> {
  if (!input.moviebox_id) return [];
  return mapStreams(await request(config, input.moviebox_id, input.season, input.episode));
}
