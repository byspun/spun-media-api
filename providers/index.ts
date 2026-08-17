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
import { getMovieboxApiMovieStreams, getMovieboxApiTvStreams } from './shared/moviebox-api-stream.js';
import { attachedSubtitles, buildDownloadResponse, buildStreamResponse } from './normalizer.js';
import { recordFailure, recordSuccess, isHealthy, getHealthRecords } from './health.js';
import { fetchWithRetry, findBestMatch } from './shared/http.js';
import type { AnimeProviderInput, MovieProviderInput, ProviderId, RawDownload, RawStream, TvProviderInput } from './shared/types.js';

const app = Fastify({ logger: true, trustProxy: true });

function safeProviderError(error: unknown): string {
  return String(error instanceof Error ? error.message : error ?? 'unknown failure')
    .replace(/https?:\/\/[^\s]+/g, '[upstream-url]')
    .slice(0, 240);
}

const env = {
  secret: process.env.X_SPUN_SECRET ?? '',
  movieboxBase: process.env.MOVIEBOX_API_BASE ?? 'https://moviebox.byspun.xyz',
  movieboxSecret: process.env.MOVIEBOX_API_SECRET ?? '',
  daratechBase: process.env.DARATECH_API_BASE ?? 'https://apimovie.runflix.name.ng/v1',
  daratechKey: process.env.DARATECH_API_KEY ?? '',
  tmdbKey: process.env.TMDB_API_KEY ?? '',
  diagnosticSecret: process.env.PROVIDER_DIAGNOSTIC_SECRET ?? '',
};

app.log.info({
  tmdbConfigured: Boolean(env.tmdbKey),
  movieboxSecretConfigured: Boolean(env.movieboxSecret),
  xSpunSecretConfigured: Boolean(env.secret),
  daratechConfigured: Boolean(env.daratechKey),
  diagnosticSecretConfigured: Boolean(env.diagnosticSecret),
}, 'streaming configuration loaded');

function auth(request: any): boolean {
  return Boolean(env.secret) && request.headers['x-spun-secret'] === env.secret;
}

function diagnosticAuth(request: any): boolean {
  return Boolean(env.diagnosticSecret) && request.headers['x-diagnostic-secret'] === env.diagnosticSecret;
}

function redactDiagnosticText(value: string): string {
  let redacted = value;
  if (env.daratechKey) redacted = redacted.split(env.daratechKey).join('[redacted-secret]');
  if (env.diagnosticSecret) redacted = redacted.split(env.diagnosticSecret).join('[redacted-diagnostic-secret]');
  return redacted
    .replace(/(authorization\s*[:=]\s*)([^,\s}]+)/gi, '$1[redacted]')
    .replace(/([?&](?:api[-_]?key|token|secret|authorization)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 8000);
}

function diagnosticResponseShape(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload)) return { body_type: 'array', body_length: payload.length };
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    const items = Array.isArray(body.items) ? body.items : Array.isArray(body.results) ? body.results : null;
    const qualities = Array.isArray(body.qualities) ? body.qualities : null;
    return {
      body_type: 'object',
      top_keys: Object.keys(body).slice(0, 30),
      item_count: items?.length ?? null,
      quality_count: qualities?.length ?? null,
    };
  }
  return { body_type: payload === null ? 'null' : typeof payload };
}

type DiagnosticStep = {
  operation: string;
  upstream_path: string;
  status: number | null;
  ok: boolean;
  elapsed_ms: number;
  response_headers?: Record<string, string>;
  response_bytes?: number;
  response_body?: string;
  response_shape?: Record<string, unknown>;
  error?: string;
  payload?: unknown;
};

