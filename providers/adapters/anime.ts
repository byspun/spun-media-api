import { detectFormat, normalizeQuality, isSafeHttpUrl, type MediaType } from '../mappers/mapper.js';
import type { RawStream, RawSubtitle } from '../shared/types.js';
import { movieBoxDownloads, type MovieBoxEnv, type ProviderInput as MovieBoxInput } from './moviebox.js';

export interface AnimeInput extends MovieBoxInput {
  anilistId: number;
  malId?: number | null;
  dub?: boolean;
}

const PROVIDER_ORDER = ['anikoto', 'kaa', 'animegg', 'reanime', 'animedunya', 'anineko', 'anidbapp', 'anibd'] as const;

function parseSubtitle(item: any): RawSubtitle | null {
  const url = item?.url ?? item?.file ?? item?.link;
  if (!isSafeHttpUrl(url)) return null;
  return {
    url,
    language: String(item?.language ?? item?.lang ?? item?.label ?? 'Unknown'),
    language_code: String(item?.language_code ?? item?.languageCode ?? item?.lang ?? 'und').toLowerCase(),
    format: String(item?.format ?? 'vtt').toLowerCase() === 'srt' ? 'srt' : 'vtt',
  };
}

function parseAnimeStreams(payload: any, provider: string, wantedQuality?: string | null): RawStream[] {
  const values = Array.isArray(payload?.streams) ? payload.streams : Array.isArray(payload?.sources) ? payload.sources : [];
  const subtitles = (Array.isArray(payload?.subtitles) ? payload.subtitles : [])
    .map(parseSubtitle).filter(Boolean) as RawSubtitle[];
  return values.map((item: any) => {
    const url = String(item?.url ?? item?.file ?? item?.link ?? '');
    const format = detectFormat(url, item?.type ?? item?.format);
    const quality = normalizeQuality(item?.quality ?? item?.label ?? item?.resolution);
    if (!isSafeHttpUrl(url) || format === 'unknown') return null;
    if (wantedQuality && wantedQuality !== 'auto' && wantedQuality.toLowerCase() !== quality.toLowerCase()) return null;
    return {
      url,
      format: format as any,
      quality: quality as any,
      audio: String(payload?.audio ?? item?.audio ?? 'Japanese'),
      subtitles,
      provider: provider as any,
      headers: payload?.headers ?? item?.headers ?? undefined,
    };
  }).filter(Boolean) as RawStream[];
}

async function anivexaFetch(path: string): Promise<any | null> {
  try {
    // @ts-ignore Vendored JavaScript provider source is validated at runtime by the service build.
    const mod = await import('../vendor/anivexa/index.js');
    const response = await mod.default.fetch(new Request(`http://provider.internal${path}`), {});
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function animeStreams(input: AnimeInput): Promise<RawStream[]> {
  const audio = input.dub ? 'dub' : 'sub';
  for (const provider of PROVIDER_ORDER) {
    const route = provider === 'kaa'
      ? `/watch/kaa/${input.anilistId}/${audio}/kaa-${input.episode ?? 1}`
      : `/watch/${provider}/${input.anilistId}/${audio}/${provider}-${input.episode ?? 1}`;
    const payload = await anivexaFetch(route);
    const streams = parseAnimeStreams(payload, provider, input.quality);
    if (streams.length) return streams;
  }
  return [];
}

export async function animeDownloads(env: MovieBoxEnv, input: AnimeInput) {
  return movieBoxDownloads(env, {
    ...input,
    type: 'anime' as MediaType,
    title: input.title,
    anilistId: input.anilistId,
  });
}
