import { attachSubtitles } from '../normalizer.js';
import { dedupeStreams, fetchJson, fetchText, safeStream, animeAudio } from './anivexa-utils.js';
import type { AnimeProviderInput, RawStream } from '../shared/types.js';

const BASE = 'https://epeng.animeapps.top';

async function fetchServers(anilistId: number): Promise<any[]> {
  const data = await fetchJson<any>(`${BASE}/api2.php?epid=${encodeURIComponent(String(anilistId))}`);
  return Array.isArray(data) ? data : [];
}

async function fetchPlayerLinks(providerLink: string): Promise<any[]> {
  const data = await fetchJson<any>(`${BASE}/apilink.php?data=${encodeURIComponent(providerLink)}`);
  return Array.isArray(data) ? data : [];
}

function extractVideoUrl(html: string, origin: string): string | null {
  const raw = html.match(/videoUrl\s*:\s*["']([^"']+)["']/i)?.[1];
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

async function resolvePlayerStream(playerLink: string): Promise<{ url: string; headers: Record<string, string> } | null> {
  const origin = new URL(playerLink).origin;
  const html = await fetchText(playerLink, { Referer: `${origin}/`, Accept: 'text/html,application/xhtml+xml' });
  const hls = extractVideoUrl(html, origin);
  if (!hls) return null;
  return { url: hls, headers: { Referer: `${origin}/` } };
}

function audioFromServerName(name = ''): 'sub' | 'dub' {
  return /dub/i.test(name) ? 'dub' : 'sub';
}

export async function getAnibdStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  const audio = animeAudio(input);
  const groups = await fetchServers(input.anilist_id);
  let providerLink: string | null = null;
  for (const group of groups) {
    if (audioFromServerName(String(group?.server_name ?? '')) !== audio) continue;
    for (const episode of group?.server_data ?? []) {
      if (Number(episode?.name ?? episode?.slug) === Number(input.episode)) {
        providerLink = String(episode.link ?? '');
        break;
      }
    }
    if (providerLink) break;
  }
  if (!providerLink) return [];

  const players = await fetchPlayerLinks(providerLink);
  const streams: RawStream[] = [];
  for (const entry of players) {
    if (!entry?.link) continue;
    try {
      const resolved = await resolvePlayerStream(String(entry.link));
      if (!resolved) continue;
      const stream = safeStream({ url: resolved.url, quality: 'auto', type: 'hls' }, 'anibd', input.dub ? 'English' : 'Japanese', 'hls', resolved.headers);
      if (stream) streams.push(stream);
    } catch {
      // Continue through the real player list just as the source adapter does.
    }
  }
  return attachSubtitles(dedupeStreams(streams), []);
}
