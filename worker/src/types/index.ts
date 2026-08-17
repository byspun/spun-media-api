// worker/src/types/index.ts
// All shared TypeScript types for the Spün Media API Worker.

// ─── Core ─────────────────────────────────────────────────────────────────────

export type ContentType = 'movie' | 'tv' | 'anime';

// ─── Universal card shape — used in every list context ────────────────────────

export interface ContentItem {
  spun_id: string;
  type:    ContentType;
  title:   string;
  year:    number | null;
  rating:  number | null;
  poster:  string | null;
}

// ─── Ranked item — used in anime ranking endpoints ────────────────────────────

export interface RankedItem extends ContentItem {
  rank:   number;
  format: string | null;
}

// ─── Airing entry — used in schedule and airing endpoints ────────────────────

export interface AiringEntry {
  spun_id:   string;
  title:     string;
  poster:    string | null;
  episode:   number;
  airing_at: string;
  countdown: string;
}

// ─── Info response ────────────────────────────────────────────────────────────

export interface CastMember {
  image:     string | null;
  character: string | null;
  name:      string;
}

export interface CrewMember {
  photo: string | null;
  name:  string;
  role:  string;
}

export interface SeasonSummary {
  season: number;
  count:  number;
}

export interface EpisodeInfo {
  number:    number;
  season:    number;
  title:     string | null;
  overview:  string | null;
  thumbnail: string | null;
  runtime:   number | null;
  air_date:  string | null;
}

export interface SeasonDetail {
  season:   number;
  count:    number;
  episodes: EpisodeInfo[];
}

export interface TrailerInfo {
  key:  string;
  site: string;
}

export type RelationshipGroupKind = 'collection' | 'franchise';

export interface MembershipSummary {
  kind:     RelationshipGroupKind;
  id:       string;
  title:    string;
  position: number;
  total:    number;
}

export interface InfoResponse {
  spun_id:  string;
  type:     ContentType;
  title:    string;
  year:     number | null;
  rating:   number | null;
  overview: string | null;
  status:   string | null;
  tagline:  string | null;
  runtime:  number | null;
  genres:   string[];
  format:   string | null;
  tags:     string[] | null;
  studios:  string[];
  poster:   string | null;
  backdrop: string | null;
  trailers: TrailerInfo[];
  stills:   string[];
  cast:     CastMember[];
  episodes: {
    total:   number;
    seasons: SeasonSummary[];
  } | null;
  part_of: MembershipSummary[];
}

// ─── Episodes response ────────────────────────────────────────────────────────

export interface EpisodesResponse {
  spun_id: string;
  type:    'tv' | 'anime';
  seasons: SeasonDetail[];
}

// ─── Related response ─────────────────────────────────────────────────────────

export interface RelatedEntry {
  relation: string;
  item:     ContentItem;
}

export interface RelatedGroupItem extends ContentItem {
  position:   number;
  role:       'main' | 'sequel' | 'prequel' | 'spinoff' | 'side_story' | null;
  note:       string | null;
  is_current: boolean;
}

export interface RelatedGroup {
  kind:  RelationshipGroupKind;
  id:    string;
  title: string;
  total: number;
  items: RelatedGroupItem[];
}

export interface RelatedResponse {
  spun_id: string;
  related: RelatedEntry[];
  groups:  RelatedGroup[];
}

// ─── Stream response ──────────────────────────────────────────────────────────

export interface SubtitleTrack {
  url:           string;
  language:      string;
  language_code: string;
  format:        'vtt' | 'srt';
}

export interface StreamEntry {
  quality: '4k' | '1080p' | '720p' | '480p' | '360p' | 'auto';
  format: 'mp4' | 'hls' | 'dash' | 'mkv';
  audio: string;
  url: string;
}

export interface StreamResponse {
  spun_id: string;
  title: string;
  type: ContentType;
  streams: StreamEntry[];
  subtitles: SubtitleTrack[];
}

// ─── Download response ────────────────────────────────────────────────────────

export interface DownloadEntry {
  quality: '4k' | '1080p' | '720p' | '480p' | '360p' | 'auto';
  format: 'mp4' | 'mkv' | 'dash';
  audio: string;
  url: string;
  filename: string | null;
  size: string | null;
}

export interface DownloadGroup {
  season: number;
  episode: number;
  options: DownloadEntry[];
}

export interface DownloadResponse {
  spun_id: string;
  title: string;
  type: ContentType;
  downloads: DownloadEntry[] | DownloadGroup[];
  subtitles: SubtitleTrack[];
}

// ─── Search response ──────────────────────────────────────────────────────────

export interface SearchResponse {
  page:          number;
  total_pages:   number | null;
  total_results: number | null;
  results:       ContentItem[];
}

export interface SuggestionsResponse {
  suggestions: ContentItem[];
}

