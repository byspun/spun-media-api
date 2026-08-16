export type MediaType = 'movie' | 'tv' | 'anime';

export interface MappingInput {
  type: MediaType;
  title: string;
  year: number | null;
  tmdbId?: number | null;
  anilistId?: number | null;
  malId?: number | null;
}

export interface MovieBoxCandidate {
  subjectId: string;
  subjectType?: number | null;
  type?: string | null;
  title: string;
  releaseDate?: string | null;
  genre?: string | null;
  country?: string | null;
  language?: string | null;
  hasResource?: boolean | null;
  poster?: string | null;
}

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
  const match = value.match(/\[([^\]]+)\]/);
  return match?.[1]?.trim().toLocaleLowerCase() || null;
}

export function yearFromDate(value: unknown): number | null {
  const match = String(value ?? '').match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function detectFormat(url: string, declared?: string | null): 'mp4' | 'hls' | 'dash' | 'mkv' | 'unknown' {
  const value = `${declared ?? ''} ${url}`.toLocaleLowerCase();
  if (value.includes('m3u8') || value.includes('hls')) return 'hls';
  if (value.includes('mpd') || value.includes('dash')) return 'dash';
  if (value.includes('mkv')) return 'mkv';
  if (value.includes('mp4') || value.includes('video')) return 'mp4';
  return 'unknown';
}

export function normalizeQuality(value: unknown): string {
  const match = String(value ?? '').match(/(2160|1440|1080|720|480|360|240)/);
  return match ? `${match[1]}p` : 'auto';
}

export function compatibleType(input: MediaType, candidate: MovieBoxCandidate): boolean {
  const type = String(candidate.type ?? '').toLocaleLowerCase();
  if (input === 'movie') return candidate.subjectType === 1 || type === 'movie';
  return candidate.subjectType === 2 || type === 'tv';
}

export function scoreMovieBoxCandidate(input: MappingInput, candidate: MovieBoxCandidate): number {
  if (!compatibleType(input.type, candidate)) return -Infinity;
  const wanted = normalizeTitle(input.title);
  const actual = normalizeTitle(candidate.title);
  if (!wanted || !actual) return -Infinity;

  let score = 0;
  if (wanted === actual) score += 80;
  else if (actual.includes(wanted) || wanted.includes(actual)) score += 32;
  else return -Infinity;

  const candidateYear = yearFromDate(candidate.releaseDate);
  if (input.year && candidateYear) {
    const delta = Math.abs(input.year - candidateYear);
    if (delta === 0) score += 35;
    else if (delta === 1) score += 18;
    else if (delta > 3) score -= 35;
  }

  if (input.type === 'anime' && /anime|animation/i.test(`${candidate.genre ?? ''} ${candidate.country ?? ''}`)) score += 12;
  if (candidate.hasResource === true) score += 4;
  if (variantMarker(candidate.title)) score -= 2;
  return score;
}

export function chooseMovieBoxCandidate(input: MappingInput, candidates: MovieBoxCandidate[]): MovieBoxCandidate | null {
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreMovieBoxCandidate(input, candidate) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 70) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 8) return null;
  return ranked[0].candidate;
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
  try {
    return new URL(url).origin === new URL(relayBase).origin;
  } catch {
    return false;
  }
}

export function isSafeHttpUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