async function diagnosticFetch(
  url: string,
  operation: string,
  headers: Record<string, string>,
  timeout: number,
): Promise<DiagnosticStep> {
  const started = Date.now();
  let upstreamPath = '[invalid-url]';
  try {
    const parsed = new URL(url);
    upstreamPath = `${parsed.pathname}${parsed.search}`;
  } catch {
    // Keep the redacted fallback path.
  }

  try {
    const response = await fetchWithRetry(url, {
      headers,
      timeout,
      retries: 0,
    });
    const rawBody = await response.text();
    const responseBody = redactDiagnosticText(rawBody);
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Preserve the exact text for non-JSON upstream responses.
    }
    const responseHeaders: Record<string, string> = {};
    for (const name of ['content-type', 'server', 'www-authenticate', 'retry-after', 'cf-ray']) {
      const value = response.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    return {
      operation,
      upstream_path: upstreamPath,
      status: response.status,
      ok: response.ok,
      elapsed_ms: Date.now() - started,
      response_headers: responseHeaders,
      response_bytes: rawBody.length,
      response_body: response.ok ? undefined : responseBody,
      response_shape: diagnosticResponseShape(payload),
      payload,
    };
  } catch (error) {
    return {
      operation,
      upstream_path: upstreamPath,
      status: null,
      ok: false,
      elapsed_ms: Date.now() - started,
      error: redactDiagnosticText(String(error instanceof Error ? error.message : error)),
      payload: null,
    };
  }
}

function publicDiagnosticStep(step: DiagnosticStep): Omit<DiagnosticStep, 'payload'> {
  const { payload: _payload, ...publicStep } = step;
  return publicStep;
}

async function runDaratechDiagnostic(type: 'movie' | 'tv', query: any) {
  const title = String(query.title ?? '').trim();
  const year = query.year !== undefined && query.year !== '' ? Number(query.year) : null;
  const season = type === 'tv' ? Number(query.season ?? 1) : null;
  const episode = type === 'tv' ? Number(query.episode ?? 1) : null;
  const headers = {
    Authorization: `Bearer ${env.daratechKey}`,
    Accept: 'application/json',
  };
  const base = env.daratechBase.replace(/\/$/, '');
  const searchUrl = type === 'movie'
    ? `${base}/search/movies?q=${encodeURIComponent(title)}`
    : `${base}/search/tvshows?q=${encodeURIComponent(title)}`;
  const steps: DiagnosticStep[] = [];
  const search = await diagnosticFetch(searchUrl, `${type}-search`, headers, 15_000);
  steps.push(search);
  const searchPayload = search.payload as any;
  const items = Array.isArray(searchPayload?.items)
    ? searchPayload.items
    : Array.isArray(searchPayload?.results)
      ? searchPayload.results
      : [];
  const candidates = items.map((item: any) => ({
    title: String(item.title ?? ''),
    year: Number(item.year) || null,
  }));
  const index = findBestMatch(candidates, { title, year }, 40);
  const matched = index >= 0 ? items[index] : null;
  const subjectId = matched?.subjectId ?? matched?.id ?? null;
  const result: Record<string, unknown> = {
    provider: 'daratech',
    type,
    request: { title, year, ...(type === 'tv' ? { season, episode } : {}) },
    search: {
      candidate_count: items.length,
      matched: Boolean(matched),
      selected: matched ? {
        subject_id: String(subjectId),
        title: String(matched.title ?? ''),
        year: Number(matched.year) || null,
      } : null,
    },
    steps: [publicDiagnosticStep(search)],
  };

  if (!search.ok || !subjectId) {
    result.outcome = search.ok ? 'no_match' : 'upstream_error';
    return result;
  }

  const playbackUrl = type === 'movie'
    ? `${base}/movies/${encodeURIComponent(String(subjectId))}/stream`
    : `${base}/tvshows/${encodeURIComponent(String(subjectId))}/season/${season}/episode/${episode}/stream`;
  const playback = await diagnosticFetch(playbackUrl, `${type}-playback`, headers, 20_000);
  steps.push(playback);
  result.outcome = playback.ok ? 'upstream_ok' : 'upstream_error';
  result.steps = steps.map(publicDiagnosticStep);
  return result;
}

