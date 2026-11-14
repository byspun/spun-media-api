import { fetchJson, fetchWithTimeout } from './internal/http.js';
import { isSafeHttpUrl, detectFormat, normalizeQuality } from './internal/utils.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from './internal/types.js';

const ANIZONE_BASE = 'https://anizone.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

async function request(url: string, options: RequestInit = {}): Promise<{ raw: string; cookies: string[] }> {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      ...options.headers,
    },
    timeout: 15_000,
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`AniZone HTTP ${response.status}: ${url}`);
  }
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean) as string[];
  return { raw, cookies };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeJsonArgument(raw: string | null): any {
  if (!raw) return null;
  const marker = '\x01U\x01';
  let value = String(raw).replace(/\\\\u([0-9a-fA-F]{4})/g, `${marker}$1`);
  value = value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  value = value.replace(/\x01U\x01([0-9a-fA-F]{4})/g, '\\u$1');
  try { return JSON.parse(value); } catch { return null; }
}

function jsonArgument(html: string, name: string): any {
  const pattern = new RegExp(`${escapeRegex(name)}\\s*:\\s*JSON\\.parse\\('((?:[^'\\\\]|\\\\.)*)'\\)`, 'i');
  return decodeJsonArgument(String(html).match(pattern)?.[1]);
}

function playerData(html: string): any {
  const match = String(html).match(/vidstackPlayer\s*\(\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)\s*\)/i);
  return decodeJsonArgument(match?.[1]);
}

