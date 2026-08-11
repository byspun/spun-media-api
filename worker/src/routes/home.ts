// worker/src/routes/home.ts
// Homepage endpoints:
//   GET /home          — combined snapshot (movies + TV + anime)
//   GET /home/movie    — movie homepage
//   GET /home/tv       — TV homepage
//   GET /home/anime    — anime homepage
//
// Each returns { hero: ContentItem[], rows: HomeRow[] }
// Built from parallel metadata calls, cached for 24h.

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import type { ContentItem, HomeRow, HomeResponse } from '../types/index.js';
import { kvGet, kvSet, CacheKeys, TTL } from '../cache.js';
import {
  getTmdbTrending,
  tmdbDiscover,
  tmdbPoster,
} from '../metadata/tmdb.js';
import {
  getAnilistTrending,
  getAnilistAiring,
  getAnilistUpcoming,
  getAnilistSeasonal,
  getCurrentSeason,
  anilistTitle,
} from '../metadata/anilist.js';
import { resolveFromTmdb, resolveFromAnilist } from '../identity/resolver.js';
import { tmdbResultToItem, anilistToItem, jsonResponse } from '../normalizer.js';
import { getDb } from '../db.js';

const home = new Hono<{ Bindings: Env }>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function tmdbListToItems(
  env:  Env,
  raw:  Array<{ id: number; title?: string; name?: string; media_type?: string; [key: string]: any }>,
  type: 'movie' | 'tv'
): Promise<ContentItem[]> {
  return Promise.all(
    raw.slice(0, 20).map(async (r) => {
      const title = r.title || r.name || '';
      const row   = await resolveFromTmdb(env, r.id, type, title);
      return tmdbResultToItem(r, row.spun_id, type);
    })
  );
}

async function anilistListToItems(
  env:   Env,
  media: Array<any>
): Promise<ContentItem[]> {
  return Promise.all(
    media.slice(0, 20).map(async (m) => {
      const title = anilistTitle(m);
      const row   = await resolveFromAnilist(env, m.id, title, { malId: m.idMal ?? undefined });
      return anilistToItem(m, row.spun_id);
    })
  );
}

// ─── Movie homepage ───────────────────────────────────────────────────────────

async function buildMovieHome(env: Env): Promise<HomeResponse> {
  const currentYear = new Date().getFullYear();

  const [trending, popular, topRated, action, horror, scifi, newReleases] = await Promise.all([
    getTmdbTrending(env, 'movie'),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc' }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'vote_count.gte': 1000 }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '28' }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '27' }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '878' }),
    tmdbDiscover(env, 'movie', {
      sort_by:                      'release_date.desc',
      'primary_release_date.gte':   `${currentYear - 1}-01-01`,
      'vote_count.gte':             50,
    }),
  ]);

  const [heroItems, popularItems, topItems, actionItems, horrorItems, scifiItems, newItems] =
    await Promise.all([
      tmdbListToItems(env, trending.slice(0, 5),  'movie'),
      tmdbListToItems(env, popular,               'movie'),
      tmdbListToItems(env, topRated,              'movie'),
      tmdbListToItems(env, action,                'movie'),
      tmdbListToItems(env, horror,                'movie'),
      tmdbListToItems(env, scifi,                 'movie'),
      tmdbListToItems(env, newReleases,           'movie'),
    ]);

  return {
    hero: heroItems,
    rows: [
      { id: 'popular',      title: 'Popular Movies',     items: popularItems },
      { id: 'new',          title: 'New Releases',       items: newItems     },
      { id: 'top-rated',    title: 'Top Rated',          items: topItems     },
      { id: 'action',       title: 'Action & Adventure', items: actionItems  },
      { id: 'horror',       title: 'Horror',             items: horrorItems  },
      { id: 'sci-fi',       title: 'Sci-Fi',             items: scifiItems   },
    ],
  };
}

// ─── TV homepage ──────────────────────────────────────────────────────────────

