import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import { getCastleStreams as getMovieCastle } from './movies/castle.js';
import { getNetmirrorStreams as getMovieNetmirror } from './movies/netmirror.js';
import { getVidlinkStreams as getMovieVidlink } from './movies/vidlink.js';
import { getDaratechStreams as getMovieDaratech } from './movies/daratech.js';
import { getCastleStreams as getTvCastle } from './tv/castle.js';
import { getNetmirrorStreams as getTvNetmirror } from './tv/netmirror.js';
import { getVidlinkStreams as getTvVidlink } from './tv/vidlink.js';
import { getDaratechStreams as getTvDaratech } from './tv/daratech.js';
import { getMovieboxDownloads } from './downloads/moviebox.js';
import { get4khdhubDownloads } from './downloads/4khdhub.js';
import { getDvdplayDownloads } from './downloads/dvdplay.js';
import { getStreamflixDownloads } from './downloads/streamflix.js';
import { getAnikotoStreams } from './anime/anikoto.js';
import { getKaaStreams } from './anime/kaa.js';
import { getAnimeggStreams } from './anime/animegg.js';
import { getReanimeStreams } from './anime/reanime.js';
import { getAnimedunyaStreams } from './anime/animedunya.js';
import { getAninekoStreams } from './anime/anineko.js';
import { getAnidbappStreams } from './anime/anidbapp.js';
import { getAnibdStreams } from './anime/anibd.js';
import { getMovieboxStreams as getMovieboxMovieStreams } from './movies/moviebox.js';
import { getMovieboxStreams as getMovieboxTvStreams } from './tv/moviebox.js';
import { attachedSubtitles, buildDownloadResponse, buildStreamResponse } from './normalizer.js';
import { recordFailure, recordSuccess, isHealthy, getHealthRecords } from './health.js';
import type { AnimeProviderInput, MovieProviderInput, ProviderId, RawDownload, RawStream, TvProviderInput } from './shared/types.js';
import { runDaratechDiagnostic } from './diagnostics.js';
import { providerLogger, startProviderLogArchiver, flushProviderLogs } from './logging.js';

const app = Fastify({ logger: false, trustProxy: true });
const PROVIDER_REQUEST_BUDGET_MS = 25_000;

function safeProviderError(error: unknown): string {
  return String(error instanceof Error ? error.message : error ?? 'unknown failure')
    .replace(/https?:\/\/[^\s]+/g, '[upstream-url]')
    .slice(0, 240);
}

const env = {
  internalsKey: process.env.INTERNALS_KEY ?? '',
  movieboxBase: process.env.MOVIEBOX_API_BASE ?? 'https://moviebox.byspun.xyz',
  movieboxSecret: process.env.MOVIEBOX_API_SECRET ?? '',
  daratechBase: process.env.DARATECH_API_BASE ?? 'https://apimovie.runflix.name.ng/v1',
  daratechKey: process.env.DARATECH_API_KEY ?? '',
  tmdbKey: process.env.TMDB_API_KEY ?? '',
  adminKey: process.env.ADMIN_KEY ?? '',
};

providerLogger.info('startup', 'Streaming configuration loaded', {
  tmdbConfigured: Boolean(env.tmdbKey),
  movieboxSecretConfigured: Boolean(env.movieboxSecret),
  internalsKeyConfigured: Boolean(env.internalsKey),
  daratechConfigured: Boolean(env.daratechKey),
  adminKeyConfigured: Boolean(env.adminKey),
});

function auth(request: any): boolean {
  return Boolean(env.internalsKey) && request.headers['x-internals-key'] === env.internalsKey;
}

