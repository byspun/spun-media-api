// Anikoto anime provider — direct HLS via MegaPlay embed extraction.
// Upstream: anikoto.cz
//   search:       /search?keyword=<title>
//   anime id:     /watch/{slug} (data-id attribute)
//   episodes:     /ajax/episode/list/{animeId}      → HTML rows with data-num/data-ids
//   servers:      /ajax/server/list?servers={ids}   → HTML rows with data-link-id/data-sv-id
//   server link:  /ajax/server?get={linkId}         → { result: { url: megaplay embed } }
//   stream:       MegaPlayExtractor on the embed    → master.m3u8 + subtitle tracks
// Title-only matching (no AniList/MAL ID support).
// Ported faithfully from ultrasrc src/providers/anime/anikoto.ts.

import { extractMegaPlay } from './internal/extractors/megaplay.js';
import { attachSubtitles } from './internal/normalizer.js';
import { detectFormat, isSafeHttpUrl, uniqueBy } from './internal/utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const BASE = 'https://anikoto.cz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36';

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await res.text() };
}

async function searchAnime(title: string): Promise<string> {
  const url = `${BASE}/search?keyword=${encodeURIComponent(title)}`;
  const r = await get(url);
  if (r.status !== 200) throw new Error(`anikoto search -> HTTP ${r.status}`);

  // Collect /watch/{slug} links from search results; strip any /ep-N suffix.
  const linkRegex = /href="([^"]*\/watch\/[^"\s]+)"/g;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(r.body)) !== null) {
    let href = match[1];
    if (href.includes('/ep-')) href = href.split('/ep-')[0];
    if (!results.includes(href)) results.push(href);
  }

  if (!results.length) throw new Error(`anikoto search: no results for '${title}'`);
  return results[0];
}

async function getAnimeInfo(animeSlug: string): Promise<{ id: string; watchUrl: string }> {
  const watchUrl = `${BASE}/watch/${animeSlug}`;
  const r = await get(watchUrl);
  if (r.status !== 200) throw new Error(`anikoto anime info -> HTTP ${r.status}`);

  const idMatch = /data-id="(\d+)"/.exec(r.body);
  const animeId = idMatch ? idMatch[1] : null;
  if (!animeId) throw new Error('anikoto: could not extract anime ID');

  return { id: animeId, watchUrl };
}

interface EpisodeInfo {
  num: number;
  id: string;
  dataIds?: string;
}

async function getEpisodeList(animeId: string): Promise<EpisodeInfo[]> {
  const url = `${BASE}/ajax/episode/list/${animeId}`;
  const r = await get(url, { 'X-Requested-With': 'XMLHttpRequest', Referer: `${BASE}/` });
  if (r.status !== 200) throw new Error(`anikoto episode list -> HTTP ${r.status}`);

  let parsed: any;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    throw new Error('anikoto: invalid episode list JSON');
  }

  const html = parsed.result || parsed.html || '';
  const aRegex = /<a\s+[^>]*>/gi;
  const episodes: EpisodeInfo[] = [];
  let match: RegExpExecArray | null;
  while ((match = aRegex.exec(html)) !== null) {
    const tag = match[0];
    const numMatch = /data-num="(\d+)"/i.exec(tag);
    const idMatch = /data-id="([^"]+)"/i.exec(tag);
    const idsMatch = /data-ids="([^"]+)"/i.exec(tag);
    if (numMatch && idMatch) {
      episodes.push({
        num: parseInt(numMatch[1], 10),
        id: idMatch[1],
        dataIds: idsMatch ? idsMatch[1] : undefined,
      });
    }
  }
  return episodes;
}

interface ServerInfo {
  name: string;
  linkId: string;
  svId?: string;
}

async function getServerList(dataIds: string, watchUrl: string): Promise<ServerInfo[]> {
  const url = `${BASE}/ajax/server/list?servers=${encodeURIComponent(dataIds)}`;
  const r = await get(url, { 'X-Requested-With': 'XMLHttpRequest', Referer: watchUrl });
  if (r.status !== 200) return [];

  let parsed: any;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    return [];
  }

  const html = parsed.result || '';
  const liRegex = /<li\s+([^>]*?)>([^<]*)<\/li>/gi;
  const servers: ServerInfo[] = [];
  let match: RegExpExecArray | null;
  while ((match = liRegex.exec(html)) !== null) {
    const attrs = match[1];
    const name = match[2].trim();
    const linkIdM = /data-link-id="([^"]+)"/i.exec(attrs);
    const svIdM = /data-sv-id="([^"]+)"/i.exec(attrs);
    if (linkIdM) {
      servers.push({ name, linkId: linkIdM[1], svId: svIdM ? svIdM[1] : undefined });
    }
  }
  return servers;
}

