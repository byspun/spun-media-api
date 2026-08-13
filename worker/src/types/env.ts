// worker/src/types/env.ts
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

  // Render backend (providers layer) — wired in Session 2
  RENDER_BACKEND_URL: string;

  // Shared secret for Worker ↔ Render auth
  X_SPUN_SECRET: string;

  // SubDL subtitle API
  SUBDL_API_KEY: string;

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
