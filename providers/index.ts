import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDownloadResponse, buildStreamResponse, attachedSubtitles } from './internal/normalizer.js';
import { recordFailure, recordSuccess, isHealthy, getHealthRecords, healthMonitor } from './internal/health.js';
import type { AnimeProviderInput, MovieProviderInput, ProviderCategory, ProviderHealthRecord, ProviderId, RawDownload, RawStream, RawSubtitle, TvProviderInput } from './internal/types.js';
import { providerLogger, startProviderLogArchiver, flushProviderLogs } from './internal/logging.js';

const app = Fastify({ logger: false, trustProxy: true });

const env = {
  internalsKey: process.env.INTERNALS_KEY ?? '',
  movieboxBase: process.env.MOVIEBOX_API_BASE ?? 'https://moviebox.byspun.xyz',
  movieboxSecret: process.env.MOVIEBOX_API_SECRET ?? '',
  daratechBase: process.env.DARATECH_API_BASE ?? 'https://apimovie.runflix.name.ng/v1',
  daratechKey: process.env.DARATECH_API_KEY ?? '',
  tmdbKey: process.env.TMDB_API_KEY ?? '',
  adminKey: process.env.ADMIN_KEY ?? '',
};

// ─── Config display (plain output, no timestamps/levels) ──────────────────────────
const configChecks = [
  { label: 'TMDB Key', value: env.tmdbKey, required: true },
  { label: 'Internals Key', value: env.internalsKey, required: true },
  { label: 'Admin Key', value: env.adminKey, required: true },
  { label: 'Moviebox Secret', value: env.movieboxSecret, required: false },
  { label: 'Daratech Key', value: env.daratechKey, required: false },
];

let hasMissingRequired = false;
for (const { label, value, required } of configChecks) {
  const status = value ? '✓' : 'x';
  const suffix = required ? ' (required)' : value ? '' : ' (optional)';
  console.log(`${status} ${label}${suffix}`);
  if (!value && required) hasMissingRequired = true;
}

if (hasMissingRequired) {
  const missing = configChecks.filter(c => c.required && !c.value).map(c => c.label).join(', ');
  console.log(`\nMissing required configuration: ${missing} — service will not start`);
  process.exit(1);
}

console.log('\nLogs:');

function safeProviderError(error: unknown): string {
  return String(error instanceof Error ? error.message : error ?? 'unknown failure')
    .replace(/https?:\/\/[^\s]+/g, '[upstream-url]')
    .slice(0, 240);
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifest-driven provider registry
//
// manifest.json is the single source of truth: which providers exist, which media
// types and capabilities they serve, which ID systems they use for matching, and
// the fallback order for each operation. Provider modules on disk are inert until
// registered here. Conflicts are detected once at startup and never crash the layer.
// ─────────────────────────────────────────────────────────────────────────────

type MediaType = 'movie' | 'tv' | 'anime';
type ManifestMediaType = 'movies' | 'series' | 'anime';
type Capability = 'streaming' | 'downloading' | 'subtitle';

const PRIORITY_FIELD: Record<Exclude<Capability, 'subtitle'>, 'priority_stream' | 'priority_download'> = {
  streaming: 'priority_stream',
  downloading: 'priority_download',
};

interface ManifestProviderEntry {
  name: string;
  module: string;
  enabled: boolean;
  type?: unknown;
  capabilities?: unknown;
  supportedIds?: unknown;
  priority_stream?: unknown;
  priority_download?: unknown;
  priority_subtitles?: unknown;
}

/** Interface for testing a single provider without fallback (used by the health monitor). */
export interface ProviderTester {
  testStream: (name: ProviderId, fixture: { type: 'movie' | 'tv' | 'anime'; anilist_id?: number; tmdb_id?: number; title: string; episode?: number }) => Promise<{ streams: RawStream[]; subtitles: RawSubtitle[] }>;
  testDownload: (name: ProviderId, fixture: { type: 'movie' | 'tv' | 'anime'; tmdb_id?: number; title: string; season?: number; episode?: number }) => Promise<{ downloads: RawDownload[]; subtitles: RawSubtitle[] }>;
}

interface ScheduledProvider {
  name: ProviderId;
  module: string;
  supportedIds: string[];
  priority: number;
}

const VALID_MANIFEST_TYPES: ManifestMediaType[] = ['movies', 'series', 'anime'];
const VALID_CAPABILITIES = ['streaming', 'downloading', 'subtitle'];
const VALID_ID_SYSTEMS = ['tmdb', 'imdb', 'anilist', 'mal', 'moviebox'];

function manifestTypeToCategory(value: ManifestMediaType): MediaType {
  if (value === 'movies') return 'movie';
  if (value === 'series') return 'tv';
  return 'anime';
}

/** Strips // line comments from JSONC while leaving string literals intact. */
function stripJsonComments(raw: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inLineComment) {
      if (ch === '\n') { inLineComment = false; out += ch; }
      continue;
    }
    if (!inString && ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '"' && raw[i - 1] !== '\\') inString = !inString;
    out += ch;
  }
  return out;
}

