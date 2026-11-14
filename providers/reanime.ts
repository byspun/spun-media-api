import { fetchJson, fetchWithTimeout } from './internal/http.js';
import { isSafeHttpUrl, detectFormat, normalizeQuality } from './internal/utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const REANIME_BASE = 'https://reanime.to';
const FLIXCLOUD_BASE = 'https://flixcloud.cc';
const ANIZIP_API = 'https://api.ani.zip/mappings';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept': 'application/json, */*' };

// Flixcloud XOR decryption (playlist_key is base64, 32 bytes)
function xorDecryptPlaylist(encryptedB64: string, playlistKeyB64: string): string | null {
  try {
    const encrypted = Buffer.from(encryptedB64, 'base64');
    const key = Buffer.from(playlistKeyB64, 'base64');
    if (key.length !== 32) return null;
    const decrypted = Buffer.alloc(encrypted.length);
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ key[i % key.length];
    }
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

async function searchReanime(query: string): Promise<Array<{ anime_id: string; title: { english?: string; romaji?: string }; cover_image?: { extra_large?: string; large?: string }; subbed?: number; dubbed?: number; episodes?: number }>> {
  try {
    const res = await fetchWithTimeout(`${REANIME_BASE}/api/v1/search?q=${encodeURIComponent(query)}&limit=10`, {
      headers: HEADERS,
      timeout: 15_000,
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: any[] };
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

async function fetchAnimeDetail(animeId: string): Promise<{ anilist_id?: number; mal_id?: number; title?: { english?: string; romaji?: string }; subbed?: number; dubbed?: number; episodes?: number } | null> {
  try {
    const res = await fetchWithTimeout(`${REANIME_BASE}/api/v1/anime/${animeId}`, { headers: HEADERS, timeout: 15_000 });
    if (!res.ok) return null;
    return await res.json() as { anilist_id?: number; mal_id?: number; title?: { english?: string; romaji?: string }; subbed?: number; dubbed?: number; episodes?: number };
  } catch {
    return null;
  }
}

function extractAnilistIdFromCover(cover: any): number | null {
  if (!cover) return null;
  for (const url of [cover.extra_large, cover.large, cover.medium].filter(Boolean)) {
    const m = url.match(/anilist\.co\/.*\/bx(\d+)-/);
    if (m) return Number(m[1]);
  }
  return null;
}

async function resolveReanimeSeries(anilistId: number, title: string): Promise<{ animeId: string; title: string; anilistId: number; malId: number | null; subbed: number | null; dubbed: number | null; episodesCount: number | null } | null> {
  const anizip = await fetchJson<{ mal_id?: number }>(`${ANIZIP_API}?anilist_id=${anilistId}`).catch(() => null);

  const queries = [title, title.split(' ')[0]].filter(Boolean);
  const candidates = new Map<string, any>();

  for (const query of queries) {
    const results = await searchReanime(query);
    for (const r of results) {
      if (r.anime_id && !candidates.has(r.anime_id)) candidates.set(r.anime_id, r);
    }
  }

  for (const [id, r] of candidates) {
    const coverId = extractAnilistIdFromCover(r.cover_image);
    if (coverId && coverId === anilistId) {
      return {
        animeId: id,
        title: r.title?.english || r.title?.romaji || id,
        anilistId,
        malId: null,
        subbed: Number.isFinite(r.subbed) ? r.subbed : null,
        dubbed: Number.isFinite(r.dubbed) ? r.dubbed : null,
        episodesCount: Number.isFinite(r.episodes) ? r.episodes : null,
      };
    }
  }

  const needsDetail = Array.from(candidates.keys()).filter(id => extractAnilistIdFromCover(candidates.get(id)?.cover_image) === null);
  for (const id of needsDetail) {
    const detail = await fetchAnimeDetail(id);
    if (detail?.anilist_id && Number(detail.anilist_id) === anilistId) {
      return {
        animeId: id,
        title: detail.title?.english || detail.title?.romaji || candidates.get(id)?.title?.english || id,
        anilistId,
        malId: detail.mal_id || null,
        subbed: Number.isFinite(detail.subbed) ? detail.subbed : null,
        dubbed: Number.isFinite(detail.dubbed) ? detail.dubbed : null,
        episodesCount: Number.isFinite(detail.episodes) ? detail.episodes : null,
      };
    }
  }

  if (anizip?.mal_id) {
    for (const id of needsDetail) {
      const detail = await fetchAnimeDetail(id);
      if (detail?.mal_id && Number(detail.mal_id) === Number(anizip.mal_id)) {
        return {
          animeId: id,
          title: detail.title?.english || detail.title?.romaji || id,
          anilistId,
          malId: Number(detail.mal_id),
          subbed: Number.isFinite(detail.subbed) ? detail.subbed : null,
          dubbed: Number.isFinite(detail.dubbed) ? detail.dubbed : null,
          episodesCount: Number.isFinite(detail.episodes) ? detail.episodes : null,
        };
      }
    }
  }

  return null;
}

async function fetchEpisodesList(animeId: string): Promise<Array<{ episode_number: number; title?: string; is_filler?: boolean; is_recap?: boolean; duration?: number; thumbnail?: string; aired?: string; description?: string }>> {
  try {
    const res = await fetchWithTimeout(`${REANIME_BASE}/api/v1/anime/${animeId}/episodes?limit=2000`, { headers: HEADERS, timeout: 15_000 });
    if (!res.ok) return [];
    const data = await res.json() as { data?: any[] };
    return Array.isArray(data?.data) ? data.data : [];
  } catch {
    return [];
  }
}

interface FlixcloudTokenResponse {
  success: boolean;
  playlist_key?: string;
  key?: string;
  subtitles?: Array<{ file: string; label: string; lang?: string; default?: boolean }>;
  intro_chapter?: { start: number; end: number };
  outro_chapter?: { start: number; end: number };
  url?: string;
}

async function extractFlixcloudStream(embedUrl: string): Promise<{ url: string; key?: string; playlist_key?: string; subtitles?: Array<{ file: string; label: string; lang?: string; default?: boolean }> } | null> {
  try {
    // Fetch the embed page
    const res = await fetchWithTimeout(embedUrl, {
      headers: { ...HEADERS, Referer: `${REANIME_BASE}/`, Origin: REANIME_BASE },
      timeout: 20_000
    });
    const embedHtml = await res.text().catch(() => '');

    // Extract token from embed page - pattern: token: "xxx" or token='xxx'
    const tokenMatch = embedHtml.match(/token\s*[:=]\s*["']([^"']+)["']/);
    if (!tokenMatch) return null;

    const token = tokenMatch[1];

    // Get token data from flixcloud API
    const tokenRes = await fetchWithTimeout(`${FLIXCLOUD_BASE}/api/token?token=${encodeURIComponent(token)}`, {
      headers: { ...HEADERS, Referer: `${FLIXCLOUD_BASE}/`, Origin: FLIXCLOUD_BASE },
      timeout: 15_000
    });
    const tokenData = await tokenRes.json().catch(() => ({})) as FlixcloudTokenResponse;

    if (!tokenData.success) return null;

    // Get playlist - the m3u8 is base64 encoded and XOR encrypted with playlist_key
    const playlistRes = await fetchWithTimeout(`${FLIXCLOUD_BASE}/api/playlist?token=${encodeURIComponent(token)}`, {
      headers: { ...HEADERS, Referer: `${FLIXCLOUD_BASE}/`, Origin: FLIXCLOUD_BASE },
      timeout: 15_000
    });
    const playlistB64 = await playlistRes.text().catch(() => '');

    if (!playlistB64) return null;

    // Decrypt playlist if we have the key
    let decryptedPlaylist = playlistB64;
    if (tokenData.playlist_key) {
      const decrypted = xorDecryptPlaylist(playlistB64, tokenData.playlist_key);
      if (decrypted) decryptedPlaylist = decrypted;
    }

    // Parse m3u8 for master URL
    const masterMatch = decryptedPlaylist.match(/https?:\/\/[^\s\n]+\.m3u8/);
    const masterUrl = masterMatch?.[0] || tokenData.url;

    if (!masterUrl || !isSafeHttpUrl(masterUrl)) return null;

    const subs = (tokenData.subtitles || []).map(s => ({
      file: s.file,
      label: s.label || s.lang || 'English',
      lang: s.lang,
      default: s.default ?? false,
    })).filter(s => isSafeHttpUrl(s.file));

    return {
      url: masterUrl,
      key: tokenData.key,
      playlist_key: tokenData.playlist_key,
      subtitles: subs,
    };
  } catch {
    return null;
  }
}

async function resolveStreams(animeId: string, anilistId: number, episode: number, audio: 'sub' | 'dub'): Promise<{ streams: RawStream[]; subtitles: RawSubtitle[] }> {
  const streams: RawStream[] = [];
  const subtitles: RawSubtitle[] = [];
  const seenUrls = new Set<string>();

  try {
    // Use /api/flix endpoint which returns the servers directly
    const flixRes = await fetchJson(`${REANIME_BASE}/api/flix/${anilistId}/${episode}`, { headers: HEADERS, timeout: 15_000 });
    const flixData = flixRes as any;

    if (!flixData?.success || !flixData?.servers) {
      // Fallback to /api/watch
      const watchRes = await fetchJson(`${REANIME_BASE}/api/watch/${animeId}/${episode}`, { headers: HEADERS, timeout: 15_000 });
      const watchData = watchRes as any;

      const links = [...(watchData?.episode_links ?? [])];
      if (flixData?.success && flixData?.servers) {
        const seen = new Set(links.map(s => s['$id']));
        for (const s of flixData.servers) {
          if (!seen.has(s['$id'])) links.push(s);
        }
      }

      const audioTypes = audio === 'sub' ? ['sub', 's-sub'] : ['dub', 's-dub'];
      const servers = links.filter((s: any) => audioTypes.includes(s.dataType));

      const priority: Record<string, number> = { 'HD-2': 0, 'HD-1': 1 };
      servers.sort((a: any, b: any) => (priority[a.serverName] ?? 9) - (priority[b.serverName] ?? 9));

      const seenServers = new Set<string>();
      const uniqueServers = servers.filter((s: any) => {
        const key = `${s.serverName}:${s.dataType}:${s.dataLink}`;
        if (seenServers.has(key)) return false;
        seenServers.add(key);
        return true;
      });

      for (const server of uniqueServers) {
        try {
          const extracted = await extractFlixcloudStream(server.dataLink);
          if (!extracted?.url) continue;

          const streamUrl = extracted.url;
          if (!isSafeHttpUrl(streamUrl) || seenUrls.has(streamUrl)) continue;
          seenUrls.add(streamUrl);

          streams.push({
            url: streamUrl,
            format: detectFormat(streamUrl, 'hls') as 'hls' | 'mp4' | 'dash' | 'mkv',
            quality: normalizeQuality('1080p'),
            audio: audio === 'dub' ? 'English' : 'Japanese',
            provider: 'reanime',
            headers: { Referer: FLIXCLOUD_BASE, Origin: FLIXCLOUD_BASE },
          });

          for (const sub of (extracted.subtitles || [])) {
            const langCode = (sub.lang || sub.label || 'en').split(' ')[0].toLowerCase();
            if (!subtitles.some(s => s.language_code === langCode)) {
              subtitles.push({
                url: sub.file,
                language: sub.label,
                language_code: langCode,
                format: 'vtt',
                provider: 'reanime',
              });
            }
          }
        } catch {
          continue;
        }
      }
    } else {
      // Use flixData servers directly
      const audioTypes = audio === 'sub' ? ['sub', 's-sub'] : ['dub', 's-dub'];
      const servers = flixData.servers.filter((s: any) => audioTypes.includes(s.dataType));

      const priority: Record<string, number> = { 'HD-2': 0, 'HD-1': 1 };
      servers.sort((a: any, b: any) => (priority[a.serverName] ?? 9) - (priority[b.serverName] ?? 9));

      const seenServers = new Set<string>();
      const uniqueServers = servers.filter((s: any) => {
        const key = `${s.serverName}:${s.dataType}:${s.dataLink}`;
        if (seenServers.has(key)) return false;
        seenServers.add(key);
        return true;
      });

      for (const server of uniqueServers) {
        try {
          const extracted = await extractFlixcloudStream(server.dataLink);
          if (!extracted?.url) continue;

          const streamUrl = extracted.url;
          if (!isSafeHttpUrl(streamUrl) || seenUrls.has(streamUrl)) continue;
          seenUrls.add(streamUrl);

          streams.push({
            url: streamUrl,
            format: detectFormat(streamUrl, 'hls') as 'hls' | 'mp4' | 'dash' | 'mkv',
            quality: normalizeQuality('1080p'),
            audio: audio === 'dub' ? 'English' : 'Japanese',
            provider: 'reanime',
            headers: { Referer: FLIXCLOUD_BASE, Origin: FLIXCLOUD_BASE },
          });

          for (const sub of (extracted.subtitles || [])) {
            const langCode = (sub.lang || sub.label || 'en').split(' ')[0].toLowerCase();
            if (!subtitles.some(s => s.language_code === langCode)) {
              subtitles.push({
                url: sub.file,
                language: sub.label,
                language_code: langCode,
                format: 'vtt',
                provider: 'reanime',
              });
            }
          }
        } catch {
          continue;
        }
      }
    }
  } catch (error) {
    console.error(`Reanime stream error: ${String(error)}`);
  }

  return { streams, subtitles };
}

export async function getReanimeStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  const streams: RawStream[] = [];

  try {
    const series = await resolveReanimeSeries(input.anilist_id, input.title);
    if (!series) return [];

    if (input.dub && !series.dubbed) return [];
    if (!input.dub && !series.subbed) return [];

    const result = await resolveStreams(series.animeId, input.anilist_id, input.episode, input.dub ? 'dub' : 'sub');
    streams.push(...result.streams);
  } catch (error) {
    console.error(`Reanime error: ${String(error)}`);
  }

  return streams;
}