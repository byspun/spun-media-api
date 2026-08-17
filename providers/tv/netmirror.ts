import { fetchJson } from '../shared/http.js';
import { detectFormat, isSafeHttpUrl, normalizeQuality } from '../mapper.js';
import type { RawStream, TvProviderInput } from '../shared/types.js';

export async function getNetmirrorStreams(input: TvProviderInput, tmdbApiKey: string): Promise<RawStream[]> {
  const tmdb = await fetchJson<any>(`https://api.themoviedb.org/3/tv/${input.tmdb_id}?api_key=${encodeURIComponent(tmdbApiKey)}`, { timeout: 15_000 }); const title = encodeURIComponent(String(tmdb?.name ?? input.title));
  const payload = await fetchJson<any>(`https://net52.cc/api/search?keyword=${title}&season=${input.season}&episode=${input.episode}`, { headers: { Referer: 'https://net52.cc/' }, timeout: 20_000 }); const values = Array.isArray(payload?.streams) ? payload.streams : Array.isArray(payload?.sources) ? payload.sources : Array.isArray(payload) ? payload : [];
  return values.filter((item: any) => isSafeHttpUrl(item.url ?? item.file)).map((item: any) => ({ url: String(item.url ?? item.file), format: detectFormat(String(item.url ?? item.file), item.type) as any, quality: normalizeQuality(item.quality ?? item.resolution), audio: String(item.audio ?? 'Original'), provider: 'netmirror' as const, headers: { Referer: 'https://net52.cc/' } })).filter((item) => item.format !== 'unknown');
}
