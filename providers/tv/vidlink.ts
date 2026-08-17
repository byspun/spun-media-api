import { fetchJson } from '../shared/http.js';
import { detectFormat, isSafeHttpUrl, normalizeQuality } from '../mapper.js';
import type { RawStream, TvProviderInput } from '../shared/types.js';
export async function getVidlinkStreams(input: TvProviderInput, tmdbApiKey: string): Promise<RawStream[]> {
  const payload = await fetchJson<any>(`https://vidlink.pro/api/b/tv/${input.tmdb_id}/${input.season}/${input.episode}?api_key=${encodeURIComponent(tmdbApiKey)}`, { headers: { Referer: 'https://vidlink.pro/', Origin: 'https://vidlink.pro' }, timeout: 20_000 }); const values = Array.isArray(payload?.streams) ? payload.streams : Array.isArray(payload?.sources) ? payload.sources : [];
  return values.filter((item: any) => isSafeHttpUrl(item.url)).map((item: any) => ({ url: item.url, format: detectFormat(item.url, item.format) as any, quality: normalizeQuality(item.quality ?? item.resolution), audio: String(item.audio ?? 'Original'), provider: 'vidlink' as const, headers: { Referer: 'https://vidlink.pro/', Origin: 'https://vidlink.pro' } })).filter((item) => item.format !== 'unknown');
}
