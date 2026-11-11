// ─────────────────────────────────────────────────────────────────────────────
// Provider Health Tracking
//
// Two-layer system:
//  1. Request-time health tracking (existing): tracks consecutive failures per
//     (provider, category) and suppresses providers after 3 failures in 60s.
//  2. Background health monitoring (new): runs actual resolution requests
//     against test fixtures at startup and every 3 hours, producing the
//     per-provider health endpoint response.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { providerLogger } from './logging.js';
import type { ManifestProviderEntry, ProviderCategory, ProviderHealthRecord, ProviderId } from './types.js';

// ─── Request-time health tracking ──────────────────────────────────────────────

const records = new Map<string, ProviderHealthRecord>();
const SUPPRESSION_FAILURES = 3;
const SUPPRESSION_MS = 60_000;

function key(providerId: ProviderId, category: ProviderCategory): string {
  return `${providerId}:${category}`;
}

function getOrCreate(providerId: ProviderId, category: ProviderCategory): ProviderHealthRecord {
  const id = key(providerId, category);
  const current = records.get(id);
  if (current) return current;
  const created: ProviderHealthRecord = {
    provider_id: providerId,
    content_type: category,
    status: 'healthy',
    last_success_at: null,
    last_failure_at: null,
    consecutive_failures: 0,
    last_error: null,
    checked_at: new Date().toISOString(),
  };
  records.set(id, created);
  return created;
}

export function recordSuccess(providerId: ProviderId, category: ProviderCategory): void {
  const record = getOrCreate(providerId, category);
  record.status = 'healthy';
  record.last_success_at = new Date().toISOString();
  record.consecutive_failures = 0;
  record.last_error = null;
  record.checked_at = new Date().toISOString();
}

export function recordFailure(providerId: ProviderId, category: ProviderCategory, error: unknown): void {
  const record = getOrCreate(providerId, category);
  record.last_failure_at = new Date().toISOString();
  record.consecutive_failures += 1;
  record.last_error = error instanceof Error ? error.message.slice(0, 240) : String(error ?? 'provider failure').slice(0, 240);
  record.status = record.consecutive_failures >= SUPPRESSION_FAILURES ? 'down' : 'degraded';
  record.checked_at = new Date().toISOString();
}

export function isHealthy(providerId: ProviderId, category: ProviderCategory): boolean {
  const record = getOrCreate(providerId, category);
  if (record.status !== 'down') return true;
  if (!record.last_failure_at) return true;
  return Date.now() - Date.parse(record.last_failure_at) >= SUPPRESSION_MS;
}

export function getHealthRecords(): ProviderHealthRecord[] {
  return [...records.values()].map((record) => ({ ...record }));
}

// ─── Background health monitoring ──────────────────────────────────────────────

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ProviderHealthResult {
  provider: string;
  status: ProviderHealthStatus;
  responseTimeMs: number | null;
  checkedAt: string | null;
  error?: string;
}

interface HealthCheckJob {
  provider: string;
  capability: 'streaming' | 'downloading';
  fixture: TestFixture;
}

// Hardcoded test fixtures per media type
const MOVIE_FIXTURE = {
  type: 'movie' as const,
  title: 'Inception',
  year: 2010,
  tmdb_id: 27205,
  imdb_id: 'tt1375666',
};

const SERIES_FIXTURE = {
  type: 'tv' as const,
  title: 'Breaking Bad',
  year: 2008,
  tmdb_id: 1396,
  imdb_id: 'tt0903747',
  season: 1,
  episode: 1,
};

const ANIME_FIXTURE = {
  type: 'anime' as const,
  title: 'Attack on Titan',
  year: 2013,
  anilist_id: 16498,
  episode: 1,
  dub: false,
};

type TestFixture = typeof MOVIE_FIXTURE | typeof SERIES_FIXTURE | typeof ANIME_FIXTURE;

function selectFixture(entry: ManifestProviderEntry): TestFixture | null {
  const types = (entry.type ?? []) as string[];

  // Prefer anime if supported
  if (types.includes('anime')) {
    return ANIME_FIXTURE;
  }
  // Prefer series if supported
  if (types.includes('series')) {
    return SERIES_FIXTURE;
  }
  // Default to movie
  if (types.includes('movies')) {
    return MOVIE_FIXTURE;
  }
  return null;
}

function selectCapability(entry: ManifestProviderEntry): 'streaming' | 'downloading' {
  const capabilities = (entry.capabilities ?? []) as string[];
  // Prefer streaming for health checks
  if (capabilities.includes('streaming')) return 'streaming';
  return 'downloading';
}