function input(q: any): any {
  const type = String(q.type);
  if (type !== 'movie' && type !== 'tv' && type !== 'anime') throw new Error('invalid_type');
  const movieboxId = q.moviebox_id !== undefined && /^\d+$/.test(String(q.moviebox_id))
    ? String(q.moviebox_id)
    : null;

  if (type === 'anime') {
    return {
      type,
      anilist_id: Number(q.anilist_id),
      mal_id: q.mal_id ? Number(q.mal_id) : null,
      title: String(q.title),
      episode: Number(q.episode ?? 1),
      dub: String(q.audio ?? '').toLowerCase() === 'dub',
    } as AnimeProviderInput & { type: 'anime' };
  }

  if (type === 'tv') {
    return {
      type,
      tmdb_id: Number(q.tmdb_id),
      moviebox_id: movieboxId,
      imdb_id: q.imdb_id ?? null,
      title: String(q.title),
      year: q.year ? Number(q.year) : null,
      season: Number(q.season ?? 1),
      episode: Number(q.episode ?? 1),
    } as TvProviderInput & { type: 'tv' };
  }

  return {
    type,
    tmdb_id: Number(q.tmdb_id),
    moviebox_id: movieboxId,
    imdb_id: q.imdb_id ?? null,
    title: String(q.title),
    year: q.year ? Number(q.year) : null,
  } as MovieProviderInput & { type: 'movie' };
}

function validPositiveInteger(value: unknown, max = 10_000): boolean {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= max;
}

function validateProviderInput(value: any): string | null {
  if (!['movie', 'tv', 'anime'].includes(value.type)) return 'invalid_type';
  if (typeof value.title !== 'string' || value.title.trim().length < 1 || value.title.length > 300) return 'invalid_title';
  if (value.type === 'anime') {
    if (!validPositiveInteger(value.anilist_id, 2_000_000_000)) return 'invalid_identifier';
    if (!validPositiveInteger(value.episode)) return 'invalid_episode';
  } else {
    const hasTmdb = validPositiveInteger(value.tmdb_id, 2_000_000_000);
    const hasMoviebox = typeof value.moviebox_id === 'string' && /^\d{1,30}$/.test(value.moviebox_id);
    if (!hasTmdb && !hasMoviebox) return 'invalid_identifier';
    if (value.type === 'tv' && (!validPositiveInteger(value.season) || !validPositiveInteger(value.episode))) return 'invalid_episode';
  }
  return null;
}

