import { attachSubtitles } from '../normalizer.js';
import { bestTitleScore, decodeEntities, dedupeStreams, fetchText, getAniListMedia, safeStream, buildTitles } from './anivexa-utils.js';
import type { AnimeProviderInput, RawStream } from '../shared/types.js';

const BASE = 'https://anineko.to';

async function search(query: string): Promise<Array<{ slug: string; text: string }>> {
  const html = await fetchText(`${BASE}/browser?keyword=${encodeURIComponent(query)}`, { Referer: `${BASE}/` });
  const results: Array<{ slug: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*class=["'][^"']*nv-anime-thumb[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const block = match[0];
    const tag = block.match(/<a\b[^>]*>/i)?.[0] ?? '';
    const slug = tag.match(/href=["'][^"']*\/watch\/([^/?#]+)["']/i)?.[1];
    if (!slug) continue;
    const title = block.match(/<(?:h3|[^>]+class=["'][^"']*nv-anime-title[^"']*["'][^>]*)>([\s\S]*?)<\/(?:h3|[^>]+)>/i)?.[1];
    results.push({ slug, text: title ? title.replace(/<[^>]*>/g, ' ').trim() : slug.replace(/-/g, ' ') });
  }
  return results;
}

async function findShow(input: AnimeProviderInput, media: any): Promise<string> {
  const titles = buildTitles(media, input).slice(0, 5);
  const candidates = new Map<string, { slug: string; text: string }>();
  for (const term of titles) {
    for (const candidate of await search(term).catch(() => [])) candidates.set(candidate.slug, candidate);
  }
  const chosen = [...candidates.values()].sort((a, b) => bestTitleScore(b.text, titles) - bestTitleScore(a.text, titles))[0];
  if (!chosen || bestTitleScore(chosen.text, titles) < 0.55) throw new Error('AniNeko show not found');
  return chosen.slug;
}

async function extractHls(embedUrl: string): Promise<string | null> {
  const html = await fetchText(embedUrl, { Referer: `${BASE}/` }).catch(() => '');
  for (const pattern of [
    /const\s+src\s*=\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\/master\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
  ]) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return null;
}

async function scrapeEpisodeWatch(seriesSlug: string, episode: number, audio: 'sub' | 'dub'): Promise<RawStream[]> {
  const episodeUrl = `${BASE}/watch/${seriesSlug}/ep-${episode}`;
  const html = await fetchText(episodeUrl, { Referer: `${BASE}/watch/${seriesSlug}` });
  const embeds: string[] = [];
  for (const panel of html.matchAll(/<div\b[^>]*class=["'][^"']*nv-server-grid[^"']*["'][^>]*data-id=["']([^"']+)["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*nv-server-grid|$)/gi)) {
    const panelAudio = panel[1].toLowerCase().includes('dub') ? 'dub' : 'sub';
    if (panelAudio !== audio) continue;
    for (const button of panel[2].matchAll(/data-video=["']([^"']+)["']/gi)) embeds.push(decodeEntities(button[1]));
  }
  const streams: RawStream[] = [];
  for (const embed of embeds) {
    const hls = await extractHls(embed);
    if (!hls) continue;
    const stream = safeStream({ url: hls, type: 'hls', quality: 'auto' }, 'anineko', audio === 'dub' ? 'English' : 'Japanese', 'hls', { Referer: `${new URL(embed).origin}/` });
    if (stream) streams.push(stream);
  }
  return dedupeStreams(streams);
}

export async function getAninekoStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    const media = await getAniListMedia(input.anilist_id);
    if (!media) return [];
    const slug = await findShow(input, media);
    return attachSubtitles(await scrapeEpisodeWatch(slug, input.episode, input.dub ? 'dub' : 'sub'), []);
  } catch {
    return [];
  }
}
