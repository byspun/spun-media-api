import type { Env } from './types/env.js';
import { createStreamProxyToken, readStreamProxyToken } from './proxy-token.js';

const MAX_REDIRECTS = 4;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_LINES = 10_000;
const MAX_MANIFEST_URIS = 1_000;

function isM3u8(url: string, contentType: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegurl');
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/[\[\]]/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '0.0.0.0' || host === '::1' || host === '::') return true;

  const octets = host.split('.').map(Number);
  if (octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    const [a, b] = octets;
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }

  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}

function isSafeProxyTarget(value: string | URL): value is string | URL {
  try {
    const url = typeof value === 'string' ? new URL(value) : value;
    return url.protocol === 'https:' && !isBlockedHostname(url.hostname);
  } catch {
    return false;
  }
}

function resolveUrl(base: string, relative: string): string {
  try {
    const resolved = new URL(relative, base);
    return resolved.toString();
  } catch {
    return relative;
  }
}

async function proxyUrl(requestUrl: URL, targetUrl: string, secret: string, headers: Record<string, string>): Promise<string> {
  const { token } = await createStreamProxyToken(secret, targetUrl, headers);
  return `${requestUrl.origin}${requestUrl.pathname}?t=${encodeURIComponent(token)}`;
}

async function rewriteM3u8(body: string, baseUrl: string, requestUrl: URL, secret: string, headers: Record<string, string>): Promise<string> {
  const lines = body.split('\n');
  if (lines.length > MAX_MANIFEST_LINES) throw new Error('manifest-line-limit');

  const output: string[] = [];
  let uriCount = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { output.push(''); continue; }
    if (line.startsWith('#') && line.includes('URI="')) {
      let rewritten = line;
      const matches = [...line.matchAll(/URI="([^"]+)"/g)];
      for (const match of matches) {
        uriCount++;
        if (uriCount > MAX_MANIFEST_URIS) throw new Error('manifest-uri-limit');
        const absolute = resolveUrl(baseUrl, match[1]);
        if (!isSafeProxyTarget(absolute)) throw new Error('manifest-target-not-allowed');
        const proxied = await proxyUrl(requestUrl, absolute, secret, headers);
        rewritten = rewritten.replace(`URI="${match[1]}"`, `URI="${proxied}"`);
      }
      output.push(rewritten);
      continue;
    }
    if (line.startsWith('#')) { output.push(line); continue; }
    uriCount++;
    if (uriCount > MAX_MANIFEST_URIS) throw new Error('manifest-uri-limit');
    const absolute = resolveUrl(baseUrl, line);
    if (!isSafeProxyTarget(absolute)) throw new Error('manifest-target-not-allowed');
    output.push(await proxyUrl(requestUrl, absolute, secret, headers));
  }
  return output.join('\n');
}

function safeHeaders(input: Record<string, string>): Record<string, string> {
  const allowed = new Set(['authorization', 'cookie', 'referer', 'origin', 'user-agent', 'x-requested-with', 'accept']);
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === 'string' && value.length < 2000));
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return null;
  const declaredLength = response.headers.get('Content-Length');
  if (declaredLength && Number(declaredLength) > maxBytes) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchSafeTarget(target: URL, headers: Headers): Promise<{ response: Response; finalUrl: URL }> {
  let current = target;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    if (!isSafeProxyTarget(current)) throw new Error('proxy-target-not-allowed');
    const response = await fetch(current, { headers, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: current };
    const location = response.headers.get('Location');
    if (!location || redirect === MAX_REDIRECTS) throw new Error('proxy-redirect-limit');
    current = new URL(location, current);
  }
  throw new Error('proxy-redirect-limit');
}

export async function proxyHls(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get('t');
  if (!token) return new Response(JSON.stringify({ code: 'BAD_REQUEST', error: 'Stream reference required', description: 'No stream capability was provided.', action: 'Use the stream URL returned by Spün.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (!env.STREAM_PROXY_TOKEN_SECRET) return new Response(JSON.stringify({ code: 'SERVICE_OFFLINE', error: 'Stream proxy unavailable', description: 'The stream proxy is not configured.', action: 'Try again later.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });

  const payload = await readStreamProxyToken(env.STREAM_PROXY_TOKEN_SECRET, token);
  if (!payload) return new Response(JSON.stringify({ code: 'PROXY_TOKEN_INVALID', error: 'Invalid stream reference', description: 'The stream capability is invalid or expired.', action: 'Request a fresh stream URL.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let target: URL;
  try {
    target = new URL(payload.upstream_url);
    if (!isSafeProxyTarget(target)) throw new Error('unsafe-target');
  } catch {
    return new Response(JSON.stringify({ code: 'PROXY_UPSTREAM_NOT_ALLOWED', error: 'Stream source not allowed', description: 'The stream source could not be validated for proxying.', action: 'Request another stream source.' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  }

  const upstreamHeaders = new Headers({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Referer: `${target.origin}/`,
    Origin: target.origin,
    Accept: '*/*',
    ...safeHeaders(payload.headers),
  });
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) upstreamHeaders.set('Range', rangeHeader);

  let upstream: Response;
  try {
    const safeResult = await fetchSafeTarget(target, upstreamHeaders);
    upstream = safeResult.response;
    target = safeResult.finalUrl;
  } catch (error) {
    const code = String(error).includes('target-not-allowed') || String(error).includes('redirect')
      ? 'PROXY_UPSTREAM_NOT_ALLOWED'
      : 'PROXY_UPSTREAM_UNAVAILABLE';
    return new Response(JSON.stringify({ code, error: 'Stream source unavailable', description: 'The stream source could not be reached safely.', action: 'Try again later or select another stream.' }), { status: code === 'PROXY_UPSTREAM_NOT_ALLOWED' ? 422 : 502, headers: { 'Content-Type': 'application/json' } });
  }
  if (!upstream.ok && upstream.status !== 206) return new Response(null, { status: upstream.status });

  const contentType = upstream.headers.get('Content-Type') ?? '';
  const responseHeaders = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  });
  for (const header of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }

  if (isM3u8(target.toString(), contentType)) {
    const manifest = await readLimitedText(upstream, MAX_MANIFEST_BYTES);
    if (manifest === null) return new Response(JSON.stringify({ code: 'PROXY_MANIFEST_TOO_LARGE', error: 'Stream manifest too large', description: 'The HLS manifest exceeds the proxy safety limit.', action: 'Request another stream source.' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
    try {
      const rewritten = await rewriteM3u8(manifest, target.toString(), requestUrl, env.STREAM_PROXY_TOKEN_SECRET, safeHeaders(payload.headers));
      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
      responseHeaders.set('Cache-Control', 'no-cache, no-store');
      return new Response(rewritten, { status: 200, headers: responseHeaders });
    } catch {
      return new Response(JSON.stringify({ code: 'PROXY_MANIFEST_UNSUPPORTED', error: 'Stream manifest unsupported', description: 'The HLS manifest exceeded the proxy safety limits or contained an unsafe target.', action: 'Request another stream source.' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const headerBound = Boolean(payload.headers.authorization || payload.headers.cookie);
  responseHeaders.set('Cache-Control', headerBound ? 'private, no-store' : 'public, max-age=3600');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
