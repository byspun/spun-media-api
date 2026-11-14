import { fetchJson, findBestMatch } from './internal/http.js';
import { isSafeHttpUrl, normalizeQuality } from './internal/utils.js';
import { attachSubtitles } from './internal/normalizer.js';
import type { RawStream, RawSubtitle, RawDownload, MovieProviderInput, TvProviderInput } from './internal/types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept': 'application/json' };

function subtitle(value: any): RawSubtitle | null {
  if (!isSafeHttpUrl(value?.url)) return null;
  const language = String(value.lang ?? value.language ?? 'Unknown');
  return { url: value.url, language, language_code: language.toLowerCase().slice(0, 2), format: 'srt', provider: 'daratech' };
}

interface DaratechConfig { baseUrl: string; apiKey: string }
interface DaratechSearchResult { subjectId?: string; id?: string; title?: string; year?: number }
interface DaratechStreamPayload { qualities?: Array<{ url: string; resolution?: string; label?: string }>; subtitles?: Array<{ url: string; lang?: string; language?: string; format?: string }> }

async function searchDaratech(base: string, config: DaratechConfig, query: string, type: 'movies' | 'tvshows'): Promise<DaratechSearchResult[]> {
  const res = await fetchJson<any>(`${base}/search/${type}?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
    timeout: 15_000,
  });
  return Array.isArray(res?.items) ? res.items : Array.isArray(res?.results) ? res.results : [];
}

async function getDaratechStreams(input: MovieProviderInput | TvProviderInput, config: DaratechConfig): Promise<RawStream[]> {
  const isMovie = !('season' in input);
  const type = isMovie ? 'movies' : 'tvshows';
  const base = config.baseUrl.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' };

  const search = await searchDaratech(base, config, input.title, type);
  const items = search.map(item => ({ title: String(item.title ?? ''), year: Number(item.year) || null }));
  const index = findBestMatch(items, input, 40);
  if (index < 0) return [];

  const subjectId = search[index]?.subjectId ?? search[index]?.id;
  if (!subjectId) return [];

  let payload: DaratechStreamPayload;
  if (isMovie) {
    payload = await fetchJson<any>(`${base}/movies/${encodeURIComponent(String(subjectId))}/stream`, { headers, timeout: 20_000 });
  } else {
    payload = await fetchJson<any>(`${base}/tvshows/${encodeURIComponent(String(subjectId))}/stream?ep=${input.episode}&season=${input.season}`, { headers, timeout: 20_000 });
  }

  const qualities = Array.isArray(payload?.qualities) ? payload.qualities : [];
  const subtitles = (Array.isArray(payload?.subtitles) ? payload.subtitles : []).map(subtitle).filter(Boolean) as RawSubtitle[];

  const streams: RawStream[] = qualities
    .filter(item => isSafeHttpUrl(item.url))
    .map(item => ({
      url: item.url,
      format: 'mp4' as const,
      quality: normalizeQuality(item.resolution ?? item.label),
      audio: 'Original',
      provider: 'daratech' as const,
    }));
  return attachSubtitles(streams, subtitles);
}

async function getDaratechDownloads(input: MovieProviderInput | TvProviderInput, config: DaratechConfig): Promise<RawDownload[]> {
  const isMovie = !('season' in input);
  const type = isMovie ? 'movies' : 'tvshows';
  const base = config.baseUrl.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' };

  const search = await searchDaratech(base, config, input.title, type);
  const items = search.map(item => ({ title: String(item.title ?? ''), year: Number(item.year) || null }));
  const index = findBestMatch(items, input, 40);
  if (index < 0) return [];

  const subjectId = search[index]?.subjectId ?? search[index]?.id;
  if (!subjectId) return [];

  let payload: any;
  if (isMovie) {
    payload = await fetchJson<any>(`${base}/movies/${encodeURIComponent(String(subjectId))}/download`, { headers, timeout: 20_000 });
  } else {
    payload = await fetchJson<any>(`${base}/tvshows/${encodeURIComponent(String(subjectId))}/season/${input.season}/episode/${input.episode}/download`, { headers, timeout: 20_000 });
  }

  // Response returns 'links' array, not 'downloads'
  const downloads = Array.isArray(payload?.links) ? payload.links : Array.isArray(payload?.downloads) ? payload.downloads : Array.isArray(payload?.streams) ? payload.streams : [];
  return downloads
    .filter((item: any) => isSafeHttpUrl(item.url))
    .map((item: any) => ({
      url: item.url,
      format: 'mp4' as const,
      quality: normalizeQuality(item.quality ?? item.resolution ?? item.label),
      size: item.size ? String(item.size) : null,
      filename: item.filename ?? null,
      provider: 'daratech' as const,
      season: isMovie ? undefined : input.season,
      episode: isMovie ? undefined : input.episode,
    }));
}

export { getDaratechStreams, getDaratechDownloads };