// worker/src/metadata/anilist.ts
// All AniList GraphQL calls. Free API, no key required. Rate limit: 90 req/min.
// AniList is the primary metadata source for all anime content.

import type { AniListMedia, ContentItem } from '../types/index.js';

const ANILIST_URL  = 'https://graphql.anilist.co';
const ALLOWED_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'];

// ─── GraphQL executor ─────────────────────────────────────────────────────────

async function anilistQuery<T>(
  query:     string,
  variables: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    const res = await fetch(ANILIST_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: T };
    return json.data ?? null;
  } catch {
    return null;
  }
}

// ─── Shared field fragments ───────────────────────────────────────────────────

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native userPreferred }
  format
  status
  episodes
  coverImage { large medium }
  bannerImage
  averageScore
  genres
  tags(sort: RANK_DESC) { name isMediaSpoiler rank }
  startDate { year month day }
  description(asHtml: false)
  studios(isMain: true) { nodes { name isAnimationStudio } }
  synonyms
  trailer { id site }
  season
  seasonYear
  nextAiringEpisode { episode airingAt timeUntilAiring }
`;

const RANKED_FIELDS = `
  id
  title { english romaji userPreferred }
  format
  coverImage { large }
  averageScore
  startDate { year }
`;

// ─── Single anime by AniList ID ───────────────────────────────────────────────

export async function getAnilistMedia(anilistId: number): Promise<AniListMedia | null> {
  const query = `
    query($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FIELDS}
        characters(role: MAIN, sort: RELEVANCE, perPage: 15) {
          edges {
            node { name { full } image { large } }
            voiceActors(language: JAPANESE) { name { full } image { large } }
          }
        }
        relations {
          edges {
            relationType(version: 2)
            node {
              id
              title { english romaji userPreferred }
              format
              status
              coverImage { large }
              averageScore
              startDate { year }
              type
            }
          }
        }
        recommendations(perPage: 10, sort: RATING_DESC) {
          nodes {
            mediaRecommendation {
              id
              title { english romaji userPreferred }
              format
              coverImage { large }
              averageScore
              startDate { year }
              genres
            }
          }
        }
      }
    }
  `;
  const result = await anilistQuery<{ Media: AniListMedia }>(query, { id: anilistId });
  return result?.Media ?? null;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchAnilist(
  query:   string,
  page    = 1,
  perPage = 20
): Promise<{ media: AniListMedia[]; hasNextPage: boolean }> {
  const gql = `
    query($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(search: $search, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{
    Page: { media: AniListMedia[]; pageInfo: { hasNextPage: boolean } }
  }>(gql, { search: query, page, perPage });

  return {
    media:       result?.Page?.media ?? [],
    hasNextPage: result?.Page?.pageInfo?.hasNextPage ?? false,
  };
}

// ─── Anime confirmation — is this title on AniList? ──────────────────────────
// Used to strip anime from TMDB search results.

export async function isAnimeOnAnilist(title: string): Promise<AniListMedia | null> {
  const results = await searchAnilist(title, 1, 5);
  if (!results.media.length) return null;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const normTitle = normalize(title);

  return results.media.find((m) => {
    const titles = [
      m.title.english,
      m.title.romaji,
      m.title.userPreferred,
    ].filter((t): t is string => Boolean(t));
    return titles.some((t) => normalize(t) === normTitle);
  }) ?? null;
}

// ─── Trending ─────────────────────────────────────────────────────────────────

export async function getAnilistTrending(page = 1, perPage = 30): Promise<AniListMedia[]> {
  const query = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: TRENDING_DESC, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(query, { page, perPage });
  return result?.Page?.media ?? [];
}

// ─── Popular ──────────────────────────────────────────────────────────────────

export async function getAnilistPopular(page = 1, perPage = 30): Promise<AniListMedia[]> {
  const query = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: POPULARITY_DESC, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(query, { page, perPage });
  return result?.Page?.media ?? [];
}

// ─── Seasonal ─────────────────────────────────────────────────────────────────

export async function getAnilistSeasonal(
  season: string,
  year:   number,
  page   = 1,
  perPage = 30
): Promise<AniListMedia[]> {
  const query = `
    query($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          season: $season, seasonYear: $year,
          type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL],
          sort: POPULARITY_DESC
        ) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(
    query, { season: season.toUpperCase(), year, page, perPage }
  );
  return result?.Page?.media ?? [];
}

// ─── Upcoming ─────────────────────────────────────────────────────────────────

export async function getAnilistUpcoming(page = 1, perPage = 20): Promise<AniListMedia[]> {
  const query = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          status: NOT_YET_RELEASED, type: ANIME,
          format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL],
          sort: POPULARITY_DESC
        ) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(query, { page, perPage });
  return result?.Page?.media ?? [];
}

// ─── Currently airing ─────────────────────────────────────────────────────────

export async function getAnilistAiring(page = 1, perPage = 30): Promise<AniListMedia[]> {
  const query = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          status: RELEASING, type: ANIME,
          format_in: [TV, TV_SHORT],
          sort: POPULARITY_DESC
        ) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(query, { page, perPage });
  return result?.Page?.media ?? [];
}

// ─── All seasons list ─────────────────────────────────────────────────────────

export async function getAnilistSeasonsList(): Promise<
  Array<{ year: number; season: string; count: number }>
> {
  // Fetch recent seasons — AniList doesn't have a direct "list all seasons" endpoint
  // so we build from known range
  const currentYear = new Date().getFullYear();
  const seasons: Array<{ year: number; season: string; count: number }> = [];
  const seasonNames = ['FALL', 'SUMMER', 'SPRING', 'WINTER'];

  // Last 10 years of seasons
  for (let y = currentYear + 1; y >= currentYear - 10; y--) {
    for (const s of seasonNames) {
      if (y === currentYear + 1 && s !== 'WINTER' && s !== 'SPRING') continue;
      const query = `
        query($season: MediaSeason, $year: Int) {
          Page(page: 1, perPage: 1) {
            pageInfo { total }
            media(season: $season, seasonYear: $year, type: ANIME, format_in: [TV, TV_SHORT]) {
              id
            }
          }
        }
      `;
      const result = await anilistQuery<{ Page: { pageInfo: { total: number } } }>(
        query, { season: s, year: y }
      );
      const count = result?.Page?.pageInfo?.total ?? 0;
      if (count > 0) {
        seasons.push({ year: y, season: s.toLowerCase() as any, count });
      }
    }
  }
  return seasons;
}

// ─── Rankings ─────────────────────────────────────────────────────────────────

export async function getAnilistRankingsAlltime(
  page = 1, perPage = 25
): Promise<AniListMedia[]> {
  const query = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: SCORE_DESC, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL], minimumTagRank: 1) {
          ${RANKED_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(query, { page, perPage });
  return result?.Page?.media ?? [];
}

export async function getAnilistRankingsPopular(
  page = 1, perPage = 25
): Promise<AniListMedia[]> {
  const query = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: POPULARITY_DESC, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]) {
          ${RANKED_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(query, { page, perPage });
  return result?.Page?.media ?? [];
}

export async function getAnilistRankingsSeason(
  year: number, season: string, page = 1, perPage = 25
): Promise<AniListMedia[]> {
  const query = `
    query($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          season: $season, seasonYear: $year,
          sort: SCORE_DESC, type: ANIME,
          format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]
        ) {
          ${RANKED_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(
    query, { season: season.toUpperCase(), year, page, perPage }
  );
  return result?.Page?.media ?? [];
}

export async function getAnilistRankingsGenre(
  genre: string, page = 1, perPage = 25
): Promise<AniListMedia[]> {
  const query = `
    query($genre: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          genre: $genre, sort: SCORE_DESC, type: ANIME,
          format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]
        ) {
          ${RANKED_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(
    query, { genre, page, perPage }
  );
  return result?.Page?.media ?? [];
}

// ─── By genre ─────────────────────────────────────────────────────────────────

export async function getAnilistByGenre(
  genre: string, page = 1, perPage = 30
): Promise<AniListMedia[]> {
  const query = `
    query($genre: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          genre: $genre, type: ANIME,
          format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL],
          sort: POPULARITY_DESC
        ) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(
    query, { genre, page, perPage }
  );
  return result?.Page?.media ?? [];
}

// ─── By format ────────────────────────────────────────────────────────────────

export async function getAnilistByFormat(
  format: string, page = 1, perPage = 30
): Promise<{ media: AniListMedia[]; total: number; hasNextPage: boolean }> {
  const query = `
    query($format: MediaFormat, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total hasNextPage }
        media(format: $format, type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{
    Page: {
      media:    AniListMedia[];
      pageInfo: { total: number; hasNextPage: boolean };
    }
  }>(query, { format: format.toUpperCase(), page, perPage });

  return {
    media:       result?.Page?.media ?? [],
    total:       result?.Page?.pageInfo?.total ?? 0,
    hasNextPage: result?.Page?.pageInfo?.hasNextPage ?? false,
  };
}

// ─── By demographic (tag-based) ───────────────────────────────────────────────

export async function getAnilistByDemographic(
  demographic: string, page = 1, perPage = 30
): Promise<{ media: AniListMedia[]; total: number; hasNextPage: boolean }> {
  // Capitalize for AniList tag
  const tag = demographic.charAt(0).toUpperCase() + demographic.slice(1).toLowerCase();
  const query = `
    query($tag: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total hasNextPage }
        media(tag: $tag, type: ANIME, sort: POPULARITY_DESC, format_in: [TV, TV_SHORT]) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{
    Page: { media: AniListMedia[]; pageInfo: { total: number; hasNextPage: boolean } }
  }>(query, { tag, page, perPage });

  return {
    media:       result?.Page?.media ?? [],
    total:       result?.Page?.pageInfo?.total ?? 0,
    hasNextPage: result?.Page?.pageInfo?.hasNextPage ?? false,
  };
}

// ─── By source material ───────────────────────────────────────────────────────

const SOURCE_MAP: Record<string, string> = {
  'original':     'ORIGINAL',
  'manga':        'MANGA',
  'light-novel':  'LIGHT_NOVEL',
  'visual-novel': 'VISUAL_NOVEL',
  'game':         'VIDEO_GAME',
};

export async function getAnilistBySource(
  source: string, page = 1, perPage = 30
): Promise<{ media: AniListMedia[]; total: number; hasNextPage: boolean }> {
  const sourceVal = SOURCE_MAP[source.toLowerCase()] ?? source.toUpperCase();
  const query = `
    query($source: MediaSource, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total hasNextPage }
        media(source: $source, type: ANIME, sort: POPULARITY_DESC, format_in: [TV, TV_SHORT, MOVIE]) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{
    Page: { media: AniListMedia[]; pageInfo: { total: number; hasNextPage: boolean } }
  }>(query, { source: sourceVal, page, perPage });

  return {
    media:       result?.Page?.media ?? [],
    total:       result?.Page?.pageInfo?.total ?? 0,
    hasNextPage: result?.Page?.pageInfo?.hasNextPage ?? false,
  };
}

// ─── Studios ──────────────────────────────────────────────────────────────────

export async function getAnilistStudios(
  query?: string, page = 1, perPage = 30
): Promise<{
  studios: Array<{ id: number; name: string; works_count: number }>;
  hasNextPage: boolean;
}> {
  const gql = `
    query($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        studios(sort: NAME${query ? ', search: $search' : ''}, isAnimationStudio: true) {
          id
          name
          media(sort: POPULARITY_DESC, isMain: true) { nodes { id } }
        }
      }
    }
  `;
  const result = await anilistQuery<{
    Page: {
      studios:  Array<{ id: number; name: string; media: { nodes: Array<{ id: number }> } }>;
      pageInfo: { hasNextPage: boolean };
    }
  }>(gql, { search: query, page, perPage });

  return {
    studios: (result?.Page?.studios ?? []).map((s) => ({
      id:          s.id,
      name:        s.name,
      works_count: s.media.nodes.length,
    })),
    hasNextPage: result?.Page?.pageInfo?.hasNextPage ?? false,
  };
}

export async function getAnilistStudioWorks(
  studioId: number, page = 1, perPage = 30
): Promise<{
  name: string;
  works_count: number;
  media: AniListMedia[];
  hasNextPage: boolean;
}> {
  const query = `
    query($id: Int, $page: Int, $perPage: Int) {
      Studio(id: $id) {
        name
        media(page: $page, perPage: $perPage, sort: POPULARITY_DESC, isMain: true) {
          pageInfo { total hasNextPage }
          nodes {
            ${MEDIA_FIELDS}
          }
        }
      }
    }
  `;
  const result = await anilistQuery<{
    Studio: {
      name:  string;
      media: {
        pageInfo: { total: number; hasNextPage: boolean };
        nodes:    AniListMedia[];
      };
    }
  }>(query, { id: studioId, page, perPage });

  return {
    name:        result?.Studio?.name        ?? '',
    works_count: result?.Studio?.media?.pageInfo?.total ?? 0,
    media:       result?.Studio?.media?.nodes ?? [],
    hasNextPage: result?.Studio?.media?.pageInfo?.hasNextPage ?? false,
  };
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

export function anilistTitle(media: AniListMedia): string {
  return (
    media.title.english ||
    media.title.romaji  ||
    media.title.userPreferred ||
    media.title.native  ||
    'Unknown'
  );
}

export function normalizeAnilistItem(
  media:  AniListMedia,
  spunId: string
): ContentItem {
  return {
    spun_id: spunId,
    type:    'anime',
    title:   anilistTitle(media),
    year:    media.startDate?.year ?? null,
    rating:  media.averageScore
      ? parseFloat((media.averageScore / 10).toFixed(1))
      : null,
    poster:  media.coverImage?.large ?? media.coverImage?.medium ?? null,
  };
}

export function mapAnilistStatus(status: string | null | undefined): string | null {
  switch (status) {
    case 'FINISHED':          return 'Ended';
    case 'RELEASING':         return 'Ongoing';
    case 'NOT_YET_RELEASED':  return 'Upcoming';
    case 'HIATUS':            return 'Hiatus';
    case 'CANCELLED':         return 'Cancelled';
    default:                  return null;
  }
}

export function getCurrentSeason(): { season: string; year: number } {
  const month = new Date().getMonth();
  const year  = new Date().getFullYear();
  let season: string;
  if (month >= 0  && month <= 2)  season = 'WINTER';
  else if (month >= 3 && month <= 5)  season = 'SPRING';
  else if (month >= 6 && month <= 8)  season = 'SUMMER';
  else season = 'FALL';
  return { season, year };
}

export function formatCountdown(airingAt: number): string {
  const now  = Date.now() / 1000;
  const diff = airingAt - now;
  if (diff <= 0) return 'Airing now';

  const days    = Math.floor(diff / 86400);
  const hours   = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  if (days > 0)  return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
