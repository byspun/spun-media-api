// worker/src/cache.ts
// Cloudflare KV cache helpers.
// All metadata caching goes through here — never call KV directly in route handlers.

import type { Env } from './types/env.js';

// ─── TTL constants (seconds) ──────────────────────────────────────────────────

export const TTL = {
  metadata:         86400,       // 24h  — movie/TV/finished anime metadata
  metadataAiring:   3600,        // 1h   — airing anime metadata
  search:           600,         // 10m  — search results
  suggestions:      300,         // 5m   — search suggestions
  idMap:            2592000,     // 30d  — spun_id ↔ external ID maps
  discover:         900,         // 15m  — discover results
  studio:           86400,       // 24h  — studio content
  genres:           604800,      // 7d   — genre list (rarely changes)
  home:             86400,       // 24h  — homepage snapshot
  animeSchedule:    3600,        // 1h   — airing schedule
  animeRankings:    3600,        // 1h   — rankings
  episodes:         86400,       // 24h  — episode lists
  episodesAiring:   3600,        // 1h   — episode lists for airing shows
  health:           60,          // 1m   — health check results
} as const;

// ─── Cache Version ─────────────────────────────────────────────────────────

const DEFAULT_VERSION = 'v6';
const VERSION_KEY     = 'internal:cache_version';

/**
 * Gets the current cache version from KV, or falls back to DEFAULT_VERSION.
 * This is cached in the Worker's memory for performance.
 */
let cachedVersion: string | null = null;

async function getCacheVersion(env: Env): Promise<string> {
  if (cachedVersion) return cachedVersion;
  
  const kvVersion = await env.MEDIA_CACHE.get(VERSION_KEY, 'text');
  cachedVersion = kvVersion || DEFAULT_VERSION;
  return cachedVersion;
}

/**
 * Bumps the cache version in KV.
 */
export async function bumpCacheVersion(env: Env): Promise<string> {
  const current = await getCacheVersion(env);
  const versionNum = parseInt(current.replace('v', '')) || 6;
  const next = `v${versionNum + 1}`;
  
  try {
    await env.MEDIA_CACHE.put(VERSION_KEY, next);
    cachedVersion = next; // Update local cache
  } catch (err) {
    console.error('[KV Error] Failed to bump cache version:', err);
  }
  
  return cachedVersion || current;
}

// ─── Key builders ─────────────────────────────────────────────────────────────

export const CacheKeys = {
  info:             (spunId: string)                     => `info:${spunId}`,
  episodes:         (spunId: string)                     => `episodes:${spunId}`,
  cast:             (spunId: string)                     => `cast:${spunId}`,
  related:          (spunId: string)                     => `related:${spunId}`,
  search:           (q: string, type: string, page: number) =>
                      `search:${q.toLowerCase().replace(/\s+/g, '_')}:${type}:${page}`,
  suggestions:      (q: string)                          => `suggest:${q.toLowerCase().replace(/\s+/g, '_')}`,
  discover:         (type: string, genre: string, page: number) =>
                      `discover:${type}:${genre}:${page}`,
  trending:         (type: string)                       => `trending:${type}`,
  popular:          (type: string)                       => `popular:${type}`,
  newContent:       (type: string)                       => `new:${type}`,
  genres:           ()                                   => `genres:list`,
  studios:          ()                                   => `studios:list`,
  studio:           (id: string, page: number)           => `studio:${id}:${page}`,
  home:             (variant: string)                    => `home:${variant}`,
  animeSeasons:     ()                                   => `anime:seasons`,
  animeSeason:      (year: number, season: string, page: number) =>
                      `anime:season:${year}:${season}:${page}`,
  animeSchedule:    ()                                   => `anime:schedule`,
  animeRankAlltime: (page: number)                       => `anime:rank:alltime:${page}`,
  animeRankPopular: (page: number)                       => `anime:rank:popular:${page}`,
  animeRankSeason:  (year: number, season: string, page: number) =>
                      `anime:rank:season:${year}:${season}:${page}`,
  animeRankGenre:   (genre: string, page: number)        => `anime:rank:genre:${genre}:${page}`,
  animeAiring:      (page: number)                       => `anime:airing:${page}`,
  animeUpcoming:    (page: number)                       => `anime:upcoming:${page}`,
  animeFormat:      (format: string, page: number)       => `anime:format:${format}:${page}`,
  animeDemographic: (demo: string, page: number)         => `anime:demo:${demo}:${page}`,
  animeSource:      (source: string, page: number)       => `anime:source:${source}:${page}`,
  animeGenre:       (genre: string, page: number)        => `anime:genre:${genre}:${page}`,
  animeStudios:     (q: string, page: number)            => `anime:studios:${q}:${page}`,
  animeStudio:      (id: number, page: number)           => `anime:studio:${id}:${page}`,
  animeThemes:      (spunId: string)                     => `anime:themes:${spunId}`,
  animeFillers:     (spunId: string, page: number)       => `anime:fillers:${spunId}:${page}`,
  resolve:          (field: string, value: string)       => `resolve:${field}:${value}`,
  health:           ()                                   => `health:status`,
  homeBuildStatus:  (type: string)                       => `internal:build_status:home:${type}`,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function kvGet<T>(env: Env, key: string): Promise<T | null> {
  const version = await getCacheVersion(env);
  const fullKey = `${version}:${key}`;
  const val = await env.MEDIA_CACHE.get(fullKey, 'text');
  if (!val) return null;
  try {
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

export async function kvSet(
  env: Env,
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    const version = await getCacheVersion(env);
    const fullKey = `${version}:${key}`;
    await env.MEDIA_CACHE.put(fullKey, JSON.stringify(value), {
      expirationTtl: ttlSeconds,
    });
  } catch (err) {
    // Silent fail on quota/write errors to keep the API functional
    console.error('[KV Error] kvSet failed:', err);
  }
}

export interface HomeBuildStatus {
  type:        string;
  status:      'in_progress' | 'completed' | 'failed';
  started_at:  string;
  finished_at: string | null;
  error:       string | null;
}

export async function updateHomeBuildStatus(
  env: Env,
  type: string,
  update: Partial<HomeBuildStatus>
): Promise<void> {
  const key = CacheKeys.homeBuildStatus(type);
  const current = await kvGet<HomeBuildStatus>(env, key);
  
  const status: HomeBuildStatus = {
    type,
    status:      update.status      ?? current?.status      ?? 'in_progress',
    started_at:  update.started_at  ?? current?.started_at  ?? new Date().toISOString(),
    finished_at: update.finished_at ?? current?.finished_at ?? null,
    error:       update.error       ?? (update.status === 'in_progress' || update.status === 'completed'
      ? null
      : current?.error ?? null),
  };

  await kvSet(env, key, status, 3600); // Status expires in 1 hour
}

export async function kvDel(env: Env, key: string): Promise<void> {
  try {
    const version = await getCacheVersion(env);
    const fullKey = `${version}:${key}`;
    await env.MEDIA_CACHE.delete(fullKey);
  } catch (err) {
    console.error('[KV Error] kvDel failed:', err);
  }
}
