// worker/src/db.ts
// Neon Postgres client using the HTTP driver.
// @neondatabase/serverless works natively in Cloudflare Workers — no TCP needed.
// Always pass the connection string per-request from env bindings.

import { neon } from '@neondatabase/serverless';
import type { Env } from './types/env.js';

export function getDb(env: Env) {
  return neon(env.NEON_DATABASE_URL);
}
