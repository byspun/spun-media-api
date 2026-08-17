const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_VERSION = 1;
const TOKEN_AAD = encoder.encode('spun-media-api:proxy-token:v1');

export const SUBTITLE_PROXY_TOKEN_TTL_SECONDS = 15 * 60;
export const STREAM_PROXY_TOKEN_TTL_SECONDS = 10 * 60;

export interface SubtitleProxyTokenPayload {
  v: 1;
  kind: 'subtitle';
  archive_url: string;
  language_code: string;
  format: 'vtt' | 'srt';
  disposition: 'inline' | 'attachment';
  headers?: Record<string, string>;
  expires_at: number;
}

export interface StreamProxyTokenPayload {
  v: 1;
  kind: 'stream';
  upstream_url: string;
  headers: Record<string, string>;
  expires_at: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function isValidSubtitlePayload(value: unknown): value is SubtitleProxyTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return payload.v === TOKEN_VERSION && payload.kind === 'subtitle' && typeof payload.archive_url === 'string' && payload.archive_url.length > 0 && typeof payload.language_code === 'string' && payload.language_code.length > 0 && (payload.format === 'vtt' || payload.format === 'srt') && (payload.disposition === 'inline' || payload.disposition === 'attachment') && typeof payload.expires_at === 'number' && Number.isFinite(payload.expires_at);
}

function isValidStreamPayload(value: unknown): value is StreamProxyTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return payload.v === TOKEN_VERSION && payload.kind === 'stream' && typeof payload.upstream_url === 'string' && payload.upstream_url.length > 0 && typeof payload.headers === 'object' && payload.headers !== null && typeof payload.expires_at === 'number' && Number.isFinite(payload.expires_at);
}

async function encryptPayload(payload: SubtitleProxyTokenPayload | StreamProxyTokenPayload, secret: string): Promise<string> {
  if (!secret) throw new Error('Missing proxy token secret.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TOKEN_AAD }, key, encoder.encode(JSON.stringify(payload)));
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

async function decryptPayload(secret: string, token: string, now: number): Promise<unknown | null> {
  if (!secret || !token || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const iv = fromBase64Url(parts[0]);
    const ciphertext = fromBase64Url(parts[1]);
    if (iv.length !== 12 || ciphertext.length < 17) return null;
    const key = await importEncryptionKey(secret);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: TOKEN_AAD }, key, ciphertext);
    const payload = JSON.parse(decoder.decode(decrypted));
    if (typeof payload?.expires_at !== 'number' || payload.expires_at <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSubtitleProxyToken(secret: string, archiveUrl: string, languageCode: string, mode: { format?: 'vtt' | 'srt'; disposition?: 'inline' | 'attachment'; headers?: Record<string, string> } = {}, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = now + SUBTITLE_PROXY_TOKEN_TTL_SECONDS * 1000;
  const headers = Object.fromEntries(Object.entries(mode.headers ?? {}).filter(([key, value]) => key.length < 80 && value.length < 2000));
  const token = await encryptPayload({ v: 1, kind: 'subtitle', archive_url: archiveUrl, language_code: languageCode, format: mode.format ?? 'vtt', disposition: mode.disposition ?? 'inline', headers, expires_at: expiresAt }, secret);
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export async function readSubtitleProxyToken(secret: string, token: string, now = Date.now()): Promise<SubtitleProxyTokenPayload | null> {
  const payload = await decryptPayload(secret, token, now);
  return isValidSubtitlePayload(payload) ? payload : null;
}

export async function createStreamProxyToken(secret: string, upstreamUrl: string, headers: Record<string, string> = {}, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = now + STREAM_PROXY_TOKEN_TTL_SECONDS * 1000;
  const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([key, value]) => key.length < 80 && value.length < 2000));
  const token = await encryptPayload({ v: 1, kind: 'stream', upstream_url: upstreamUrl, headers: safeHeaders, expires_at: expiresAt }, secret);
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export async function readStreamProxyToken(secret: string, token: string, now = Date.now()): Promise<StreamProxyTokenPayload | null> {
  const payload = await decryptPayload(secret, token, now);
  return isValidStreamPayload(payload) ? payload : null;
}