function isValidFixtureForProvider(fixture: TestFixture, entry: ManifestProviderEntry): boolean {
  const supportedIds = new Set((entry.supportedIds ?? []) as string[]);
  const types = (entry.type ?? []) as string[];

  // Check if the fixture's media type is supported
  const fixtureType = fixture.type;
  const manifestType = fixtureType === 'movie' ? 'movies' : fixtureType === 'tv' ? 'series' : 'anime';
  if (!types.includes(manifestType)) return false;

  // If provider has specific ID requirements, check if fixture provides them
  if (supportedIds.size > 0) {
    if (fixtureType === 'movie' || fixtureType === 'tv') {
      if (!supportedIds.has('tmdb') && !supportedIds.has('imdb') && !supportedIds.has('moviebox')) {
        return false;
      }
    }
    if (fixtureType === 'anime') {
      if (!supportedIds.has('anilist') && !supportedIds.has('mal')) {
        return false;
      }
    }
  }

  return true;
}

export class HealthMonitor {
  private results = new Map<string, ProviderHealthResult>();
  private isRunning = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private manifestEntries: ManifestProviderEntry[] = [];
  private streamForFn: ((value: any) => Promise<{ streams: any[]; subtitles: any[] }>) | null = null;
  private downloadsForFn: ((value: any) => Promise<{ downloads: any[]; subtitles: any[] }>) | null = null;

  constructor() {
    this.loadManifest();
  }

  private loadManifest(): void {
    try {
      // Resolve manifest relative to the providers root directory
      // In dev: providers/internal/health.ts -> ../../manifest.json
      // In dist: dist/providers/internal/health.js -> ../../manifest.json
      const manifestPath = fileURLToPath(new URL('../../manifest.json', import.meta.url));
      const raw = fs.readFileSync(manifestPath, 'utf8');
      // Strip JSONC comments
      const stripped = raw.replace(/\/\/.*$/gm, '');
      const parsed = JSON.parse(stripped) as { providers?: ManifestProviderEntry[] };
      this.manifestEntries = Array.isArray(parsed.providers) ? parsed.providers : [];
    } catch (error) {
      providerLogger.error('health-monitor', `Failed to load manifest: ${String(error)}`);
      this.manifestEntries = [];
    }
  }

  /** Set the resolution functions after they're defined in index.ts */
  setResolutionFunctions(
    streamFor: (value: any) => Promise<{ streams: any[]; subtitles: any[] }>,
    downloadsFor: (value: any) => Promise<{ downloads: any[]; subtitles: any[] }>
  ): void {
    this.streamForFn = streamFor;
    this.downloadsForFn = downloadsFor;
  }

  /** Get all enabled providers that should be health-checked */
  private getHealthCheckTargets(): HealthCheckJob[] {
    const jobs: HealthCheckJob[] = [];

    for (const entry of this.manifestEntries) {
      if (entry.enabled !== true) continue;

      const capability = selectCapability(entry);
      const fixture = selectFixture(entry);

      if (!fixture) {
        providerLogger.warn('health-monitor', `No suitable fixture for provider "${entry.name}"`);
        continue;
      }

      const valid = isValidFixtureForProvider(fixture, entry);
      providerLogger.debug('health-monitor', `Provider "${entry.name}": capability=${capability}, fixture=${fixture.type}, valid=${valid}, supportedIds=${JSON.stringify(entry.supportedIds)}`);

      if (!valid) {
        providerLogger.warn('health-monitor', `Fixture not compatible with provider "${entry.name}"`);
        continue;
      }

      jobs.push({ provider: entry.name, capability, fixture });
    }

    providerLogger.info('health-monitor', `Health check targets: ${jobs.map(j => j.provider).join(', ')}`);
    return jobs;
  }