async function attemptWithinBudget<T>(fn: () => Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new Error('provider_deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('provider_deadline')), remainingMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function movieboxMovieAttempt(value: MovieProviderInput) {
  return getMovieboxMovieStreams(value, {
    baseUrl: env.movieboxBase,
    secret: env.movieboxSecret,
  });
}

function movieboxTvAttempt(value: TvProviderInput) {
  return getMovieboxTvStreams(value, {
    baseUrl: env.movieboxBase,
    secret: env.movieboxSecret,
  });
}

async function streamFor(value: any): Promise<{ streams: RawStream[]; subtitles: any[] }> {
  const deadline = Date.now() + PROVIDER_REQUEST_BUDGET_MS;
  const streams: RawStream[] = [];
  let subtitles: any[] = [];

  const attempts = (value.type === 'anime'
    ? [
        ['anikoto', getAnikotoStreams],
        ['kaa', getKaaStreams],
        ['animegg', getAnimeggStreams],
        ['reanime', getReanimeStreams],
        ['animedunya', getAnimedunyaStreams],
        ['anineko', getAninekoStreams],
        ['anidbapp', getAnidbappStreams],
        ['anibd', getAnibdStreams],
      ]
    : value.type === 'tv'
      ? Number.isFinite(value.tmdb_id)
        ? [
            ['castle', (x: TvProviderInput) => getTvCastle(x, env.tmdbKey)],
            ...(value.moviebox_id ? [['moviebox', movieboxTvAttempt] as [ProviderId, (input: TvProviderInput) => Promise<RawStream[]>]] : []),
            ['daratech', (x: TvProviderInput) => getTvDaratech(x, { baseUrl: env.daratechBase, apiKey: env.daratechKey })],
            ['netmirror', (x: TvProviderInput) => getTvNetmirror(x, env.tmdbKey)],
            ['vidlink', (x: TvProviderInput) => getTvVidlink(x, env.tmdbKey)],
          ]
        : value.moviebox_id
          ? [['moviebox', movieboxTvAttempt]]
          : []
      : Number.isFinite(value.tmdb_id)
        ? [
            ['castle', (x: MovieProviderInput) => getMovieCastle(x, env.tmdbKey)],
            ...(value.moviebox_id ? [['moviebox', movieboxMovieAttempt] as [ProviderId, (input: MovieProviderInput) => Promise<RawStream[]>]] : []),
            ['daratech', (x: MovieProviderInput) => getMovieDaratech(x, { baseUrl: env.daratechBase, apiKey: env.daratechKey })],
            ['netmirror', (x: MovieProviderInput) => getMovieNetmirror(x, env.tmdbKey)],
            ['vidlink', (x: MovieProviderInput) => getMovieVidlink(x, env.tmdbKey)],
          ]
        : value.moviebox_id
          ? [['moviebox', movieboxMovieAttempt]]
          : []) as Array<[ProviderId, (input: any) => Promise<RawStream[]>]>;

  for (const [id, fn] of attempts) {
    if (Date.now() >= deadline) {
      providerLogger.warn('fallback', `Provider request budget exhausted category=${value.type}`);
      break;
    }
    if (!isHealthy(id, value.type)) {
      providerLogger.debug(id, `Provider suppressed by health tracker category=${value.type}`);
      continue;
    }

    try {
      const result = await attemptWithinBudget(() => fn(value), Math.max(1, deadline - Date.now()));
      if (result.length) {
        recordSuccess(id, value.type);
        providerLogger.info(id, `Provider returned playable streams category=${value.type} count=${result.length}`);
        streams.push(...result);
        subtitles = attachedSubtitles(result);
        break;
      }
      recordFailure(id, value.type, 'no usable result');
      providerLogger.warn(id, `Provider returned no usable streams category=${value.type}`);
    } catch (error) {
      recordFailure(id, value.type, error);
      providerLogger.error(id, `Provider stream request failed category=${value.type}: ${safeProviderError(error)}`);
    }
  }

  if (!streams.length) {
    providerLogger.error('fallback', `All stream providers exhausted category=${value.type} attempted=${attempts.map(([id]) => id).join(',')}`);
  }

  return { streams, subtitles };
}

async function downloadsFor(value: any): Promise<{ downloads: RawDownload[]; subtitles: any[] }> {
  const deadline = Date.now() + PROVIDER_REQUEST_BUDGET_MS;
  const providers: Array<[string, (input: any) => Promise<RawDownload[]>]> = [
    ['moviebox', (x: any) => getMovieboxDownloads(x, { baseUrl: env.movieboxBase, apiKey: env.movieboxSecret })],
    ['4khdhub', (x: any) => get4khdhubDownloads(x, env.tmdbKey)],
    ['streamflix', (x: any) => getStreamflixDownloads(x, env.tmdbKey)],
  ];
  if (value.type === 'movie') providers.splice(2, 0, ['dvdplay', (x: any) => getDvdplayDownloads(x, env.tmdbKey)]);

  for (const [id, fn] of providers) {
    if (Date.now() >= deadline) {
      providerLogger.warn('fallback', `Download provider request budget exhausted category=${value.type}`);
      break;
    }
    if (!isHealthy(id as ProviderId, value.type)) {
      providerLogger.debug(id, `Download provider suppressed by health tracker category=${value.type}`);
      continue;
    }
    try {
      const result = await attemptWithinBudget(() => fn(value), Math.max(1, deadline - Date.now()));
      if (result.length) {
        recordSuccess(id as ProviderId, value.type);
        providerLogger.info(id, `Provider returned downloadable files category=${value.type} count=${result.length}`);
        return { downloads: result, subtitles: [] };
      }
      recordFailure(id as ProviderId, value.type, 'no usable result');
      providerLogger.warn(id, `Provider returned no downloadable files category=${value.type}`);
    } catch (error) {
      recordFailure(id as ProviderId, value.type, error);
      providerLogger.error(id, `Provider download request failed category=${value.type}: ${safeProviderError(error)}`);
    }
  }
  providerLogger.error('fallback', `All download providers exhausted category=${value.type}`);
  return { downloads: [], subtitles: [] };
}

await app.register(cors, {
  origin: ['https://media.byspun.xyz', 'https://torii.byspun.xyz'],
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Internals-Key', 'X-Admin-Key', 'X-Log-Upload-Key'],
});

app.addHook('onRequest', async (request, reply) => {
  const requestPath = new URL(request.url, 'http://provider.local').pathname;
  if (requestPath === '/health') return;
  if (requestPath.startsWith('/admin/')) {
    if (!env.adminKey) {
      return reply.code(503).send({
        code: 'ADMIN_DISABLED',
        error: 'Administration disabled',
        description: 'The provider administration surface has not been enabled on this Render service.',
        action: 'Configure the administrator key before retrying.',
      });
    }
    if (request.headers['x-admin-key'] !== env.adminKey) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        error: 'Administrator authentication required',
        description: 'This management request was not authenticated.',
        action: 'Send the X-Admin-Key header configured for the Render service.',
      });
    }
    return;
  }
  if (!auth(request)) {
    return reply.code(401).send({
      code: 'UNAUTHORIZED',
      error: 'Authentication required',
      description: 'The provider gateway request was not authenticated.',
      action: 'Retry through the Spün gateway.',
    });
  }
});

