import type { PlanPolicy } from './types.js';

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'on';
}

function mode(value: string | undefined): 'off' | 'observe' | 'enforce' {
  if (value === 'observe' || value === 'enforce') return value;
  return 'off';
}

export function policyFromEnv(env: Record<string, unknown>): PlanPolicy {
  return {
    billingEnabled: bool(String(env.BILLING_ENABLED ?? 'false')),
    subscriptionsEnabled: bool(String(env.SUBSCRIPTIONS_ENABLED ?? 'false')),
    plansEnabled: bool(String(env.PLANS_ENABLED ?? 'false')),
    quotaMode: mode(String(env.QUOTA_MODE ?? 'off')),
    rateLimitMode: mode(String(env.RATE_LIMIT_MODE ?? 'off')),
  };
}

export function commercialEnforcementEnabled(policy: PlanPolicy): boolean {
  return policy.billingEnabled || policy.subscriptionsEnabled || policy.plansEnabled
    || policy.quotaMode !== 'off' || policy.rateLimitMode !== 'off';
}

/**
 * Returns the default expiry for a newly generated key.
 * Existing rows are never changed here, so keys created while enforcement was
 * disabled remain grandfathered when enforcement is later enabled.
 */
export function defaultApiKeyExpiry(policy: PlanPolicy, now = Date.now()): string | null {
  if (!commercialEnforcementEnabled(policy)) return null;
  return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
}