function readManifestEntries(): ManifestProviderEntry[] {
  const manifestPath = fileURLToPath(new URL('./manifest.json', import.meta.url));
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(stripJsonComments(raw)) as { providers?: ManifestProviderEntry[] };
  if (!Array.isArray(parsed.providers)) {
    throw new Error('manifest.json must contain a top-level "providers" array');
  }
  return parsed.providers;
}

class ProviderRegistry {
  /** `${mediaType}:${capability}` -> providers in priority order (conflicts already removed). */
  private scheduled = new Map<string, ScheduledProvider[]>();
  private registeredNames = new Set<string>();

  load(): void {
    let entries: ManifestProviderEntry[] = [];
    try {
      entries = readManifestEntries();
    } catch (error) {
      providerLogger.error('manifest', `providers/manifest.json could not be read: ${safeProviderError(error)}`);
      providerLogger.error('manifest', 'No providers are registered — every stream and download request will fall back to an empty result');
      return;
    }

    // 1. Parse every entry; only enabled, structurally valid providers are scheduled.
    for (const entry of entries) {
      if (typeof entry.name !== 'string' || !entry.name) {
        providerLogger.warn('manifest', 'Manifest entry without a "name" is ignored');
        continue;
      }
      this.registeredNames.add(entry.name);
      if (entry.enabled !== true) {
        if (entry.enabled === false) {
          providerLogger.info('manifest', `Provider "${entry.name}" is disabled in the manifest and is never loaded or called`);
        } else {
          providerLogger.warn('manifest', `Provider "${entry.name}" is missing a boolean "enabled" field and is treated as not registered`);
        }
        continue;
      }
      if (typeof entry.module !== 'string' || !entry.module) {
        providerLogger.warn('manifest', `Provider "${entry.name}" has no "module" path and cannot be scheduled`);
        continue;
      }
      if (!Array.isArray(entry.type) || entry.type.length === 0) {
        providerLogger.warn('manifest', `Provider "${entry.name}" declares no media "type" and is skipped for every operation`);
        continue;
      }
      if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
        providerLogger.warn('manifest', `Provider "${entry.name}" declares no "capabilities" and is skipped for every operation`);
        continue;
      }

      const categories: MediaType[] = [];
      for (const rawType of entry.type) {
        if (typeof rawType === 'string' && (VALID_MANIFEST_TYPES as string[]).includes(rawType)) {
          categories.push(manifestTypeToCategory(rawType as ManifestMediaType));
        } else {
          providerLogger.warn('manifest', `Provider "${entry.name}" has unknown media type "${String(rawType)}" — valid: ${VALID_MANIFEST_TYPES.join(', ')}`);
        }
      }
      if (categories.length === 0) {
        providerLogger.warn('manifest', `Provider "${entry.name}" has no valid media type after validation and is skipped for every operation`);
        continue;
      }

      const supportedIds: string[] = [];
      if (entry.supportedIds !== undefined) {
        if (Array.isArray(entry.supportedIds) && entry.supportedIds.every((id) => typeof id === 'string' && (VALID_ID_SYSTEMS as string[]).includes(id))) {
          supportedIds.push(...(entry.supportedIds as string[]));
        } else {
          providerLogger.warn('manifest', `Provider "${entry.name}" has an invalid "supportedIds" list — valid: ${VALID_ID_SYSTEMS.join(', ')} — treated as [] (title/fuzzy matching only)`);
        }
      }

      for (const rawCapability of entry.capabilities) {
        if (typeof rawCapability !== 'string' || !(VALID_CAPABILITIES as string[]).includes(rawCapability)) {
          providerLogger.warn('manifest', `Provider "${entry.name}" has unknown capability "${String(rawCapability)}" — valid: ${VALID_CAPABILITIES.join(', ')}`);
          continue;
        }
        const priority = this.readPriority(entry, rawCapability as Capability);
        if (priority === null) continue; // missing/invalid priority: reported, provider skipped for this operation only
        for (const category of categories) {
          this.push(category, rawCapability as Capability, {
            name: entry.name as ProviderId,
            module: entry.module,
            supportedIds,
            priority,
          });
        }
      }
    }

