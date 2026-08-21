import type { PlanRecord, SqlExecutor } from './types.js';

export type UsageCategory = 'metadata' | 'stream' | 'download' | 'request';

export interface UsageSnapshot {
  account_id: string;
  period_start: string;
  period_end: string;
  metadata_count: number;
  stream_count: number;
  download_count: number;
  request_count: number;
}

export interface QuotaDecision {
  allowed: boolean;
  mode: 'off' | 'observe' | 'enforce';
  category: UsageCategory;
  used: number;
  limit: number | null;
  remaining: number | null;
  wouldExceed: boolean;
}

const columnByCategory: Record<UsageCategory, 'metadata_count' | 'stream_count' | 'download_count' | 'request_count'> = {
  metadata: 'metadata_count',
  stream: 'stream_count',
  download: 'download_count',
  request: 'request_count',
};

export async function getUsageSnapshot(sql: SqlExecutor, accountId: string, periodStart: string, periodEnd: string): Promise<UsageSnapshot> {
  const rows = await sql`
    SELECT account_id, period_start, period_end, metadata_count, stream_count, download_count, request_count
    FROM public.account_usage_monthly
    WHERE account_id = ${accountId} AND period_start = ${periodStart}
    LIMIT 1
  `;
  if (rows.length) return rows[0] as UsageSnapshot;
  return {
    account_id: accountId,
    period_start: periodStart,
    period_end: periodEnd,
    metadata_count: 0,
    stream_count: 0,
    download_count: 0,
    request_count: 0,
  };
}

export async function incrementUsage(
  sql: SqlExecutor,
  accountId: string,
  periodStart: string,
  periodEnd: string,
  increments: Partial<Record<UsageCategory, number>>,
): Promise<UsageSnapshot> {
  const metadata = Math.max(0, Math.trunc(increments.metadata ?? 0));
  const stream = Math.max(0, Math.trunc(increments.stream ?? 0));
  const download = Math.max(0, Math.trunc(increments.download ?? 0));
  const request = Math.max(0, Math.trunc(increments.request ?? 0));
  const rows = await sql`
    INSERT INTO public.account_usage_monthly (
      account_id, period_start, period_end, metadata_count, stream_count, download_count, request_count
    )
    VALUES (${accountId}, ${periodStart}, ${periodEnd}, ${metadata}, ${stream}, ${download}, ${request})
    ON CONFLICT (account_id, period_start) DO UPDATE SET
      metadata_count = public.account_usage_monthly.metadata_count + EXCLUDED.metadata_count,
      stream_count = public.account_usage_monthly.stream_count + EXCLUDED.stream_count,
      download_count = public.account_usage_monthly.download_count + EXCLUDED.download_count,
      request_count = public.account_usage_monthly.request_count + EXCLUDED.request_count,
      period_end = EXCLUDED.period_end,
      updated_at = now()
    RETURNING account_id, period_start, period_end, metadata_count, stream_count, download_count, request_count
  `;
  return rows[0] as UsageSnapshot;
}

export function quotaDecision(
  usage: UsageSnapshot,
  plan: PlanRecord | null,
  category: UsageCategory,
  mode: 'off' | 'observe' | 'enforce',
  additionalUnits = 0,
): QuotaDecision {
  const used = Number(usage[columnByCategory[category]] ?? 0);
  const limit = plan ? plan[`${category}_monthly_limit` as 'metadata_monthly_limit' | 'stream_monthly_limit' | 'download_monthly_limit'] ?? null : null;
  const wouldExceed = limit !== null && used + additionalUnits > limit;
  return {
    allowed: mode !== 'enforce' || !wouldExceed,
    mode,
    category,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    wouldExceed,
  };
}
