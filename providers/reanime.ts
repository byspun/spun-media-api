// Reanime anime provider — direct HLS via FlixCloud embed extraction.
// Upstream: reanime.to (REST: /api/v1/search, /api/v1/anime/{slug},
// /api/flix/{anilistId}/{episode}?mal={malId}) → FlixCloud embed (WASM-decrypted
// master.m3u8 via internal/flixcloud.ts).
// Server preference: HD-2 → HD-1 → first available, filtered by sub/dub.
// Ported faithfully from ultrasrc src/providers/anime/reanime.ts.

import { extractFlixCloud } from './internal/flixcloud.js';
import { attachSubtitles } from './internal/normalizer.js';
import { detectFormat, isSafeHttpUrl, uniqueBy } from './internal/utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const BASE = 'https://reanime.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36';

interface ReanimeSearchItem {
  anime_id: string;
  anilist_id?: number;
  mal_id?: number;
  title: { english?: string; native?: string; romaji?: string };
  format?: string;
  episodes?: number;
}

interface ReanimeSearchResponse {
  results?: ReanimeSearchItem[];
  limit?: number;
}

interface ReanimeAnimeDetail {
  anime_id: string;
  anilist_id?: number;
  mal_id?: number;
  themoviedb_id?: number;
  title: { english?: string; native?: string; romaji?: string };
  format?: string;
  episodes_total?: number;
}

interface ReanimeServer {
  $id?: string;
  serverName: string;
  dataLink: string;
  dataType: string; // "sub" | "dub"
  continue?: boolean;
  softsub?: boolean;
}

interface ReanimeFlixResponse {
  success?: boolean;
  servers?: ReanimeServer[];
}

async function getJson<T>(url: string): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: `${BASE}/` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    return { status: 500, data: null };
  }
}

async function searchReanime(title: string, anilistId?: number): Promise<ReanimeSearchItem> {
  const url = `${BASE}/api/v1/search?q=${encodeURIComponent(title)}`;
  const res = await getJson<ReanimeSearchResponse>(url);
  const results = res.data?.results;
  if (!results?.length) {
    throw new Error(`reanime search: no anime found for '${title}'`);
  }

  // Prefer an exact AniList ID match, then exact title match, then first result.
  if (anilistId) {
    const found = results.find(r => r.anilist_id === anilistId);
    if (found) return found;
  }

  const lower = title.toLowerCase();
  const match = results.find(
    r =>
      r.title.english?.toLowerCase() === lower ||
      r.title.romaji?.toLowerCase() === lower ||
      r.title.native?.toLowerCase() === lower,
  );

  return match || results[0];
}

async function getAnimeDetail(slug: string): Promise<ReanimeAnimeDetail | null> {
  const url = `${BASE}/api/v1/anime/${encodeURIComponent(slug)}`;
  const res = await getJson<ReanimeAnimeDetail>(url);
  return res.data;
}

async function getFlixServers(anilistId: number, episode: number, malId?: number): Promise<ReanimeServer[]> {
  const malQuery = malId ? `?mal=${malId}` : '';
  const url = `${BASE}/api/flix/${anilistId}/${episode}${malQuery}`;
  const res = await getJson<ReanimeFlixResponse>(url);
  return res.data?.servers || [];
}

export async function getReanimeStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    // 1. Resolve the catalog entry. AniList ID lets us skip fuzzy matching when
    //    the search endpoint returns it on results; otherwise title match.
    const searchItem = await searchReanime(input.title, input.anilist_id);
    let slug = searchItem.anime_id;
    let anilistId = searchItem.anilist_id ?? input.anilist_id;
    let malId = searchItem.mal_id;
    const animeTitle = searchItem.title.english || searchItem.title.romaji || input.title;

    // 2. Detail lookup guarantees accurate anilist_id + mal_id for the flix call.
    if (slug) {
      const detail = await getAnimeDetail(slug);
      if (detail) {
        if (detail.anilist_id) anilistId = detail.anilist_id;
        if (detail.mal_id) malId = detail.mal_id;
      }
    }

    if (!anilistId) {
      throw new Error(`reanime: could not resolve anilistId for '${animeTitle || slug}'`);
    }

    // 3. Language preference: dub only when the input asks for it.
    const langKey = input.dub ? 'dub' : 'sub';

    // 4. Fetch the Flix server list for this episode.
    const servers = await getFlixServers(anilistId, input.episode, malId);
    if (!servers.length) {
      throw new Error(`reanime: no servers for anilist ${anilistId} episode ${input.episode}`);
    }

    // 5. Filter by language, prefer HD-2 → HD-1 → first.
    const langServers = servers.filter(s => s.dataType === langKey);
    const candidatePool = langServers.length ? langServers : servers;
    const selectedServer =
      candidatePool.find(s => s.serverName === 'HD-2') ||
      candidatePool.find(s => s.serverName === 'HD-1') ||
      candidatePool[0];

    if (!selectedServer?.dataLink || !isSafeHttpUrl(selectedServer.dataLink)) {
      throw new Error('reanime: selected server has no usable dataLink');
    }

    // 6. Extract the direct master.m3u8 from the FlixCloud embed.
    const extracted = await extractFlixCloud(selectedServer.dataLink);

    const audio = input.dub ? 'Dub' : 'Original';
    const streams: RawStream[] = [];
    const seen = new Set<string>();

    const format = detectFormat(extracted.masterUrl);
    if (format !== 'unknown' && isSafeHttpUrl(extracted.masterUrl)) {
      seen.add(extracted.masterUrl);
      streams.push({
        url: extracted.masterUrl,
        format,
        quality: 'auto',
        audio,
        provider: 'reanime',
        headers: extracted.headers,
      });
    }

    const subtitles: RawSubtitle[] = extracted.subtitles
      .filter(sub => isSafeHttpUrl(sub.url))
      .map(sub => ({
        url: sub.url,
        language: sub.lang,
        language_code: sub.lang.slice(0, 2).toLowerCase() || 'en',
        format: 'vtt' as const,
        provider: 'reanime' as const,
      }));

    return attachSubtitles(uniqueBy(streams, s => s.url), uniqueBy(subtitles, s => s.url));
  } catch (error) {
    console.error(`Reanime error: ${String(error)}`);
    return [];
  }
}
