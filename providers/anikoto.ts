import { fetchJson, fetchWithTimeout } from './internal/http.js';
import { isSafeHttpUrl, detectFormat, normalizeQuality } from './internal/utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle, ProviderId } from './internal/types.js';

interface AnikotoEpisode {
  number: number;
  ids: string;
  hasSub: boolean;
  hasDub: boolean;
  malId: number | null;
  slug: string;
  timestamp: string;
  title: string;
}

const ANIKOTO_DOMAIN = 'https://anikototv.bz';
const NEXABLOOM_DOMAIN = 'https://fetch.nexabloom.top';
const REFERER = 'https://megaplay.buzz/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface EmbedStream {
  url: string;
  quality?: string;
  label?: string;
  resolution?: string;
  type?: string;
}

interface ExtractedData {
  sources?: EmbedStream[];
  tracks?: { file: string; label: string; default?: boolean; lang?: string }[];
  intro?: { start: number; end: number };
  outro?: { start: number; end: number };
  origin?: string;
}

// Check if URL contains base64-encoded m3u8
function isBase64M3u8(url: string): boolean {
  return url.includes('#aHR0c') && url.split('#')[1].length > 10;
}

// Decode base64 encoded m3u8 URL
function decodeBase64M3u8(url: string): string | null {
  try {
    const encoded = url.split('#')[1];
    if (!encoded) return null;
    return atob(encoded);
  } catch {
    return null;
  }
}

// Detect stream format from URL
function detectFormatFromUrl(url: string): 'mp4' | 'hls' | 'unknown' {
  if (url.includes('.m3u8')) return 'hls';
  if (url.includes('.mp4') || url.includes('.mp4?')) return 'mp4';
  return 'unknown';
}

// Detect subtitle format from URL
function detectSubtitleFormat(url: string): 'vtt' | 'srt' {
  if (url.toLowerCase().includes('.srt')) return 'srt';
  return 'vtt';
}

