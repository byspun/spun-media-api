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

  // Environment flag
  ENVIRONMENT: string;
}