function mergeCookies(jar: Map<string, string>, values: string[]): Map<string, string> {
  for (const value of values) {
    const match = String(value).match(/^\s*([^=;\s]+)=([^;]*)/);
    if (match) jar.set(match[1], match[2]);
  }
  return jar;
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function pickTitle(titles: Record<string, string>): string {
  return titles?.['1'] || titles?.['5'] || titles?.['8'] || Object.values(titles || {})[0] || '';
}

function titleValues(item: any): string[] {
  return [...new Set([item?.main_title, ...Object.values(item?.title_list || {})].filter(Boolean))];
}

function formatName(value: string): string {
  const type = String(value || '').toLowerCase();
  if (type.includes('special')) return 'special';
  if (type.includes('movie')) return 'movie';
  if (type.includes('ova')) return 'ova';
  if (type.includes('web') || type.includes('ona')) return 'ona';
  if (type.includes('tv')) return 'tv';
  return '';
}

function expectedFormat(value: string): string {
  const format = String(value || '').toUpperCase();
  if (format === 'TV' || format === 'TV_SHORT') return 'tv';
  if (format === 'MOVIE') return 'movie';
  if (format === 'OVA') return 'ova';
  if (format === 'ONA') return 'ona';
  if (format === 'SPECIAL') return 'special';
  return '';
}

function searchQueries(titles: string[]): string[] {
  const queries = new Set<string>();
  for (const title of titles) {
    if (!title.trim()) continue;
    queries.add(title.trim());
    queries.add(title.trim().replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return Array.from(queries).slice(0, 18);
}

function parseSearchItems(html: string): Array<{ slug: string; title: string; titles: string[]; type: string; year: number | null; episodeCount: number }> {
  const items = jsonArgument(html, 'items');
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => /^[a-z0-9-]+$/i.test(String(item?.slug || '')))
    .map(item => ({
      slug: String(item.slug),
      title: pickTitle(item.title_list) || item.main_title || '',
      titles: titleValues(item),
      type: formatName(item.type),
      year: Number(item.start_year) || null,
      episodeCount: Number(item.episode_count) || 0,
    }))
    .filter(item => item.title);
}

async function searchAniZone(query: string): Promise<Array<{ slug: string; title: string; titles: string[]; type: string; year: number | null; episodeCount: number }>> {
  const { raw } = await request(`${ANIZONE_BASE}/anime?search=${encodeURIComponent(query)}`);
  return parseSearchItems(raw);
}

function candidateTitleScore(titles: string[], candidate: { titles: string[]; slug: string }): number {
  const values = [...candidate.titles, candidate.slug.replace(/-/g, ' ')];
  return Math.max(...titles.map(t => Math.max(...values.map(v => {
    const normT = t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const normV = v.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    if (!normT || !normV) return 0;
    if (normT === normV) return 1;
    if (normT.includes(normV) || normV.includes(normT)) return 0.5;
    return 0;
  }))));
}

function coverageScore(candidate: { episodeCount: number }, expected: number, status: string): number {
  if (!expected || expected < 1) return 0.5;
  if (candidate.episodeCount < 1) return 0;
  if (status !== 'FINISHED') return 1;
  if (expected < 6) return 1;
  const needed = Math.ceil(expected * 0.8);
  return Math.min(1, candidate.episodeCount / needed);
}

function ordinal(value: string): number {
  const match = String(value || '').toLowerCase().match(/\b(?:part|special|chapter)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!match) return 0;
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return Number(match[1]) || words[match[1]] || 0;
}

function validateCandidate(candidate: any, media: any, titles: string[], expected: number): any {
  const titleScore = candidateTitleScore(titles, candidate);
  const format = expectedFormat(media?.format);
  const year = Number(media?.startDate?.year ?? media?.seasonYear ?? 0) || null;
  const primaryTitles = [media?.title?.english, media?.title?.romaji, media?.title?.native].filter(Boolean);
  const partOrdinal = Math.max(0, ...primaryTitles.map(ordinal));
  const partMapping = expected === 1 && format === 'special' && candidate.type === 'special' && year && candidate.year === year && partOrdinal >= 2 && candidate.episodeCount === partOrdinal && titleScore >= 0.65;
  if (titleScore < 0.68 && !partMapping) return null;
  if (format && candidate.type && format !== candidate.type) return null;
  if (year && candidate.year && year !== candidate.year) return null;
  const coverage = coverageScore(candidate, expected, media?.status);
  if (expected >= 6 && coverage < 0.8) return null;
  const score = titleScore * 0.72 + (format && candidate.type === format ? 0.14 : 0.07) + (year && candidate.year === year ? 0.1 : 0.04) + coverage * 0.04;
  const exactEpisodeCount = expected > 0 && candidate.episodeCount === expected;
  return { ...candidate, titleScore, coverage, score, exactEpisodeCount, partOrdinal: partMapping ? partOrdinal : 0 };
}

async function resolveSeries(anilistId: number, title: string, media: any): Promise<{ slug: string; title: string; matchScore: number; score: number; type: string; year: number | null; episodeCount: number; partOrdinal: number } | null> {
  const queries = searchQueries([title]);
  const discovered = new Map<string, any>();

  for (const query of queries) {
    try {
      const results = await searchAniZone(query);
      for (const candidate of results) {
        if (!discovered.has(candidate.slug)) discovered.set(candidate.slug, candidate);
      }
    } catch {}
  }

  const expected = media?.episodes ?? 0;
  const valid = Array.from(discovered.values())
    .map(candidate => validateCandidate(candidate, media, [title], expected))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || Number(right.exactEpisodeCount) - Number(left.exactEpisodeCount));

  const selected = valid[0];
  const runnerUp = valid[1];
  const exactCountResolvesTie = selected?.exactEpisodeCount && runnerUp && !runnerUp.exactEpisodeCount && selected.titleScore >= runnerUp.titleScore - 0.02;

  if (!selected || (selected.score < 0.82 && !selected.partOrdinal) || (runnerUp && selected.score - runnerUp.score < 0.08 && !exactCountResolvesTie)) {
    return null;
  }

  return {
    slug: selected.slug,
    title: selected.title,
    matchScore: selected.titleScore,
    score: selected.score,
    type: selected.type,
    year: selected.year,
    episodeCount: selected.episodeCount,
    partOrdinal: selected.partOrdinal,
  };
}

function snapshot(html: string): string {
  const match = [...String(html).matchAll(/wire:snapshot="([^"]*)"/gi)]
    .find(item => item[1].includes('pages.anime-detail'));
  return match ? match[1] : '';
}

function cursor(html: string): string | null {
  return String(html).match(/nextCursor:\s*'([^']+)'/i)?.[1] || null;
}

