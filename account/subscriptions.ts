import type { PlanRecord, SqlExecutor, SubscriptionRecord } from './types.js';

export async function getPlanById(sql: SqlExecutor, planId: string): Promise<PlanRecord | null> {
  const rows = await sql`
    SELECT id, name, slug, price, currency, billing_interval,
           metadata_monthly_limit, stream_monthly_limit, download_monthly_limit,
           requests_per_minute, burst_limit, api_key_limit, origin_limit,
           daily_request_safety_limit, features, is_active, created_at, updated_at
    FROM public.plans
    WHERE id = ${planId}
    LIMIT 1
  `;
  return rows.length ? rows[0] as PlanRecord : null;
}

export async function getPlanBySlug(sql: SqlExecutor, slug: string): Promise<PlanRecord | null> {
  const rows = await sql`
    SELECT id, name, slug, price, currency, billing_interval,
           metadata_monthly_limit, stream_monthly_limit, download_monthly_limit,
           requests_per_minute, burst_limit, api_key_limit, origin_limit,
           daily_request_safety_limit, features, is_active, created_at, updated_at
    FROM public.plans
    WHERE slug = ${slug}
    LIMIT 1
  `;
  return rows.length ? rows[0] as PlanRecord : null;
}

export async function getCurrentSubscription(sql: SqlExecutor, accountId: string): Promise<(SubscriptionRecord & { plan: PlanRecord }) | null> {
  const rows = await sql`
    SELECT
      s.id, s.account_id, s.plan_id, s.status, s.started_at,
      s.current_period_start, s.current_period_end, s.trial_ends_at,
      s.cancelled_at, s.cancel_at_period_end, s.created_at, s.updated_at,
      p.id AS plan_id, p.name AS plan_name, p.slug AS plan_slug, p.price AS plan_price,
      p.currency AS plan_currency, p.billing_interval AS plan_billing_interval,
      p.metadata_monthly_limit AS plan_metadata_monthly_limit,
      p.stream_monthly_limit AS plan_stream_monthly_limit,
      p.download_monthly_limit AS plan_download_monthly_limit,
      p.requests_per_minute AS plan_requests_per_minute,
      p.burst_limit AS plan_burst_limit, p.api_key_limit AS plan_api_key_limit,
      p.origin_limit AS plan_origin_limit,
      p.daily_request_safety_limit AS plan_daily_request_safety_limit,
      p.features AS plan_features, p.is_active AS plan_is_active,
      p.created_at AS plan_created_at, p.updated_at AS plan_updated_at
    FROM public.subscriptions s
    JOIN public.plans p ON p.id = s.plan_id
    WHERE s.account_id = ${accountId}
      AND s.status IN ('trialing', 'active', 'past_due')
      AND s.current_period_end > now()
    ORDER BY s.current_period_end DESC
    LIMIT 1
  `;
  if (!rows.length) return null;
  const row = rows[0] as Record<string, unknown>;
  const subscription = {
    id: row.id,
    account_id: row.account_id,
    plan_id: row.plan_id,
    status: row.status,
    started_at: row.started_at,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    trial_ends_at: row.trial_ends_at,
    cancelled_at: row.cancelled_at,
    cancel_at_period_end: row.cancel_at_period_end,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } as SubscriptionRecord;
  const plan = {
    id: row.plan_id,
    name: row.plan_name,
    slug: row.plan_slug,
    price: row.plan_price,
    currency: row.plan_currency,
    billing_interval: row.plan_billing_interval,
    metadata_monthly_limit: row.plan_metadata_monthly_limit,
    stream_monthly_limit: row.plan_stream_monthly_limit,
    download_monthly_limit: row.plan_download_monthly_limit,
    requests_per_minute: row.plan_requests_per_minute,
    burst_limit: row.plan_burst_limit,
    api_key_limit: row.plan_api_key_limit,
    origin_limit: row.plan_origin_limit,
    daily_request_safety_limit: row.plan_daily_request_safety_limit,
    features: row.plan_features,
    is_active: row.plan_is_active,
    created_at: row.plan_created_at,
    updated_at: row.plan_updated_at,
  } as PlanRecord;
  return { ...subscription, plan };
}

export function subscriptionIsUsable(subscription: SubscriptionRecord | null, now = Date.now()): boolean {
  if (!subscription || !['trialing', 'active', 'past_due'].includes(subscription.status)) return false;
  return new Date(subscription.current_period_end).getTime() > now;
}

export async function createSubscription(
  sql: SqlExecutor,
  accountId: string,
  planId: string,
  periodStart: string,
  periodEnd: string,
  status: SubscriptionRecord['status'] = 'active',
  trialEndsAt: string | null = null,
): Promise<SubscriptionRecord> {
  const rows = await sql`
    INSERT INTO public.subscriptions (
      account_id, plan_id, status, started_at, current_period_start,
      current_period_end, trial_ends_at
    )
    VALUES (${accountId}, ${planId}, ${status}, ${periodStart}, ${periodStart}, ${periodEnd}, ${trialEndsAt})
    RETURNING id, account_id, plan_id, status, started_at, current_period_start,
              current_period_end, trial_ends_at, cancelled_at, cancel_at_period_end,
              created_at, updated_at
  `;
  return rows[0] as SubscriptionRecord;
}

export async function renewSubscription(sql: SqlExecutor, subscriptionId: string, periodStart: string, periodEnd: string): Promise<SubscriptionRecord | null> {
  const rows = await sql`
    UPDATE public.subscriptions
    SET status = CASE WHEN status = 'cancelled' THEN 'active' ELSE status END,
        current_period_start = ${periodStart}, current_period_end = ${periodEnd},
        cancelled_at = NULL, cancel_at_period_end = false, updated_at = now()
    WHERE id = ${subscriptionId}
    RETURNING id, account_id, plan_id, status, started_at, current_period_start,
              current_period_end, trial_ends_at, cancelled_at, cancel_at_period_end,
              created_at, updated_at
  `;
  return rows.length ? rows[0] as SubscriptionRecord : null;
}

export async function cancelSubscription(sql: SqlExecutor, subscriptionId: string, immediately = false): Promise<SubscriptionRecord | null> {
  const rows = immediately
    ? await sql`
        UPDATE public.subscriptions
        SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()),
            cancel_at_period_end = false, updated_at = now()
        WHERE id = ${subscriptionId}
        RETURNING id, account_id, plan_id, status, started_at, current_period_start,
                  current_period_end, trial_ends_at, cancelled_at, cancel_at_period_end,
                  created_at, updated_at
      `
    : await sql`
        UPDATE public.subscriptions
        SET cancel_at_period_end = true, cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
        WHERE id = ${subscriptionId}
        RETURNING id, account_id, plan_id, status, started_at, current_period_start,
                  current_period_end, trial_ends_at, cancelled_at, cancel_at_period_end,
                  created_at, updated_at
      `;
  return rows.length ? rows[0] as SubscriptionRecord : null;
}