async function resolveServerEmbed(linkId: string, referer: string): Promise<string> {
  const r = await get(`${BASE}/ajax/server?get=${encodeURIComponent(linkId)}`, {
    'X-Requested-With': 'XMLHttpRequest',
    Referer: referer,
  });
  if (r.status !== 200) throw new Error(`anikoto server -> HTTP ${r.status}`);
  const json = JSON.parse(r.body) as { result?: { url?: string } };
  const embedUrl = json?.result?.url;
  if (!embedUrl) throw new Error('anikoto: server returned no embed url');
  return embedUrl;
}

/** Best-effort language match on a MegaPlay subtitle track label. */
function trackIsDub(label?: string): boolean {
  return /dub|audio\s*(jap|english|indonesian|thai|portuguese|spanish|french|german)/i.test(label ?? '');
}

export async function getAnikotoStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    // 1. Search for the anime → first /watch/{slug} link.
    const searchUrl = await searchAnime(input.title);
    const parsedUrl = new URL(searchUrl.startsWith('http') ? searchUrl : `${BASE}${searchUrl}`);
    const animeSlug = parsedUrl.pathname.startsWith('/watch/') ? parsedUrl.pathname.split('/')[2] : parsedUrl.pathname.split('/').filter(Boolean)[1] ?? '';

    // 2. Watch page → anime id.
    const animeInfo = await getAnimeInfo(animeSlug);

    // 3. Episode list → target episode (fall back to first available).
    const episodes = await getEpisodeList(animeInfo.id);
    const targetEp = episodes.find(e => e.num === input.episode) ?? episodes[0];
    if (!targetEp) throw new Error(`anikoto: episode ${input.episode} not found`);

    const audio = input.dub ? 'Dub' : 'Original';
    const streams: RawStream[] = [];
    const subtitles: RawSubtitle[] = [];
    const seen = new Set<string>();
    const seenSubs = new Set<string>();

    // 4. Try each server until one yields a playable stream.
    if (targetEp.dataIds) {
      const servers = await getServerList(targetEp.dataIds, animeInfo.watchUrl);

      for (const server of servers) {
        try {
          const embedUrl = await resolveServerEmbed(server.linkId, animeInfo.watchUrl);
          if (!isSafeHttpUrl(embedUrl)) continue;

          const extracted = await extractMegaPlay(embedUrl);
          if (!extracted.fileUrl) continue;

          const format = detectFormat(extracted.fileUrl);
          if (!isSafeHttpUrl(extracted.fileUrl) || format === 'unknown') continue;

          // Language guard: skip dub-only sources when sub was requested, and
          // vice-versa, using the server name / track labels as a heuristic.
          const serverName = server.name.toLowerCase();
          const serverIsDub = /dub/i.test(serverName) || extracted.tracks.some(t => trackIsDub(t.label));
          if (serverIsDub !== input.dub) continue;

          if (!seen.has(extracted.fileUrl)) {
            seen.add(extracted.fileUrl);
            streams.push({
              url: extracted.fileUrl,
              format,
              quality: 'auto',
              audio,
              provider: 'anikoto',
              headers: extracted.headers,
            });
          }

          // Subtitle tracks from the MegaPlay payload.
          for (const track of extracted.tracks) {
            if (!track.file || !isSafeHttpUrl(track.file)) continue;
            if (track.kind && track.kind.toLowerCase() === 'thumbnails') continue;
            if (seenSubs.has(track.file)) continue;
            seenSubs.add(track.file);
            const language = track.language || track.label || 'English';
            const langBase = track.label || track.language || 'en';
            subtitles.push({
              url: track.file,
              language,
              language_code: langBase.slice(0, 2).toLowerCase() || 'en',
              format: /\.srt($|[?#])/i.test(track.file) ? 'srt' : 'vtt',
              provider: 'anikoto',
            });
          }

          // First server with playable output wins.
          break;
        } catch {
          // Continue to the next server candidate.
        }
      }
    }

    return attachSubtitles(uniqueBy(streams, s => s.url), uniqueBy(subtitles, s => s.url));
  } catch (error) {
    console.error(`Anikoto error: ${String(error)}`);
    return [];
  }
}
