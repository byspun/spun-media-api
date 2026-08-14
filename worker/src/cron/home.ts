// worker/src/cron/home.ts
// Home page builders for Cron Triggers.
// These functions do the heavy lifting of fetching from upstream APIs,
// resolving spun_ids in batch, and caching the final results in KV.

import type { Env } from '../types/env.js';
import type { AniListMedia, ContentItem } from '../types/index.js';
import { kvSet, CacheKeys, TTL } from '../cache.js';
import { getTmdbTrending, tmdbDiscover } from '../metadata/tmdb.js';
import {
  getAnilistTrending,
  getAnilistAiring,
  getAnilistNextSeason,
  getAnilistSeasonal,
  getAnilistByGenre,
  getAnilistByTag,
  getAnilistFiltered,
  getAnilistStudioWorks,
  getAnilistSeasonTopScored,
  getAnilistRankingsAlltime,
  getAnilistRankingsPopular,
  getCurrentSeason,
  anilistTitle,
} from '../metadata/anilist.js';
import { batchResolveFromTmdb, batchResolveFromAnilist, getBySpunId } from '../identity/resolver.js';
import { tmdbResultToItem, anilistToItem } from '../normalizer.js';
import { getDb } from '../db.js';

// Config imports
import { homeHero }   from '../config/hero/home.js';
import { movieHero }  from '../config/hero/movie.js';
import { tvHero }     from '../config/hero/tv.js';
import { animeHero }  from '../config/hero/anime.js';
import {
  mcu, dceu, dcu, fastFurious, missionImpossible, jamesBond,
  marvelTv, starWars, attackOnTitan, fateUniverse, shounenBigThree,
  dragonBall, monogatari, gundam, typeMoon,
} from '../config/franchises/index.js';
import type { FranchiseEntry } from '../config/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_MAX  = 20; // Reduced from 30 to stay within subrequest limits
const HERO_MAX = 7;

// ─── Shared converters (Batch Optimized) ──────────────────────────────────────

async function tmdbToItems(
  env:  Env,
  raw:  Array<Record<string, any>>,
  type: 'movie' | 'tv',
  limit = ROW_MAX
): Promise<ContentItem[]> {
  const slice = raw.slice(0, limit);
  if (!slice.length) return [];

  const resolveItems = slice.map((r) => ({
    id:    r.id,
    title: r.title || r.name || '',
  }));

  const rows = await batchResolveFromTmdb(env, resolveItems, type);
  
  // Map rows back to items in original order
  return slice.map((r) => {
    const row = rows.find((row) => Number(row.tmdb_id) === r.id);
    return tmdbResultToItem(r, row?.spun_id || `pending-${r.id}`, type);
  });
}

async function anilistToItems(
  env:   Env,
  media: AniListMedia[],
  limit = ROW_MAX
): Promise<ContentItem[]> {
  const slice = media.slice(0, limit);
  if (!slice.length) return [];

  const resolveItems = slice.map((m) => ({
    id:    m.id,
    title: anilistTitle(m),
    malId: m.idMal ?? undefined,
  }));

  const rows = await batchResolveFromAnilist(env, resolveItems);

  return slice.map((m) => {
    const row = rows.find((row) => Number(row.anilist_id) === m.id);
    return anilistToItem(m, row?.spun_id || `pending-${m.id}`);
  });
}

// ─── Franchise row builder ────────────────────────────────────────────────────

async function franchiseRow(
  env:     Env,
  id:      string,
  title:   string,
  entries: FranchiseEntry[]
): Promise<{ id: string; title: string; items: ContentItem[] }> {
  const sorted = [...entries].sort((a, b) => a.order - b.order);
  const filled = sorted.filter((e) => !e.spun_id.includes('xxxxxx'));

  const items: Array<ContentItem | null> = await Promise.all(
    filled.map(async (e) => {
      const row = await getBySpunId(env, e.spun_id);
      if (!row) return null;

      return {
        spun_id: e.spun_id,
        type:    row.content_type as 'movie' | 'tv' | 'anime',
        title:   row.title       ?? '',
        year:    null,
        rating:  null,
        poster:  null,
      } satisfies ContentItem;
    })
  );

  return { 
    id, 
    title, 
    items: items.filter((i): i is ContentItem => i !== null) 
  };
}

// ─── Hero assembly ────────────────────────────────────────────────────────────

