import { attachSubtitles } from '../normalizer.js';
import { bestTitleScore, decodeEntities, dedupeStreams, fetchText, getAniListMedia, safeStream, buildTitles, stripTags, attr } from './anivexa-utils.js';
import type { AnimeProviderInput, RawStream } from '../shared/types.js';

const BASE = 'https://www.animegg.org';

type Episode = { number: number; title: string; epSlug: string; hasSub: boolean; hasDub: boolean };

async function search(query: string): Promise<Array<{ slug: string; text: string }>> {
  const html = await fetchText(`${BASE}/search/?q=${encodeURIComponent(query)}`);
  const results: Array<{ slug: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*class=["'][^"']*\bmse\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const block = match[0];
    const tag = block.match(/<a\b[^>]*>/i)?.[0] ?? '';
    const href = attr(tag, 'href');
    const slug = href.match(/^\/series\/([^/?#]+)/)?.[1];
    if (!slug) continue;
    const strong = block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1];
    results.push({ slug, text: strong ? stripTags(strong) : slug.replace(/-/g, ' ') });
  }
  return results;
}

async function findShow(input: AnimeProviderInput, media: any): Promise<string> {
  const titles = buildTitles(media, input).slice(0, 5);
  const candidates = new Map<string, { slug: string; text: string }>();
  for (const term of titles) {
    for (const candidate of await search(term).catch(() => [])) candidates.set(candidate.slug, candidate);
    const compact = term.split(/\s+/)[0].replace(/[^a-z0-9]/gi, '');
    if (compact.length >= 4 && compact.toLowerCase() !== term.toLowerCase()) {
      for (const candidate of await search(compact).catch(() => [])) candidates.set(candidate.slug, candidate);
    }
  }
  const chosen = [...candidates.values()].sort((a, b) => bestTitleScore(b.text, titles) - bestTitleScore(a.text, titles))[0];
  if (!chosen || bestTitleScore(chosen.text, titles) < 0.55) throw new Error('AnimeGG show not found');
  return chosen.slug;
}

async function scrapeSeries(slug: string): Promise<Episode[]> {
  const html = await fetchText(`${BASE}/series/${slug}`);
  const episodes: Episode[] = [];
  for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = match[1];
    if (!/\banm_det_pop\b/.test(block)) continue;
    const link = block.match(/<a\b[^>]*class=["'][^"']*anm_det_pop[^"']*["'][^>]*>/i)?.[0] ?? '';
    const href = attr(link, 'href').replace(/#.*$/, '').replace(/^\//, '');
    const strong = stripTags(block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '');
    const number = Number(strong.match(/(?:\d+-)?(\d+)\s*$/)?.[1]);
    if (!Number.isFinite(number) || !href) continue;
    const title = stripTags(block.match(/<i\b[^>]*class=["'][^"']*anititle[^"']*["'][^>]*>([\s\S]*?)<\/i>/i)?.[1] ?? '') || strong;
    const badges = [...block.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((value) => stripTags(value[1]).toLowerCase());
    episodes.push({ number, title, epSlug: href, hasSub: badges.includes('subbed'), hasDub: badges.includes('dubbed') });
  }
  const seen = new Set<number>();
  return episodes.sort((a, b) => a.number - b.number).filter((episode) => seen.has(episode.number) ? false : (seen.add(episode.number), true));
}

async function scrapeEmbed(embedId: string): Promise<Array<{ url: string; quality: string }>> {
  const html = await fetchText(`${BASE}/embed/${embedId}`, { Referer: BASE });
  const sourceText = html.match(/var\s+videoSources\s*=\s*(\[[\s\S]*?\]);/)?.[1];
  if (!sourceText) return [];
  let parsed: any[] = [];
  try {
    parsed = JSON.parse(sourceText.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":').replace(/:\s*'([^']*)'/g, ': "$1"'));
  } catch {
    return [];
  }
  return parsed.map((source) => ({
    url: source.file ? (String(source.file).startsWith('http') ? String(source.file) : `${BASE}${source.file}`) : '',
    quality: String(source.label ?? 'auto'),
  })).filter((source) => source.url);
}

async function scrapeEpisodeWatch(epSlug: string, audio: 'sub' | 'dub'): Promise<RawStream[]> {
  const html = await fetchText(`${BASE}/${epSlug}`, { Referer: BASE });
  const tabs: Array<{ id: string; server: string; audio: 'sub' | 'dub' }> = [];
  for (const match of html.matchAll(/<a\b[^>]*data-toggle=["']tab["'][^>]*>/gi)) {
    const tag = match[0];
    const id = attr(tag, 'data-id');
    if (!id) continue;
    const version = attr(tag, 'data-version') || 'subbed';
    const normalized = version.startsWith('dub') ? 'dub' : 'sub';
    if (normalized === audio) tabs.push({ id, server: attr(tag, 'data-mirror') || 'AnimeGG', audio: normalized });
  }
  const streams: RawStream[] = [];
  for (const tab of tabs) {
    for (const source of await scrapeEmbed(tab.id).catch(() => [])) {
      const stream = safeStream({ url: decodeEntities(source.url), quality: source.quality, type: source.url.includes('.m3u8') ? 'hls' : 'mp4' }, 'animegg', audio === 'dub' ? 'English' : 'Japanese');
      if (stream) streams.push(stream);
    }
  }
  return dedupeStreams(streams);
}

export async function getAnimeggStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    const media = await getAniListMedia(input.anilist_id);
    if (!media) return [];
    const slug = await findShow(input, media);
    const episodes = await scrapeSeries(slug);
    const episode = episodes.find((value) => value.number === Number(input.episode));
    if (!episode) return [];
    return attachSubtitles(await scrapeEpisodeWatch(episode.epSlug, input.dub ? 'dub' : 'sub'), []);
  } catch {
    return [];
  }
}
