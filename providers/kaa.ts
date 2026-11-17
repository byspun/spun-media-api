import { attachSubtitles } from './internal/normalizer.js';
import { bestTitleScore, dedupeStreams, safeStream, buildTitles, diceCoeff } from './internal/utils.js';
import { fetchJsonOrThrow, getAniListMedia } from './internal/http.js';
import type { AnimeProviderInput, RawStream } from './internal/types.js';

const BASE = 'https://kaa.lt';
const HLS_BASE = 'https://hls.krussdomi.com/manifest';
const KAA_REFERER = 'https://kaa.lt/';
const HLS_REFERER = 'https://krussdomi.com/';

// Map a kaa `ln=` locale tag (e.g. "ja-JP", "en-US") to the audio label exposed on a RawStream.
// kaa's CDN declares each server's language via the `ln=` query param on its player `src`
// (e.g. "...&ln=ja-JP"). When that param is present it is authoritative; otherwise we fall
// back to the dub/sub flag from the input.
function audioLabel(ln: string | null, dub: boolean): string {
  const locale = String(ln ?? '').toLowerCase();
  if (locale.startsWith('en')) return 'English';
  if (locale.startsWith('ja')) return 'Japanese';
  return dub ? 'English' : 'Japanese';
}

async function search(query: string): Promise<any[]> {
  const response = await fetch(`${BASE}/api/fsearch`, {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'Content-Type': 'application/json', Referer: KAA_REFERER },
    body: JSON.stringify({ page: 1, query }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`KAA search upstream ${response.status}`);
  const data = await response.json() as any;
  return Array.isArray(data?.result) ? data.result : [];
}

async function showInfo(slug: string): Promise<any> {
  return fetchJsonOrThrow<any>(`${BASE}/api/show/${encodeURIComponent(slug)}`, { headers: { Referer: KAA_REFERER } } as any);
}

async function episodePage(slug: string, episode: number): Promise<any> {
  return fetchJsonOrThrow<any>(`${BASE}/api/show/${encodeURIComponent(slug)}/episodes?ep=${episode}&lang=ja-JP`, { headers: { Referer: KAA_REFERER } } as any);
}

async function allEpisodes(slug: string): Promise<any[]> {
  const first = await episodePage(slug, 1);
  const all = Array.isArray(first?.result) ? [...first.result] : [];
  const pages = Array.isArray(first?.pages) ? first.pages : [];
  const rest = await Promise.all(pages.slice(1).map(async (page: any) => {
    const firstEpisode = page?.eps?.[0];
    return firstEpisode
      ? episodePage(slug, Number(firstEpisode)).then((value) => Array.isArray(value?.result) ? value.result : []).catch(() => [])
      : [];
  }));
  return all.concat(...rest);
}

function scoreCandidate(candidate: any, titles: string[], seasonYear: number | null, format: string | null): number {
  const titleScore = Math.max(...titles.map((title) => Math.max(diceCoeff(title, candidate.title_en ?? ''), diceCoeff(title, candidate.title ?? ''))), 0);
  const candidateYear = Number(candidate.year);
  const yearMultiplier = seasonYear && candidateYear
    ? Math.abs(seasonYear - candidateYear) === 0 ? 1.2 : Math.abs(seasonYear - candidateYear) === 1 ? 0.8 : 0.5
    : 1;
  const candidateType = String(candidate.type ?? '').toLowerCase();
  const formatValue = String(format ?? '').toUpperCase();
  const typeMultiplier = formatValue === 'MOVIE' && candidateType !== 'movie' ? 0.25
    : formatValue !== 'MOVIE' && candidateType === 'movie' ? 0.25
      : 1;
  return Math.min(1, titleScore * yearMultiplier) * typeMultiplier;
}

async function resolveSeries(input: AnimeProviderInput, media: any): Promise<{ slug: string; locales: string[] }> {
  const titles = buildTitles(media, input).slice(0, 4).filter((title) => !/[\u3000-\u9fff\u3040-\u30ff]/.test(title));
  const candidates = new Map<string, any>();
  for (const title of titles) {
    const clean = title.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const results = await search(clean).catch(() => []);
    for (const result of results) if (result?.slug) candidates.set(String(result.slug), result);
  }
  const ranked = [...candidates.values()]
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, titles, Number(media?.seasonYear) || null, media?.format) }))
    .filter((value) => value.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 0.6) throw new Error('KAA match not found');
  const selected = ranked[0].candidate;
  const info = await showInfo(String(selected.slug));
  return { slug: String(selected.slug), locales: Array.isArray(info?.locales) ? info.locales : (Array.isArray(selected.locales) ? selected.locales : []) };
}

export async function getKaaStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    const media = await getAniListMedia(input.anilist_id);
    if (!media) return [];
    const series = await resolveSeries(input, media);
    if (input.dub && !series.locales.includes('en-US')) return [];
    const episodes = await allEpisodes(series.slug);
    const episode = episodes.find((value: any) => Number(value.episode_number) === Number(input.episode));
    if (!episode?.slug) return [];
    const fullSlug = `ep-${input.episode}-${episode.slug}`;
    const episodeData = await fetchJsonOrThrow<any>(`${BASE}/api/show/${encodeURIComponent(series.slug)}/episode/${encodeURIComponent(fullSlug)}`, { headers: { Referer: KAA_REFERER } } as any);
    const streams: RawStream[] = [];
    for (const server of Array.isArray(episodeData?.servers) ? episodeData.servers : []) {
      const source = String(server?.src ?? '');
      const id = source.match(/[?&]id=([^&]+)/)?.[1];
      if (!id) continue;
      const ln = source.match(/[?&]ln=([^&]+)/)?.[1] ?? null;
      const audio = audioLabel(ln, input.dub);
      // When the server declares its own language, only keep servers matching the requested audio.
      // (Without a declared language the server is treated as generic and always kept.)
      if (ln && audio !== (input.dub ? 'English' : 'Japanese')) continue;
      const stream = safeStream({ url: `${HLS_BASE}/${id}/master.m3u8`, type: 'hls', quality: 'auto' }, 'kaa', audio, 'hls', { Referer: KAA_REFERER });
      if (stream) streams.push(stream);
    }
    return attachSubtitles(dedupeStreams(streams), []);
  } catch {
    return [];
  }
}
