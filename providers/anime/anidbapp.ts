import { attachSubtitles } from '../normalizer.js';
import { buildTitles, decodeEntities, dedupeStreams, fetchJson, fetchText, getAniListMedia, safeStream, attr, stripTags } from './anivexa-utils.js';
import type { AnimeProviderInput, RawStream } from '../shared/types.js';

const BASE = 'https://anidb.app';
const XHR = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json,text/html,*/*;q=0.8' };

async function search(query: string): Promise<any[]> {
  const html = await fetchText(`${BASE}/search/suggestions?q=${encodeURIComponent(query)}`, { ...XHR, Referer: `${BASE}/home` }).catch(() => '');
  const results: any[] = [];
  for (const match of html.matchAll(/<a\b[^>]*data-search-item[^>]*>[\s\S]*?<\/a>/gi)) {
    const block = match[0];
    const tag = block.match(/<a\b[^>]*>/i)?.[0] ?? '';
    const href = attr(tag, 'href');
    const path = href.startsWith('http') ? new URL(href).pathname : href;
    const slug = path.match(/^\/anime\/([^/?#]+)/)?.[1];
    if (!slug) continue;
    results.push({ slug, title: stripTags(block.match(/<p\b[^>]*class=["'][^"']*text-sm[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ''), siteId: Number(slug.match(/-(\d+)$/)?.[1]) });
  }
  if (results.length) return results;
  const browse = await fetchText(`${BASE}/browse?q=${encodeURIComponent(query)}`, { Referer: `${BASE}/home` }).catch(() => '');
  for (const match of browse.matchAll(/<a\b[^>]*href=["'](?:https:\/\/anidb\.app)?\/anime\/([^"']+)["'][^>]*class=["'][^"']*\banime-card\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const slug = match[1];
    results.push({ slug, title: stripTags(match[0].match(/title=["']([^"']+)["']/i)?.[1] ?? slug.replace(/-/g, ' ')), siteId: Number(slug.match(/-(\d+)$/)?.[1]) });
  }
  return results;
}

function externalIds(html: string): { anilistId: number | null; malId: number | null } {
  return {
    anilistId: Number(html.match(/https:\/\/anilist\.co\/anime\/(\d+)/i)?.[1]) || null,
    malId: Number(html.match(/https:\/\/myanimelist\.net\/anime\/(\d+)/i)?.[1]) || null,
  };
}

async function resolveSeries(input: AnimeProviderInput, media: any): Promise<{ slug: string; siteId: number }> {
  const titles = buildTitles(media, input).slice(0, 5);
  const candidates = new Map<string, any>();
  for (const title of titles) for (const candidate of await search(title).catch(() => [])) candidates.set(candidate.slug, candidate);
  for (const candidate of candidates.values()) {
    const html = await fetchText(`${BASE}/anime/${candidate.slug}`, { Referer: `${BASE}/home` }).catch(() => '');
    if (!html) continue;
    const ids = externalIds(html);
    if (ids.anilistId === input.anilist_id || (!ids.anilistId && ids.malId && ids.malId === media?.idMal)) {
      return { slug: candidate.slug, siteId: candidate.siteId || Number(candidate.slug.match(/-(\d+)$/)?.[1]) };
    }
  }
  throw new Error('AniDB.app match not found');
}

function languageForAudio(languages: any[], audio: 'sub' | 'dub'): any | null {
  const preferred = audio === 'sub' ? ['jpn', 'ja', 'japanese'] : ['eng', 'en', 'english'];
  return languages.find((value) => preferred.includes(String(value?.code ?? '').toLowerCase()))
    ?? languages.find((value) => preferred.includes(String(value?.name ?? '').toLowerCase()))
    ?? null;
}

function extractHls(html: string): string | null {
  for (const pattern of [
    /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /sources\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\/master\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
  ]) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return null;
}

export async function getAnidbappStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    const media = await getAniListMedia(input.anilist_id);
    if (!media) return [];
    const series = await resolveSeries(input, media);
    const episodes = await fetchJson<any>(`${BASE}/api/frontend/anime/${series.siteId}/episodes`, { Referer: `${BASE}/anime/${series.siteId}` });
    const episode = (Array.isArray(episodes?.episodes) ? episodes.episodes : []).find((value: any) => Number(value.number) === Number(input.episode));
    if (!episode?.id) return [];
    const languages = await fetchJson<any>(`${BASE}/api/frontend/episode/${episode.id}/languages`, { Referer: `${BASE}/anime/${series.slug}` }).catch(() => null);
    const language = languageForAudio(Array.isArray(languages?.languages) ? languages.languages : [], input.dub ? 'dub' : 'sub');
    if (!language?.embed_url) return [];
    const embedUrl = decodeEntities(String(language.embed_url));
    const html = await fetchText(embedUrl, { Referer: `${BASE}/` }).catch(() => '');
    const hls = extractHls(html);
    if (!hls) return [];
    const stream = safeStream({ url: hls, type: 'hls', quality: 'auto' }, 'anidbapp', input.dub ? 'English' : 'Japanese', 'hls', { Referer: `${new URL(embedUrl).origin}/` });
    return attachSubtitles(stream ? dedupeStreams([stream]) : [], []);
  } catch {
    return [];
  }
}
