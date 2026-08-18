// Kitsu anime metadata client.
// Kitsu is used internally for anime enrichment and identifier reconciliation.
// Nothing from this module is exposed directly to consumers.

const KITSU_BASE_URL = 'https://kitsu.io/api/edge';

export class KitsuUnavailableError extends Error {
  constructor(public readonly status = 503) {
    super('Kitsu metadata unavailable');
    this.name = 'KitsuUnavailableError';
  }
}

interface KitsuResponse<T> {
  data?: T;
  included?: KitsuResource[];
  links?: { next?: string | null; prev?: string | null; first?: string | null; last?: string | null };
  errors?: Array<{ title?: string; detail?: string; code?: string }>;
}

export interface KitsuAnimeAttributes {
  slug?: string | null;
  synopsis?: string | null;
  description?: string | null;
  canonicalTitle?: string | null;
  titles?: Record<string, string | null> | null;
  startDate?: string | null;
  endDate?: string | null;
  nextRelease?: string | null;
  subtype?: string | null;
  status?: string | null;
  episodeCount?: number | null;
  episodeLength?: number | null;
  averageRating?: string | number | null;
  posterImage?: {
    tiny?: string | null;
    small?: string | null;
    medium?: string | null;
    large?: string | null;
    original?: string | null;
  } | null;
  coverImage?: {
    tiny?: string | null;
    small?: string | null;
    medium?: string | null;
    large?: string | null;
    original?: string | null;
  } | null;
}

export interface KitsuEpisodeAttributes {
  synopsis?: string | null;
  description?: string | null;
  canonicalTitle?: string | null;
  titles?: Record<string, string | null> | null;
  seasonNumber?: number | null;
  number?: number | null;
  relativeNumber?: number | null;
  airdate?: string | null;
  length?: number | null;
  thumbnail?: {
    original?: string | null;
    small?: string | null;
    medium?: string | null;
    large?: string | null;
  } | null;
}

export interface KitsuMappingAttributes {
  externalSite?: string | null;
  externalId?: string | null;
}

export interface KitsuResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface KitsuAnime {
  id: number;
  type: 'anime';
  attributes: KitsuAnimeAttributes;
  mappings: KitsuMapping[];
}

export interface KitsuEpisode {
  id: number;
  type: 'episodes';
  attributes: KitsuEpisodeAttributes;
}

export interface KitsuMapping {
  id: number;
  type: 'mappings';
  attributes: KitsuMappingAttributes;
}

function asAnime(resource: KitsuResource, included: KitsuResource[] = []): KitsuAnime | null {
  if (resource.type !== 'anime') return null;
  const mappingData = (resource.relationships?.mappings as { data?: Array<{ id?: string; type?: string }> } | undefined)?.data ?? [];
  const mappingIds = new Set(mappingData.map((item) => item.id).filter(Boolean));
  const mappings = included
    .filter((item) => item.type === 'mappings' && (mappingIds.size === 0 || mappingIds.has(item.id)))
    .map((item) => ({
      id: Number(item.id),
      type: 'mappings' as const,
      attributes: (item.attributes ?? {}) as KitsuMappingAttributes,
    }));
  return {
    id: Number(resource.id),
    type: 'anime',
    attributes: (resource.attributes ?? {}) as KitsuAnimeAttributes,
    mappings,
  };
}

function asEpisodes(resources: KitsuResource[] | undefined): KitsuEpisode[] {
  return (resources ?? [])
    .filter((item) => item.type === 'episodes')
    .map((item) => ({
      id: Number(item.id),
      type: 'episodes' as const,
      attributes: (item.attributes ?? {}) as KitsuEpisodeAttributes,
    }));
}

async function kitsuFetch<T>(path: string): Promise<KitsuResponse<T> | null> {
  try {
    const response = await fetch(`${KITSU_BASE_URL}${path}`, {
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
    });
    if (!response.ok) {
      if (response.status === 404) return null;
      if (response.status === 429 || response.status >= 500) {
        throw new KitsuUnavailableError(response.status);
      }
      return null;
    }
    return await response.json() as KitsuResponse<T>;
  } catch (error) {
    if (error instanceof KitsuUnavailableError) throw error;
    console.error('[Kitsu] request failed:', error);
    throw new KitsuUnavailableError();
  }
}