// ─── Discover response ────────────────────────────────────────────────────────

export interface DiscoverResponse {
  page:     number;
  has_more: boolean;
  results:  ContentItem[];
}

// ─── Genre types ──────────────────────────────────────────────────────────────

export interface SpunGenre {
  id:            string;          // slug e.g. "action", "sci-fi", "slice-of-life"
  name:          string;          // display name e.g. "Action"
  description:   string | null;
  content_types: ContentType[];
  // Internal — never exposed in API responses
  tmdb_movie_genre_ids?: number[];
  tmdb_tv_genre_ids?:    number[];
  anilist_genres?:       string[];
  anilist_tags?:         string[];
}

export interface GenreGroup {
  id:     string;
  label:  string;
  genres: Array<{
    id:            string;
    name:          string;
    description:   string | null;
    content_types: string[];
  }>;
}

export interface GenresResponse {
  groups: GenreGroup[];
}

// ─── Studio types ─────────────────────────────────────────────────────────────

export interface PublicStudio {
  spun_studio_id: string;
  name:           string;
  category:       string;
  description:    string;
  logo:           string;
}

// ─── Home response ────────────────────────────────────────────────────────────

export interface HomeRow {
  id:    string;
  title: string;
  items: ContentItem[];
}

export interface HomeResponse {
  hero: ContentItem[];
  rows: HomeRow[];
}

// ─── Anime-specific types ─────────────────────────────────────────────────────

export interface AnimeSeason {
  year:   number;
  season: 'winter' | 'spring' | 'summer' | 'fall';
  count:  number;
}

export interface AnimeTheme {
  title:    string;
  artist:   string;
  episodes: string;
  season:   number;
}

export interface FillerEpisode {
  number: number;
  type:   'canon' | 'filler' | 'mixed';
}

export interface FranchiseEntry {
  order:    number;
  spun_id:  string;
  title:    string;
  year:     number | null;
  format:   string;
  poster:   string | null;
  relation: string;
  note:     string | null;
}

// ─── Utility types ────────────────────────────────────────────────────────────

export type ResolveResponse = ContentItem;

export interface HealthResponse {
  status:   'ok' | 'degraded' | 'down';
  services: {
    tmdb:      'ok' | 'down';
    anilist:   'ok' | 'down';
    jikan:     'ok' | 'down';
    kitsu:       'ok' | 'down';
    moviebox:    'ok' | 'down';
    providers: 'ok' | 'degraded' | 'down';
  };
}

// ─── Internal DB row types ────────────────────────────────────────────────────

export interface MediaTitleRow {
  spun_id:         string;
  slug:            string;
  content_type:    ContentType;
  title:           string;
  tmdb_id:         number | null;
  anilist_id:      number | null;
  mal_id:          number | null;
  imdb_id:         string | null;
  tvdb_id:         number | null;
  kitsu_id:        number | null;
  moviebox_id:     string | null;
  year:            number | null;
  rating:          number | null;
  poster_path:     string | null;
  summary_synced_at: string | null;
  daratech_id:     string | null;
  daratech_score:  number | null;
  created_at:      string;
  last_accessed_at: string;
}

// ─── AniList raw types ────────────────────────────────────────────────────────

export interface AniListTitle {
  romaji:        string | null;
  english:       string | null;
  native:        string | null;
  userPreferred: string | null;
}

export interface AniListMedia {
  id:           number;
  idMal:        number | null;
  title:        AniListTitle;
  format:       string | null;
  status:       string | null;
  episodes:     number | null;
  coverImage:   { large: string | null; medium: string | null };
  bannerImage:  string | null;
  averageScore: number | null;
  genres:       string[];
  tags?:        Array<{ name: string; isMediaSpoiler: boolean; rank: number }>;
  startDate:    { year: number | null; month: number | null; day: number | null } | null;
  description:  string | null;
  studios?:     { nodes: Array<{ name: string; isAnimationStudio: boolean }> };
  synonyms?:    string[];
  trailer?:     { id: string; site: string } | null;
  nextAiringEpisode?: {
    episode:          number;
    airingAt:         number;
    timeUntilAiring:  number;
  } | null;
  season?:       string | null;
  seasonYear?:   number | null;
  relations?:    {
    edges: Array<{
      relationType: string;
      node:         AniListMedia;
    }>;
  };
  recommendations?: {
    nodes: Array<{ mediaRecommendation: AniListMedia }>;
  };
  characters?: {
    edges: Array<{
      node: {
        name:  { full: string };
        image: { large: string | null };
      };
      voiceActors: Array<{
        name:  { full: string };
        image: { large: string | null };
      }>;
    }>;
  };
  rankings?: Array<{
    rank:    number;
    type:    string;
    allTime: boolean;
    season:  string | null;
    year:    number | null;
  }>;
}
