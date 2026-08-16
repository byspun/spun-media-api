import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import { createRequire } from 'node:module';
import { animeDownloads, animeStreams } from './adapters/anime.js';
import { movieBoxDownloads, movieBoxInfo, movieBoxMadeInNaija, movieBoxSearch, movieBoxStreamsViaNuvio, resolveMovieBoxSubject, type ProviderInput } from './adapters/moviebox.js';
import { detectFormat, normalizeQuality, isSafeHttpUrl, uniqueBy } from './mappers/mapper.js';
import type { RawDownload, RawStream, RawSubtitle } from './shared/types.js';

const server = Fastify({ logger: true, trustProxy: true });
const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT ?? 10000);
const SHARED_SECRET = process.env.X_SPUN_SECRET ?? '';
const MOVIEBOX_API_BASE = process.env.MOVIEBOX_API_BASE ?? 'https://moviebox.byspun.xyz';
const MOVIEBOX_API_SECRET = process.env.MOVIEBOX_API_SECRET ?? SHARED_SECRET;

const movieBoxEnv = {
  MOVIEBOX_API_BASE,
  MOVIEBOX_API_SECRET,
  MOVIEBOX_RELAY_BASE: process.env.MOVIEBOX_RELAY_BASE ?? MOVIEBOX_API_BASE,
  TMDB_API_KEY: process.env.TMDB_API_KEY,
};

function providerError(code: string, status: number, error: string, description: string, action: string) {
  return { statusCode: status, body: { code, error, description, action } };
}

function inputFromQuery(query: Record<string, any>): ProviderInput {
  const type = String(query.type ?? 'movie') as 'movie' | 'tv' | 'anime';
  return {
    type,
    title: String(query.title ?? ''),
    year: query.year ? Number(query.year) : null,
    tmdbId: query.tmdb_id ? Number(query.tmdb_id) : null,
    anilistId: query.anilist_id ? Number(query.anilist_id) : null,
    malId: query.mal_id ? Number(query.mal_id) : null,
    movieboxId: query.moviebox_id ? String(query.moviebox_id) : null,
    season: query.season ? Number(query.season) : undefined,
    episode: query.episode ? Number(query.episode) : undefined,
    quality: query.quality ? String(query.quality) : null,
    audio: query.audio ? String(query.audio) : null,
  };
}

function normalizeSubtitle(value: any): RawSubtitle | null {
  const url = value?.url ?? value?.link;
  if (!isSafeHttpUrl(url)) return null;
  return {
    url,
    language: String(value?.language ?? value?.lang ?? 'Unknown'),
    language_code: String(value?.language_code ?? value?.languageCode ?? value?.lang ?? 'und').toLowerCase(),
    format: String(value?.format ?? 'vtt').toLowerCase() === 'srt' ? 'srt' : 'vtt',
  };
}

function normalizeNuvioStreams(values: any[], provider: string, qualityWanted?: string | null): RawStream[] {
  return (Array.isArray(values) ? values : []).map((item: any) => {
    const url = String(item?.url ?? '');
    const format = detectFormat(url, item?.format);
    const quality = normalizeQuality(item?.quality ?? item?.resolution ?? item?.label);
    if (!isSafeHttpUrl(url) || format === 'unknown') return null;
    if (qualityWanted && qualityWanted !== 'auto' && qualityWanted.toLowerCase() !== quality.toLowerCase()) return null;
    const subtitles = (Array.isArray(item?.subtitles) ? item.subtitles : [])
      .map(normalizeSubtitle).filter(Boolean) as RawSubtitle[];
    return {
      url,
      format: format as any,
      quality: quality as any,
      audio: String(item?.audio ?? item?.lang ?? item?.language ?? 'Original'),
      subtitles: uniqueBy(subtitles, (subtitle) => `${subtitle.language_code}:${subtitle.url}`),
      provider: provider as any,
      headers: item?.headers ?? undefined,
    };
  }).filter(Boolean) as RawStream[];
}

async function fallbackNuvioStreams(input: ProviderInput): Promise<RawStream[]> {
  const candidates = [
    ['netmirror', '../vendor/nuvio-netmirror.cjs'],
    ['streamflix', '../vendor/nuvio-streamflix.cjs'],
    ['vidlink', '../vendor/nuvio-vidlink.cjs'],
  ] as const;
  if (!input.tmdbId) return [];
  for (const [provider, path] of candidates) {
    try {
      const mod = require(path);
      const result = await mod.getStreams(input.tmdbId, input.type, input.season ?? 1, input.episode ?? 1);
      const streams = normalizeNuvioStreams(result, provider, input.quality);
      if (streams.length) return streams;
    } catch (error) {
      server.log.debug({ provider, error }, 'stream fallback failed');
    }
  }
  return [];
}

function normalizeDownloads(values: RawDownload[]): RawDownload[] {
  return uniqueBy(values.filter((item) => isSafeHttpUrl(item.url)), (item) => `${item.url}:${item.quality}:${item.format}`);
}

