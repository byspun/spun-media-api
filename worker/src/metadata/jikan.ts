// worker/src/metadata/jikan.ts
// Jikan v4 — unofficial MyAnimeList REST API.
// Used for: episode lists, OP/ED themes, filler guides.
// No API key required. Rate limit: 3 req/sec, 60 req/min.

const JIKAN_BASE = 'https://api.jikan.moe/v4';

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function jikanFetch<T>(
  path:   string,
  params: Record<string, string | number> = {}
): Promise<T | null> {
  const url = new URL(`${JIKAN_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 429) return null; // rate limited
    if (!res.ok)            return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JikanEpisode {
  mal_id:    number;
  title:     string | null;
  title_romaji?: string | null;
  aired:     string | null;
  filler:    boolean;
  recap:     boolean;
  duration?: string | null;
}

export interface JikanTheme {
  mal_id: number;
  type:   'OP' | 'ED';
  name:   string;
  text:   string;
}

export interface JikanAnime {
  mal_id:   number;
  title:    string;
  episodes: number | null;
  status:   string | null;
}

// ─── Episode list ─────────────────────────────────────────────────────────────
// Jikan paginates episodes at 100/page.
// We fetch all pages and return the full flat list.

export async function getJikanEpisodes(
  malId:   number,
  page    = 1
): Promise<{ episodes: JikanEpisode[]; hasNextPage: boolean; total: number }> {
  const data = await jikanFetch<{
    data:       JikanEpisode[];
    pagination: { last_visible_page: number; has_next_page: boolean; items: { total: number } };
  }>(`/anime/${malId}/episodes`, { page });

  return {
    episodes:    data?.data              ?? [],
    hasNextPage: data?.pagination?.has_next_page ?? false,
    total:       data?.pagination?.items?.total  ?? 0,
  };
}

export async function getAllJikanEpisodes(malId: number): Promise<JikanEpisode[]> {
  const all:  JikanEpisode[] = [];
  let   page = 1;

  while (true) {
    const { episodes, hasNextPage } = await getJikanEpisodes(malId, page);
    all.push(...episodes);
    if (!hasNextPage) break;
    page++;
    // Small delay to respect Jikan rate limit
    await new Promise((r) => setTimeout(r, 350));
  }

  return all;
}

// ─── Themes (OP/ED) ───────────────────────────────────────────────────────────

export interface ParsedTheme {
  title:    string;
  artist:   string;
  episodes: string;
  type:     'OP' | 'ED';
}

export async function getJikanThemes(malId: number): Promise<ParsedTheme[]> {
  const data = await jikanFetch<{
    data: {
      openings: string[];
      endings:  string[];
    }
  }>(`/anime/${malId}/themes`);

  if (!data?.data) return [];

  const parse = (raw: string[], type: 'OP' | 'ED'): ParsedTheme[] =>
    raw.map((entry) => {
      // Format: '#1: "Title" by Artist (eps X-Y)'
      const titleMatch   = entry.match(/"([^"]+)"/);
      const artistMatch  = entry.match(/by ([^(]+)/);
      const episodeMatch = entry.match(/\(eps? ([^)]+)\)/);

      return {
        title:    titleMatch?.[1]?.trim()   ?? entry,
        artist:   artistMatch?.[1]?.trim()  ?? '',
        episodes: episodeMatch?.[1]?.trim() ?? 'All',
        type,
      };
    });

  return [
    ...parse(data.data.openings, 'OP'),
    ...parse(data.data.endings,  'ED'),
  ];
}

// ─── Filler guide ─────────────────────────────────────────────────────────────

export interface FillerEntry {
  number: number;
  type:   'canon' | 'filler' | 'mixed';
}

export async function getJikanFillers(
  malId: number,
  page  = 1
): Promise<{ fillers: FillerEntry[]; hasNextPage: boolean }> {
  const data = await jikanFetch<{
    data: Array<{
      mal_id: number;
      filler: boolean;
      recap:  boolean;
    }>;
    pagination: { has_next_page: boolean };
  }>(`/anime/${malId}/episodes`, { page });

  const fillers: FillerEntry[] = (data?.data ?? []).map((ep, i) => ({
    number: ep.mal_id,
    type:   ep.filler ? 'filler' : ep.recap ? 'mixed' : 'canon',
  }));

  return {
    fillers,
    hasNextPage: data?.pagination?.has_next_page ?? false,
  };
}

// ─── Lookup MAL ID from title (fallback) ──────────────────────────────────────

export async function searchJikan(query: string): Promise<JikanAnime | null> {
  const data = await jikanFetch<{ data: JikanAnime[] }>('/anime', {
    q:   query,
    limit: 5,
  });

  return data?.data?.[0] ?? null;
}