  /** Run a single provider health check */
  private async checkProvider(job: HealthCheckJob): Promise<ProviderHealthResult> {
    const { provider, capability, fixture } = job;
    const startTime = Date.now();

    try {
      let result: { streams?: any[]; downloads?: any[]; subtitles?: any[] } = {};

      if (capability === 'streaming') {
        if (!this.streamForFn) throw new Error('Stream resolution function not registered');
        result = await this.streamForFn(fixture);
        // Check if we got valid streams with URLs
        const streams = result.streams ?? [];
        const validStream = streams.find(s => s && typeof s.url === 'string' && s.url.startsWith('http'));

        if (validStream) {
          return {
            provider,
            status: 'healthy',
            responseTimeMs: Date.now() - startTime,
            checkedAt: new Date().toISOString(),
          };
        }
        // No valid stream returned
        return {
          provider,
          status: 'down',
          responseTimeMs: Date.now() - startTime,
          checkedAt: new Date().toISOString(),
          error: 'No valid stream URL returned',
        };
      } else {
        if (!this.downloadsForFn) throw new Error('Download resolution function not registered');
        result = await this.downloadsForFn(fixture);
        const downloads = result.downloads ?? [];
        const validDownload = downloads.find(d => d && typeof d.url === 'string' && d.url.startsWith('http'));

        if (validDownload) {
          return {
            provider,
            status: 'healthy',
            responseTimeMs: Date.now() - startTime,
            checkedAt: new Date().toISOString(),
          };
        }
        return {
          provider,
          status: 'down',
          responseTimeMs: Date.now() - startTime,
          checkedAt: new Date().toISOString(),
          error: 'No valid download URL returned',
        };
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Classify error type
      let status: ProviderHealthStatus = 'down';
      if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('429') || errorMsg.includes('rate limit')) {
        status = 'degraded';
      } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('network')) {
        status = 'degraded';
      }

      return {
        provider,
        status,
        responseTimeMs: elapsed > 30000 ? null : elapsed,
        checkedAt: new Date().toISOString(),
        error: errorMsg.slice(0, 200),
      };
    }
  }

  /** Run all health checks */
  async runHealthChecks(): Promise<void> {
    if (this.isRunning) {
      providerLogger.debug('health-monitor', 'Health check already running, skipping');
      return;
    }

    this.isRunning = true;
    const jobs = this.getHealthCheckTargets();

    providerLogger.info('health-monitor', `Starting health checks for ${jobs.length} providers`);

    // Run checks with individual timeouts and error isolation
    const checkPromises = jobs.map(async (job) => {
      const timeoutMs = 30000; // 30 second timeout per provider
      try {
        const result = await Promise.race([
          this.checkProvider(job),
          new Promise<ProviderHealthResult>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), timeoutMs)
          ),
        ]);
        this.results.set(job.provider, result);
        providerLogger.info('health-monitor', `${job.provider}: ${result.status} (${result.responseTimeMs}ms)${result.error ? ` - ${result.error}` : ''}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const result: ProviderHealthResult = {
          provider: job.provider,
          status: errorMsg.includes('timeout') ? 'degraded' : 'down',
          responseTimeMs: null,
          checkedAt: new Date().toISOString(),
          error: errorMsg.slice(0, 200),
        };
        this.results.set(job.provider, result);
        providerLogger.warn('health-monitor', `${job.provider}: ${result.status} - ${result.error}`);
      }
    });

    await Promise.all(checkPromises);
    this.isRunning = false;
    providerLogger.info('health-monitor', 'Health checks completed');
  }

  /** Get current health results for the endpoint */
  getHealthSummary(): {
    status: 'healthy' | 'degraded' | 'down' | 'unknown';
    summary: { healthy: number; degraded: number; down: number; unknown: number };
    providers: Record<string, { status: ProviderHealthStatus; response_time: string | null }>;
  } {
    // Only include enabled providers from manifest
    const enabledProviders = this.manifestEntries
      .filter(e => e.enabled === true)
      .map(e => e.name);

    const providers: Record<string, { status: ProviderHealthStatus; response_time: string | null }> = {};
    let healthy = 0, degraded = 0, down = 0, unknown = 0;

    for (const name of enabledProviders) {
      const result = this.results.get(name);
      if (!result || result.status === 'unknown') {
        providers[name] = { status: 'unknown', response_time: null };
        unknown++;
      } else {
        const responseTime = result.responseTimeMs !== null ? `${result.responseTimeMs}ms` : null;
        providers[name] = { status: result.status, response_time: responseTime };
        switch (result.status) {
          case 'healthy': healthy++; break;
          case 'degraded': degraded++; break;
          case 'down': down++; break;
        }
      }
    }

    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'down' | 'unknown';
    if (healthy + degraded + down === 0) {
      overallStatus = 'unknown';
    } else if (down === healthy + degraded + down) {
      overallStatus = 'down';
    } else if (degraded > 0 || down > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    return {
      status: overallStatus,
      summary: { healthy, degraded, down, unknown },
      providers,
    };
  }

  /** Start background scheduler */
  startScheduler(): void {
    // Run initial check immediately
    this.runHealthChecks().catch(err =>
      providerLogger.error('health-monitor', `Initial health check failed: ${String(err)}`)
    );

    // Schedule every 3 hours
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    this.intervalHandle = setInterval(() => {
      this.runHealthChecks().catch(err =>
        providerLogger.error('health-monitor', `Scheduled health check failed: ${String(err)}`)
      );
    }, THREE_HOURS);

    // Prevent interval from keeping process alive
    this.intervalHandle.unref?.();

    providerLogger.info('health-monitor', 'Health check scheduler started (every 3 hours)');
  }

  /** Stop background scheduler */
  stopScheduler(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      providerLogger.info('health-monitor', 'Health check scheduler stopped');
    }
  }
}

// Singleton instance
export const healthMonitor = new HealthMonitor();