# Spün Media API Account Layer — Completion ToDo

## Purpose

This document is the implementation handoff for completing the Spün Media API account layer. It is written so that a future builder can finish the commercial and identity features without guessing, breaking the existing trust model, exposing provider infrastructure, or changing the public media API unnecessarily.

The account layer is the domain responsible for local user/account records, API credentials, plans, subscriptions, billing boundaries, monthly usage, quotas, and request-rate protection. The parent directory is `account/`. Authentication-specific code belongs in `account/auth/`, user/account persistence and identity synchronization belongs in `account/users/`, API-key code belongs in `account/keys/`, and commercial logic belongs in the remaining focused modules rather than in one oversized authentication file.

> **Core rule:** authentication identifies the caller; subscriptions and plans determine what the account is entitled to use; usage and rate-limit systems enforce those entitlements. These concerns must remain separate.

## Current baseline

The repository already contains the API-key and initial account groundwork. The current implementation must be treated as the compatibility baseline.

| Area | Current state |
|---|---|
| API-key format | `spn_<random-alphanumeric>` is generated with Web Crypto. |
| Secret storage | Full API keys are returned only at creation time and stored as hashes. |
| Key metadata | Prefix, label, status, expiry, last use, and revocation fields are stored. |
| Key states | `active` and `revoked`; revocation is terminal. |
| Key expiry | Derived from `expires_at`; no expiry cron is required. |
| Account identity | Local `accounts` rows are mapped to a stable `auth_subject`. |
| Manual account creation | Administrator endpoint: `POST /v1/admin/accounts/create`. |
| Internal account synchronization | `PUT /v1/internal/accounts/:auth_subject`, protected by `X-Internals-Key`. |
| Customer account discovery | `GET /v1/account/me`, using the Spün Auth adapter placeholder. |
| Customer key routes | List, generate, detail, and revoke routes exist under `/v1/account/keys/*`. |
| Admin key routes | Global list, account-filtered list, account-specific list, account-specific generation, detail, and revoke routes exist. |
| Plans table | Exists and is seeded with Trial, Launch, and Scale. |
| Subscriptions table | Exists with status and period fields. |
| Monthly usage table | Exists as `account_usage_monthly`. |
| Billing integration | Not connected; only a provider boundary/disabled adapter exists. |
| Spün Auth integration | Placeholder adapter exists and fails closed until its verification contract is configured. |
| Quota enforcement | Not active; usage and quota services must be completed and wired to request classification. |
| Rate-limit enforcement | Not active; storage and request enforcement must be completed before enabling it. |
| Commercial enforcement | Disabled initially through environment configuration. |

## Non-negotiable architecture rules

The following rules protect the current API and must not be changed during completion work.

1. **Do not change the monorepo layout.** The existing top-level areas remain `metadata/`, `providers/`, `account/`, `database/`, `errors/`, and `logs/`.
2. **Do not expose provider names** in public responses, account responses, usage responses, errors, or billing responses. Consumers see Spün Media API behavior only.
3. **Do not put a plan directly on `api_keys`.** The ownership chain remains:

   ```text
   api_key → account → subscription → plan
   ```

4. **Do not store plaintext API keys.** The full key is returned once during generation and never returned by list, detail, logs, or later retrieval.
5. **Do not make revocation reversible.** `revoked` is terminal. A replacement key must be generated.
6. **Do not use email as the identity relationship.** Use the stable Spün Auth subject. Email is profile/contact data and may change.
7. **Do not use `X-User-Key` for internal service calls.** Worker-to-Render and other service-to-service calls use `X-Internals-Key` only.
8. **Do not use `X-Admin-Key` as a customer credential.** It may be accepted on public media routes for private operator testing, but it remains a powerful private operator secret.
9. **Health endpoints stay unauthenticated.** Public media routes require `X-User-Key` or `X-Admin-Key`, while health routes remain available without either.
10. **Do not count internal provider fallbacks as customer usage.** One stream call is one stream unit regardless of fallback attempts. Batch downloads count one unit per episode processed.
11. **Do not turn on commercial enforcement before its dependencies are verified.** Use `off`, then `observe`, then `enforce` where applicable.
12. **Do not hardcode credentials.** All admin, internal, Spün Auth, billing, and external-service credentials come from deployment secrets or environment variables.

