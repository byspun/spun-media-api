// Shared HTTP helpers for all providers.
// Wraps fetch with: configurable retries, exponential backoff, timeout.
// Ported and extended from D.Verse retry.ts.

export interface FetchOptions extends RequestInit {
  timeout?:   number;   // ms, default 15000
  retries?:   number;   // default 2
  retryDelay?: number;  // base ms for exponential backoff, default 500
}

// ─── Fetch with timeout ───────────────────────────────────────────────────────

export async function fetchWithTimeout(
  url:     string,
  options: FetchOptions = {}
): Promise<Response> {
  const { timeout = 15_000, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Fetch with retry ─────────────────────────────────────────────────────────

export async function fetchWithRetry(
  url:     string,
  options: FetchOptions = {}
): Promise<Response> {
  const { retries = 2, retryDelay = 500, ...rest } = options;
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, rest);

      // Retry on 5xx
      if (res.status >= 500 && attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on abort (timeout)
      if (lastError.name === 'AbortError') throw lastError;

      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ─── JSON fetch helper ────────────────────────────────────────────────────────

export async function fetchJson<T>(
  url:     string,
  options: FetchOptions = {}
): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
      ...options,
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// Throwing variant of fetchJson — callers that need to distinguish "upstream
// failed" from "no data" (e.g. kaa, animegg) use this. Returns the parsed body
// or throws with the upstream status + a body prefix.
export async function fetchJsonOrThrow<T = any>(url: string, extra: Record<string, string> = {}, timeout = 25_000): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, ...requestHeaders(extra), Accept: 'application/json,text/plain,*/*' },
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

// ─── Shared headers / constants ───────────────────────────────────────────────

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

// ─── AniList GraphQL ─────────────────────────────────────────────────────────

/** Fetch anime metadata from AniList by ID. Returns null on any failure. */
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

// ─── Sleep helper ─────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Best match scoring ───────────────────────────────────────────────────────
// Used by providers to pick the best result from a search list.
// Scores: exact title (+50), year match (+35), partial title (+20).
// Returns index of best match or -1 if nothing clears threshold.

export function findBestMatch(
  candidates: Array<{ title: string; year?: number | null }>,
  query:      { title: string; year?: number | null },
  threshold   = 40
): number {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const normQuery = normalize(query.title);

  let bestScore = -1;
  let bestIdx   = -1;

  for (let i = 0; i < candidates.length; i++) {
    const c         = candidates[i];
    const normTitle = normalize(c.title);
    let score       = 0;

    // Exact title
    if (normTitle === normQuery) {
      score += 50;
    } else if (normTitle.includes(normQuery) || normQuery.includes(normTitle)) {
      score += 20;
    }

    // Year match
    if (query.year && c.year && query.year === c.year) {
      score += 35;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx   = i;
    }
  }

  return bestScore >= threshold ? bestIdx : -1;
}
