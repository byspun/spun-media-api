// metadata/src/types/env.ts
// Cloudflare Worker environment bindings.
// All secrets are injected via `wrangler secret put` — never hardcoded.

export interface Env {
  // KV namespace for metadata caching
  MEDIA_CACHE: KVNamespace;

  // TMDB
  TMDB_API_KEY: string;
  TMDB_BEARER_TOKEN: string;

  // Neon Postgres — pooled connection string
  NEON_DATABASE_URL: string;

  // Render backend (content resolution only)
  RENDER_BACKEND_URL: string;

  // Direct MovieBox catalogue access owned by the Worker metadata layer
  MOVIEBOX_API_BASE?: string;
  MOVIEBOX_API_SECRET?: string;

  // Shared secret for Worker ↔ Render auth
  INTERNALS_KEY?: string;
  // Administrator key for /v1/admin operations
  ADMIN_KEY?: string;
  // Spün Auth verification adapter (placeholder until the authenticator contract is supplied)
  SPUN_AUTH_VERIFY_URL?: string;
  SPUN_AUTH_VERIFY_KEY?: string;
  // Commercial enforcement switches; disabled by default when unset
  BILLING_ENABLED?: string;
  SUBSCRIPTIONS_ENABLED?: string;
  PLANS_ENABLED?: string;
  QUOTA_MODE?: string;
  RATE_LIMIT_MODE?: string;
  // Dedicated service key for automated Render log uploads
  LOG_UPLOAD_KEY?: string;

  // Subtitle catalog API
  SUBDL_API_KEY: string;

  // Encrypts opaque, expiring subtitle proxy references.
  // Set with: wrangler secret put SUBTITLE_PROXY_TOKEN_SECRET
  SUBTITLE_PROXY_TOKEN_SECRET: string;

  // Encrypts opaque, expiring HLS stream proxy references.
  STREAM_PROXY_TOKEN_SECRET: string;

  // TasteDive similar content API
  TASTEDIVE_API_KEY: string;

  // Vercel proxy for AniList + Jikan (bypasses CF orange-to-orange block)
  // Set to your deployed Vercel project URL e.g. https://spun-anilist-proxy.vercel.app
  PROXY_BASE_URL: string;

  // Shared secret sent in x-spun-proxy-secret header to the Vercel proxy.
  // Must match SPUN_PROXY_SECRET on the Vercel side.
  SPUN_PROXY_SECRET: string;

  // Environment flag
  ENVIRONMENT: string;
}
