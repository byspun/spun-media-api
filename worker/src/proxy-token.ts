// worker/src/proxy-token.ts
// Opaque, authenticated, expiring references for media proxy routes.
// The browser receives only the token. Upstream URLs and credentials stay inside Spün.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_VERSION = 1;
const TOKEN_AAD = encoder.encode('spun-media-api:proxy-token:v1');

export const SUBTITLE_PROXY_TOKEN_TTL_SECONDS = 15 * 60;

export interface SubtitleProxyTokenPayload {
  v: 1;
  kind: 'subtitle';
  archive_url: string;
  language_code: string;
  expires_at: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(secret));

  return crypto.subtle.importKey(
    'raw',
    material,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

function isValidSubtitlePayload(value: unknown): value is SubtitleProxyTokenPayload {
  if (!value || typeof value !== 'object') return false;

  const payload = value as Record<string, unknown>;
  return (
    payload.v === TOKEN_VERSION &&
    payload.kind === 'subtitle' &&
    typeof payload.archive_url === 'string' &&
    payload.archive_url.length > 0 &&
    typeof payload.language_code === 'string' &&
    payload.language_code.length > 0 &&
    typeof payload.expires_at === 'number' &&
    Number.isFinite(payload.expires_at)
  );
}

export async function createSubtitleProxyToken(
  secret: string,
  archiveUrl: string,
  languageCode: string,
  now = Date.now(),
): Promise<{ token: string; expiresAt: string }> {
  if (!secret) throw new Error('Missing proxy token secret.');

  const expiresAt = now + SUBTITLE_PROXY_TOKEN_TTL_SECONDS * 1000;
  const payload: SubtitleProxyTokenPayload = {
    v: TOKEN_VERSION,
    kind: 'subtitle',
    archive_url: archiveUrl,
    language_code: languageCode,
    expires_at: expiresAt,
  };

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: TOKEN_AAD },
    key,
    encoder.encode(JSON.stringify(payload)),
  );

  return {
    token: `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function readSubtitleProxyToken(
  secret: string,
  token: string,
  now = Date.now(),
): Promise<SubtitleProxyTokenPayload | null> {
  if (!secret || !token || token.length > 4096) return null;

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const iv = fromBase64Url(parts[0]);
    const ciphertext = fromBase64Url(parts[1]);
    if (iv.length !== 12 || ciphertext.length < 17) return null;

    const key = await importEncryptionKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: TOKEN_AAD },
      key,
      ciphertext,
    );
    const payload = JSON.parse(decoder.decode(decrypted));

    if (!isValidSubtitlePayload(payload) || payload.expires_at <= now) return null;

    return payload;
  } catch {
    return null;
  }
}
