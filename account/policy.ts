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
