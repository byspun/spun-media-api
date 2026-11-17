// Shared normalization and utility functions.
// Previously located at providers/mapper.ts — that name was misleading,
// as this module does NOT perform any ID mapping. It holds:
//   - title normalization / slugification
//   - year-from-date detection
//   - stream quality normalization
//   - format detection from URLs
//   - safe-URL validation
//   - generic deduplication
//   - unique-by selection
//
// Also holds anime-provider shared helpers (title scoring, HTML entity/attr
// parsing, stream/subtitle builders) absorbed from the former anivexa-utils.ts.

import type { AnimeProviderInput, RawSubtitle, RawStream } from './types.js';

export function normalizeTitle(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(dub|dubbed|dual audio|hindi|tamil|telugu|english|japanese|korean|cam|uncut|4k|hd)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

export function variantMarker(value: string): string | null {
  return value.match(/\[([^\]]+)\]/)?.[1]?.trim().toLocaleLowerCase() || null;
}

export function yearFromDate(value: unknown): number | null {
  const match = String(value ?? '').match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function detectFormat(url: string, declared?: string | null): StreamFormat | 'unknown' {
  const value = `${declared ?? ''} ${url}`.toLocaleLowerCase();
  if (value.includes('m3u8') || value.includes('hls')) return 'hls';
  if (value.includes('mpd') || value.includes('dash')) return 'dash';
  if (value.includes('mkv')) return 'mkv';
  if (value.includes('mp4') || value.includes('video')) return 'mp4';
  return 'unknown';
}

export function normalizeQuality(value: unknown): StreamQuality {
  const text = String(value ?? '').toLocaleLowerCase();
  if (/(2160|4k|uhd)/.test(text)) return '4k';
  const match = text.match(/(1440|1080|720|480|360|240)/);
  return match ? `${match[1]}p` as StreamQuality : 'auto';
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function isAlreadyRelayedUrl(url: string, relayBase: string): boolean {
  try { return new URL(url).origin === new URL(relayBase).origin; } catch { return false; }
}

export function universalSlugify(value: unknown): string {
  return normalizeTitle(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

export function isSafeHttpUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export type StreamFormat = 'mp4' | 'hls' | 'dash' | 'mkv' | 'embed';
export type StreamQuality = '4k' | '1080p' | '720p' | '480p' | '360p' | 'auto';

// ─── Anime provider shared helpers ────────────────────────────────────────────
// Absorbed from the former anivexa-utils.ts. These are pure functions used by
// the anime providers for title matching, HTML parsing, and stream building.

/** Build the candidate title list for fuzzy matching against a media + input. */
export function buildTitles(media: any, input: AnimeProviderInput): string[] {
  return [...new Set([
    input.title,
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native,
    ...(Array.isArray(media?.synonyms) ? media.synonyms : []),
  ].filter((value): value is string => Boolean(value && String(value).trim())).map(String))];
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

export function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

export function attr(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return decodeEntities(tag.match(new RegExp(`${escaped}=["']([^"']*)["']`, 'i'))?.[1] ?? '');
}

/** Sørensen–Dice coefficient over title bigrams (order-independent similarity). */
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