function authenticated(request: { headers: Record<string, any> }): boolean {
  return Boolean(SHARED_SECRET) && request.headers['x-spun-secret'] === SHARED_SECRET;
}

await server.register(cors, {
  origin: ['https://media.byspun.xyz', 'https://torii.byspun.xyz'],
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Spun-Secret'],
});

server.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health') return;
  if (!authenticated(request)) {
    return reply.code(401).send(providerError('UNAUTHORIZED', 401, 'Authentication required', 'The provider gateway request was not authenticated.', 'Retry through the Spün gateway.').body);
  }
});

server.get('/health', async (_request, reply) => reply.send({
  status: 'ok',
  service: 'Spün Media API',
  capabilities: { streaming: true, downloads: true, anime: true },
}));

server.get('/home/made-in-naija', async (_request, reply) => {
  const items = await movieBoxMadeInNaija(movieBoxEnv);
  return reply.send({ title: 'Made in Naija', items });
});

server.get('/catalog/search', async (request, reply) => {
  const keyword = String((request.query as Record<string, unknown>).keyword ?? '').trim();
  if (keyword.length < 2) return reply.code(400).send(providerError('MISSING_QUERY', 400, 'Search query required', 'No valid title query was provided.', 'Provide a title with at least two characters.').body);
  const items = await movieBoxSearch(movieBoxEnv, keyword);
  return reply.send({ items });
});

server.get('/catalog/info', async (request, reply) => {
  const subjectId = String((request.query as Record<string, unknown>).moviebox_id ?? '').trim();
  if (!subjectId) return reply.code(400).send(providerError('MISSING_EXTERNAL_ID', 400, 'Subject identifier required', 'No MovieBox subject identifier was provided.', 'Retry with a mapped subject identifier.').body);
  const item = await movieBoxInfo(movieBoxEnv, subjectId);
  if (!item) return reply.code(404).send(providerError('MAPPING_NOT_FOUND', 404, 'Content mapping unavailable', 'No compatible MovieBox title was found for this identifier.', 'Try another title.').body);
  return reply.send({ item });
});

server.get('/stream', async (request, reply) => {
  const input = inputFromQuery(request.query as Record<string, any>);
  if (!['movie', 'tv', 'anime'].includes(input.type) || !input.title) {
    return reply.code(400).send(providerError('BAD_REQUEST', 400, 'Malformed request', 'The provider request is missing a supported type or title.', 'Retry with the normalized title request.').body);
  }

  let streams: RawStream[] = [];
  if (input.type === 'anime') {
    if (!input.anilistId || !input.episode) {
      return reply.code(400).send(providerError('BAD_REQUEST', 400, 'Malformed request', 'Anime streaming requires an anime identity and episode.', 'Retry with the resolved anime identifiers.').body);
    }
    streams = await animeStreams({ ...input, anilistId: input.anilistId, dub: input.audio?.toLowerCase() === 'dub' });
  } else {
    streams = await movieBoxStreamsViaNuvio(movieBoxEnv, input);
    if (!streams.length) streams = await fallbackNuvioStreams(input);
  }

  if (!streams.length) return reply.code(503).send(providerError('STREAMS_UNAVAILABLE', 503, 'No playable sources found', 'No active stream could be prepared for this title.', 'Try again later or select another title.').body);
  const subject = input.type === 'anime' ? null : await resolveMovieBoxSubject(movieBoxEnv, input);
  return reply.send({
    mapping: subject ? { moviebox_id: subject.subjectId } : null,
    streams: uniqueBy(streams, (item) => `${item.url}:${item.quality}:${item.audio}`),
  });
});

server.get('/download', async (request, reply) => {
  const input = inputFromQuery(request.query as Record<string, any>);
  if (!['movie', 'tv', 'anime'].includes(input.type) || !input.title) {
    return reply.code(400).send(providerError('BAD_REQUEST', 400, 'Malformed request', 'The provider request is missing a supported type or title.', 'Retry with the normalized title request.').body);
  }

  const subject = await resolveMovieBoxSubject(movieBoxEnv, input);
  const downloads = normalizeDownloads(input.type === 'anime'
    ? await animeDownloads(movieBoxEnv, { ...input, anilistId: input.anilistId ?? 0 })
    : await movieBoxDownloads(movieBoxEnv, input));
  if (!downloads.length) return reply.code(503).send(providerError('DOWNLOADS_UNAVAILABLE', 503, 'No downloads found', 'No active download resource could be prepared for this title.', 'Try again later or select another quality.').body);
  return reply.send({ mapping: subject ? { moviebox_id: subject.subjectId } : null, downloads });
});


server.setErrorHandler((error, _request, reply) => {
  server.log.error(error);
  return reply.code(500).send(providerError('INTERNAL_ERROR', 500, 'Unexpected error', 'The provider gateway could not complete the request.', 'Please try again later.').body);
});

try {
  await server.listen({ port: PORT, host: '0.0.0.0' });
  server.log.info(`Spün provider gateway listening on ${PORT}`);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
