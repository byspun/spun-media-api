import type { ProviderCategory, ProviderHealthRecord, ProviderId } from './shared/types.js';

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