app.get('/admin/diagnostics/:provider/:type', async (request, reply) => {
  const params: any = request.params;
  const query: any = request.query;
  const provider = String(params.provider ?? '').toLowerCase();
  const type = String(params.type ?? '').toLowerCase();
  const title = String(query.title ?? '').trim();

  if (provider !== 'daratech') {
    return reply.code(404).send({
      code: 'DIAGNOSTIC_PROVIDER_UNSUPPORTED',
      error: 'Diagnostic provider unsupported',
      description: 'This internal diagnostic route is only enabled for an explicitly allowlisted provider.',
      action: 'Use an allowlisted provider name.',
    });
  }
  if (type !== 'movie' && type !== 'tv') {
    return reply.code(400).send({
      code: 'DIAGNOSTIC_TYPE_UNSUPPORTED',
      error: 'Diagnostic type unsupported',
      description: 'Daratech diagnostics currently support movie and TV requests only.',
      action: 'Use movie or tv as the type segment.',
    });
  }
  if (!title) {
    return reply.code(400).send({
      code: 'MISSING_QUERY',
      error: 'Title required',
      description: 'A title is required to run the provider diagnostic.',
      action: 'Pass the title in the query string, for example ?title=Fight%20Club.',
    });
  }

  const diagnostic = await runDaratechDiagnostic(type, query, {
    daratechBase: env.daratechBase,
    daratechKey: env.daratechKey,
  });
  return reply.send({
    diagnostic: true,
    generated_at: new Date().toISOString(),
    ...diagnostic,
  });
});

app.addHook('onResponse', async (request, reply) => {
  const requestPath = request.url.split('?')[0];
  providerLogger.info('request', `${request.method} ${requestPath} status=${reply.statusCode}`);
});

app.get('/health', async () => {
  const records = getHealthRecords();
  const degraded = records.some((record) => record.status === 'down');
  const categoryAvailable = (category: 'movie' | 'tv' | 'anime', configured: boolean): boolean => {
    if (!configured) return false;
    const categoryRecords = records.filter((record) => record.content_type === category);
    return !categoryRecords.length || categoryRecords.some((record) => record.status !== 'down');
  };
  const streamingConfigured = Boolean(env.tmdbKey || env.movieboxSecret || env.daratechKey);
  const downloadsConfigured = Boolean(env.movieboxSecret || env.tmdbKey);
  const animeConfigured = true;
  const streaming = categoryAvailable('movie', streamingConfigured) || categoryAvailable('tv', streamingConfigured) || categoryAvailable('anime', animeConfigured);
  const downloads = categoryAvailable('movie', downloadsConfigured) || categoryAvailable('tv', downloadsConfigured) || categoryAvailable('anime', false);
  return {
    status: degraded ? 'degraded' : 'ok',
    capabilities: { streaming, downloads, anime: animeConfigured },
    content_resolution: { status: degraded ? 'degraded' : 'healthy', checked_at: new Date().toISOString() },
  };
});