async function buildHero(
  env:             Env,
  overrides:       Array<{ spun_id: string; note: string | null }>,
  pool:            ContentItem[]
): Promise<ContentItem[]> {
  const hero: ContentItem[] = [];
  const seen  = new Set<string>();

  if (overrides.length) {
    for (const o of overrides) {
      if (hero.length >= HERO_MAX) break;
      if (seen.has(o.spun_id)) continue;
      try {
        const row = await getBySpunId(env, o.spun_id);
        if (row) {
          hero.push({
            spun_id: o.spun_id,
            type:    row.content_type as 'movie' | 'tv' | 'anime',
            title:   row.title       ?? '',
            year:    null,
            rating:  null,
            poster:  null,
          });
          seen.add(o.spun_id);
        }
      } catch { /* skip */ }
    }
  }

  for (const item of pool) {
    if (hero.length >= HERO_MAX) break;
    if (seen.has(item.spun_id)) continue;
    if ((item.rating ?? 0) >= 7.5 && item.poster) {
      hero.push(item);
      seen.add(item.spun_id);
    }
  }

  return hero;
}

function merge(...arrays: ContentItem[][]): ContentItem[] {
  const seen   = new Set<string>();
  const result: ContentItem[] = [];
  for (const arr of arrays) {
    for (const item of arr) {
      if (!seen.has(item.spun_id)) {
        seen.add(item.spun_id);
        result.push(item);
      }
    }
  }
  return result;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

export async function buildMovieHome(env: Env) {
  const year = new Date().getFullYear();
  const [
    trending, nowPlaying, upcoming, thisYear, allTimeGreats, hiddenGems,
    action, comedy, scifi, romance, horror, shortWatch, epicWatch, awardWinners,
    worldCinema, docs, animated, throwback,
  ] = await Promise.all([
    getTmdbTrending(env, 'movie'),
    tmdbDiscover(env, 'movie', { sort_by: 'release_date.desc', 'primary_release_date.gte': `${year}-01-01`, 'vote_count.gte': 50 }),
    tmdbDiscover(env, 'movie', { sort_by: 'primary_release_date.asc', 'primary_release_date.gte': `${year}-01-01`, 'primary_release_date.lte': `${year + 1}-12-31`, 'with_release_type': '2|3' }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'primary_release_date.gte': `${year}-01-01`, 'vote_count.gte': 200 }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'vote_count.gte': 1000 }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'vote_average.gte': 7.5, 'popularity.lte': 20, 'vote_count.gte': 100 }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '28,53' }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '35' }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', with_genres: '878,9648' }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '10749,18' }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', with_genres: '27', 'vote_count.gte': 200 }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', 'with_runtime.lte': 90, 'vote_average.gte': 7.0 }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'with_runtime.gte': 150 }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'vote_average.gte': 8.0, 'vote_count.gte': 1000 }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', 'with_original_language': 'xx', 'vote_average.gte': 7.5 }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', with_genres: '99', 'vote_count.gte': 100 }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '16', without_keywords: '210024' }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'primary_release_date.lte': '1999-12-31', 'vote_average.gte': 7.5 }),
  ]);

  const [
    trendingItems, nowPlayingItems, upcomingItems, thisYearItems, allTimeItems, hiddenItems,
    actionItems, comedyItems, scifiItems, romanceItems, horrorItems, shortItems, epicItems,
    awardItems, worldItems, docsItems, animatedItems, throwbackItems,
  ] = await Promise.all([
    tmdbToItems(env, trending,      'movie'),
    tmdbToItems(env, nowPlaying,    'movie'),
    tmdbToItems(env, upcoming,      'movie'),
    tmdbToItems(env, thisYear,      'movie'),
    tmdbToItems(env, allTimeGreats, 'movie'),
    tmdbToItems(env, hiddenGems,    'movie'),
    tmdbToItems(env, action,        'movie'),
    tmdbToItems(env, comedy,        'movie'),
    tmdbToItems(env, scifi,         'movie'),
    tmdbToItems(env, romance,       'movie'),
    tmdbToItems(env, horror,        'movie'),
    tmdbToItems(env, shortWatch,    'movie'),
    tmdbToItems(env, epicWatch,     'movie'),
    tmdbToItems(env, awardWinners,  'movie'),
    tmdbToItems(env, worldCinema,   'movie'),
    tmdbToItems(env, docs,          'movie'),
    tmdbToItems(env, animated,      'movie'),
    tmdbToItems(env, throwback,     'movie'),
  ]);

  const [mcuRow, dceuRow, dcuRow, ffRow, miRow, bondRow] = await Promise.all([
    franchiseRow(env, 'mcu',               'MCU Line-Up',           mcu),
    franchiseRow(env, 'dceu',              'DC Extended Universe',   dceu),
    franchiseRow(env, 'dcu',               'DC Universe',            dcu),
    franchiseRow(env, 'fast-furious',      'Fast & Furious',         fastFurious),
    franchiseRow(env, 'mission-impossible', 'Mission: Impossible',   missionImpossible),
    franchiseRow(env, 'james-bond',        'James Bond',             jamesBond),
  ]);

  const hero = await buildHero(env, movieHero, trendingItems);

  return {
    hero,
    rows: [
      { id: 'in-cinemas',          title: 'In Cinemas Now',        items: nowPlayingItems },
      { id: 'coming-soon',         title: 'Coming Soon',           items: upcomingItems   },
      mcuRow, dceuRow, dcuRow,
      { id: 'this-year',           title: "This Year's Best",      items: thisYearItems   },
      { id: 'all-time-greats',     title: 'All-Time Greats',       items: allTimeItems    },
      { id: 'hidden-gems',         title: 'Hidden Gems',           items: hiddenItems     },
      { id: 'action-adrenaline',   title: 'Action & Adrenaline',   items: actionItems     },
      { id: 'make-you-laugh',      title: 'Make You Laugh',        items: comedyItems     },
      { id: 'make-you-think',      title: 'Make You Think',        items: scifiItems      },
      { id: 'make-you-feel',       title: 'Make You Feel',         items: romanceItems    },
      { id: 'horror-vault',        title: 'Horror Vault',          items: horrorItems     },
      ffRow, miRow, bondRow,
      { id: 'short-watch',         title: 'Short Watch',           items: shortItems      },
      { id: 'epic-watch',          title: 'Epic Watch',            items: epicItems       },
      { id: 'award-winners',       title: 'Award Winners',         items: awardItems      },
      { id: 'world-cinema',        title: 'World Cinema',          items: worldItems      },
      { id: 'documentaries',       title: 'Documentaries',         items: docsItems       },
      { id: 'animated-films',      title: 'Animated Films',        items: animatedItems   },
      { id: 'throwback',           title: 'Throwback',             items: throwbackItems  },
      { id: 'bollywood',           title: 'Bollywood & Beyond',    items: []              },
    ],
  };
}

