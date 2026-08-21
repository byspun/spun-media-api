export type AccountStatus = 'active' | 'closed';
export type ApiKeyStatus = 'active' | 'revoked';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'incomplete';
export type BillingInterval = 'trial' | 'month' | 'year' | 'one_time';

export interface AccountRecord {
  id: string;
  auth_subject: string;
  email: string | null;
  name: string | null;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface PlanRecord {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  billing_interval: BillingInterval;
  metadata_monthly_limit: number | null;
  stream_monthly_limit: number | null;
  download_monthly_limit: number | null;
  requests_per_minute: number | null;
  burst_limit: number | null;
  api_key_limit: number | null;
  origin_limit: number | null;
  daily_request_safety_limit: number | null;
  features: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRecord {
  id: string;
  account_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  started_at: string;
  current_period_start: string;
  current_period_end: string;
  trial_ends_at: string | null;
  cancelled_at: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyRecord {
  id: string;
  account_id: string;
  key_prefix: string;
  label: string;
  status: ApiKeyStatus;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
}

export interface ApiKeyCreationResult {
  record: ApiKeyRecord;
  key: string;
}

export interface AuthSession {
  subject: string;
  email?: string | null;
  name?: string | null;
  accountId?: string;
}

export interface AuthPrincipal {
  kind: 'user' | 'admin' | 'internal';
  accountId?: string;
  keyId?: string;
  subject?: string;
}

export interface PlanPolicy {
  billingEnabled: boolean;
  subscriptionsEnabled: boolean;
  plansEnabled: boolean;
  quotaMode: 'off' | 'observe' | 'enforce';
  rateLimitMode: 'off' | 'observe' | 'enforce';
}

export interface SqlExecutor {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
}
