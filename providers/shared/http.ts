// providers/shared/http.ts
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
    const res = await fetchWithRetry(url, {
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
      ...options,
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
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
