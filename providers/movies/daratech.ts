import { findBestMatch } from '../shared/http.js';
import { fetchDaratechJson } from '../shared/daratech-http.js';
import { isSafeHttpUrl, normalizeQuality } from '../mapper.js';
import { attachSubtitles } from '../normalizer.js';
import type { MovieProviderInput, RawStream, RawSubtitle } from '../shared/types.js';

interface DaratechConfig { baseUrl: string; apiKey: string }
function subtitle(value: any): RawSubtitle | null { if (!isSafeHttpUrl(value?.url)) return null; const language = String(value.lang ?? value.language ?? 'Unknown'); return { url: value.url, language, language_code: language.toLowerCase().slice(0, 2), format: 'srt', provider: 'daratech-subtitles' }; }

export async function getDaratechStreams(input: MovieProviderInput, config: DaratechConfig): Promise<RawStream[]> {
  const headers = { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' }; const base = config.baseUrl.replace(/\/$/, '');
    const search = await fetchDaratechJson<any>(`${base}/search/movies?q=${encodeURIComponent(input.title)}`, 'movie-search', { headers, timeout: 15_000 });
 const items = Array.isArray(search?.items) ? search.items : Array.isArray(search?.results) ? search.results : []; const index = findBestMatch(items.map((item: any) => ({ title: String(item.title ?? ''), year: Number(item.year) || null })), input, 40); if (index < 0) return [];
    const subjectId = items[index]?.subjectId ?? items[index]?.id; if (!subjectId) return []; const payload = await fetchDaratechJson<any>(`${base}/movies/${encodeURIComponent(String(subjectId))}/stream`, 'movie-playback', { headers, timeout: 20_000 });
 const qualities = Array.isArray(payload?.qualities) ? payload.qualities : []; const subtitles = (Array.isArray(payload?.subtitles) ? payload.subtitles : []).map(subtitle).filter(Boolean) as RawSubtitle[];
  const streams: RawStream[] = qualities.filter((item: any) => isSafeHttpUrl(item.url)).map((item: any) => ({ url: item.url, format: 'mp4' as const, quality: normalizeQuality(item.resolution ?? item.label), audio: 'Original', provider: 'daratech' as const })); return attachSubtitles(streams, subtitles);
}
