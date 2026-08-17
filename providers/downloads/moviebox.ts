import { fetchJson } from '../shared/http.js';
import { isSafeHttpUrl, normalizeQuality } from '../mapper.js';
import type { AnimeProviderInput, MovieProviderInput, RawDownload, TvProviderInput } from '../shared/types.js';

type Input = MovieProviderInput | TvProviderInput | AnimeProviderInput;
interface Config { baseUrl: string; apiKey: string }
function titleOf(input: Input): string { return input.title; }
function seasonOf(input: Input): number | undefined { return 'season' in input ? input.season : undefined; }
function episodeOf(input: Input): number | undefined { return 'episode' in input ? input.episode : undefined; }
export async function getMovieboxDownloads(input: Input, config: Config): Promise<RawDownload[]> {
  const search = await fetchJson<any>(`${config.baseUrl.replace(/\/$/, '')}/search`, { method: 'POST', headers: { 'X-Worker-Secret': config.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: titleOf(input), page: 1, perPage: 10 }), timeout: 25_000 }); const items = Array.isArray(search?.items) ? search.items : Array.isArray(search?.results) ? search.results : []; const chosen = items.find((item: any) => String(item.title ?? '').toLowerCase() === input.title.toLowerCase()) ?? items[0]; const subjectId = chosen?.subjectId ?? chosen?.id; if (!subjectId) return [];
  const payload = await fetchJson<any>(`${config.baseUrl.replace(/\/$/, '')}/download/${encodeURIComponent(String(subjectId))}`, { headers: { 'X-Worker-Secret': config.apiKey }, timeout: 30_000 }); const output: RawDownload[] = []; const seasons = Array.isArray(payload?.seasons) ? payload.seasons : [];
  for (const season of seasons) { const seasonNo = Number(season.season ?? season.seasonNumber ?? 1); if (seasonOf(input) != null && seasonOf(input) !== seasonNo) continue; for (const episode of Array.isArray(season.episodes) ? season.episodes : []) { const episodeNo = Number(episode.episode ?? episode.episodeNumber ?? episode.number ?? 1); if (episodeOf(input) != null && episodeOf(input) !== episodeNo) continue; const options = Array.isArray(episode.qualities) ? episode.qualities : Array.isArray(episode.downloads) ? episode.downloads : []; for (const option of options) { const url = option.url ?? option.downloadUrl ?? option.link; const format = String(option.format ?? url ?? '').toLowerCase().includes('mkv') ? 'mkv' : 'mp4'; if (!isSafeHttpUrl(url)) continue; output.push({ url, format, quality: normalizeQuality(option.quality ?? option.resolution ?? option.label), size: option.size ? String(option.size) : null, filename: option.filename ? String(option.filename) : null, provider: 'moviebox', season: seasonNo, episode: episodeNo }); } } }
  return output;
}
