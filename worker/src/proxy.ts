import type { Env } from './types/env.js';
import { createStreamProxyToken, readStreamProxyToken } from './proxy-token.js';

function isM3u8(url: string, contentType: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegurl');
}

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith('http://') || relative.startsWith('https://')) return relative;
  try { return new URL(relative, base).toString(); } catch { return relative; }
}

async function proxyUrl(requestUrl: URL, targetUrl: string, secret: string, headers: Record<string, string>): Promise<string> {
  const { token } = await createStreamProxyToken(secret, targetUrl, headers);
  return `${requestUrl.origin}${requestUrl.pathname}?t=${encodeURIComponent(token)}`;
}

async function rewriteM3u8(body: string, baseUrl: string, requestUrl: URL, secret: string, headers: Record<string, string>): Promise<string> {
  const lines = body.split('\n');
  const output: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { output.push(''); continue; }
    if (line.startsWith('#') && line.includes('URI="')) {
      let rewritten = line;
      const matches = [...line.matchAll(/URI="([^"]+)"/g)];
      for (const match of matches) {
        const absolute = resolveUrl(baseUrl, match[1]);
        const proxied = await proxyUrl(requestUrl, absolute, secret, headers);
        rewritten = rewritten.replace(`URI="${match[1]}"`, `URI="${proxied}"`);
      }
      output.push(rewritten);
      continue;
    }
    if (line.startsWith('#')) { output.push(line); continue; }
    output.push(await proxyUrl(requestUrl, resolveUrl(baseUrl, line), secret, headers));
  }
  return output.join('\n');
}

function safeHeaders(input: Record<string, string>): Record<string, string> {
  const allowed = new Set(['authorization', 'cookie', 'referer', 'origin', 'user-agent', 'x-requested-with', 'accept']);
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.has(key.toLowerCase()) && value.length < 2000));
}

export async function proxyHls(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get('t');
  if (!token) return new Response(JSON.stringify({ code: 'BAD_REQUEST', error: 'Stream reference required', description: 'No stream capability was provided.', action: 'Use the stream URL returned by Spün.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const payload = await readStreamProxyToken(env.STREAM_PROXY_TOKEN_SECRET || env.SUBTITLE_PROXY_TOKEN_SECRET, token);
  if (!payload) return new Response(JSON.stringify({ code: 'PROXY_TOKEN_INVALID', error: 'Invalid stream reference', description: 'The stream capability is invalid or expired.', action: 'Request a fresh stream URL.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let target: URL;
  try { target = new URL(payload.upstream_url); } catch { return new Response(JSON.stringify({ code: 'PROXY_FORMAT_UNSUPPORTED', error: 'Invalid stream source', description: 'The stream source could not be validated.', action: 'Request another stream source.' }), { status: 422, headers: { 'Content-Type': 'application/json' } }); }

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
    upstream = await fetch(target, { headers: upstreamHeaders, redirect: 'follow' });
  } catch {
    return new Response(JSON.stringify({ code: 'PROXY_UPSTREAM_UNAVAILABLE', error: 'Stream source unavailable', description: 'The stream source could not be reached.', action: 'Try again later or select another stream.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
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
    const rewritten = await rewriteM3u8(await upstream.text(), target.toString(), requestUrl, env.STREAM_PROXY_TOKEN_SECRET || env.SUBTITLE_PROXY_TOKEN_SECRET, safeHeaders(payload.headers));
    responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
    responseHeaders.set('Cache-Control', 'no-cache, no-store');
    return new Response(rewritten, { status: 200, headers: responseHeaders });
  }

  responseHeaders.set('Cache-Control', 'public, max-age=3600');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
