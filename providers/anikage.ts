// Anikage anime provider — direct HLS streams.
// Upstream: anikage.cc (JSON API) → og.bakayaro.live (stream proxy).
// Requires: Referer header for playback.

import { detectFormat, isSafeHttpUrl, normalizeQuality, uniqueBy } from './internal/utils.js';
import { attachSubtitles } from './internal/normalizer.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const BASE = 'https://anikage.cc';
const PROXY_BASE = 'https://og.bakayaro.live';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

interface AnikageSearchItem {
  slug: string;
  anilistId: number;
  title: { romaji?: string; english?: string; native?: string };
}

interface AnikageEpisode {
  id: string;
  slug: string;
  number: number;
  title?: string;
}

interface AnikageServersResponse {
  servers?: Array<{ id: string; providerId: string; default?: boolean; urls?: Record<string, string> }>;
}

interface AnikageSourcesResponse {
  sources?: Array<{ url: string; quality?: string; label?: string; isM3U8?: boolean }>;
  subtitles?: Array<{ file: string; label: string; kind?: string; default?: boolean }>;
}

async function getJson<T>(url: string): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: await res.json() as T };
  } catch {
    return { status: 500, data: null };
  }
}

async function searchAnime(title: string, anilistId?: number): Promise<AnikageSearchItem | null> {
  const res = await getJson<{ data: AnikageSearchItem[] }>(
    `${BASE}/api/media/anime/search?q=${encodeURIComponent(title)}`,
  );
  const items = res.data?.data ?? [];
  if (anilistId) {
    const match = items.find(i => i.anilistId === anilistId);
    if (match) return match;
  }
  const lower = title.toLowerCase();
  return items.find(i =>
    i.title.romaji?.toLowerCase() === lower ||
    i.title.english?.toLowerCase() === lower ||
    i.title.native?.toLowerCase() === lower
  ) ?? items[0] ?? null;
}

async function getEpisodes(slug: string): Promise<AnikageEpisode[]> {
  const res = await getJson<AnikageEpisode[]>(
    `${BASE}/api/media/anime/${encodeURIComponent(slug)}/episodes`,
  );
  return Array.isArray(res.data) ? res.data : [];
}

async function getServers(slug: string, episode: number): Promise<AnikageServersResponse | null> {
  const res = await getJson<AnikageServersResponse>(
    `${BASE}/api/media/anime/${encodeURIComponent(slug)}/episodes/${episode}/servers`,
  );
  return res.data;
}

async function getSources(slug: string, episode: number, provider: string, lang: string): Promise<AnikageSourcesResponse | null> {
  const res = await getJson<AnikageSourcesResponse>(
    `${BASE}/api/media/anime/${encodeURIComponent(slug)}/episodes/${episode}/sources?provider=${encodeURIComponent(provider)}&lang=${encodeURIComponent(lang)}`,
  );
  return res.data;
}

export async function getAnikageStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    const anime = await searchAnime(input.title, input.anilist_id);
    if (!anime) return [];

    const episodes = await getEpisodes(anime.slug);
    const target = episodes.find(e => e.number === input.episode) ?? episodes[0];
    if (!target) return [];

    const serversData = await getServers(anime.slug, target.number);
    if (!serversData?.servers?.length) return [];

    // Try each server, prefer default
    const candidateServers: string[] = [];
    const def = serversData.servers.find(s => s.default)?.id;
    if (def) candidateServers.push(def);
    for (const s of serversData.servers) {
      if (!candidateServers.includes(s.id)) candidateServers.push(s.id);
    }

    const lang = input.dub ? 'dub' : 'sub';
    const audio = input.dub ? 'Dub' : 'Original';
    const streams: RawStream[] = [];
    const subtitles: RawSubtitle[] = [];
    const seen = new Set<string>();

    for (const serverId of candidateServers) {
      const sourcesRes = await getSources(anime.slug, target.number, serverId, lang);
      if (!sourcesRes?.sources?.length) continue;

      for (const src of sourcesRes.sources) {
        const url = src.url.startsWith('http')
          ? src.url
          : `${PROXY_BASE}/${src.isM3U8 ? 'm3u8' : 'stream'}/${src.url}`;

        if (!isSafeHttpUrl(url)) continue;
        const format = detectFormat(url, src.isM3U8 ? 'hls' : undefined);
        if (format === 'unknown') continue;
        const key = `${url}:${src.quality ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        streams.push({
          url,
          format,
          quality: normalizeQuality(src.quality ?? src.label),
          audio,
          provider: 'anikage',
          headers: { 'User-Agent': UA, Referer: `${BASE}/` },
        });
      }

      // Extract subtitles
      for (const sub of sourcesRes.subtitles ?? []) {
        if (!isSafeHttpUrl(sub.file)) continue;
        subtitles.push({
          url: sub.file,
          language: sub.label,
          language_code: sub.label.slice(0, 2).toLowerCase(),
          format: 'vtt',
          provider: 'anikage',
        });
      }

      if (streams.length > 0) break; // first server with sources wins
    }

    return attachSubtitles(uniqueBy(streams, s => `${s.url}:${s.quality}`), subtitles);
  } catch (error) {
    console.error(`Anikage error: ${String(error)}`);
    return [];
  }
}