## Folder organization target

The agreed parent folder is `account/`. The following organization is the target. Existing modules may be moved only when imports and behavior are preserved.

```text
account/
├── auth/
│   ├── headers.ts        # Header parsing and bearer-token extraction
│   ├── spun.ts           # Spün Auth verification adapter boundary
│   └── errors.ts         # Optional account-auth-specific error helpers
├── users/
│   ├── service.ts        # Account provisioning, lookup, update, closure
│   └── types.ts          # Optional user/account DTOs
├── keys/
│   ├── crypto.ts         # Generation, hashing, constant-time comparison
│   └── service.ts        # Key lifecycle and ownership operations
├── plans/
│   └── service.ts        # Plan lookup and entitlement projection
├── subscriptions/
│   └── service.ts        # Period and subscription lifecycle logic
├── billing.ts            # BillingProvider interface and adapters
├── usage.ts              # Monthly usage counters and quota decisions
├── rate-limits.ts        # RateLimitStore interface and decisions
├── policy.ts             # Environment feature modes
├── store.ts              # Existing Neon persistence functions during transition
├── types.ts              # Shared account-layer types
└── README.md             # Optional module-level overview
```

The current code may temporarily keep persistence functions in `account/store.ts`, but new builders should avoid adding unrelated logic there. A later structural cleanup can move functions into the focused services after tests are in place.

## Database model

`database/schema.sql` is the canonical schema. It must remain runnable against a fresh PostgreSQL/Neon database and must include all existing media, caching, provider-health, studio-registry, and log-archive tables before the account tables.

### `accounts`

