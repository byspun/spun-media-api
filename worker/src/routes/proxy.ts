// worker/src/routes/proxy.ts
// Black Box media proxy routes. Upstream URLs are accepted only inside encrypted,
// expiring capability tokens created by the relevant public API route.

import { Hono } from 'hono';
import { unzipSync } from 'fflate';
import type { Env } from '../types/env.js';
import { errorResponse } from '../normalizer.js';
import { readSubtitleProxyToken } from '../proxy-token.js';
import { srtToVtt } from '../utils/srtToVtt.js';
import { proxyHls } from '../proxy.js';

const proxy = new Hono<{ Bindings: Env }>();

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20;
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const ALLOWED_SUBTITLE_HOSTS = [
  'subdl.com',
  'dl.subdl.com',
  'bhcxy.com',
  'kucwn.com',
  'flocw.com',
  'hvncw.com',
  'kclov.com',
  'megaplay.buzz',
  'vidwish.live',
  'megacloud.bloggy.click',
  'megacloud.tv',
];

function isAllowedSubtitleUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      ALLOWED_SUBTITLE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const declaredLength = response.headers.get('Content-Length');
  if (declaredLength && Number(declaredLength) > maxBytes) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
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
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function fetchSubtitle(url: string, requestHeaders: Record<string, string> = {}): Promise<Uint8Array | null> {
  if (!isAllowedSubtitleUrl(url)) return null;
  const allowedHeaders = new Set(['accept', 'cookie', 'origin', 'referer', 'user-agent', 'x-requested-with']);
  const safeHeaders = Object.fromEntries(Object.entries(requestHeaders).filter(([key, value]) => allowedHeaders.has(key.toLowerCase()) && value.length < 2000));
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        Accept: 'text/vtt, text/plain, application/x-subrip, application/zip, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; SpunMediaSubtitleProxy/1.0)',
        ...safeHeaders,
      },
    });
    if (!response.ok) return null;
    return readLimited(response, MAX_ARCHIVE_BYTES);
  } catch {
    return null;
  }
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function extractSubtitleFile(archiveBytes: Uint8Array, languageCode: string): Uint8Array | null {
  let entryCount = 0;
  let declaredSubtitleBytes = 0;
  let invalidArchive = false;

  try {
    const archive = unzipSync(archiveBytes, {
      filter: (file) => {
        entryCount++;
        const name = file.name.replace(/\\/g, '/');
        const unsafeName = name.startsWith('/') || name.split('/').includes('..');
        if (
          entryCount > MAX_ARCHIVE_ENTRIES ||
          unsafeName ||
          !Number.isSafeInteger(file.originalSize) ||
          file.originalSize < 1
        ) {
          invalidArchive = true;
          return false;
        }
        if (!name.toLowerCase().endsWith('.srt') && !name.toLowerCase().endsWith('.vtt')) return false;
        if (file.originalSize > MAX_SUBTITLE_BYTES) {
          invalidArchive = true;
          return false;
        }
        declaredSubtitleBytes += file.originalSize;
        if (declaredSubtitleBytes > MAX_SUBTITLE_BYTES) {
          invalidArchive = true;
          return false;
        }
        return true;
      },
    });

    if (invalidArchive || entryCount === 0) return null;
    const entries = Object.entries(archive).filter(([, bytes]) => bytes.byteLength > 0 && bytes.byteLength <= MAX_SUBTITLE_BYTES);
    if (!entries.length) return null;
    const normalizedLanguage = languageCode.toLowerCase();
    const preferred = entries.find(([name]) => name.toLowerCase().includes(normalizedLanguage));
    return (preferred ?? entries[0])[1];
  } catch {
    return null;
  }
}

function decodeSubtitle(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function looksLikeVtt(text: string): boolean {
  return /^\s*WEBVTT(?:\s|$)/i.test(text);
}

function looksLikeCueText(text: string): boolean {
  return /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(text);
}

// GET /v1/proxy/stream?t=<encrypted-token>
// Handles HLS, header-bound MP4, and DASH through the existing capability proxy.
proxy.get('/stream', async (c) => proxyHls(c.req.raw, c.env));

// GET /v1/proxy/subtitles?t=<encrypted-token>
// Browser-playable endpoint for direct VTT/SRT files and SubDL archives.
proxy.get('/subtitles', async (c) => {
  const token = c.req.query('t');
  if (!token) return errorResponse('BAD_REQUEST', 'Missing subtitle reference.', 400);

  const payload = await readSubtitleProxyToken(c.env.SUBTITLE_PROXY_TOKEN_SECRET, token);
  if (!payload) return errorResponse('SECURE_LINK_ERROR', 'Invalid subtitle reference.', 403);

  const sourceBytes = await fetchSubtitle(payload.archive_url, payload.headers ?? {});
  if (!sourceBytes) return errorResponse('SUBTITLE_UNAVAILABLE', 'Subtitle track unavailable.', 502);

  const subtitleBytes = isZip(sourceBytes)
    ? extractSubtitleFile(sourceBytes, payload.language_code)
    : sourceBytes;
  if (!subtitleBytes) return errorResponse('SUBTITLE_TRACK_NOT_FOUND', 'No playable subtitle track found.', 422);

  const sourceText = decodeSubtitle(subtitleBytes).trim();
  const actualFormat: 'vtt' | 'srt' = looksLikeVtt(sourceText) ? 'vtt' : 'srt';
  if (!looksLikeCueText(sourceText)) return errorResponse('SUBTITLE_CONVERSION_FAILED', 'Subtitle track could not be prepared.', 422);

  const wantsAttachmentSrt = payload.disposition === 'attachment' && payload.format === 'srt';
  const body = wantsAttachmentSrt && actualFormat === 'srt' ? sourceText : actualFormat === 'vtt' ? sourceText : srtToVtt(sourceText);
  const outputFormat = wantsAttachmentSrt && actualFormat === 'srt' ? 'srt' : 'vtt';
  if (!body.includes('-->')) return errorResponse('SUBTITLE_CONVERSION_FAILED', 'Subtitle track could not be prepared.', 422);

  const filename = `${payload.language_code || 'subtitle'}.${outputFormat}`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': outputFormat === 'srt' ? 'application/x-subrip; charset=utf-8' : 'text/vtt; charset=utf-8',
      'Content-Disposition': `${payload.disposition === 'attachment' ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=900',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export default proxy;
