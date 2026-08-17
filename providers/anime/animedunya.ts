import { attachSubtitles } from '../normalizer.js';
import { dedupeStreams, dedupeSubtitles, fetchText, getAniListMedia, safeStream, safeSubtitle } from './anivexa-utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from '../shared/types.js';

const BASE = 'https://anime-dunya.com';

function extractStream(html: string): any | null {
  const match = html.match(/\\?"stream\\?"\s*:\s*/);
  if (!match || match.index === undefined) return null;
  let depth = 0;
  let started = false;
  let result = '';
  for (let i = match.index + match[0].length; i < html.length; i++) {
    const char = html[i];
    if (char === '{') { depth++; started = true; }
    else if (char === '}') depth--;
    if (started) {
      result += char;
      if (depth === 0) break;
    }
  }
  try {
    return JSON.parse(result.replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  } catch {
    const source = html.match(/"source"\s*:\s*"([^"]+)"/)?.[1];
    return source ? { source: source.replace(/\\/g, '') } : null;
  }
}

export async function getAnimedunyaStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  if (input.dub) return [];
  const media = await getAniListMedia(input.anilist_id);
  const malId = media?.idMal;
  if (!malId) return [];
  const html = await fetchText(`${BASE}/en/play/${malId}/${input.episode}`, {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
    Referer: `${BASE}/en/anime/${malId}`,
  });
  const streamData = extractStream(html);
  if (!streamData?.source) return [];

  const subtitles: RawSubtitle[] = (Array.isArray(streamData.subtitles) ? streamData.subtitles : [])
    .map((value: any) => safeSubtitle({ url: value.src, label: value.label, srclang: value.srclang }, 'animedunya'))
    .filter(Boolean) as RawSubtitle[];
  const stream = safeStream({ url: streamData.source, type: 'hls', quality: 'auto' }, 'animedunya', 'Japanese', 'hls', { Referer: `${BASE}/` });
  return attachSubtitles(stream ? dedupeStreams([stream]) : [], dedupeSubtitles(subtitles));
}