```text
id              UUID primary key
 auth_subject    TEXT unique not null
email           TEXT nullable
name            TEXT nullable
status          TEXT not null: active | closed
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

The `auth_subject` is the stable identity identifier supplied by Spün Auth. It must have a unique constraint. Manual administrator creation requires it because the local account needs a future identity mapping even if the user has not yet signed in.

Account closure is separate from API-key revocation. Closing an account should prevent normal account usage and customer key-management operations, while retaining the account and its audit history.

### `plans`

The plan table contains product entitlements, not user identity.

```text
id
name
slug unique
price integer in minor currency units
currency
billing_interval: trial | month | year | one_time
metadata_monthly_limit nullable
stream_monthly_limit nullable
download_monthly_limit nullable
requests_per_minute nullable
burst_limit nullable
api_key_limit nullable
origin_limit nullable
daily_request_safety_limit nullable
features JSONB
is_active
created_at
updated_at
```

Prices are stored as integer minor units, for example `300` means `$3.00`. Floating-point money values must not be introduced.

The current seeded definitions are:

| Plan | Price | Metadata/month | Streams/month | Downloads/month | API keys | Requests/minute | Burst |
|---|---:|---:|---:|---:|---:|---:|---:|
| Trial | 0 USD | 5,000 | 1,500 | 750 | 1 | 5 | 10 |
| Launch | 300 USD | 10,000 | 5,000 | 2,500 | 3 | 60 | 120 |
| Scale | 800 USD | 25,000 | 12,000 | 6,000 | 10 | 150 | 300 |

Do not assume that a nullable limit means unlimited in every future product context. Define the interpretation in the entitlement service and document it. A practical initial interpretation is that `NULL` means no configured limit for that entitlement, while `0` means unavailable.

### `subscriptions`

```text
id
account_id foreign key → accounts.id
plan_id foreign key → plans.id
status: trialing | active | past_due | paused | cancelled | incomplete
started_at
current_period_start
current_period_end
trial_ends_at nullable
cancelled_at nullable
cancel_at_period_end boolean
created_at
updated_at
```

The effective subscription state is derived from both status and timestamps. A subscription is usable only when its status is allowed and `current_period_end > NOW()`. Do not create a separate `expired` status merely to avoid checking the timestamp.

When billing is added, reserve room for external identifiers such as a billing customer ID and billing subscription ID. Add them only after the payment provider and naming contract are known; do not guess provider-specific field names.

### `api_keys`

```text
id
account_id foreign key → accounts.id
key_prefix
key_hash unique
label
status: active | revoked
expires_at nullable
created_at
updated_at
last_used_at nullable
revoked_at nullable
revocation_reason nullable
```

For an active key, `revoked_at` and `revocation_reason` must be null. For a revoked key, both must be populated. A database check constraint should enforce this invariant.

### `account_usage_monthly`

```text
account_id foreign key → accounts.id
period_start
period_end
metadata_count
stream_count
download_count
request_count
updated_at
```

The primary key is `(account_id, period_start)`. Updates must be atomic so concurrent requests cannot overwrite each other’s counters. All counters must be non-negative.

## Manual account provisioning

The administrator must be able to populate the accounts table while all commercial features are disabled.

### Endpoint

```http
POST /v1/admin/accounts/create
X-Admin-Key: <admin-key>
Content-Type: application/json
```

### Request body

```json
{
  "auth_subject": "spun-auth-user-123",
  "email": "developer@example.com",
  "name": "Developer Account",
  "status": "active"
}
```

`auth_subject` is required. `email` and `name` are optional. `status` defaults to `active` and may be `active` or `closed`.

The endpoint must be strict-create semantics. If the same `auth_subject` already exists, return `ACCOUNT_CONFLICT`; do not silently overwrite the existing account. The internal synchronization endpoint remains the idempotent upsert path.

### Success response

HTTP `201 Created`:

```json
{
  "success": true,
  "action": "created",
  "account": {
    "id": "9b3f3f6e-2ef5-4d6f-a2b0-0a2d5b1c8f10",
    "auth_subject": "spun-auth-user-123",
    "email": "developer@example.com",
    "name": "Developer Account",
    "status": "active",
    "created_at": "2026-08-22T10:00:00.000Z",
    "updated_at": "2026-08-22T10:00:00.000Z"
  }
}
```

## Internal account synchronization

Spün Auth should eventually call:

```http
PUT /v1/internal/accounts/:auth_subject
X-Internals-Key: <internal-key>
Content-Type: application/json
```

Example body:

```json
{
  "email": "developer@example.com",
  "name": "Developer Account",
  "status": "active"
}
```

This operation is idempotent. It creates the account when absent and updates profile/status fields when present. It must never create a duplicate account for a repeated subject.

The synchronization caller is trusted to send account status changes. A public customer must not be allowed to set another account’s status or identity mapping.

## Customer account and key-management endpoints

These routes use the verified Spün Auth session, not a customer-supplied `account_id`.

```text
GET  /v1/account/me
GET  /v1/account/keys/list?status=active&page=1&limit=25
POST /v1/account/keys/gen
GET  /v1/account/keys/:key_id
POST /v1/account/keys/:key_id/revoke
```

The authenticated session maps to the local account using `auth_subject`. Every key lookup must verify `key.account_id === authenticated_account_id`.

Generation body:

```json
{
  "label": "Production application",
  "expires_at": "2026-09-20T23:59:59.000Z"
}
```

The plaintext key is returned only in the successful generation response:

```json
{
  "success": true,
  "message": "API key generated successfully. Copy it now; it will not be shown again.",
  "api_key": {
    "id": "5f0c8b1e-4d3c-4e10-9a3e-8b4dd6d4e4a1",
    "account_id": "9b3f3f6e-2ef5-4d6f-a2b0-0a2d5b1c8f10",
    "key": "spn_A7k2Qp9xLm4R8vN2cQ...",
    "key_prefix": "spn_A7k2Qp9x",
    "label": "Production application",
    "status": "active",
    "expires_at": "2026-09-20T23:59:59.000Z",
    "created_at": "2026-08-22T10:00:00.000Z"
  }
}
```

List and detail responses must never contain `key` or `key_hash`.

## Administrator key-management endpoints

Administrator routes can target any account and use `X-Admin-Key`.

```text
GET  /v1/admin/keys/list
GET  /v1/admin/keys/list?status=active
GET  /v1/admin/keys/list?account_id=<account-id>
GET  /v1/admin/keys/list?page=1&limit=25
GET  /v1/admin/accounts/:account_id/keys/list?status=active&page=1&limit=25
POST /v1/admin/accounts/:account_id/keys/gen
GET  /v1/admin/keys/:key_id
POST /v1/admin/keys/:key_id/revoke
POST /v1/admin/accounts/create
```

Global list filters:

| Parameter | Meaning |
|---|---|
| `status` | Optional `active` or `revoked`. |
| `account_id` | Optional account UUID. |
| `page` | One-based page number; default `1`. |
| `limit` | Default `25`, maximum `100`. |

Account-specific list routes accept `status`, `page`, and `limit`; they do not need an `account_id` query parameter because the account is in the path.

Administrator generation uses:

```http
POST /v1/admin/accounts/:account_id/keys/gen
X-Admin-Key: <admin-key>
Content-Type: application/json
```

```json
{
  "label": "Support test key",
  "expires_at": null
}
```

Administrator generation is an operator action and may bypass customer plan limits while commercial enforcement is disabled. When plan enforcement is activated, decide explicitly whether administrators retain that override; do not let this behavior emerge accidentally.

Revocation uses:

```http
POST /v1/admin/keys/:key_id/revoke
X-Admin-Key: <admin-key>
Content-Type: application/json
```

```json
{
  "reason": "Production credential rotated"
}
```

## Response contract

All account-layer errors use the existing Spün error contract. Preserve the repository’s existing serialization behavior when returning it.

```json
{
  "error": {
    "code": "ERROR_CODE",
    "error": "Short human-readable message",
    "description": "A safe explanation of what happened.",
    "action": "The next step the caller should take."
  }
}
```

The public contract must not reveal SQL errors, database names, provider names, secret names, internal URLs, stack traces, or implementation details.

## Error codes

The following account-layer codes are available or reserved. Use the most specific applicable code and keep the action useful to a consumer.

| Code | Use |
|---|---|
| `USER_KEY_REQUIRED` | Public route has no user/admin credential. |
| `INVALID_USER_KEY` | Supplied user key does not match a stored hash. |
| `USER_KEY_REVOKED` | Matching key exists but is permanently revoked. |
| `USER_KEY_EXPIRED` | Matching active key has passed `expires_at`. |
| `ADMIN_KEY_REQUIRED` | Administrative credential is missing. |
| `INVALID_ADMIN_KEY` | Administrative credential is invalid. |
| `INVALID_INTERNAL_KEY` | Internal service credential is missing or invalid. |
| `USER_AUTH_REQUIRED` | Customer account-management route has no valid Spün Auth session. |
| `MULTIPLE_AUTH_METHODS` | Mutually exclusive public credentials were supplied together. |
| `ACCOUNT_NOT_FOUND` | Requested account does not exist or is intentionally hidden. |
| `ACCOUNT_ID_INVALID` | Account UUID is malformed. |
| `ACCOUNT_INACTIVE` | Account is closed or not eligible for the operation. |
| `AUTH_SUBJECT_REQUIRED` | Account provisioning omitted the identity subject. |
| `ACCOUNT_EMAIL_INVALID` | Email is malformed. |
| `ACCOUNT_ALREADY_CLOSED` | Operation targets a closed account. |
| `ACCOUNT_CONFLICT` | Identity mapping already belongs to another local account. |
| `ACCOUNT_SYNC_FAILED` | Trusted account synchronization failed. |
| `FORBIDDEN_ACCOUNT_ACCESS` | Caller cannot access the requested account. |
| `API_KEY_NOT_FOUND` | Key does not exist or is hidden from the caller. |
| `ACCOUNT_REQUIRED` | Key creation has no owning account. |
| `INVALID_KEY_LABEL` | Label is empty or too long. |
| `INVALID_KEY_EXPIRY` | Expiry is malformed or not in the future. |
| `KEY_ALREADY_REVOKED` | Terminal revocation was already performed. |
| `INVALID_REVOCATION_REASON` | Revoke request lacks a valid reason. |
| `API_KEY_LIMIT_REACHED` | Plan-based active-key limit is enforced and reached. |
| `INVALID_STATUS_FILTER` | Key list status is not `active` or `revoked`. |
| `INVALID_PAGINATION` | Page or limit is invalid. |
| `SUBSCRIPTION_REQUIRED` | Subscription enforcement is active but none is usable. |
| `SUBSCRIPTION_NOT_ACTIVE` | Subscription status is not usable. |
| `SUBSCRIPTION_EXPIRED` | Subscription period ended. |
| `PLAN_NOT_FOUND` | Subscription refers to no available plan. |
| `PLAN_NOT_AVAILABLE` | Plan is inactive or unavailable for new entitlement. |
| `QUOTA_EXCEEDED` | Monthly allowance was exceeded in enforce mode. |
| `RATE_LIMITED` | Request-speed allowance was exceeded in enforce mode. |
| `INTERNAL_ERROR` | Safe fallback for unexpected failures. |

Do not add an error code merely to expose an internal implementation distinction. Add a code only when a caller can take a meaningful next action.

## Trust layers

### Public customer trust

```http
X-User-Key: spn_<full-key>
```

The Worker hashes the supplied value, finds the matching key record, verifies account status, verifies key status, checks expiry, and touches `last_used_at`. It must not return the key hash or expose account internals.

### Administrator trust

```http
X-Admin-Key: <admin-secret>
```

This credential protects `/v1/admin/*`. The current design also permits it on public media routes for private operator testing. It must never be embedded in a frontend, mobile bundle, public test script, or consumer integration.

### Internal service trust

```http
X-Internals-Key: <internal-secret>
```

This credential authenticates Worker-to-Render and other trusted service calls. It is unrelated to customer API keys and unrelated to stream/subtitle proxy token signing.

### Proxy and external-service secrets

The following remain separate and must not be removed merely because `X-Internals-Key` was introduced:

```text
STREAM_PROXY_TOKEN_SECRET
SUBTITLE_PROXY_TOKEN_SECRET
MOVIEBOX_API_SECRET
SPUN_PROXY_SECRET
LOG_UPLOAD_KEY
TMDB_API_KEY / TMDB_BEARER_TOKEN
SUBDL_API_KEY
```

`X-Internals-Key` proves service identity. Proxy-token secrets protect signed consumer-facing proxy URLs. External-service credentials authenticate external services. They have different purposes.

## Feature-policy modes

The policy layer must support independent switches. The recommended initial values are:

```text
BILLING_ENABLED=false
SUBSCRIPTIONS_ENABLED=false
PLANS_ENABLED=false
QUOTA_MODE=off
RATE_LIMIT_MODE=off
```

The commercial switches must not disable key authentication, account status checks, key expiry, key revocation, admin authentication, or internal authentication.

For quotas and rate limits, support three modes:

| Mode | Behavior |
|---|---|
| `off` | Do not calculate or block. |
| `observe` | Calculate and log what would happen, but allow the request. |
| `enforce` | Calculate and block when the limit is exceeded. |

These settings are deployment configuration only. They must not be changeable through a public endpoint.

## Required completion work

### 1. Finish the users subfolder organization

Move account provisioning/service code into `account/users/` only after adding or preserving tests. Keep the route adapters in `metadata/src/routes/`. The users service should own account lookup, strict creation, idempotent sync, profile update, closure, and identity mapping rules.

The move must preserve the existing endpoint contracts and imports. Do not rename the public `/v1/account/*` paths merely to match an internal folder name.

### 2. Complete the Spün Auth adapter

When Spün Auth credentials and contract are available:

1. Confirm the bearer token header and token format.
2. Confirm whether verification is local signature verification or a remote verification call.
3. Confirm the stable subject claim.
4. Confirm the trusted email, name, and account-status claims.
5. Configure timeout and failure behavior.
6. Never trust unverified request-body identity fields.
7. Add tests for valid, expired, malformed, revoked, and unavailable sessions.
8. Keep the adapter interface stable so the Worker route code does not depend on Spün Auth-specific internals.

The adapter must fail closed. If verification is unavailable, do not manufacture a session from a bearer token or from caller-supplied JSON.

### 3. Complete plan service logic

Create a focused service that can:

- Retrieve plans by ID and slug.
- Return only active plans when selecting a plan for new entitlement.
- Project a plan into a safe entitlement object.
- Distinguish a nullable limit from a zero limit.
- Avoid exposing internal billing-provider data.
- Validate that limits are non-negative.
- Support plan seeding and idempotent updates from the canonical schema.

Plan administration endpoints should not be added until their exact operator contract is approved. Internal service functions can be completed first.

### 4. Complete subscription service logic

The subscription service must:

- Retrieve the current usable subscription for an account.
- Join it to the active plan.
- Evaluate status and period together.
- Support trialing and active states.
- Define the policy for past-due subscriptions before enforcement is turned on.
- Support period renewal without recreating API keys.
- Support immediate cancellation and cancellation at period end.
- Preserve subscription history.
- Prevent invalid period boundaries.
- Make state transitions explicit and testable.

Recommended effective access rule:

```text
subscription.status ∈ {trialing, active, past_due according to policy}
AND current_period_end > NOW()
AND plan.is_active = true
```

Do not automatically treat a cancelled subscription as usable unless the period-end policy explicitly says it remains usable until `current_period_end`.

### 5. Complete billing boundary logic

Do not connect a payment provider until credentials, product identifiers, webhook signing rules, and cancellation semantics are known.

The billing boundary should provide an interface for:

```text
createCustomer
createSubscription or checkout
cancelSubscription
verifyWebhook
applySubscriptionEvent
```

The disabled adapter must fail clearly with a safe “billing not enabled” result. It must never return a fake successful payment or fake provider subscription ID.

When a payment gateway is selected:

1. Add a provider-specific adapter without changing the account-layer service interface.
2. Store external customer/subscription IDs in local subscription/account records only after the fields are approved.
3. Verify webhook signatures before parsing events.
4. Make webhook handling idempotent using the provider event ID.
5. Map payment events to explicit local subscription transitions.
6. Do not trust browser redirect success as proof of payment.
7. Test renewal, payment failure, cancellation, refund, duplicate webhook, and delayed webhook behavior.

### 6. Complete usage accounting

Add a request classification layer that assigns each accepted public request to a usage category without exposing provider details.

The initial categories are:

```text
metadata
stream
download
request
```

The accounting rules are:

- One metadata operation counts according to its classified endpoint policy.
- One stream call counts as one stream unit even if several internal providers are attempted.
- One download unit is counted per episode processed.
- A batch download increments the download counter once per episode, not once per HTTP request.
- Failed requests must have an explicitly documented counting policy; do not let retries accidentally double-count.
- Admin-key traffic is not assigned to a customer account and should not consume customer quotas.
- Internal service calls must never be counted as customer usage.

Counters must be updated atomically. If usage is recorded after a response, ensure retries and duplicate processing cannot create accidental double counts. If usage is reserved before processing, ensure failed reservations are handled deliberately.

### 7. Complete quota evaluation

The quota service should:

1. Find the account’s current subscription and plan.
2. Determine the current period.
3. Read the usage snapshot.
4. Add the proposed units.
5. Return a decision containing used, limit, remaining, and would-exceed values.
6. In `off` mode, allow without blocking.
7. In `observe` mode, allow and log.
8. In `enforce` mode, return `QUOTA_EXCEEDED` when the allowance is exceeded.

Do not call the quota service from internal provider fallback logic. Call it once at the public API boundary so one consumer request remains one chargeable operation.

### 8. Complete rate-limit storage and enforcement

The rate-limit service must use a distributed, atomic store in production. An in-memory Worker map is not sufficient because requests can hit different isolates and instances.

The interface should remain storage-agnostic:

```text
consume(bucketKey, limit, window, now) → count and resetAt
```

The production adapter can later use the Cloudflare capability that is available to the account, such as a supported rate-limit product or Durable Object-backed coordination. Do not enable enforcement until atomicity, reset behavior, and failure policy are verified.

Rate-limit decisions must include:

```text
allowed
mode
limit
burst
count
resetAt
wouldExceed
```

When enforced, return `RATE_LIMITED` and include a safe retry indication if the public response contract supports it. Do not expose the underlying storage technology.

### 9. Add account/subscription read APIs only after contract approval

Useful future customer reads may include:

```text
GET /v1/account/subscription
GET /v1/account/plan
GET /v1/account/usage
```

These should expose safe account entitlements and usage only. They should not expose payment-provider IDs, database identifiers that are not needed by the customer, internal policy switches, or provider names.

Useful administrator reads may include:

```text
GET /v1/admin/accounts/:account_id
GET /v1/admin/accounts/:account_id/subscription
GET /v1/admin/plans
GET /v1/admin/accounts/:account_id/usage
```

Do not add these routes automatically if the product owner has not approved their exact paths and response shapes. Implement the underlying services first.

## Activation and rollout plan

The complete implementation should be deployable while all commercial enforcement remains disabled.

### Stage 1: identity and credentials

Keep API-key authentication active. Verify manual account creation, customer account discovery, key generation, list, detail, expiry, and revocation.

### Stage 2: plans and subscriptions in data-only mode

Seed plan definitions. Create test subscription records manually or through internal tools. Do not block requests based on them.

### Stage 3: observation

Set:

```text
QUOTA_MODE=observe
RATE_LIMIT_MODE=observe
```

Compare calculated decisions with real traffic and inspect logs for classification mistakes.

### Stage 4: billing test mode

Connect the payment gateway in test mode. Verify signed webhooks, idempotency, renewals, cancellations, and local subscription transitions.

### Stage 5: subscription and plan enforcement

Enable subscription/plan checks for controlled test accounts first. Confirm that existing API keys continue to work for entitled accounts.

### Stage 6: quota enforcement

Set `QUOTA_MODE=enforce` only after counters and counting rules have been validated.

### Stage 7: rate-limit enforcement

Set `RATE_LIMIT_MODE=enforce` only after distributed storage, burst semantics, and failure handling have been validated.

## Testing requirements

A future builder must add automated tests for the following areas.

### API-key tests

- Generated key has the `spn_` prefix.
- Generated key contains cryptographically random material.
- Plaintext is not stored.
- Hash lookup authenticates the correct key.
- Wrong key returns `INVALID_USER_KEY`.
- Revoked key returns `USER_KEY_REVOKED`.
- Expired key returns `USER_KEY_EXPIRED`.
- Active key updates `last_used_at` without changing ownership.
- Revocation is terminal.
- Repeated revocation returns `KEY_ALREADY_REVOKED`.
- List and detail never return plaintext or hashes.

### Account tests

- Manual creation succeeds with a new subject.
- Duplicate manual creation returns `ACCOUNT_CONFLICT`.
- Internal sync creates a missing account.
- Repeated internal sync updates the same account.
- Email/name changes do not create duplicates.
- Closed accounts cannot use customer account routes.
- Invalid status and malformed email are rejected.

### Authorization tests

- Public routes reject missing credentials.
- Public routes accept a valid user key.
- Public routes accept a valid admin key for operator testing.
- Public routes reject both user and admin credentials together.
- Admin routes reject user keys.
- Internal routes reject user and admin keys.
- Health routes remain unauthenticated.
- Customer account routes cannot access another account’s key.

### Plan/subscription tests

- Current subscription is selected correctly when multiple historical subscriptions exist.
- Ended periods are not usable.
- Cancel-at-period-end remains usable only according to the documented policy.
- Cancelled subscriptions are not incorrectly reactivated.
- Plan limits are projected correctly.
- Inactive plans cannot be newly assigned.

### Usage/quota tests

- One stream request produces one stream unit despite internal fallbacks.
- Batch download increments once per processed episode.
- Concurrent increments are not lost.
- `off` allows requests.
- `observe` allows requests and records a would-exceed decision.
- `enforce` blocks only when the proposed request exceeds the limit.
- Admin and internal traffic does not consume customer quotas.

### Rate-limit tests

- Window reset is correct.
- Burst allowance is applied correctly.
- Concurrent requests cannot bypass the atomic counter.
- `off` allows requests.
- `observe` records would-exceed behavior without blocking.
- `enforce` returns `RATE_LIMITED` with a usable reset/retry value.
- Storage failure follows an explicit fail-open or fail-closed policy.

### Billing tests

- Disabled billing never reports a fake success.
- Invalid webhook signatures are rejected.
- Duplicate webhook events are idempotent.
- Renewal extends the local period correctly.
- Immediate cancellation and period-end cancellation differ correctly.
- Payment failure maps to the documented subscription state.

## Deployment and secret checklist

### Worker secrets

Configure only through Cloudflare secret management:

```text
ADMIN_KEY
INTERNALS_KEY
LOG_UPLOAD_KEY
SPUN_AUTH_VERIFY_KEY       # when the real adapter is available
```

External service secrets remain separately configured as required by the existing metadata layer.

### Render secrets

Configure only through Render’s environment settings:

```text
INTERNALS_KEY
ADMIN_KEY
LOG_UPLOAD_KEY
```

Do not leave the old `X_SPUN_SECRET` as the active Worker-to-Render credential after the new deployment is confirmed. Proxy-token secrets remain separate and must not be deleted.

### Initial switches

```text
BILLING_ENABLED=false
SUBSCRIPTIONS_ENABLED=false
PLANS_ENABLED=false
QUOTA_MODE=off
RATE_LIMIT_MODE=off
```

### Before enabling any switch

Confirm that the corresponding tables exist, the service logic is tested, the adapter is configured, the failure policy is documented, logs do not expose credentials, and rollback consists of changing the mode back to `off`.

## Completion acceptance criteria

The account layer can be considered fully prepared for later commercial activation when all of the following are true:

- Manual account creation works through the approved administrator endpoint.
- Internal Spün Auth synchronization is idempotent.
- The real Spün Auth verification adapter is connected or the placeholder is explicitly documented as the only unavailable dependency.
- API-key generation, hashing, expiry, list, detail, and permanent revocation are tested.
- Customer and administrator ownership boundaries are tested.
- Plans are represented by reusable entitlement objects.
- Subscription periods and status transitions are implemented and tested.
- Billing has a provider interface and a safe disabled adapter.
- Usage classification and atomic monthly counters are implemented.
- Quota decisions support off, observe, and enforce modes.
- Rate-limit decisions support off, observe, and enforce modes.
- Production rate-limit storage is distributed and atomic before enforcement.
- All account-layer responses preserve the established Spün error shape.
- No public response reveals providers, infrastructure choices, database details, hashes, or secrets.
- `database/schema.sql` remains complete and runnable from a clean database.
- The initial deployment keeps commercial enforcement disabled while API-key authentication remains active.
- The implementation has been type-checked, built, smoke-tested, and committed to the `main` branch.

## Final implementation principle

The future builder should not comment out large blocks of code or uncomment an untested commercial system in production. The preferred design is compiled interfaces plus explicit disabled/no-op adapters and policy modes. That way, the account layer is real and testable now, while billing, Spün Auth verification, quota blocking, and Cloudflare-backed rate limits can be activated in controlled steps when their external credentials and infrastructure are ready.