export async function getAnikotoStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  const streams: RawStream[] = [];
  const subtitles: RawSubtitle[] = [];
  const seenStreams = new Set<string>();
  const seenSubtitles = new Set<string>();

  try {
    // Search for the anime on anikoto - note domain is .bz
    const searchResponse = await fetchWithTimeout(
      `${ANIKOTO_DOMAIN}/filter?keyword=${encodeURIComponent(input.title)}`,
      {
        headers: {
          Referer: REFERER,
          'User-Agent': UA,
        },
        timeout: 15_000,
      }
    );
    const searchHtml = await searchResponse.text()
      .catch(() => '');
    const searchHtmlClean = searchHtml.replace(/\r?\n|\r/g, ' ');

    if (!searchHtmlClean) {
      return [];
    }

    // Extract candidate shows using the selector - watch for .bz domain
    const candidateRegex = /<a\s+class="name d-title"\s+href="https:\/\/anikototv\.bz\/watch\/([^"]+)"/g;
    const candidates: { slug: string; title: string }[] = [];

    let match: RegExpExecArray | null;
    while ((match = candidateRegex.exec(searchHtmlClean)) !== null) {
      const slug = match[1];
      const titles = searchHtmlClean.slice(match.index!, match.index! + 500)
        .match(/data-jp="([^"]*)"[^>]*>([^<]*)<\/a>/);
      const title = titles?.[2]?.replace(/<[^>]*>/g, '').trim() || slug;
      if (!candidates.some(c => c.slug === slug)) {
        candidates.push({ slug, title });
      }
    }

    if (candidates.length === 0) {
      return [];
    }

    // Inspect first candidate to get episode list
    const watchResponse = await fetchWithTimeout(
      `${ANIKOTO_DOMAIN}/watch/${candidates[0].slug}`,
      {
        headers: {
          Referer: REFERER,
          'User-Agent': UA,
        },
        timeout: 15_000,
      }
    );
    const watchHtml = await watchResponse.text()
      .catch(() => '');

    const showIdMatch = watchHtml.match(/data-id="(\d+)"/);
    if (!showIdMatch) {
      return [];
    }
    const showId = showIdMatch[1];

    // Get episode list from AJAX endpoint
    const episodesResponse = await fetchJson(
      `${ANIKOTO_DOMAIN}/ajax/episode/list/${showId}`,
      {
        headers: {
          Referer: `${ANIKOTO_DOMAIN}/watch/${candidates[0].slug}`,
        },
        timeout: 15_000,
      }
    );

    const episodesResponseData = episodesResponse as { result?: string } | null;
    const episodesData = episodesResponseData?.result;
    if (!episodesData || typeof episodesData !== 'string') {
      return [];
    }

    const episodeRegex = /<a\s+[^>]*data-id="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    const episodeRows: RegExpMatchArray[] = [];
    let episodeMatch: RegExpExecArray | null;
    while ((episodeMatch = episodeRegex.exec(episodesData)) !== null) {
      episodeRows.push(episodeMatch);
    }

    // Find the target episode
    let targetEpisode: AnikotoEpisode | null = null;
    for (const row of episodeRows) {
      const tag = row[0];
      const numStr = tag.match(/data-num="(\d+)"/)?.[1] || '0';
      const num = parseInt(numStr, 10);
      if (num !== input.episode) continue;

      const titleMatch = tag.match(/<span\s+class="d-title"[^>]*>([^<]*)<\/span>/i);
      const title = titleMatch?.[1]?.replace(/<[^>]*>/g, '').trim() || `Episode ${num}`;

      const getAttr = (name: string) => tag.match(/data-${name}="([^"]*)"/)?.[1] || '';
      const ids = getAttr('ids');
      const hasSub = getAttr('sub') === '1';
      const hasDub = getAttr('dub') === '1';
      const malId = Number(getAttr('mal')) || null;
      const slug = getAttr('slug');
      const timestamp = getAttr('timestamp');

      if ((input.dub && hasDub) || (!input.dub && hasSub)) {
        targetEpisode = { number: num, ids, hasSub, hasDub, malId, slug, timestamp, title };
      }
      if (targetEpisode) break;
    }

    if (!targetEpisode) {
      return [];
    }

    // Get server list
    const serverResponse = await fetchJson(
      `${ANIKOTO_DOMAIN}/ajax/server/list?servers=${encodeURIComponent(targetEpisode.ids)}`,
      {
        headers: {
          Referer: `${ANIKOTO_DOMAIN}/`,
        },
        timeout: 15_000,
      }
    );

    const serverResponseData = serverResponse as { result?: string } | null;
    const serverHtml = serverResponseData?.result;
    if (!serverHtml || typeof serverHtml !== 'string') {
      return [];
    }

    // Parse server items (download and stream)
    const typeRegex = /<div\s+class="type"\s+data-type="([^"]+)">([^<]*<\/ul>\s*<\/div>)/g;
    const serverTypeRegex = /<li\s+([^>]*data-link-id[^>]*)>([^<]*)<\/li>/g;

    let typeMatch: RegExpExecArray | null;
    while ((typeMatch = typeRegex.exec(serverHtml)) !== null) {
      const typeName = typeMatch[1];
      const typeItemsHtml = typeMatch[2];
      const typeItemsString = typeItemsHtml.replace(/\r?\n|\r/g, ' ');

      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = serverTypeRegex.exec(typeItemsString)) !== null) {
        const tag = itemMatch[0];
        const linkId = tag.match(/data-link-id="([^"]*)"/)?.[1] || '';

        let serverName = itemMatch[2]?.replace(/<[^>]+>/g, '').trim() || '';
        if (!serverName) continue;

        // Skip download items if we only want streaming
        const isDownload = typeName === 'dl' ||
          serverName.toLowerCase().includes('download') ||
          serverName.toLowerCase().includes('kiwi');
        if (isDownload) continue;

        // Resolve stream URL
        let hlsSources: string[] = [];

        // Check for base64 encoded m3u8
        if (linkId.includes('#aHR0c')) {
          const decoded = decodeBase64M3u8(linkId);
          if (decoded) {
            hlsSources.push(decoded);
          }
        }

        // Fetch and extract HLS sources if needed
        if (hlsSources.length === 0 && linkId && !linkId.startsWith('http')) {
          try {
            const resolvedResponse = await fetchJson(
              `${ANIKOTO_DOMAIN}/ajax/server?get=${encodeURIComponent(linkId)}`,
              {
                headers: {
                  Referer: `${ANIKOTO_DOMAIN}/`,
                },
                timeout: 15_000,
              }
            );

            const resolvedData = resolvedResponse as { result?: { url?: string } };
            const resolvedUrl = resolvedData?.result?.url;
            if (resolvedUrl) {
              if (resolvedUrl.includes('#aHR0c')) {
                const decoded = decodeBase64M3u8(resolvedUrl);
                if (decoded) hlsSources.push(decoded);
              } else {
                hlsSources.push(resolvedUrl);
              }
            }
          } catch {
            // Continue to next server
          }
        }

        // Create stream from HLS sources
        for (const hlsUrl of hlsSources) {
          const streamKey = `${hlsUrl}:${input.dub ? 'dub' : 'sub'}`;
          if (seenStreams.has(streamKey)) continue;
          seenStreams.add(streamKey);

          const existingIndex = streams.findIndex(s => s.url === hlsUrl);
          if (existingIndex !== -1) {
            // Merge with existing stream
            streams[existingIndex].provider = 'anikoto';
            streams[existingIndex].audio = input.dub ? 'Dub' : 'Original';
          } else {
            streams.push({
              url: hlsUrl,
              format: detectFormatFromUrl(hlsUrl) as 'hls',
              quality: '1080p',
              audio: input.dub ? 'Dub' : 'Original',
              provider: 'anikoto',
            });
          }
        }
      }
    }

    // Handle fallback embed URL
    if (streams.length === 0 && targetEpisode.ids) {
      try {
        const fallbackResponse = await fetchJson(
          `${ANIKOTO_DOMAIN}/ajax/server?get=${encodeURIComponent(targetEpisode.ids)}`,
          {
            headers: {
              Referer: `${ANIKOTO_DOMAIN}/`,
            },
            timeout: 15_000,
          }
        );

        const fallbackData = fallbackResponse as { result?: { url?: string } };
        const fallbackUrl = fallbackData?.result?.url;
        if (fallbackUrl && isSafeHttpUrl(fallbackUrl)) {
          const format = detectFormatFromUrl(fallbackUrl);
          streams.push({
            url: fallbackUrl,
            format: format as 'hls' | 'mp4',
            quality: '1080p',
            audio: input.dub ? 'Dub' : 'Original',
            provider: 'anikoto',
          });
        }
      } catch {
        // Silently continue
      }
    }

  } catch (error) {
    console.error(`Anikoto error: ${String(error)}`);
  }

  return streams;
}