function hasMore(html: string): boolean {
  return /hasMore:\s*true/i.test(String(html));
}

function csrf(html: string): string {
  return String(html).match(/csrf-token"\s+content="([^"]+)"/i)?.[1] || '';
}

function seconds(value: string): number | null {
  const parts = String(value || '').match(/^(\d+):(\d{1,2})$/);
  if (!parts) return null;
  return Number(parts[1]) * 60 + Number(parts[2]);
}

function episodeNumber(item: any): number | null {
  const direct = Number(item?.slug);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const fromUrl = String(item?.url || '').replace(/\\+\//g, '/').match(/\/(\d+)\/?$/)?.[1];
  const number = Number(fromUrl);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseEpisodes(items: any[]): Array<{ number: number; sourceNumber: number; title: string; duration: number | null; description: string | null; image: string | null; airDate: string | null; hasSub: boolean; hasDub: boolean }> {
  const seen = new Set<number>();
  return items
    .map(item => {
      const number = episodeNumber(item);
      if (!number || seen.has(number)) return null;
      seen.add(number);
      return {
        number,
        sourceNumber: number,
        title: pickTitle(item.title_list) || `Episode ${number}`,
        duration: seconds(item.duration),
        description: item.summary || null,
        image: String(item.snapshot || '').replace(/\\+\//g, '/') || null,
        airDate: item.air_date || null,
        hasSub: Number(item.videos_count) > 0,
        hasDub: false,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.number - right.number);
}

async function initialPage(html: string, cookies: string[]): Promise<{ items: any[]; snapshot: string; cursor: string | null; hasMore: boolean; csrf: string; cookies: Map<string, string> }> {
  const items = jsonArgument(html, 'items');
  const data = {
    items: Array.isArray(items) ? items : [],
    snapshot: snapshot(html),
    cursor: cursor(html),
    hasMore: hasMore(html),
    csrf: csrf(html),
    cookies: mergeCookies(new Map(), cookies),
  };
  if (!data.items.length || !data.snapshot || !data.csrf) {
    throw new Error('AniZone page payload not found');
  }
  return data;
}

async function loadPage(state: any, slug: string): Promise<any> {
  const response = await request(`${ANIZONE_BASE}/livewire/update`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'X-Livewire': '',
      'X-CSRF-TOKEN': state.csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': ANIZONE_BASE,
      'Referer': `${ANIZONE_BASE}/anime/${slug}`,
      'Cookie': cookieHeader(state.cookies),
    },
    body: JSON.stringify({
      components: [{
        snapshot: state.snapshot,
        updates: {},
        calls: [{ path: '', method: 'loadPage', params: [state.cursor] }],
      }],
    }),
  });

  let payload;
  try { payload = JSON.parse(response.raw); } catch { throw new Error('AniZone returned invalid Livewire JSON'); }

  const component = payload?.components?.[0];
  const dispatch = component?.effects?.dispatches?.find((item: any) => item?.name === 'items-loaded');
  if (!component?.snapshot || !dispatch?.params || !Array.isArray(dispatch.params.items)) {
    throw new Error('AniZone page continuation payload not found');
  }

  return {
    items: dispatch.params.items,
    snapshot: component.snapshot,
    cursor: dispatch.params.nextCursor || null,
    hasMore: Boolean(dispatch.params.hasMore),
    csrf: state.csrf,
    cookies: mergeCookies(state.cookies, response.cookies),
  };
}

async function scrapeSeries(slug: string, limit: number, maxPages: number): Promise<any[]> {
  const initial = await request(`${ANIZONE_BASE}/anime/${slug}`);
  let state = await initialPage(initial.raw, initial.cookies);
  const items = [...state.items];
  let pages = 1;
  while (state.hasMore && state.cursor && items.length < limit && pages < maxPages) {
    state = await loadPage(state, slug);
    items.push(...state.items);
    pages++;
  }
  return parseEpisodes(items);
}

function chooseMode(episodes: any[], expected: number, offset: number): string {
  if (!expected || !offset) return 'local';
  const local = episodes.filter(ep => ep.number >= 1 && ep.number <= expected).length;
  const shifted = episodes.filter(ep => ep.number > offset && ep.number <= offset + expected).length;
  return shifted > local ? 'offset' : 'local';
}

function alignEpisodes(episodes: any[], media: any, expected: number, series: any): any[] {
  if (!expected || episodes.length <= expected) return episodes;
  const titles = [media?.title?.english, media?.title?.romaji, media?.title?.native].filter(Boolean);
  const target = Math.max(0, ...titles.map(ordinal));
  if (target < 2) return episodes;
  let start = episodes.findIndex(ep => ordinal(ep.title) === target);
  if (start < 0 && series?.partOrdinal === target && episodes.length === target) start = target - 1;
  if (start < 0 || episodes.length - start < expected) return episodes;
  return episodes.slice(start, start + expected).map((ep, index) => ({ ...ep, number: index + 1 }));
}

async function scrapeWatch(slug: string, episode: number): Promise<{ hls: string; subtitles: Array<{ url: string; label: string; srclang: string; format: string; default: boolean }> }> {
  const { raw } = await request(`${ANIZONE_BASE}/anime/${slug}/${episode}`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': `${ANIZONE_BASE}/`,
    },
  });

  const player = playerData(raw);
  if (!player?.src) {
    throw new Error(`AniZone player payload not found for episode ${episode}`);
  }

  return {
    hls: String(player.src).replace(/\\+\//g, '/'),
    subtitles: (Array.isArray(player.subtitles) ? player.subtitles : [])
      .filter(sub => sub?.file)
      .map(sub => ({
        url: String(sub.file).replace(/\\+\//g, '/'),
        label: sub.title || '',
        srclang: sub.language || '',
        format: sub.format || 'vtt',
        default: Boolean(sub.default),
      })),
  };
}

export async function getAnizoneStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  const streams: RawStream[] = [];

  try {
    // Build minimal media object for title matching
    const media: any = {
      title: { english: input.title, romaji: null, native: null },
      format: 'TV',
      status: 'FINISHED',
      episodes: 0,
      seasonYear: null,
      startDate: { year: null },
    };

    const series = await resolveSeries(input.anilist_id, input.title, media);
    if (!series) return [];

    const expected = media.episodes ?? 0;
    const offset = 0;
    const limit = expected ? Math.max(expected, series.partOrdinal || 0) + offset : Infinity;
    const maxPages = Infinity;

    const rawEpisodes = await scrapeSeries(series.slug, limit, maxPages);
    const mode = chooseMode(rawEpisodes, expected, offset);
    const episodes = alignEpisodes(rawEpisodes, media, expected, series);

    const episode = episodes.find(ep => ep.number === input.episode && ep.hasSub);
    if (!episode) return [];

    const watch = await scrapeWatch(series.slug, episode.sourceNumber);
    if (!watch.hls || !isSafeHttpUrl(watch.hls)) return [];

    streams.push({
      url: watch.hls,
      format: 'hls',
      quality: normalizeQuality('1080p'),
      audio: input.dub ? 'Dub' : 'Original',
      provider: 'anizone',
      headers: { Referer: ANIZONE_BASE },
    });

    // Subtitles would be attached via normalizer in caller
  } catch (error) {
    console.error(`AniZone error: ${String(error)}`);
  }

  return streams;
}