export async function getKitsuAnime(
  kitsuId: number,
  include: string[] = [],
): Promise<KitsuAnime | null> {
  const query = include.length ? `?include=${encodeURIComponent(include.join(','))}` : '';
  const response = await kitsuFetch<KitsuResource>(`/anime/${kitsuId}${query}`);
  if (!response?.data || Array.isArray(response.data)) return null;
  return asAnime(response.data, response.included);
}

export async function getKitsuAnimeEpisodes(
  kitsuId: number,
  page = 0,
  limit = 20,
): Promise<{ episodes: KitsuEpisode[]; hasMore: boolean }> {
  if (page === 0) {
    const includedResponse = await kitsuFetch<KitsuResource>(`/anime/${kitsuId}?include=episodes`);
    const includedEpisodes = asEpisodes(includedResponse?.included);
    if (includedEpisodes.length) {
      return { episodes: includedEpisodes, hasMore: false };
    }
  }

  const offset = page * limit;
  const response = await kitsuFetch<KitsuResource[]>(
    `/anime/${kitsuId}/episodes?page[limit]=${Math.min(limit, 20)}&page[offset]=${offset}&sort=number`,
  );
  const episodes = asEpisodes(response?.data);
  const next = response?.links?.next;
  return { episodes, hasMore: Boolean(next) };
}

export async function getKitsuEpisode(kitsuEpisodeId: number): Promise<KitsuEpisode | null> {
  const response = await kitsuFetch<KitsuResource>(`/episodes/${kitsuEpisodeId}`);
  if (!response?.data || Array.isArray(response.data) || response.data.type !== 'episodes') return null;
  return {
    id: Number(response.data.id),
    type: 'episodes',
    attributes: (response.data.attributes ?? {}) as KitsuEpisodeAttributes,
  };
}

export async function searchKitsuAnime(
  title: string,
  limit = 5,
): Promise<KitsuAnime[]> {
  const response = await kitsuFetch<KitsuResource[]>(
    `/anime?filter[text]=${encodeURIComponent(title)}&page[limit]=${Math.min(limit, 20)}&include=mappings`,
  );
  return (response?.data ?? [])
    .map((resource, index) => asAnime(resource, index === 0 ? response?.included : []))
    .filter((anime): anime is KitsuAnime => anime !== null);
}

export async function findKitsuAnimeByExternalId(
  site: string,
  externalId: number | string,
  titleHint?: string,
): Promise<KitsuAnime | null> {
  if (!titleHint) return null;
  const candidates = await searchKitsuAnime(titleHint, 10);
  const wanted = String(externalId);
  return candidates.find((anime) => anime.mappings.some((mapping) =>
    mapping.attributes.externalSite?.toLowerCase() === site.toLowerCase()
      && mapping.attributes.externalId === wanted,
  )) ?? null;
}

export function kitsuTitle(anime: KitsuAnime): string {
  return anime.attributes.canonicalTitle
    || anime.attributes.titles?.en
    || anime.attributes.titles?.en_us
    || anime.attributes.titles?.en_jp
    || anime.attributes.slug
    || `Kitsu title ${anime.id}`;
}

export function kitsuDescription(anime: KitsuAnime): string | null {
  const value = anime.attributes.description || anime.attributes.synopsis || null;
  return value?.replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n') ?? null;
}

export function kitsuRating(anime: KitsuAnime): number | null {
  const raw = typeof anime.attributes.averageRating === 'string'
    ? Number(anime.attributes.averageRating)
    : anime.attributes.averageRating;
  return typeof raw === 'number' && Number.isFinite(raw) ? Number((raw / 10).toFixed(1)) : null;
}

export function kitsuMappingId(anime: KitsuAnime, sites: string[]): number | null {
  const wanted = sites.map((site) => site.toLowerCase());
  const mapping = anime.mappings.find((item) => {
    const site = item.attributes.externalSite?.toLowerCase() ?? '';
    return wanted.includes(site) && item.attributes.externalId;
  });
  const value = mapping?.attributes.externalId;
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

export function kitsuType(anime: KitsuAnime): 'movie' | 'tv' {
  return anime.attributes.subtype?.toUpperCase() === 'MOVIE' ? 'movie' : 'tv';
}
