import type { PlanRecord } from './types.js';

export type LimitMode = 'off' | 'observe' | 'enforce';

export interface RateLimitBucket {
  key: string;
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitBucket>;
}

/**
 * Placeholder storage implementation. It deliberately permits every request.
 * Replace this with Cloudflare Rate Limiting, Durable Objects, or another
 * distributed store before setting RATE_LIMIT_MODE=enforce in production.
 */
export class NoopRateLimitStore implements RateLimitStore {
  async consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitBucket> {
    return { key, count: 0, resetAt: now + windowMs };
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  mode: LimitMode;
  limit: number | null;
  burst: number | null;
  count: number;
  resetAt: number | null;
  wouldExceed: boolean;
}

export async function rateLimitDecision(
  store: RateLimitStore,
  key: string,
  plan: PlanRecord | null,
  mode: LimitMode,
  now = Date.now(),
): Promise<RateLimitDecision> {
  const limit = plan?.requests_per_minute ?? null;
  const burst = plan?.burst_limit ?? null;
  if (mode === 'off' || limit === null || limit <= 0) {
    return { allowed: true, mode, limit, burst, count: 0, resetAt: null, wouldExceed: false };
  }
  const bucket = await store.consume(key, limit, 60_000, now);
  const effectiveLimit = Math.max(limit, burst ?? limit);
  const wouldExceed = bucket.count > effectiveLimit;
  return {
    allowed: mode !== 'enforce' || !wouldExceed,
    mode,
    limit,
    burst,
    count: bucket.count,
    resetAt: bucket.resetAt,
    wouldExceed,
  };
}
