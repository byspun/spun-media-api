// worker/src/metadata/anilist.ts
// All AniList GraphQL calls — routed through the Vercel proxy at PROXY_BASE_URL.
// Direct calls to graphql.anilist.co from Cloudflare Workers are blocked
// (orange-to-orange Cloudflare IP detection). The Vercel proxy sidesteps this.
//
// Proxy endpoint: POST ${PROXY_BASE_URL}/api/anilist
// Auth header:    x-spun-proxy-secret: ${SPUN_PROXY_SECRET}
//
// All functions now accept `env: Env` as first argument so they can read
// PROXY_BASE_URL and SPUN_PROXY_SECRET at runtime.

import type { AniListMedia, ContentItem } from '../types/index.js';
import type { Env } from '../types/env.js';

const ALLOWED_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'];

// ─── GraphQL executor ─────────────────────────────────────────────────────────

async function anilistQuery<T>(
  env:       Env,
  query:     string,
  variables: Record<string, unknown> = {}
): Promise<T | null> {
  const baseUrl = env.PROXY_BASE_URL.replace(/\/$/, '');
  const proxyUrl = `${baseUrl}/api/anilist`;

  try {
    const res = await fetch(proxyUrl, {
      method:  'POST',
      headers: {
        'Content-Type':        'application/json',
        Accept:                'application/json',
        'x-spun-proxy-secret': env.SPUN_PROXY_SECRET ?? '',
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (!res.ok) {
      const msg = `[AniList Proxy] HTTP ${res.status}: ${text.slice(0, 100)}`;
      console.error(msg);
      return null;
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error(`[AniList Proxy] Non-JSON response: ${text.slice(0, 100)}`);
      return null;
    }

    if (json.errors?.length) {
      console.error('[AniList GraphQL Error]', json.errors.map((e: any) => e.message).join(', '));
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error('[AniList proxy fetch error]', err);
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
  startDate { year month day }
  description(asHtml: false)
  studios(isMain: true) { nodes { name isAnimationStudio } }
  synonyms
  trailer { id site }
  season
  seasonYear
  nextAiringEpisode { airingAt timeUntilAiring episode }
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

export async function getAnilistMedia(env: Env, anilistId: number): Promise<AniListMedia | null> {
  const query = `
    query($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FIELDS}
        characters(role: MAIN, sort: [RELEVANCE, ID], perPage: 15) {
          edges {
            node { name { full } image { large } }
            voiceActors(language: JAPANESE) { name { full } image { large } }
          }
        }
        relations {
          edges {
            relationType
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
        recommendations(perPage: 10, sort: [RATING_DESC, ID]) {
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
  const result = await anilistQuery<{ Media: AniListMedia }>(env, query, { id: anilistId });
  return result?.Media ?? null;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchAnilist(
  env:     Env,
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
  }>(env, gql, { search: query, page, perPage });

  return {
    media:       result?.Page?.media ?? [],
    hasNextPage: result?.Page?.pageInfo?.hasNextPage ?? false,
  };
}

// ─── Anime confirmation — is this title on AniList? ──────────────────────────

export async function isAnimeOnAnilist(env: Env, title: string): Promise<AniListMedia | null> {
  const results = await searchAnilist(env, title, 1, 5);
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

export async function getAnilistTrending(env: Env, page = 1, perPage = 20): Promise<AniListMedia[]> {
  const query = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: TRENDING_DESC, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(env, query, { page, perPage });
  return result?.Page?.media ?? [];
}

// ─── Popular ──────────────────────────────────────────────────────────────────

export async function getAnilistPopular(env: Env, page = 1, perPage = 20): Promise<AniListMedia[]> {
  const query = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: POPULARITY_DESC, type: ANIME, format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(env, query, { page, perPage });
  return result?.Page?.media ?? [];
}

// ─── Seasonal ─────────────────────────────────────────────────────────────────

export async function getAnilistSeasonal(
  env:    Env,
  season: string,
  year:   number,
  page   = 1,
  perPage = 20
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
    env, query, { season: season.toUpperCase(), year, page, perPage }
  );
  return result?.Page?.media ?? [];
}

// ─── Next season ──────────────────────────────────────────────────────────────

export async function getAnilistNextSeason(env: Env, page = 1, perPage = 20): Promise<AniListMedia[]> {
  const { season, year } = getNextSeason();
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
    env, query, { season, year, page, perPage }
  );
  return result?.Page?.media ?? [];
}

// ─── Upcoming ─────────────────────────────────────────────────────────────────

export async function getAnilistUpcoming(env: Env, page = 1, perPage = 20): Promise<AniListMedia[]> {
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
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(env, query, { page, perPage });
  return result?.Page?.media ?? [];
}

// ─── Currently airing ─────────────────────────────────────────────────────────

export async function getAnilistAiring(env: Env, page = 1, perPage = 20): Promise<AniListMedia[]> {
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
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(env, query, { page, perPage });
  return result?.Page?.media ?? [];
}

// ─── Top scored this season ───────────────────────────────────────────────────

export async function getAnilistSeasonTopScored(
  env:     Env,
  minScore = 75,
  page     = 1,
  perPage  = 30
): Promise<AniListMedia[]> {
  const { season, year } = getCurrentSeason();
  const query = `
    query($season: MediaSeason, $year: Int, $page: Int, $perPage: Int, $minScore: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          season: $season, seasonYear: $year,
          status: RELEASING,
          type: ANIME, format_in: [TV, TV_SHORT],
          averageScore_greater: $minScore,
          sort: SCORE_DESC
        ) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(
    env, query, { season: season.toUpperCase(), year, page, perPage, minScore }
  );
  return result?.Page?.media ?? [];
}

// ─── All seasons list ─────────────────────────────────────────────────────────

export async function getAnilistSeasonsList(env: Env): Promise<
  Array<{ year: number; season: string; count: number }>
> {
  const currentYear = new Date().getFullYear();
  const seasons: Array<{ year: number; season: string; count: number }> = [];
  const seasonNames = ['FALL', 'SUMMER', 'SPRING', 'WINTER'];

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
        env, query, { season: s, year: y }
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
  env: Env, page = 1, perPage = 25
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
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(env, query, { page, perPage });
  return result?.Page?.media ?? [];
}

export async function getAnilistRankingsPopular(
  env: Env, page = 1, perPage = 25
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
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(env, query, { page, perPage });
  return result?.Page?.media ?? [];
}

export async function getAnilistRankingsSeason(
  env: Env, year: number, season: string, page = 1, perPage = 25
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
    env, query, { season: season.toUpperCase(), year, page, perPage }
  );
  return result?.Page?.media ?? [];
}

export async function getAnilistRankingsGenre(
  env: Env, genre: string, page = 1, perPage = 25
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
    env, query, { genre, page, perPage }
  );
  return result?.Page?.media ?? [];
}

// ─── By genre ─────────────────────────────────────────────────────────────────

export async function getAnilistByGenre(
  env: Env, genre: string, page = 1, perPage = 20
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
    env, query, { genre, page, perPage }
  );
  return result?.Page?.media ?? [];
}

// ─── By tag ───────────────────────────────────────────────────────────────────

export async function getAnilistByTag(
  env: Env, tag: string, page = 1, perPage = 20
): Promise<AniListMedia[]> {
  const query = `
    query($tag: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          tag: $tag, type: ANIME,
          format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL],
          sort: POPULARITY_DESC
        ) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;
  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(
    env, query, { tag, page, perPage }
  );
  return result?.Page?.media ?? [];
}

// ─── Advanced filtered queries (for home rows) ────────────────────────────────

export async function getAnilistFiltered(
  env: Env,
  filters: {
    genre?:           string;
    tag?:             string;
    status?:          string;
    format?:          string;
    demographic?:     string;
    minScore?:        number;
    maxScore?:        number;
    minPopularity?:   number;
    maxPopularity?:   number;
    minFavourites?:   number;
    maxEpisodes?:     number;
    maxStartYear?:    number;
    sort?:            string;
  },
  page    = 1,
  perPage = 20
): Promise<AniListMedia[]> {
  const gqlFilters: string[] = ['type: ANIME', 'format_in: [TV, TV_SHORT, MOVIE, OVA, ONA, SPECIAL]'];
  const vars: Record<string, unknown> = { page, perPage };

  if (filters.genre)         { gqlFilters.push('genre: $genre');                 vars.genre = filters.genre; }
  if (filters.tag)           { gqlFilters.push('tag: $tag');                     vars.tag = filters.tag; }
  if (filters.status)        { gqlFilters.push('status: $status');               vars.status = filters.status.toUpperCase(); }
  if (filters.format)        { gqlFilters.push('format: $format');               vars.format = filters.format.toUpperCase(); }
  if (filters.demographic)   { gqlFilters.push('tag: $demographic');             vars.demographic = filters.demographic; }
  if (filters.minScore)      { gqlFilters.push('averageScore_greater: $minScore'); vars.minScore = filters.minScore; }
  if (filters.maxPopularity) { gqlFilters.push('popularity_lesser: $maxPop');   vars.maxPop = filters.maxPopularity; }
  if (filters.minPopularity) { gqlFilters.push('popularity_greater: $minPop');  vars.minPop = filters.minPopularity; }
  if (filters.minFavourites) { gqlFilters.push('favourites_greater: $minFav');  vars.minFav = filters.minFavourites; }
  if (filters.maxEpisodes)   { gqlFilters.push('episodes_lesser: $maxEp');      vars.maxEp = filters.maxEpisodes; }
  if (filters.maxStartYear)  { gqlFilters.push('startDate_lesser: $maxYear');   vars.maxYear = `${filters.maxStartYear}1231`; }

  const sortVal = filters.sort ?? 'POPULARITY_DESC';

  const gqlVarDefs = [
    '$page: Int', '$perPage: Int',
    filters.genre         ? '$genre: String'          : null,
    filters.tag           ? '$tag: String'            : null,
    filters.status        ? '$status: MediaStatus'    : null,
    filters.format        ? '$format: MediaFormat'    : null,
    filters.demographic   ? '$demographic: String'    : null,
    filters.minScore      ? '$minScore: Int'          : null,
    filters.maxPopularity ? '$maxPop: Int'            : null,
    filters.minPopularity ? '$minPop: Int'            : null,
    filters.minFavourites ? '$minFav: Int'            : null,
    filters.maxEpisodes   ? '$maxEp: Int'             : null,
    filters.maxStartYear  ? '$maxYear: FuzzyDateInt'  : null,
  ].filter(Boolean).join(', ');

  const query = `
    query(${gqlVarDefs}) {
      Page(page: $page, perPage: $perPage) {
        media(${gqlFilters.join(', ')}, sort: ${sortVal}) {
          ${MEDIA_FIELDS}
        }
      }
    }
  `;

  const result = await anilistQuery<{ Page: { media: AniListMedia[] } }>(env, query, vars);
  return result?.Page?.media ?? [];
}

// ─── By format ────────────────────────────────────────────────────────────────

export async function getAnilistByFormat(
  env: Env, format: string, page = 1, perPage = 20
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
  }>(env, query, { format: format.toUpperCase(), page, perPage });

  return {
    media:       result?.Page?.media ?? [],
    total:       result?.Page?.pageInfo?.total ?? 0,
    hasNextPage: result?.Page?.pageInfo?.hasNextPage ?? false,
  };
}

// ─── By demographic (tag-based) ───────────────────────────────────────────────

export async function getAnilistByDemographic(
  env: Env, demographic: string, page = 1, perPage = 20
): Promise<{ media: AniListMedia[]; total: number; hasNextPage: boolean }> {
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
  }>(env, query, { tag, page, perPage });

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
  env: Env, source: string, page = 1, perPage = 20
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
  }>(env, query, { source: sourceVal, page, perPage });

  return {
    media:       result?.Page?.media ?? [],
    total:       result?.Page?.pageInfo?.total ?? 0,
    hasNextPage: result?.Page?.pageInfo?.hasNextPage ?? false,
  };
}

// ─── Studios ──────────────────────────────────────────────────────────────────

export async function getAnilistStudios(
  env: Env, query?: string, page = 1, perPage = 20
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
  }>(env, gql, { search: query, page, perPage });

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
  env: Env, studioId: number, page = 1, perPage = 20
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
  }>(env, query, { id: studioId, page, perPage });

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

export function getNextSeason(): { season: string; year: number } {
  const { season, year } = getCurrentSeason();
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const idx   = order.indexOf(season);
  const next  = order[(idx + 1) % 4];
  return { season: next, year: next === 'WINTER' ? year + 1 : year };
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
