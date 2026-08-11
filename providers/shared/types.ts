// providers/shared/types.ts
// All shared TypeScript types for the Spün Media API providers backend.
// These are internal types — never exposed directly in API responses.
// Public response shapes live in worker/src/types/index.ts.

// ─── Provider identity ────────────────────────────────────────────────────────

export type ProviderId =
  // Movie + TV
  | 'moviebox'
  | 'showbox'
  | 'vidlink'
  | 'vidrock'
  | 'vidnest'
  | 'castle'
  | 'netmirror'
  | 'vixsrc'
  | 'streamflix'
  | '4khdhub'
  | 'dvdplay'
  | 'daratech'
  // Anime
  | 'anikoto'
  | 'kaa'
  | 'animegg'
  | 'reanime'
  | 'animedunya'
  | 'anineko'
  | 'anidbapp'
  | 'anibd';

export type ProviderCategory = 'movie' | 'tv' | 'anime';
export type StreamFormat     = 'mp4' | 'hls' | 'dash' | 'mkv';
export type StreamQuality    = '4k' | '1080p' | '720p' | '480p' | '360p' | 'auto';

// ─── Raw stream result from a provider ───────────────────────────────────────

export interface RawSubtitle {
  url:           string;
  language:      string;
  language_code: string;
  format:        'vtt' | 'srt';
}

export interface RawStream {
  url:       string;
  format:    StreamFormat;
  quality:   StreamQuality;
  audio:     string;           // e.g. "English", "Japanese", "Multi"
  subtitles: RawSubtitle[];
  provider:  ProviderId;       // stripped before leaving Worker
  headers?:  Record<string, string>; // extra headers needed to play the stream
}

export interface RawDownload {
  url:       string;
  format:    'mp4' | 'mkv';
  quality:   StreamQuality;
  size:      string | null;
  filename:  string | null;
  subtitles: Array<{
    url:           string;
    language:      string;
    language_code: string;
    format:        'zip' | 'srt' | 'vtt';
  }>;
  provider:  ProviderId;
}

// ─── Provider result — what each provider returns ─────────────────────────────

export interface ProviderResult {
  streams:   RawStream[];
  downloads: RawDownload[];
  error?:    string;
}

// ─── Provider input — what the orchestrator passes in ────────────────────────

export interface MovieProviderInput {
  tmdb_id:   number;
  imdb_id:   string | null;
  title:     string;
  year:      number | null;
}

export interface TvProviderInput {
  tmdb_id:   number;
  imdb_id:   string | null;
  title:     string;
  year:      number | null;
  season:    number;
  episode:   number;
}

export interface AnimeProviderInput {
  anilist_id: number;
  mal_id:     number | null;
  title:      string;
  episode:    number;
  dub:        boolean;
}

export type ProviderInput =
  | ({ type: 'movie' } & MovieProviderInput)
  | ({ type: 'tv'    } & TvProviderInput)
  | ({ type: 'anime' } & AnimeProviderInput);

// ─── Provider health ──────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface ProviderHealthRecord {
  provider_id:          ProviderId;
  content_type:         ProviderCategory;
  status:               HealthStatus;
  last_success_at:      string | null;
  last_failure_at:      string | null;
  consecutive_failures: number;
  last_error:           string | null;
  checked_at:           string;
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface Provider {
  id:       ProviderId;
  name:     string;
  supports: ProviderCategory[];
  priority: number; // lower = higher priority in fan-out

  getMovie?(input: MovieProviderInput): Promise<ProviderResult>;
  getTv?(input: TvProviderInput):       Promise<ProviderResult>;
  getAnime?(input: AnimeProviderInput): Promise<ProviderResult>;
}

// ─── Daratech types ───────────────────────────────────────────────────────────

export interface DaratechSearchResult {
  id:    string;
  score: number;  // 0-100 match confidence
  title: string;
}

export interface DaratechStream {
  url:     string;
  quality: string;
  format:  string;
}