app.get('/stream', async (request, reply) => {
  const q: any = request.query;
  let value: any;
  try {
    value = input(q);
  } catch {
    return reply.code(400).send({
      code: 'INVALID_TYPE',
      error: 'Invalid content type',
      description: 'The provider request type is unsupported.',
      action: 'Use movie, tv, or anime.',
    });
  }
  const inputError = validateProviderInput(value);
  const identifierValid = value.type === 'anime'
    ? Number.isFinite(value.anilist_id)
    : Number.isFinite(value.tmdb_id) || (typeof value.moviebox_id === 'string' && /^\d+$/.test(value.moviebox_id));
  if (inputError || !value.title || !identifierValid) {
    return reply.code(400).send({
      code: 'BAD_REQUEST',
      error: 'Malformed request',
      description: 'The content request is incomplete.',
      action: 'Retry with a resolved title and identifier.',
    });
  }
  const result = await streamFor(value);
  if (!result.streams.length) {
    return reply.code(503).send({
      code: 'STREAMS_UNAVAILABLE',
      error: 'No playable streams found',
      description: 'No usable stream was found across the available infrastructure.',
      action: 'Try again later or select another title.',
    });
  }
  return reply.send(buildStreamResponse(String(q.spun_id), value.title, value.type, result.streams, result.subtitles));
});

app.get('/download', async (request, reply) => {
  const q: any = request.query;
  let value: any;
  try {
    value = input(q);
  } catch {
    return reply.code(400).send({
      code: 'INVALID_TYPE',
      error: 'Invalid content type',
      description: 'The provider request type is unsupported.',
      action: 'Use movie, tv, or anime.',
    });
  }
  const inputError = validateProviderInput(value);
  if (inputError || !value.title) {
    return reply.code(400).send({
      code: 'BAD_REQUEST',
      error: 'Malformed request',
      description: 'The content request is incomplete.',
      action: 'Retry with a resolved title and identifier.',
    });
  }
  const result = await downloadsFor(value);
  if (!result.downloads.length) {
    return reply.code(503).send({
      code: 'DOWNLOADS_UNAVAILABLE',
      error: 'No downloads found',
      description: 'No usable download was found across the available infrastructure.',
      action: 'Try again later or choose another quality.',
    });
  }
  const batch = value.type !== 'movie' && !q.season && !q.episode;
  return reply.send(buildDownloadResponse(String(q.spun_id), value.title, value.type, result.downloads, result.subtitles, batch));
});

app.post('/admin/logs/flush', async (_request, reply) => {
  const result = await flushProviderLogs();
  providerLogger.info('logs', `Provider logs flushed date=${result.date} uploaded=${result.uploaded}`);
  return reply.send({ success: true, ...result, message: 'Current provider log flushed and archived.' });
});

app.setErrorHandler((_error, _request, reply) => reply.code(500).send({
  code: 'INTERNAL_ERROR',
  error: 'Unexpected error',
  description: 'The provider gateway could not complete the request.',
  action: 'Please try again later.',
}));

startProviderLogArchiver();

process.on('SIGTERM', async () => {
  await flushProviderLogs();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await flushProviderLogs();
  process.exit(0);
});

await app.listen({ port: Number(process.env.PORT ?? 10000), host: '0.0.0.0' });
providerLogger.info('startup', `Provider service listening on port ${process.env.PORT ?? 10000}`);
