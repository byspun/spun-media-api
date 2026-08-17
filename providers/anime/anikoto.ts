import { attachSubtitles } from '../normalizer.js';
import { detectFormat, isSafeHttpUrl, uniqueBy } from '../mapper.js';
import type { AnimeProviderInput, RawStream, RawSubtitle } from '../shared/types.js';

const ANIKOTO = 'https://anikototv.to';
const SPOOF_REF = 'https://hianimes.re/';
const ANILIST = 'https://graphql.anilist.co';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

function normalize(value: unknown): string { return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function requestHeaders(extra: Record<string, string> = {}): Record<string, string> { return { 'User-Agent': UA, Accept: 'text/html,*/*', ...extra }; }
async function text(url: string, extra: Record<string, string> = {}): Promise<string> { const response = await fetch(url, { headers: requestHeaders(extra), signal: AbortSignal.timeout(25_000) }); if (!response.ok) throw new Error(`upstream ${response.status}`); return response.text(); }
async function json(url: string, extra: Record<string, string> = {}): Promise<any> { const response = await fetch(url, { headers: { ...requestHeaders(extra), Accept: 'application/json,*/*' }, signal: AbortSignal.timeout(25_000) }); if (!response.ok) throw new Error(`upstream ${response.status}`); return response.json(); }

async function getMedia(anilistId: number): Promise<any | null> {
  try {
    const response = await fetch(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: 'query($id:Int){Media(id:$id,type:ANIME){id idMal title{english romaji native} synonyms}}', variables: { id: anilistId } }), signal: AbortSignal.timeout(20_000) });
    const payload = await response.json() as any;
    return payload?.data?.Media ?? null;
  } catch { return null; }
}

function score(candidate: any, media: any): number {
  const targets = [media?.title?.english, media?.title?.romaji, ...(media?.synonyms ?? [])].filter(Boolean).map(normalize);
  const names = [candidate.name, candidate.jp, candidate.slug].map(normalize);
  let value = targets.includes(names[0]) ? 1000 : 0;
  for (const target of targets) {
    if (!target) continue;
    if (names.includes(target)) value += 200;
    else if (names.some((name) => name && (name.includes(target) || target.includes(name)))) value += 40;
  }
  return value - Math.abs((names[0] ?? '').length - (targets[0] ?? '').length) * 2;
}

async function findShow(media: any): Promise<{ slug: string; showId: string; title: string }> {
  const candidates = new Map<string, any>();
  const terms = [...new Set([media?.title?.english, media?.title?.romaji, ...(media?.synonyms ?? [])].filter(Boolean))].slice(0, 5);
  for (const term of terms) {
    try {
      const html = await text(`${ANIKOTO}/filter?keyword=${encodeURIComponent(String(term))}`, { Referer: `${ANIKOTO}/` });
      const re = /<a\s+class="name d-title"\s+href="https:\/\/anikototv\.to\/watch\/([^"/]+)(?:\/ep-\d+)?"[^>]*data-jp="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(html))) candidates.set(match[1], { slug: match[1], jp: match[2], name: match[3].replace(/<[^>]*>/g, '').trim() });
    } catch { /* try next title */ }
  }
  const chosen = [...candidates.values()].sort((a, b) => score(b, media) - score(a, media))[0];
  if (!chosen) throw new Error('show not found');
  const watch = await text(`${ANIKOTO}/watch/${chosen.slug}`, { Referer: `${ANIKOTO}/` });
  const showId = watch.match(/data-id="(\d+)"/)?.[1];
  if (!showId) throw new Error('show id not found');
  return { slug: chosen.slug, showId, title: chosen.name };
}

function subtitleTrack(value: any): RawSubtitle | null {
  if (!isSafeHttpUrl(value?.file)) return null;
  const label = String(value.label ?? 'English');
  return { url: String(value.file), language: label, language_code: label.split(/\s+/)[0].toLowerCase() || 'en', format: 'vtt', provider: 'anikoto' };
}

