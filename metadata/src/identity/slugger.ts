// metadata/src/identity/slugger.ts
// Slug generation and deterministic 6-digit hash for spun_id construction.
// Uses Web Crypto API (available natively in Cloudflare Workers).

import type { ContentType } from '../types/index.js';

// ─── Slug generation ──────────────────────────────────────────────────────────

export function makeSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')      // strip special chars
    .trim()
    .replace(/\s+/g, '-')              // spaces to hyphens
    .replace(/-+/g, '-');              // collapse multiple hyphens
}

// ─── Deterministic 6-digit hash ───────────────────────────────────────────────
// Input: "{contentType}:{primaryExternalId}"
// Uses SHA-256 via Web Crypto → first 3 bytes → mod 1,000,000 → zero-padded
// Same content ALWAYS generates the same code. Safe to recreate lost rows.

export async function generateCode(
  contentType: ContentType,
  primaryId:   string | number
): Promise<string> {
  const input  = `${contentType}:${primaryId}`;
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  const bytes = new Uint8Array(buffer);
  const code  = String(
    bytes.slice(0, 3).reduce((acc, b) => acc * 256 + b, 0) % 1_000_000
  ).padStart(6, '0');
  return code;
}

// ─── Full spun_id ─────────────────────────────────────────────────────────────

export async function makeSpunId(
  title:       string,
  contentType: ContentType,
  primaryId:   string | number
): Promise<string> {
  const slug = makeSlug(title);
  const code = await generateCode(contentType, primaryId);
  return `${slug}-${code}`;
}
