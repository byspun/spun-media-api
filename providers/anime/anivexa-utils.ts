import { detectFormat, isSafeHttpUrl, normalizeTitle, normalizeQuality, uniqueBy } from '../mapper.js';
import type { AnimeProviderInput, RawSubtitle, RawStream } from '../shared/types.js';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const ANILIST_URL = 'https://graphql.anilist.co';

export function requestHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  };
}

export async function fetchText(url: string, extra: Record<string, string> = {}, timeout = 25_000): Promise<string> {
  const response = await fetch(url, {
    headers: requestHeaders(extra),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`upstream ${response.status}${body ? `: ${body}` : ''}`);
  }
  return response.text();
}

export async function fetchJson<T = any>(url: string, extra: Record<string, string> = {}, timeout = 25_000): Promise<T> {
  const response = await fetch(url, {
    headers: { ...requestHeaders(extra), Accept: 'application/json,text/plain,*/*' },
    signal: AbortSignal.timeout(timeout),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`upstream ${response.status}: ${raw.slice(0, 300)}`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('upstream returned invalid JSON');
  }
}

export async function getAniListMedia(anilistId: number): Promise<any | null> {
  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: 'query($id:Int){Media(id:$id,type:ANIME){id idMal format status seasonYear title{english romaji native} synonyms coverImage{large medium} episodes}}',
        variables: { id: anilistId },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json() as any;
    return payload?.data?.Media ?? null;
  } catch {
    return null;
  }
}

export function buildTitles(media: any, input: AnimeProviderInput): string[] {
  return [...new Set([
    input.title,
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native,
    ...(Array.isArray(media?.synonyms) ? media.synonyms : []),
  ].filter((value): value is string => Boolean(value && String(value).trim())).map(String))];
}

export function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;|&#47;/gi, '/')
    .replace(/&#x27;|&#39;/gi, "'");
}

export function attr(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return decodeEntities(tag.match(new RegExp(`${escaped}=["']([^"']*)["']`, 'i'))?.[1] ?? '');
}

export function diceCoeff(left: string, right: string): number {
  const a = normalizeTitle(left).replace(/\s+/g, '');
  const b = normalizeTitle(right).replace(/\s+/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = (value: string) => {
    const result = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i++) result.set(value.slice(i, i + 2), (result.get(value.slice(i, i + 2)) ?? 0) + 1);
    return result;
  };
  const ap = pairs(a);
  const bp = pairs(b);
  let intersection = 0;
  for (const [key, count] of ap) intersection += Math.min(count, bp.get(key) ?? 0);
  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

export function bestTitleScore(candidate: string, titles: string[]): number {
  const normalized = normalizeTitle(candidate);
  return Math.max(...titles.map((title) => {
    const target = normalizeTitle(title);
    if (!target || !normalized) return 0;
    if (target === normalized) return 1;
    if (normalized.includes(target) || target.includes(normalized)) return 0.86;
    return diceCoeff(normalized, target);
  }), 0);
}

export function safeStream(value: any, provider: RawStream['provider'], audio: string, declared?: string, headers?: Record<string, string>): RawStream | null {
  if (!isSafeHttpUrl(value?.url)) return null;
  const format = detectFormat(String(value.url), declared ?? value.type);
  if (format === 'unknown') return null;
  return {
    url: String(value.url),
    format,
    quality: normalizeQuality(value.quality ?? value.label ?? value.resolution),
    audio,
    provider,
    ...(headers ? { headers } : {}),
  };
}

export function safeSubtitle(value: any, provider: RawSubtitle['provider']): RawSubtitle | null {
  const url = value?.url ?? value?.file ?? value?.src;
  if (!isSafeHttpUrl(url)) return null;
  const language = String(value?.language ?? value?.label ?? value?.lang ?? 'English');
  return {
    url: String(url),
    language,
    language_code: String(value?.language_code ?? value?.srclang ?? value?.lang ?? language.slice(0, 2)).toLowerCase(),
    format: String(url).toLowerCase().includes('.srt') ? 'srt' : 'vtt',
    provider,
  };
}

export function dedupeStreams(streams: RawStream[]): RawStream[] {
  return uniqueBy(streams, (stream) => `${stream.url}:${stream.audio}:${stream.quality}`);
}

export function dedupeSubtitles(subtitles: RawSubtitle[]): RawSubtitle[] {
  return uniqueBy(subtitles, (subtitle) => `${subtitle.url}:${subtitle.language_code}`);
}

export function animeAudio(input: AnimeProviderInput): 'sub' | 'dub' {
  return input.dub ? 'dub' : 'sub';
}
