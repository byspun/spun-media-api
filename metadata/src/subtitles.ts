import type { Env } from './types/env.js';
import type { MediaTitleRow } from './types/index.js';
import { createSubtitleProxyToken } from './proxy-token.js';

const SUBTITLE_CATALOG_BASE = 'https://api.subdl.com/api/v1';

interface SubtitleCatalogItem {
  lang: string;
  language: string;
  url: string;
  full_link?: string;
  season?: number;
  episode?: number;
}

interface SubtitleCatalogResponse {
  status: boolean;
  subtitles: SubtitleCatalogItem[];
}

export type SubtitleDisposition = 'inline' | 'attachment';

export interface ResolvedSubtitleTrack {
  language: string;
  language_code: string;
  label: string;
  format: 'vtt';
  url: string;
  expires_at: string;
}

const LANG_MAP: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  portuguese: 'pt',
  arabic: 'ar',
  japanese: 'ja',
  chinese: 'zh',
  korean: 'ko',
  italian: 'it',
  russian: 'ru',
};

function toLangCode(language: string): string {
  return LANG_MAP[language.toLowerCase()] ?? language.toLowerCase().slice(0, 2);
}

function toArchiveUrl(item: SubtitleCatalogItem): string | null {
  const candidate = item.full_link || item.url;
  if (!candidate) return null;
  try {
    if (candidate.startsWith('https://')) return new URL(candidate).toString();
    return new URL(candidate, 'https://dl.subdl.com').toString();
  } catch {
    return null;
  }
}

export async function resolveSubtitleTracks(
  env: Env,
  row: MediaTitleRow,
  options: {
    season?: number;
    episode?: number;
    language?: string;
    disposition: SubtitleDisposition;
  },
  origin: string,
): Promise<ResolvedSubtitleTrack[]> {
  if (!env.SUBTITLE_PROXY_TOKEN_SECRET || !env.SUBDL_API_KEY) return [];

  const params = new URLSearchParams({
    api_key: env.SUBDL_API_KEY,
    languages: options.language ?? 'EN',
    subs_per_page: '5',
    type: row.content_type === 'movie' ? 'movie' : 'tv',
  });

  if (row.imdb_id) params.set('imdb_id', row.imdb_id.replace(/^tt/, ''));
  else if (row.tmdb_id) params.set('tmdb_id', String(row.tmdb_id));
  if (options.season !== undefined) params.set('season_number', String(options.season));
  if (options.episode !== undefined) params.set('episode_number', String(options.episode));

  const response = await fetch(`${SUBTITLE_CATALOG_BASE}/subtitles?${params.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Subtitle catalog upstream ${response.status}`);

  const data = await response.json() as SubtitleCatalogResponse;
  if (!data.status || !Array.isArray(data.subtitles)) return [];

  const publicOrigin = origin.replace(/\/$/, '');

  const tracks = await Promise.all(
    data.subtitles.slice(0, 5).map(async (item) => {
      const archiveUrl = toArchiveUrl(item);
      if (!archiveUrl) return null;
      const language = item.language || item.lang || 'Unknown';
      const languageCode = toLangCode(language);
      const { token, expiresAt } = await createSubtitleProxyToken(
        env.SUBTITLE_PROXY_TOKEN_SECRET,
        archiveUrl,
        languageCode,
        {
          // VTT is the stable output format for both inline playback and
          // downloadable attachments. The proxy converts SRT when needed.
          format: 'vtt',
          disposition: options.disposition,
        },
      );
      return {
        language,
        language_code: languageCode,
        label: language,
        format: 'vtt' as const,
        url: `${publicOrigin}/v1/proxy/subtitles?t=${encodeURIComponent(token)}`,
        expires_at: expiresAt,
      };
    }),
  );

  return tracks.filter((track): track is ResolvedSubtitleTrack => track !== null);
}