async function buildTvHome(env: Env): Promise<HomeResponse> {
  const [trending, popular, topRated, drama, action, comedy] = await Promise.all([
    getTmdbTrending(env, 'tv'),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc' }),
    tmdbDiscover(env, 'tv', { sort_by: 'vote_average.desc', 'vote_count.gte': 500 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_genres: '18' }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_genres: '10759' }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_genres: '35' }),
  ]);

  const [heroItems, popularItems, topItems, dramaItems, actionItems, comedyItems] =
    await Promise.all([
      tmdbListToItems(env, trending.slice(0, 5), 'tv'),
      tmdbListToItems(env, popular,              'tv'),
      tmdbListToItems(env, topRated,             'tv'),
      tmdbListToItems(env, drama,                'tv'),
      tmdbListToItems(env, action,               'tv'),
      tmdbListToItems(env, comedy,               'tv'),
    ]);

  return {
    hero: heroItems,
    rows: [
      { id: 'popular',   title: 'Popular Series',     items: popularItems },
      { id: 'top-rated', title: 'Top Rated',          items: topItems     },
      { id: 'drama',     title: 'Drama',              items: dramaItems   },
      { id: 'action',    title: 'Action & Adventure', items: actionItems  },
      { id: 'comedy',    title: 'Comedy',             items: comedyItems  },
    ],
  };
}

// ─── Anime homepage ───────────────────────────────────────────────────────────

async function buildAnimeHome(env: Env): Promise<HomeResponse> {
  const { season, year } = getCurrentSeason();

  const [trending, airing, upcoming, seasonal, action, romance, isekai] = await Promise.all([
    getAnilistTrending(1, 20),
    getAnilistAiring(1, 20),
    getAnilistUpcoming(1, 10),
    getAnilistSeasonal(season, year, 1, 20),
    // Genre rows via AniList
    (async () => {
      const { getAnilistByGenre } = await import('../metadata/anilist.js');
      return getAnilistByGenre('Action', 1, 20);
    })(),
    (async () => {
      const { getAnilistByGenre } = await import('../metadata/anilist.js');
      return getAnilistByGenre('Romance', 1, 20);
    })(),
    (async () => {
      const { getAnilistByGenre } = await import('../metadata/anilist.js');
      return getAnilistByGenre('Isekai', 1, 20);
    })(),
  ]);

  const [
    heroItems, airingItems, upcomingItems,
    seasonalItems, actionItems, romanceItems, isekaiItems,
  ] = await Promise.all([
    anilistListToItems(env, trending.slice(0, 5)),
    anilistListToItems(env, airing),
    anilistListToItems(env, upcoming),
    anilistListToItems(env, seasonal),
    anilistListToItems(env, action),
    anilistListToItems(env, romance),
    anilistListToItems(env, isekai),
  ]);

  const seasonLabel = `${season.charAt(0) + season.slice(1).toLowerCase()} ${year}`;

  return {
    hero: heroItems,
    rows: [
      { id: 'airing',   title: 'Currently Airing',  items: airingItems   },
      { id: 'seasonal', title: seasonLabel,          items: seasonalItems },
      { id: 'upcoming', title: 'Upcoming',           items: upcomingItems },
      { id: 'action',   title: 'Action',             items: actionItems   },
      { id: 'romance',  title: 'Romance',            items: romanceItems  },
      { id: 'isekai',   title: 'Isekai',             items: isekaiItems   },
    ],
  };
}

// ─── GET /home/movie ──────────────────────────────────────────────────────────

home.get('/movie', async (c) => {
  const cacheKey = CacheKeys.home('movie');
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const payload = await buildMovieHome(c.env);
  await kvSet(c.env, cacheKey, payload, TTL.home);
  return jsonResponse(payload);
});

// ─── GET /home/tv ─────────────────────────────────────────────────────────────

home.get('/tv', async (c) => {
  const cacheKey = CacheKeys.home('tv');
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const payload = await buildTvHome(c.env);
  await kvSet(c.env, cacheKey, payload, TTL.home);
  return jsonResponse(payload);
});

// ─── GET /home/anime ──────────────────────────────────────────────────────────

home.get('/anime', async (c) => {
  const cacheKey = CacheKeys.home('anime');
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  const payload = await buildAnimeHome(c.env);
  await kvSet(c.env, cacheKey, payload, TTL.home);
  return jsonResponse(payload);
});

// ─── GET /home ────────────────────────────────────────────────────────────────

home.get('/', async (c) => {
  const cacheKey = CacheKeys.home('all');
  const cached   = await kvGet(c.env, cacheKey);
  if (cached) return jsonResponse(cached);

  // Build all three in parallel
  const [movieHome, tvHome, animeHome] = await Promise.all([
    buildMovieHome(c.env),
    buildTvHome(c.env),
    buildAnimeHome(c.env),
  ]);

  const payload = {
    movie: movieHome,
    tv:    tvHome,
    anime: animeHome,
  };

  await kvSet(c.env, cacheKey, payload, TTL.home);
  return jsonResponse(payload);
});

export default home;