export async function buildTvHome(env: Env) {
  const year      = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const month30   = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [
    trending, onTheAir, newSeasons, netflix, thisYear, allTimeGreats, bingeWorthy,
    cantLookAway, comedy, feel, sciFiFantasy,
    miniseries, hiddenGems, longRunners,
    kDrama, british, hbo, a24, critAcc, ended, throwback,
  ] = await Promise.all([
    getTmdbTrending(env, 'tv'),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', 'air_date.gte': new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', 'first_air_date.gte': month30, 'vote_count.gte': 10 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_watch_providers: '8', watch_region: 'US' }),
    tmdbDiscover(env, 'tv', { sort_by: 'vote_average.desc', 'first_air_date.gte': yearStart, 'vote_average.gte': 7.5, 'vote_count.gte': 50 }),
    tmdbDiscover(env, 'tv', { sort_by: 'vote_average.desc', 'vote_count.gte': 500 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', 'vote_average.gte': 7.5, 'vote_count.gte': 100 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_genres: '80,9648,53' }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_genres: '35' }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_genres: '10749,18', 'vote_average.gte': 7.0 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_genres: '10765' }),
    tmdbDiscover(env, 'tv', { sort_by: 'vote_average.desc', with_genres: '18', 'with_runtime.lte': 450, 'vote_count.gte': 100 }),
    tmdbDiscover(env, 'tv', { sort_by: 'vote_average.desc', 'vote_average.gte': 7.5, 'popularity.lte': 15 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', 'vote_count.gte': 1000 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_origin_country: 'KR' }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_origin_country: 'GB' }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_networks: '49', 'vote_count.gte': 100 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_companies: '41077' }),
    tmdbDiscover(env, 'tv', { sort_by: 'vote_average.desc', 'vote_average.gte': 8.0, 'vote_count.gte': 500 }),
    tmdbDiscover(env, 'tv', { sort_by: 'popularity.desc', with_status: '3' }),
    tmdbDiscover(env, 'tv', { sort_by: 'vote_average.desc', 'first_air_date.lte': '2005-12-31', 'vote_average.gte': 7.5 }),
  ]);

  const [
    trendingItems, onAirItems, newItems, netflixItems, thisYearItems, allTimeItems, bingeItems,
    thrillerItems, comedyItems, feelItems, scifiItems, miniItems, hiddenItems, longItems,
    kDramaItems, britishItems, hboItems, a24Items, critItems, endedItems, throwbackItems,
  ] = await Promise.all([
    tmdbToItems(env, trending,      'tv'),
    tmdbToItems(env, onTheAir,      'tv'),
    tmdbToItems(env, newSeasons,    'tv'),
    tmdbToItems(env, netflix,       'tv'),
    tmdbToItems(env, thisYear,      'tv'),
    tmdbToItems(env, allTimeGreats, 'tv'),
    tmdbToItems(env, bingeWorthy,   'tv'),
    tmdbToItems(env, cantLookAway,  'tv'),
    tmdbToItems(env, comedy,        'tv'),
    tmdbToItems(env, feel,          'tv'),
    tmdbToItems(env, sciFiFantasy,  'tv'),
    tmdbToItems(env, miniseries,    'tv'),
    tmdbToItems(env, hiddenGems,    'tv'),
    tmdbToItems(env, longRunners,   'tv'),
    tmdbToItems(env, kDrama,        'tv'),
    tmdbToItems(env, british,       'tv'),
    tmdbToItems(env, hbo,           'tv'),
    tmdbToItems(env, a24,           'tv'),
    tmdbToItems(env, critAcc,       'tv'),
    tmdbToItems(env, ended,         'tv'),
    tmdbToItems(env, throwback,     'tv'),
  ]);

  const marvelTvRow = await franchiseRow(env, 'marvel-tv', 'Marvel TV Universe', marvelTv);
  const starWarsRow = await franchiseRow(env, 'star-wars', 'Star Wars Universe', starWars);
  const hero        = await buildHero(env, tvHero, trendingItems);

  return {
    hero,
    rows: [
      { id: 'trending-tv',         title: 'Trending TV Shows',     items: trendingItems },
      { id: 'on-the-air',          title: 'On the Air Now',        items: onAirItems    },
      { id: 'new-seasons',         title: 'New Seasons',           items: newItems      },
      { id: 'netflix-originals',   title: 'Only on Netflix',       items: netflixItems  },
      marvelTvRow, starWarsRow,
      { id: 'this-year-tv',        title: "This Year's Best",      items: thisYearItems },
      { id: 'all-time-greats-tv',  title: 'All-Time Greats',       items: allTimeItems  },
      { id: 'binge-worthy',        title: 'Binge-Worthy Series',   items: bingeItems    },
      { id: 'cant-look-away',      title: "Can't Look Away",       items: thrillerItems },
      { id: 'laugh-out-loud',      title: 'Laugh Out Loud',        items: comedyItems   },
      { id: 'feels-and-drama',     title: 'Feels & Drama',         items: feelItems     },
      { id: 'sci-fi-fantasy',      title: 'Sci-Fi & Fantasy',      items: scifiItems    },
      { id: 'limited-series',      title: 'Limited Series',        items: miniItems     },
      { id: 'hidden-gems-tv',      title: 'Hidden Gems',           items: hiddenItems   },
      { id: 'long-running-hits',   title: 'Long-Running Hits',     items: longItems     },
      { id: 'k-drama',             title: 'K-Drama',               items: kDramaItems   },
      { id: 'british-invasion',    title: 'Best of British',       items: britishItems  },
      { id: 'hbo-collection',      title: 'The HBO Collection',    items: hboItems      },
      { id: 'a24-tv',              title: 'A24 Television',        items: a24Items      },
      { id: 'critically-acclaimed', title: 'Critically Acclaimed',   items: critItems     },
      { id: 'completed-series',    title: 'Completed Series',      items: endedItems    },
      { id: 'tv-throwback',        title: 'TV Throwback',          items: throwbackItems },
    ],
  };
}

export async function buildAnimeHome(env: Env) {
  const [
    trending, airing, nextSeason, seasonTop, allTime, popular,
    otaku, startHere, action, comedy, romance, dark, isekai, shonen,
    hidden, films, mappa, ufotable, ghibli, classic, rewatch,
  ] = await Promise.all([
    getAnilistTrending(env, 1, 20),
    getAnilistAiring(env, 1, 20),
    getAnilistNextSeason(env, 1, 20),
    getAnilistSeasonTopScored(env, 1, 20),
    getAnilistRankingsAlltime(env, 1, 20),
    getAnilistRankingsPopular(env, 1, 20),
    getAnilistFiltered(env, { minScore: 80, maxPopularity: 100000, sort: 'SCORE_DESC' }),
    getAnilistFiltered(env, { minPopularity: 500000, sort: 'POPULARITY_DESC' }),
    getAnilistByGenre(env, 'Action', 1, 20),
    getAnilistByGenre(env, 'Comedy', 1, 20),
    getAnilistByGenre(env, 'Romance', 1, 20),
    getAnilistByTag(env, 'Psychological', 1, 20),
    getAnilistByTag(env, 'Isekai', 1, 20),
    getAnilistFiltered(env, { tag: 'Shounen', sort: 'POPULARITY_DESC' }),
    getAnilistFiltered(env, { minScore: 82, maxPopularity: 50000, sort: 'SCORE_DESC' }),
    getAnilistFiltered(env, { format: 'MOVIE', sort: 'SCORE_DESC' }),
    getAnilistStudioWorks(env, 569, 1),
    getAnilistStudioWorks(env, 43, 1),
    getAnilistStudioWorks(env, 21, 1),
    getAnilistFiltered(env, { maxStartYear: 2005, minScore: 75, sort: 'SCORE_DESC' }),
    getAnilistFiltered(env, { minScore: 70, sort: 'TRENDING_DESC' }),
  ]);

  const [
    trendingItems, airingItems, nextSeasonItems, seasonTopItems, allTimeItems, popularItems,
    otakuItems, startHereItems, actionItems, comedyItems, romanceItems, darkItems, isekaiItems, shonenItems,
    hiddenItems, filmsItems, mappaItems, ufotableItems, ghibliItems, classicItems, rewatchItems,
  ] = await Promise.all([
    anilistToItems(env, trending),
    anilistToItems(env, airing),
    anilistToItems(env, nextSeason),
    anilistToItems(env, seasonTop),
    anilistToItems(env, allTime),
    anilistToItems(env, popular),
    anilistToItems(env, otaku),
    anilistToItems(env, startHere),
    anilistToItems(env, action),
    anilistToItems(env, comedy),
    anilistToItems(env, romance),
    anilistToItems(env, dark),
    anilistToItems(env, isekai),
    anilistToItems(env, shonen),
    anilistToItems(env, hidden),
    anilistToItems(env, films),
    anilistToItems(env, mappa.media),
    anilistToItems(env, ufotable.media),
    anilistToItems(env, ghibli.media),
    anilistToItems(env, classic),
    anilistToItems(env, rewatch),
  ]);

  const [aotRow, fateRow, bigThreeRow, dbRow, monogatariRow, gundamRow, typeMoonRow] = await Promise.all([
    franchiseRow(env, 'attack-on-titan',  'Attack on Titan',   attackOnTitan),
    franchiseRow(env, 'fate-universe',    'Fate Universe',     fateUniverse),
    franchiseRow(env, 'shounen-big-three', 'Shounen Big Three', shounenBigThree),
    franchiseRow(env, 'dragon-ball',      'Dragon Ball',       dragonBall),
    franchiseRow(env, 'monogatari',       'Monogatari Series', monogatari),
    franchiseRow(env, 'gundam',           'Gundam Universe',   gundam),
    franchiseRow(env, 'type-moon',        'Type-Moon World',   typeMoon),
  ]);

  const hero = await buildHero(env, animeHero, trendingItems);

  return {
    hero,
    rows: [
      { id: 'airing-this-season', title: 'Airing This Season',        items: airingItems      },
      { id: 'next-season',        title: 'Next Season Preview',        items: nextSeasonItems  },
      aotRow, fateRow, bigThreeRow,
      { id: 'this-season-top',    title: "This Season's Top Picks",    items: seasonTopItems   },
      { id: 'all-time-greatest',  title: 'All-Time Greatest',          items: allTimeItems     },
      { id: 'most-popular',       title: 'Most Popular Ever',          items: popularItems     },
      dbRow, monogatariRow, gundamRow, typeMoonRow,
      { id: 'for-the-otaku',      title: 'For the Otaku',              items: otakuItems       },
      { id: 'start-here',         title: 'New to Anime? Start Here',   items: startHereItems   },
      { id: 'action-hype',        title: 'Action & Hype',              items: actionItems      },
      { id: 'laugh-out-loud',     title: 'Laugh Out Loud',             items: comedyItems      },
      { id: 'feels-romance',      title: 'Feels & Romance',            items: romanceItems     },
      { id: 'dark-psychological', title: 'Dark & Psychological',       items: darkItems        },
      { id: 'isekai-universe',    title: 'Isekai Universe',            items: isekaiItems      },
      { id: 'shonen-legends',     title: 'Shonen Legends',             items: shonenItems      },
      { id: 'hidden-masterpieces', title: 'Hidden Masterpieces',       items: hiddenItems      },
      { id: 'anime-films',        title: 'Anime Films',                items: filmsItems       },
      { id: 'studio-mappa',       title: 'By Studio — MAPPA',          items: mappaItems       },
      { id: 'studio-ufotable',    title: 'By Studio — Ufotable',       items: ufotableItems    },
      { id: 'studio-ghibli',      title: 'By Studio — Ghibli',         items: ghibliItems      },
      { id: 'classic-era',        title: 'Classic Era',                items: classicItems     },
      { id: 'currently-rewatching', title: 'Currently Rewatching',     items: rewatchItems     },
    ],
  };
}

export async function buildGeneralHome(env: Env) {
  const year = new Date().getFullYear();
  const { season } = getCurrentSeason();

  const [
    tmdbTrending, tmdbNowPlaying, tmdbOnAir,
    anilistTrending, anilistAiring, anilistSeasonal,
    tmdbAction, anilistAction, tmdbComedy, anilistComedy,
    tmdbThriller, anilistPsych, tmdbFeel, anilistSliceOfLife,
    tmdbScifi, anilistScifi, tmdbHorror, anilistDark,
    animeAllTime, animeSeason, animeShort, animeClassic, animeOtaku, animeFilms,
    tmdbCritAcc, tmdbHiddenGems, anilistHiddenGems,
    tmdbBinge, tmdbShortWatch, tmdbShortTv, tmdbKDrama,
  ] = await Promise.all([
    getTmdbTrending(env, 'all'),
    tmdbDiscover(env, 'movie', { sort_by: 'release_date.desc', 'primary_release_date.gte': `${year}-01-01` }),
    tmdbDiscover(env, 'tv',    { sort_by: 'popularity.desc', 'air_date.gte': new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] }),
    getAnilistTrending(env, 1, 20),
    getAnilistAiring(env, 1, 20),
    getAnilistSeasonal(env, season, year, 1, 20),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '28,53' }),
    getAnilistByGenre(env, 'Action', 1, 20),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '35' }),
    getAnilistByGenre(env, 'Comedy', 1, 20),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '53,9648,80' }),
    getAnilistByTag(env, 'Psychological', 1, 20),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '10749,10751', 'vote_average.gte': 7.0 }),
    getAnilistByGenre(env, 'Slice of Life', 1, 20),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '878,9648' }),
    getAnilistFiltered(env, { genre: 'Sci-Fi', sort: 'POPULARITY_DESC' }),
    tmdbDiscover(env, 'movie', { sort_by: 'popularity.desc', with_genres: '27,53' }),
    getAnilistFiltered(env, { tag: 'Psychological', minScore: 75, sort: 'SCORE_DESC' }),
    getAnilistRankingsAlltime(env, 1, 20),
    getAnilistSeasonal(env, season, year, 1, 20),
    getAnilistFiltered(env, { status: 'FINISHED', maxEpisodes: 15, minScore: 75, sort: 'SCORE_DESC' }),
    getAnilistFiltered(env, { maxStartYear: 2010, minScore: 75, sort: 'SCORE_DESC' }),
    getAnilistFiltered(env, { minScore: 80, maxPopularity: 100000, sort: 'SCORE_DESC' }),
    getAnilistFiltered(env, { format: 'MOVIE', minScore: 75, sort: 'SCORE_DESC' }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'vote_average.gte': 8.0, 'vote_count.gte': 1000 }),
    tmdbDiscover(env, 'movie', { sort_by: 'vote_average.desc', 'vote_average.gte': 7.5, 'popularity.lte': 20 }),
    getAnilistFiltered(env, { minScore: 80, maxPopularity: 50000, sort: 'SCORE_DESC' }),
    tmdbDiscover(env, 'tv',   { sort_by: 'popularity.desc', 'vote_average.gte': 7.5, 'vote_count.gte': 100 }),
    tmdbDiscover(env, 'movie',{ sort_by: 'popularity.desc', 'with_runtime.lte': 90, 'vote_average.gte': 7.0 }),
    tmdbDiscover(env, 'tv',   { sort_by: 'vote_average.desc', 'vote_count.gte': 50 }),
    tmdbDiscover(env, 'tv',   { sort_by: 'popularity.desc', with_origin_country: 'KR' }),
  ]);

  const db = getDb(env);
  const justAddedRaw = await db`
    SELECT spun_id, title, content_type, year, rating, poster_path 
    FROM media_titles 
    ORDER BY created_at DESC 
    LIMIT 20
  ` as any[];

  const justAddedItems: ContentItem[] = justAddedRaw.map((r) => ({
    spun_id: r.spun_id,
    type:    r.content_type as 'movie' | 'tv' | 'anime',
    title:   r.title        ?? '',
    year:    r.year         ?? null,
    rating:  r.rating       ?? null,
    poster:  r.poster_path  ?? null,
  }));

  const [
    tmdbTrendingItems, nowPlayingItems, onAirItems,
    anilistTrendingItems, airingItems, seasonalItems,
    tmdbActionItems, anilistActionItems, tmdbComedyItems, anilistComedyItems,
    tmdbThrillerItems, anilistPsychItems, tmdbFeelItems, anilistSliceItems,
    tmdbScifiItems, anilistScifiItems, tmdbHorrorItems, anilistDarkItems,
    animeAllTimeItems, animeSeasonItems, animeShortItems,
    animeClassicItems, animeOtakuItems, animeFilmItems,
    tmdbCritItems, tmdbHiddenMovieItems, anilistHiddenItems,
    tmdbBingeItems, tmdbShortMovieItems, tmdbShortTvItems, tmdbKDramaItems,
  ] = await Promise.all([
    tmdbToItems(env, tmdbTrending,    'movie'),
    tmdbToItems(env, tmdbNowPlaying,  'movie'),
    tmdbToItems(env, tmdbOnAir,       'tv'),
    anilistToItems(env, anilistTrending),
    anilistToItems(env, anilistAiring),
    anilistToItems(env, anilistSeasonal),
    tmdbToItems(env, tmdbAction,      'movie'),
    anilistToItems(env, anilistAction),
    tmdbToItems(env, tmdbComedy,      'movie'),
    anilistToItems(env, anilistComedy),
    tmdbToItems(env, tmdbThriller,    'movie'),
    anilistToItems(env, anilistPsych),
    tmdbToItems(env, tmdbFeel,        'movie'),
    anilistToItems(env, anilistSliceOfLife),
    tmdbToItems(env, tmdbScifi,       'movie'),
    anilistToItems(env, anilistScifi),
    tmdbToItems(env, tmdbHorror,      'movie'),
    anilistToItems(env, anilistDark),
    anilistToItems(env, animeAllTime),
    anilistToItems(env, animeSeason),
    anilistToItems(env, animeShort),
    anilistToItems(env, animeClassic),
    anilistToItems(env, animeOtaku),
    anilistToItems(env, animeFilms),
    tmdbToItems(env, tmdbCritAcc,     'movie'),
    tmdbToItems(env, tmdbHiddenGems,  'movie'),
    anilistToItems(env, anilistHiddenGems),
    tmdbToItems(env, tmdbBinge,       'tv'),
    tmdbToItems(env, tmdbShortWatch,  'movie'),
    tmdbToItems(env, tmdbShortTv,     'tv'),
    tmdbToItems(env, tmdbKDrama,      'tv'),
  ]);

  const trendingMixed   = merge(tmdbTrendingItems, anilistTrendingItems).slice(0, ROW_MAX);
  const newThisWeek     = merge(nowPlayingItems, onAirItems, seasonalItems).slice(0, ROW_MAX);
  const actionMixed     = merge(tmdbActionItems, anilistActionItems).slice(0, ROW_MAX);
  const comedyMixed     = merge(tmdbComedyItems, anilistComedyItems).slice(0, ROW_MAX);
  const thrillerMixed   = merge(tmdbThrillerItems, anilistPsychItems).slice(0, ROW_MAX);
  const feelMixed       = merge(tmdbFeelItems, anilistSliceItems).slice(0, ROW_MAX);
  const scifiMixed      = merge(tmdbScifiItems, anilistScifiItems).slice(0, ROW_MAX);
  const darkMixed       = merge(tmdbHorrorItems, anilistDarkItems).slice(0, ROW_MAX);
  const hiddenMixed     = merge(tmdbHiddenMovieItems, anilistHiddenItems).slice(0, ROW_MAX);
  const shortWatchMixed = merge(tmdbShortMovieItems, tmdbShortTvItems).slice(0, ROW_MAX);

  const [mcuRow, aotRow] = await Promise.all([
    franchiseRow(env, 'mcu',              'MCU Line-Up',       mcu),
    franchiseRow(env, 'attack-on-titan',  'Attack on Titan',   attackOnTitan),
  ]);

  const hero = await buildHero(env, homeHero, trendingMixed);

  return {
    hero,
    rows: [
      { id: 'trending-today',      title: 'Trending Today',          items: trendingMixed    },
      { id: 'new-this-week',       title: 'New This Week',           items: newThisWeek      },
      { id: 'airing-now',          title: 'Airing Now',              items: airingItems      },
      { id: 'just-added',          title: 'Just Added',              items: justAddedItems   },
      mcuRow, aotRow,
      { id: 'action-adrenaline',   title: 'Action & Adrenaline',     items: actionMixed      },
      { id: 'something-funny',     title: 'Something Funny',         items: comedyMixed      },
      { id: 'cant-look-away',      title: "Can't Look Away",         items: thrillerMixed    },
      { id: 'feel-good',           title: 'Feel Good',               items: feelMixed        },
      { id: 'mind-bending',        title: 'Mind-Bending',            items: scifiMixed       },
      { id: 'dark-intense',        title: 'Dark & Intense',          items: darkMixed        },
      { id: 'top-anime-alltime',   title: 'Top Anime of All Time',   items: animeAllTimeItems },
      { id: 'this-season-anime',   title: "This Season's Anime",     items: animeSeasonItems  },
      { id: 'short-sweet-anime',   title: 'Short & Sweet',           items: animeShortItems   },
      { id: 'classic-anime',       title: 'Classic Anime',           items: animeClassicItems },
      { id: 'for-the-otaku',       title: 'For the Otaku',           items: animeOtakuItems   },
      { id: 'critically-acclaimed', title: 'Critically Acclaimed',   items: tmdbCritItems    },
      { id: 'hidden-gems',         title: 'Hidden Gems',             items: hiddenMixed      },
      { id: 'binge-worthy',        title: 'Binge-Worthy Series',     items: tmdbBingeItems   },
      { id: 'short-watch',         title: 'Short Watch',             items: shortWatchMixed  },
      { id: 'k-drama',             title: 'K-Drama',                 items: tmdbKDramaItems  },
      { id: 'anime-films',         title: 'Anime Films',             items: animeFilmItems   },
    ],
  };
}

// ─── Cache Wrappers ───────────────────────────────────────────────────────────

export async function buildAndCacheGeneralHome(env: Env) {
  const payload = await buildGeneralHome(env);
  await kvSet(env, CacheKeys.home('all'), payload, TTL.home);
}

export async function buildAndCacheMovieHome(env: Env) {
  const payload = await buildMovieHome(env);
  await kvSet(env, CacheKeys.home('movie'), payload, TTL.home);
}

export async function buildAndCacheTvHome(env: Env) {
  const payload = await buildTvHome(env);
  await kvSet(env, CacheKeys.home('tv'), payload, TTL.home);
}

export async function buildAndCacheAnimeHome(env: Env) {
  const payload = await buildAnimeHome(env);
  await kvSet(env, CacheKeys.home('anime'), payload, TTL.home);
}