    // 2. Per (media type, capability): detect priority conflicts and order survivors.
    this.resolveConflicts();
  }

  /** Returns the priority for a declared capability, or null after emitting a clear warning. */
  private readPriority(entry: ManifestProviderEntry, capability: Capability): number | null {
    if (capability === 'subtitle') {
      // No provider delivers standalone subtitles yet; accept but do not schedule.
      const raw = entry.priority_subtitles;
      if (raw === undefined) {
        providerLogger.warn('manifest', `Provider "${entry.name}" declares subtitle support without "priority_subtitles" — subtitles capability ignored for now`);
        return null;
      }
      return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
    }
    const field = PRIORITY_FIELD[capability];
    const raw = entry[field];
    if (raw === undefined || raw === null) {
      providerLogger.warn('manifest', `Provider "${entry.name}" declares "${capability}" but has no "${field}" — skipped for this operation only (other operations still work)`);
      return null;
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) {
      providerLogger.warn('manifest', `Provider "${entry.name}" has invalid ${field} "${String(raw)}" — must be a number >= 0 — skipped for this operation only (other operations still work)`);
      return null;
    }
    return numeric;
  }

  private push(category: MediaType, capability: Capability, provider: ScheduledProvider): void {
    const key = `${category}:${capability}`;
    const list = this.scheduled.get(key);
    if (list) list.push(provider);
    else this.scheduled.set(key, [provider]);
  }

  /**
   * Conflicting priorities (two enabled providers sharing a priority for the same
   * media type + capability) are reported once at startup and every provider in the
   * conflict is skipped for that operation only. Conflicts are never resolved
   * silently by alphabetical order or manifest position, and unrelated capabilities
   * of the same providers stay fully registered.
   */
  private resolveConflicts(): void {
    for (const [key, providers] of this.scheduled) {
      const [category, capability] = key.split(':') as [MediaType, Capability];
      const byPriority = new Map<number, ScheduledProvider[]>();
      for (const provider of providers) {
        const group = byPriority.get(provider.priority);
        if (group) group.push(provider);
        else byPriority.set(provider.priority, [provider]);
      }

      const survivors: ScheduledProvider[] = [];
      for (const [priority, group] of [...byPriority.entries()].sort((a, b) => a[0] - b[0])) {
        if (group.length === 1) {
          survivors.push(group[0]);
          continue;
        }
        const names = group.map((provider) => provider.name).join(', ');
        providerLogger.warn(
          'manifest',
          `Priority conflict: ${names} all claim priority ${priority} for ${capability} on ${category} — all are skipped for this operation only`,
        );
      }
      this.scheduled.set(key, survivors);
    }
  }

  /** Providers in manifest priority order for one media type + capability. */
  getOrdered(category: MediaType, capability: Capability): ScheduledProvider[] {
    return this.scheduled.get(`${category}:${capability}`) ?? [];
  }

  isRegistered(name: string): boolean {
    return this.registeredNames.has(name);
  }

  getRegisteredNames(): string[] {
    return [...this.registeredNames];
  }
}

const registry = new ProviderRegistry();
registry.load();
providerLogger.info('manifest', `Provider manifest loaded — registered: ${registry.getRegisteredNames().join(', ') || '(none)'}`);

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic provider loading
//
// Modules are imported on demand (module cache resolves repeat loads) and the
// expected export is resolved by provider name + capability. A module that fails
// to load or lacks the export is reported and skipped, never crashing a request.
// ─────────────────────────────────────────────────────────────────────────────

type ProviderFn = (input: any, config?: any) => Promise<unknown>;

const moduleCache = new Map<string, Record<string, unknown>>();

/** Resolves the correct module extension for the current runtime (tsx vs node). */
function resolveModuleSpecifier(specifier: string): string {
  // In production (dist), modules are .js files; in dev (tsx), they're .ts files.
  // The manifest always references .ts, so we swap extension based on __dirname.
  if (import.meta.url.includes('/dist/')) {
    return specifier.replace(/\.ts$/, '.js');
  }
  return specifier;
}

async function loadModule(specifier: string): Promise<Record<string, unknown> | null> {
  const resolved = resolveModuleSpecifier(specifier);
  const cached = moduleCache.get(resolved);
  if (cached) return cached;
  try {
    const mod = (await import(resolved)) as Record<string, unknown>;
    moduleCache.set(resolved, mod);
    return mod;
  } catch (error) {
    providerLogger.error('manifest', `Provider module "${resolved}" failed to import: ${safeProviderError(error)}`);
    return null;
  }
}

