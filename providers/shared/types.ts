// All shared provider-backend types. These are internal and are never exposed directly.

export type ProviderId =
  | 'moviebox' | 'daratech' | 'castle' | 'netmirror' | 'vidlink'
  | '4khdhub' | 'dvdplay' | 'streamflix'
  | 'anikoto' | 'kaa' | 'animegg' | 'reanime' | 'animedunya' | 'anineko' | 'anidbapp' | 'anibd';

export type ProviderCategory = 'movie' | 'tv' | 'anime';
export type StreamFormat = 'mp4' | 'hls' | 'dash' | 'mkv';
export type StreamQuality = '4k' | '1080p' | '720p' | '480p' | '360p' | 'auto';

export interface RawSubtitle {
  url: string;
  language: string;
  language_code: string;
  format: 'vtt' | 'srt';
  provider: ProviderId | 'subtitle-catalog' | 'daratech-subtitles';
}

export interface RawStream {
  url: string;
  format: StreamFormat;
  quality: StreamQuality;
  audio: string;
  provider: ProviderId;
  headers?: Record<string, string>;
}

export interface RawDownload {
  url: string;
  format: 'mp4' | 'mkv' | 'dash';
  quality: StreamQuality;
  size: string | null;
  filename: string | null;
  provider: ProviderId;
  season?: number;
  episode?: number;
}

export interface ProviderResult {
  streams: RawStream[];
  downloads: RawDownload[];
  subtitles: RawSubtitle[];
  error?: string;
}

export interface MovieProviderInput {
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  year: number | null;
}

export interface TvProviderInput {
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  year: number | null;
  season: number;
  episode: number;
}

export interface AnimeProviderInput {
  anilist_id: number;
  mal_id: number | null;
  title: string;
  episode: number;
  dub: boolean;
}

export type ProviderInput =
  | ({ type: 'movie' } & MovieProviderInput)
  | ({ type: 'tv' } & TvProviderInput)
  | ({ type: 'anime' } & AnimeProviderInput);

export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface ProviderHealthRecord {
  provider_id: ProviderId;
  content_type: ProviderCategory;
  status: HealthStatus;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
  checked_at: string;
}

export interface PublicStreamItem {
  quality: StreamQuality;
  format: StreamFormat;
  audio: string;
  url: string;
}

export interface PublicDownloadItem {
  quality: StreamQuality;
  format: 'mp4' | 'mkv' | 'dash';
  audio: string;
  url: string;
  filename: string | null;
  size: string | null;
}

export interface PublicDownloadGroup {
  season: number;
  episode: number;
  options: PublicDownloadItem[];
}

export interface PublicSubtitle {
  url: string;
  language: string;
  language_code: string;
  format: 'vtt' | 'srt';
}

export interface PublicStreamResponse {
  spun_id: string;
  title: string;
  type: ProviderCategory;
  streams: PublicStreamItem[];
  subtitles: PublicSubtitle[];
}

export interface PublicDownloadResponse {
  spun_id: string;
  title: string;
  type: ProviderCategory;
  downloads: PublicDownloadItem[] | PublicDownloadGroup[];
  subtitles: PublicSubtitle[];
}