function input(q: any): any {
  const type = String(q.type);
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

function movieboxMovieAttempt(value: MovieProviderInput) {
  return getMovieboxApiMovieStreams(value, {
    baseUrl: env.movieboxBase,
    secret: env.movieboxSecret,
  });
}

function movieboxTvAttempt(value: TvProviderInput) {
  return getMovieboxApiTvStreams(value, {
    baseUrl: env.movieboxBase,
    secret: env.movieboxSecret,
  });
}

async function streamFor(value: any): Promise<{ streams: RawStream[]; subtitles: any[] }> {
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
    if (!isHealthy(id, value.type)) {
      app.log.debug({ provider: id, category: value.type }, 'provider suppressed by health tracker');
      continue;
    }

    try {
      const result = await fn(value);
      if (result.length) {
        recordSuccess(id, value.type);
        app.log.info({ provider: id, category: value.type, count: result.length }, 'provider returned playable streams');
        streams.push(...result);
        subtitles = attachedSubtitles(result);
        break;
      }
      recordFailure(id, value.type, 'no usable result');
      app.log.warn({ provider: id, category: value.type }, 'provider returned no usable streams');
    } catch (error) {
      recordFailure(id, value.type, error);
      app.log.error({ provider: id, category: value.type, error: safeProviderError(error) }, 'provider stream request failed');
    }
  }

  if (!streams.length) {
    app.log.error({ category: value.type, attempted: attempts.map(([id]) => id) }, 'all stream providers exhausted');
  }

  return { streams, subtitles };
}

async function downloadsFor(value: any): Promise<{ downloads: RawDownload[]; subtitles: any[] }> {
  const providers: Array<[string, (input: any) => Promise<RawDownload[]>]> = [
    ['moviebox', (x: any) => getMovieboxDownloads(x, { baseUrl: env.movieboxBase, apiKey: env.movieboxSecret })],
    ['4khdhub', (x: any) => get4khdhubDownloads(x, env.tmdbKey)],
    ['streamflix', (x: any) => getStreamflixDownloads(x, env.tmdbKey)],
  ];
  if (value.type === 'movie') providers.splice(2, 0, ['dvdplay', (x: any) => getDvdplayDownloads(x, env.tmdbKey)]);

  for (const [, fn] of providers) {
    try {
      const result = await fn(value);
      if (result.length) return { downloads: result, subtitles: [] };
    } catch {
      // Fallback continues silently; public responses remain provider-neutral.
    }
  }
  return { downloads: [], subtitles: [] };
}

await app.register(cors, {
  origin: ['https://media.byspun.xyz', 'https://torii.byspun.xyz'],
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Spun-Secret', 'X-Diagnostic-Secret'],
});

app.addHook('onRequest', async (request, reply) => {
  const requestPath = new URL(request.url, 'http://provider.local').pathname;
  if (requestPath === '/health') return;
  if (requestPath.startsWith('/diagnostics/')) {
    if (!env.diagnosticSecret) {
      return reply.code(503).send({
        code: 'DIAGNOSTICS_DISABLED',
        error: 'Diagnostics disabled',
        description: 'The provider diagnostic endpoint has not been enabled on this Render service.',
        action: 'Configure the diagnostic secret before retrying.',
      });
    }
    if (!diagnosticAuth(request)) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        error: 'Diagnostic authentication required',
        description: 'This internal diagnostic request was not authenticated.',
        action: 'Send the X-Diagnostic-Secret header configured for the Render service.',
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

app.get('/diagnostics/:provider/:type', async (request, reply) => {
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

  const diagnostic = await runDaratechDiagnostic(type, query);
  return reply.send({
    diagnostic: true,
    generated_at: new Date().toISOString(),
    ...diagnostic,
  });
});

app.get('/health', async () => {
  const records = getHealthRecords();
  const degraded = records.some((record) => record.status === 'down');
  return {
    status: degraded ? 'degraded' : 'ok',
    capabilities: { streaming: true, downloads: true, anime: true },
    content_resolution: { status: degraded ? 'degraded' : 'healthy', checked_at: new Date().toISOString() },
  };
});

app.get('/stream', async (request, reply) => {
  const q: any = request.query;
  const value = input(q);
  const identifierValid = value.type === 'anime'
    ? Number.isFinite(value.anilist_id)
    : Number.isFinite(value.tmdb_id) || (typeof value.moviebox_id === 'string' && /^\d+$/.test(value.moviebox_id));
  if (!value.title || !identifierValid) {
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
  const value = input(q);
  if (!value.title) {
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

app.setErrorHandler((_error, _request, reply) => reply.code(500).send({
  code: 'INTERNAL_ERROR',
  error: 'Unexpected error',
  description: 'The provider gateway could not complete the request.',
  action: 'Please try again later.',
}));

await app.listen({ port: Number(process.env.PORT ?? 10000), host: '0.0.0.0' });