function expectedExportName(providerName: string, capability: Capability): string {
  const pascal = providerName.charAt(0).toUpperCase() + providerName.slice(1);
  return `get${pascal}${capability === 'streaming' ? 'Streams' : capability === 'downloading' ? 'Downloads' : 'Subtitles'}`;
}

async function resolveProviderFn(provider: ScheduledProvider, capability: Capability): Promise<ProviderFn | null> {
  const mod = await loadModule(provider.module);
  if (!mod) return null;
  const exportName = expectedExportName(provider.name, capability);
  const fn = mod[exportName];
  if (typeof fn !== 'function') {
    providerLogger.error('manifest', `Provider "${provider.name}" is registered for ${capability} but "${provider.module}" does not export ${exportName} — skipped for this operation`);
    return null;
  }
  return fn as ProviderFn;
}

/** Builds the per-provider configuration object passed as the second argument. */
function providerConfig(name: ProviderId): unknown {
  switch (name) {
    case 'moviebox':
      return { baseUrl: env.movieboxBase, secret: env.movieboxSecret, apiKey: env.movieboxSecret };
    case 'daratech':
      return { baseUrl: env.daratechBase, apiKey: env.daratechKey };
    case 'castle':
    case 'netmirror':
    case 'vidlink':
    case '4khdhub':
    case 'dvdplay':
    case 'streamflix':
      return env.tmdbKey;
    default:
      return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider tester (used by the health monitor)
//
// Tests a single provider in isolation, WITHOUT the fallback chain, so each
// provider's health is measured independently.
// ─────────────────────────────────────────────────────────────────────────────

interface MovieFixture { type: 'movie'; tmdb_id?: number; title: string; year?: number }
interface TvFixture { type: 'tv'; tmdb_id?: number; title: string; season?: number; episode?: number }
interface AnimeFixture { type: 'anime'; anilist_id?: number; title: string; episode?: number; dub?: boolean }

function eligibleForTest(provider: ScheduledProvider, fixture: MovieFixture | TvFixture | AnimeFixture): boolean {
  if (fixture.type === 'anime') return fixture.anilist_id !== undefined;
  const hasTmdb = fixture.tmdb_id !== undefined;
  if (!hasTmdb) return false;
  return true;
}

export const providerTester: ProviderTester = {
  async testStream(name: ProviderId, fixture: AnimeFixture | MovieFixture | TvFixture): Promise<{ streams: RawStream[]; subtitles: RawSubtitle[] }> {
    const category = fixture.type as MediaType;
    const ordered = registry.getOrdered(category, 'streaming');
    const provider = ordered.find(p => p.name === name);
    if (!provider) return { streams: [], subtitles: [] };
    if (!eligibleForTest(provider, fixture)) return { streams: [], subtitles: [] };

    const fn = await resolveProviderFn(provider, 'streaming');
    if (!fn) return { streams: [], subtitles: [] };

    try {
      const result = (await fn(fixture, providerConfig(name))) as RawStream[];
      if (Array.isArray(result) && result.length) {
        return { streams: result, subtitles: attachedSubtitles(result) };
      }
      return { streams: [], subtitles: [] };
    } catch {
      return { streams: [], subtitles: [] };
    }
  },

  async testDownload(name: ProviderId, fixture: MovieFixture | TvFixture): Promise<{ downloads: RawDownload[]; subtitles: RawSubtitle[] }> {
    const category = fixture.type as MediaType;
    const ordered = registry.getOrdered(category, 'downloading');
    const provider = ordered.find(p => p.name === name);
    if (!provider) return { downloads: [], subtitles: [] };

    const fn = await resolveProviderFn(provider, 'downloading');
    if (!fn) return { downloads: [], subtitles: [] };

    try {
      const result = (await fn(fixture, providerConfig(name))) as RawDownload[];
      if (Array.isArray(result) && result.length) {
        return { downloads: result, subtitles: [] };
      }
      return { downloads: [], subtitles: [] };
    } catch {
      return { downloads: [], subtitles: [] };
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Request coordination (contracts unchanged)
// ─────────────────────────────────────────────────────────────────────────────

function auth(request: any): boolean {
  return Boolean(env.internalsKey) && request.headers['x-internals-key'] === env.internalsKey;
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

/** Mirrors the original per-request gating: which registered providers may run for this input. */
function eligibleForStream(provider: ScheduledProvider, value: any): boolean {
  if (value.type === 'anime') return Number.isFinite(value.anilist_id);
  const hasTmdb = Number.isFinite(value.tmdb_id);
  const hasMoviebox = typeof value.moviebox_id === 'string' && value.moviebox_id.length > 0;
  if (!hasTmdb && !hasMoviebox) return false;
  if (provider.name === 'moviebox') return hasMoviebox;
  return hasTmdb;
}

async function streamFor(value: any): Promise<{ streams: RawStream[]; subtitles: RawSubtitle[] }> {
  const streams: RawStream[] = [];
  let subtitles: RawSubtitle[] = [];
  const category = value.type as MediaType;
  const ordered = registry.getOrdered(category, 'streaming');
  const attempted: string[] = [];

  for (const provider of ordered) {
    if (!eligibleForStream(provider, value)) continue;
    if (!isHealthy(provider.name, category as ProviderCategory)) {
      providerLogger.debug(provider.name, `Provider suppressed by health tracker category=${category}`);
      continue;
    }

    const fn = await resolveProviderFn(provider, 'streaming');
    if (!fn) continue;

    attempted.push(provider.name);
    try {
      const result = (await fn(value, providerConfig(provider.name))) as RawStream[];
      if (Array.isArray(result) && result.length) {
        recordSuccess(provider.name, category as ProviderCategory);
        providerLogger.info(provider.name, `Provider returned playable streams category=${category} count=${result.length}`);
        streams.push(...result);
        subtitles = attachedSubtitles(result);
        break;
      }
      recordFailure(provider.name, category as ProviderCategory, 'no usable result');
      providerLogger.warn(provider.name, `Provider returned no usable streams category=${category}`);
    } catch (error) {
      recordFailure(provider.name, category as ProviderCategory, error);
      providerLogger.error(provider.name, `Provider stream request failed category=${category}: ${safeProviderError(error)}`);
    }
  }

  if (!streams.length) {
    providerLogger.error('fallback', `All stream providers exhausted category=${value.type} attempted=${attempted.join(',') || '(none)'}`);
  }

  return { streams, subtitles };
}

async function downloadsFor(value: any): Promise<{ downloads: RawDownload[]; subtitles: RawSubtitle[] }> {
  const category = value.type as MediaType;
  const ordered = registry.getOrdered(category, 'downloading');
  const attempted: string[] = [];

  for (const provider of ordered) {
    const fn = await resolveProviderFn(provider, 'downloading');
    if (!fn) continue;

    attempted.push(provider.name);
    try {
      const result = (await fn(value, providerConfig(provider.name))) as RawDownload[];
      if (Array.isArray(result) && result.length) {
        providerLogger.info(provider.name, `Provider returned downloadable files category=${value.type} count=${result.length}`);
        return { downloads: result, subtitles: [] };
      }
      providerLogger.warn(provider.name, `Provider returned no downloadable files category=${value.type}`);
    } catch (error) {
      providerLogger.error(provider.name, `Provider download request failed category=${value.type}: ${safeProviderError(error)}`);
    }
  }
  providerLogger.error('fallback', `All download providers exhausted category=${value.type} attempted=${attempted.join(',') || '(none)'}`);
  return { downloads: [], subtitles: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP routes (request/response contracts unchanged)
// ─────────────────────────────────────────────────────────────────────────────

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

app.addHook('onResponse', async (request, reply) => {
  const requestPath = request.url.split('?')[0];
  providerLogger.info('request', `${request.method} ${requestPath} status=${reply.statusCode}`);
});

app.get('/health', async () => {
  return healthMonitor.getHealthSummary();
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

// Register resolution functions with health monitor after both are defined
healthMonitor.setResolutionFunctions(streamFor, downloadsFor, { testStream: providerTester.testStream.bind(providerTester), testDownload: providerTester.testDownload.bind(providerTester) });

// Start health monitor scheduler (now with test functions available)
healthMonitor.startScheduler();

process.on('SIGTERM', async () => {
  healthMonitor.stopScheduler();
  await flushProviderLogs();
  process.exit(0);
});
process.on('SIGINT', async () => {
  healthMonitor.stopScheduler();
  await flushProviderLogs();
  process.exit(0);
});

await app.listen({ port: Number(process.env.PORT ?? 10000), host: '0.0.0.0' });
providerLogger.info('startup', `Provider service listening on port ${process.env.PORT ?? 10000}`);