async function resolveEmbed(embedUrl: string): Promise<{ url: string; origin: string; tracks: RawSubtitle[] } | null> {
  try {
    const html = await text(embedUrl, { Referer: SPOOF_REF, 'Accept-Language': 'en-US,en;q=0.9' });
    const fileId = html.match(/data-id="([^"]*)"/)?.[1];
    if (!fileId) return null;
    const origin = new URL(embedUrl).origin;
    const payload = await json(`${origin}/stream/getSources?id=${encodeURIComponent(fileId)}&id=${encodeURIComponent(fileId)}`, { Referer: `${origin}/`, 'X-Requested-With': 'XMLHttpRequest' });
    const source = payload?.sources?.file;
    if (!isSafeHttpUrl(source) || detectFormat(String(source), 'hls') !== 'hls') return null;
    const tracks = (Array.isArray(payload?.tracks) ? payload.tracks : []).map(subtitleTrack).filter(Boolean) as RawSubtitle[];
    return { url: String(source), origin, tracks };
  } catch { return null; }
}

export async function getAnikotoStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    const media = await getMedia(input.anilist_id);
    if (!media) return [];
    const show = await findShow(media);
    const episodeList = await json(`${ANIKOTO}/ajax/episode/list/${show.showId}`, { 'X-Requested-With': 'XMLHttpRequest', Referer: `${ANIKOTO}/watch/${show.slug}` });
    const html = String(episodeList?.result ?? '');
    const re = /<a\s+[^>]*data-id="([^"]*)"[^>]*>/g;
    let match: RegExpExecArray | null;
    let target: { ids: string } | null = null;
    while ((match = re.exec(html))) {
      const tag = match[0];
      const number = Number(tag.match(/data-num="([^"]*)"/)?.[1]);
      if (number === input.episode) { target = { ids: tag.match(/data-ids="([^"]*)"/)?.[1] ?? '' }; break; }
    }
    if (!target?.ids) return [];
    const servers = await json(`${ANIKOTO}/ajax/server/list?servers=${encodeURIComponent(target.ids)}`, { 'X-Requested-With': 'XMLHttpRequest', Referer: `${ANIKOTO}/` });
    const serverHtml = String(servers?.result ?? '');
    const audio = input.dub ? 'dub' : 'sub';
    const serverItems: Array<{ linkId: string; name: string }> = [];
    const typeRe = /<div class="type" data-type="([^"]+)">([\s\S]*?)<\/ul>\s*<\/div>/g;
    let typeMatch: RegExpExecArray | null;
    while ((typeMatch = typeRe.exec(serverHtml))) {
      if (typeMatch[1] !== audio) continue;
      for (const li of typeMatch[2].matchAll(/<li\s+([^>]*data-link-id[^>]*)>([\s\S]*?)<\/li>/g)) {
        const linkId = li[1].match(/data-link-id="([^"]+)"/)?.[1];
        if (linkId) serverItems.push({ linkId, name: li[2].replace(/<[^>]+>/g, '').trim() });
      }
    }
    const streams: RawStream[] = [];
    const subtitles: RawSubtitle[] = [];
    for (const item of uniqueBy(serverItems, (value) => value.name)) {
      const resolved = item.linkId.startsWith('http') ? { result: { url: item.linkId } } : await json(`${ANIKOTO}/ajax/server?get=${encodeURIComponent(item.linkId)}`, { 'X-Requested-With': 'XMLHttpRequest', Referer: `${ANIKOTO}/` }).catch(() => null);
      const embedUrl = resolved?.result?.url;
      if (!isSafeHttpUrl(embedUrl)) continue;
      const extracted = await resolveEmbed(String(embedUrl));
      if (!extracted) continue;
      subtitles.push(...extracted.tracks);
      streams.push({ url: extracted.url, format: 'hls', quality: 'auto', audio: input.dub ? 'English' : 'Japanese', provider: 'anikoto', headers: { Referer: `${extracted.origin}/`, 'User-Agent': UA } });
    }
    return attachSubtitles(streams, uniqueBy(subtitles, (value) => value.language_code));
  } catch { return []; }
}
