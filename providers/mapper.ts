import type { StreamFormat, StreamQuality } from './shared/types.js';

export type MediaType = 'movie' | 'tv' | 'anime';

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
