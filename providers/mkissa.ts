import crypto from 'node:crypto';
import { fetchJson, getAniListMedia, sleep } from './internal/http.js';
import { isSafeHttpUrl, detectFormat, normalizeQuality } from './internal/utils.js';
import type { AnimeProviderInput, MovieProviderInput, TvProviderInput, RawStream, RawDownload } from './internal/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// MKissa provider — GraphQL API with crypto handshake
//
// Ported from anivexa-api/providers/mkissa.js. The old REST API (api.mkissa.net/
// api/anime/:id) was removed upstream; the site migrated to a GraphQL API
// protected by an HMAC boot-token + AES-256-GCM lane-key handshake. This module
// ports the crypto/config-discovery flow and the source-extraction pipeline.
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const REFERER = 'https://mkissa.to';
const API = 'https://api.mkissa.net';
const API_URL = `${API}/api`;
const ANIZIP = 'https://api.ani.zip/mappings';
const CONTENT_LANE = 'k7';
const REFERER_HOST = 'mkissa.to';
const KEY_GROUP = 'mkissa';
const BOOT_EPOCH_MS = 604800000;
const BOOT_GRACE_MS = 86400000;
const AA_REQ_MS = 300000;
const DISCOVERY_CONCURRENCY = 16;
const DISCOVERY_LIMIT = 600;
const FETCH_TIMEOUT_MS = 30000;
const EXTRACT_TIMEOUT_MS = 5000;

const HEX_TABLE: Record<string, string> = {
  '79': 'A', '7a': 'B', '7b': 'C', '7c': 'D', '7d': 'E', '7e': 'F', '7f': 'G',
  '70': 'H', '71': 'I', '72': 'J', '73': 'K', '74': 'L', '75': 'M', '76': 'N', '77': 'O',
  '68': 'P', '69': 'Q', '6a': 'R', '6b': 'S', '6c': 'T', '6d': 'U', '6e': 'V', '6f': 'W',
  '60': 'X', '61': 'Y', '62': 'Z', '59': 'a', '5a': 'b', '5b': 'c', '5c': 'd', '5d': 'e',
  '5e': 'f', '5f': 'g', '50': 'h', '51': 'i', '52': 'j', '53': 'k', '54': 'l', '55': 'm',
  '56': 'n', '57': 'o', '48': 'p', '49': 'q', '4a': 'r', '4b': 's', '4c': 't', '4d': 'u',
  '4e': 'v', '4f': 'w', '40': 'x', '41': 'y', '42': 'z', '08': '0', '09': '1', '0a': '2',
  '0b': '3', '0c': '4', '0d': '5', '0e': '6', '0f': '7', '00': '8', '01': '9', '15': '-',
  '16': '.', '67': '_', '46': '~', '02': ':', '17': '/', '07': '?', '1b': '#', '63': '[',
  '65': ']', '78': '@', '19': '!', '1c': '$', '1e': '&', '10': '(', '11': ')', '12': '*',
  '13': '+', '14': ',', '03': ';', '05': '=', '1d': '%',
};

let cryptoConfigCache: any = null;
let episodeQueryCache: any = null;
const sessionCookies = new Map<string, string>();

function decodeHexUrl(hex: string): string {
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    const pair = hex.substring(i, i + 2).toLowerCase();
    out += HEX_TABLE[pair] ?? pair;
  }
  return out;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacBytes(key: Buffer, value: string): Buffer {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function storeCookies(headers: Headers): void {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean) as string[];
  for (const value of raw) {
    for (const part of String(value).split(/,(?=[^;,]+=)/)) {
      const pair = part.split(';')[0]?.trim();
      const index = pair?.indexOf('=');
      if (index && index > 0) sessionCookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

function cookieHeader(): string {
  return [...sessionCookies].map(([key, value]) => `${key}=${value}`).join('; ');
}

function browserHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const cookie = cookieHeader();
  return {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    ...(cookie ? { Cookie: cookie } : {}),
    ...headers,
  };
}

function apiHeaders(buildId: string, headers: Record<string, string> = {}): Record<string, string> {
  return {
    'Referer': `${REFERER}/`,
    'Origin': REFERER,
    'x-build-id': buildId,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Priority': 'u=1, i',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    ...headers,
  };
}

async function sessionFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...options, headers: browserHeaders(options.headers as Record<string, string> || {}) });
  storeCookies(res.headers);
  return res;
}

async function apiSessionFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Warm the session with a page visit first (establishes cookies)
  try {
    await sessionFetch(`${REFERER}/`, {
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {}
  const res = await sessionFetch(url, options);
  return res;
}

// ── Crypto config discovery ──────────────────────────────────────────────────

function findBalancedBlock(text: string, start: number): number {
  let depth = 0;
  let seen = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return i + 1; }
  }
  return -1;
}

function findOpeningParen(text: string, end: number): number {
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(' && --depth === 0) return i;
  }
  return -1;
}

function normalizeCryptoConfig(out: any): any {
  if (!out?.buildId || !Array.isArray(out.maskParts) || out.maskParts.length < 4) return null;
  return { scheme: 'legacy', buildId: String(out.buildId), maskParts: out.maskParts.slice(0, 4).map(String) };
}

function functionSource(text: string, name: string): string | null {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(text);
  if (!match) return null;
  const start = text.indexOf('{', match.index);
  const end = findBalancedBlock(text, start);
  return end === -1 ? null : text.slice(match.index, end);
}

function findStatementEnd(text: string, start: number): number {
  let parens = 0, brackets = 0, braces = 0, quote = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === ';' && !parens && !brackets && !braces) return i;
  }
  return -1;
}

function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let start = 0, parens = 0, brackets = 0, braces = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === ',' && !parens && !brackets && !braces) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

function declarationStatementAt(text: string, index: number): any {
  const start = Math.max(text.lastIndexOf('const ', index), text.lastIndexOf('let ', index), text.lastIndexOf('var ', index));
  if (start < 0) return null;
  const end = findStatementEnd(text, start);
  if (end < 0 || index > end) return null;
  const keyword = /^(?:const|let|var)\s+/.exec(text.slice(start));
  if (!keyword) return null;
  const entries = splitTopLevel(text.slice(start + keyword[0].length, end)).map((value: string) => {
    const entry = /^\s*([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(value);
    return entry ? { name: entry[1], expression: entry[2], start, end } : null;
  }).filter(Boolean);
  return { start, end, entries };
}

function templateDependencies(expression: string): string[] {
  return [...expression.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\b[^}]*\}/g)].map((match: RegExpMatchArray) => match[1]);
}

function templateDeclaration(chunk: string, name: string, before = chunk.length): any {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...chunk.matchAll(new RegExp(`(?<![A-Za-z0-9_$])${escaped}\\s*=`, 'g'))];
  let fallback = null;
  for (const match of matches) {
    const statement = declarationStatementAt(chunk, match.index!);
    const entry = statement?.entries.find((value: any) => value.name === name);
    if (!entry) continue;
    if (!fallback) fallback = entry;
    if (entry.start < before) fallback = entry;
  }
  return fallback;
}

function bootstrapBuildDeclaration(chunk: string): any {
  const matches = [...chunk.matchAll(/\bbuildId\s*:\s*[A-Za-z_$][\w$]*\s*=\s*([A-Za-z_$][\w$]*)\b/g)];
  for (const match of matches) {
    const entry = templateDeclaration(chunk, match[1], match.index);
    if (entry) return entry;
  }
  return null;
}

function previousArrayAndBuildDeclaration(chunk: string, before: number): any {
  const matches = [...chunk.slice(0, before).matchAll(/\b(?:const|let|var)\s+/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const statement = declarationStatementAt(chunk, matches[i].index! + matches[i][0].length);
    if (!statement?.entries.length || statement.start >= before) continue;
    const partsIndex = statement.entries.findIndex((entry: any) => entry.expression.trim().startsWith('['));
    if (partsIndex < 0) continue;
    const build = statement.entries.find((entry: any, index: number) => index < partsIndex && !entry.expression.trim().startsWith('['));
    if (build) return { build, parts: statement.entries[partsIndex] };
  }
  return null;
}

function validEpisodeQuery(query: string): boolean {
  return typeof query === 'string' &&
    !/[\uD800-\uDFFF]/.test(query) &&
    /\bquery\b/.test(query) &&
    /\bepisode\s*\(\s*showId\s*:\s*\$showId\s+translationType\s*:\s*\$translationType\s+episodeString\s*:\s*\$episodeString\s*\)/.test(query) &&
    !query.includes('${');
}

function evalEpisodeQueryChunk(chunk: string): string | null {
  const operation = /\bepisode\s*\(\s*showId\s*:\s*\$showId\s*translationType\s*:\s*\$translationType\s*episodeString\s*:\s*\$episodeString\s*\)/g;
  const operationInExpression = new RegExp(operation.source);
  for (const match of chunk.matchAll(operation)) {
    const statement = declarationStatementAt(chunk, match.index!);
    const candidate = statement?.entries.find((entry: any) => operationInExpression.test(entry.expression));
    if (!candidate) continue;
    const definitions = new Map<string, any>();
    const resolving = new Set<string>();
    const resolve = (name: string, before: number) => {
      if (definitions.has(name) || resolving.has(name)) return;
      const entry = templateDeclaration(chunk, name, before);
      if (!entry) return;
      resolving.add(name);
      for (const dependency of templateDependencies(entry.expression)) resolve(dependency, entry.start);
      resolving.delete(name);
      definitions.set(name, entry);
    };
    resolve(candidate.name, candidate.start + 1);
    try {
      const source = [...definitions.values()].map((entry: any) => `const ${entry.name}=${entry.expression};`).join('\n');
      const query = Function(`${source}\nreturn ${candidate.name}();`)();
      if (validEpisodeQuery(query)) return query;
    } catch {}
  }
  return null;
}

function evalFragmentCryptoChunk(chunk: string): any {
  for (const match of chunk.matchAll(/\bsaltMul\s*:/g)) {
    const declarationAt = chunk.lastIndexOf('const ', match.index);
    const declarationEnd = declarationAt === -1 ? -1 : findStatementEnd(chunk, declarationAt);
    if (declarationEnd === -1 || match.index! > declarationEnd) continue;
    const declarations = splitTopLevel(chunk.slice(declarationAt + 6, declarationEnd)).map((value: string) => {
      const entry = /^\s*([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(value);
      return entry ? { name: entry[1], expression: entry[2] } : null;
    }).filter(Boolean);
    const configIndex = declarations.findIndex((entry: any) => /\b(?:saltMul|fragMul)\s*:/.test(entry.expression));
    if (configIndex < 0) continue;
    const previous = previousArrayAndBuildDeclaration(chunk, declarationAt);
    const partsIndex = declarations.slice(0, configIndex).map((entry: any, index: number) => ({ entry, index })).reverse().find(({ entry }: any) => entry.expression.trim().startsWith('['))?.index;
    const build = bootstrapBuildDeclaration(chunk) ?? previous?.build ?? declarations[0];
    const parts = partsIndex === undefined ? previous?.parts : declarations[partsIndex!];
    const params = declarations[configIndex];
    if (!build || !parts || !params) continue;
    const expression = `${build.expression};${parts.expression};${params.expression}`;
    const names = new Set([...expression.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((entry: RegExpMatchArray) => entry[1]));
    const helpers: string[] = [];
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const name of [...names]) {
        if (helpers.some((source: string) => new RegExp(`function\\s+${name}\\s*\\(`).test(source))) continue;
        const source = functionSource(chunk, name);
        if (!source) continue;
        helpers.push(source);
        for (const reference of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
          if (!names.has(reference[1])) { names.add(reference[1]); changed = true; }
        }
      }
      if (helpers.some((source: string) => /^function\s+[A-Za-z_$][\w$]*\s*\(\)\s*\{const\s+e=\[/.test(source))) break;
      if (!changed) break;
    }
    const tableSource = helpers.find((source: string) => /^function\s+[A-Za-z_$][\w$]*\s*\(\)\s*\{const\s+e=\[/.test(source)) ?? null;
    const tableName = tableSource?.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/)?.[1] ?? null;
    const tableInitEnd = tableName ? chunk.lastIndexOf(`)(${tableName},`, declarationAt) : -1;
    const tableInitStart = tableInitEnd === -1 ? -1 : findOpeningParen(chunk, tableInitEnd);
    const tableInit = tableInitStart === -1 || tableInitEnd === -1 ? '' : chunk.slice(tableInitStart, chunk.indexOf(';', tableInitEnd) + 1);
    if (!tableSource || !tableInit) continue;
    const source = `${tableSource}\n${tableInit}\n${helpers.filter((helper: string) => !helper.startsWith(`function ${tableName}`)).join('\n')}\nreturn { buildId: (${build.expression}), maskParts: (${parts.expression}), params: (${params.expression}) };`;
    const out = Function(source)();
    const config = out?.params;
    if (!out?.buildId || !Array.isArray(out.maskParts) || out.maskParts.length < 4 || !config || typeof config !== 'object') continue;
    const numeric = ['saltMul', 'saltAdd', 'fragMul', 'fragAdd'];
    if (numeric.some((key) => !Number.isFinite(Number(config[key])))) continue;
    if (!Array.isArray(config.parts) || !config.parts.length || typeof config.bootPrefix !== 'string' || typeof config.join !== 'string') continue;
    return {
      scheme: 'fragments', buildId: String(out.buildId), maskParts: out.maskParts.slice(0, 4).map(String),
      saltMul: Number(config.saltMul), saltAdd: Number(config.saltAdd), fragMul: Number(config.fragMul), fragAdd: Number(config.fragAdd),
      bootPrefix: config.bootPrefix, join: config.join, parts: config.parts.map(String), omitEmptyLane: Boolean(config.omitEmptyLane),
    };
  }
  return null;
}

function evalOldCryptoChunk(chunk: string): any {
  const cryptoStart = chunk.search(/const\s+[A-Za-z_$][\w$]*\s*=[^;]{0,180}\?"\d+":"",\s*[A-Za-z_$][\w$]*=\[/);
  if (cryptoStart < 0) return null;
  const tableMatches = [...chunk.slice(0, cryptoStart).matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(\)\{const e=\[/g)];
  const tableStart = tableMatches.at(-1)?.index ?? -1;
  const asyncStart = chunk.indexOf('async function', cryptoStart);
  if (tableStart < 0 || asyncStart < 0) return null;
  let code = chunk.slice(tableStart, asyncStart);
  const buildMatch = code.match(/const\s+([A-Za-z_$][\w$]*)\s*=([^;]+?\?"(\d+)":"")\s*,\s*([A-Za-z_$][\w$]*)=\[/);
  if (!buildMatch) return null;
  const buildName = buildMatch[1];
  const maskName = buildMatch[4];
  code = code.replace(new RegExp(`\\b[A-Za-z_$][\\w$]*\\(\\);\\s*const\\s+${buildName}=`), `const ${buildName}=`);
  code = code.replace(new RegExp(`const\\s+${buildName}=`), `var ${buildName}=`);
  code = code.replace(new RegExp(`,\\s*${maskName}=\\[`), `;var ${maskName}=[`);
  code += `\nreturn { buildId: ${buildName}, maskParts: ${maskName} };`;
  return normalizeCryptoConfig(Function(code)());
}

function evalModernCryptoChunk(chunk: string): any {
  const cryptoStart = chunk.search(/const\s+[A-Za-z_$][\w$]*\s*=[^;]{0,220}\?"\d+":"",\s*[A-Za-z_$][\w$]*=\[/);
  if (cryptoStart < 0) return null;
  const wrapperMatch = [...chunk.slice(0, cryptoStart).matchAll(/const\s+[A-Za-z_$][\w$]*=\(function\(\)\{/g)].at(-1);
  const wrapperStart = wrapperMatch?.index ?? -1;
  const tableMatch = [...chunk.slice(0, wrapperStart).matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(\)\{const\s+[A-Za-z_$][\w$]*=\[/g)].at(-1);
  const tableStart = tableMatch?.index ?? -1;
  const decoderMatch = [...chunk.slice(0, tableStart).matchAll(/function\s+[A-Za-z_$][\w$]*\s*\([A-Za-z_$][\w$]*(?:,[A-Za-z_$][\w$]*)?\)\{return\s+[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*-\d+,[A-Za-z_$][\w$]*\(\)\[[A-Za-z_$][\w$]*\]\}/g)].at(-1);
  const tiStart = decoderMatch?.index ?? -1;
  const asyncStart = chunk.indexOf('async function', cryptoStart);
  if (tiStart < 0 || wrapperStart < 0 || asyncStart < 0) return null;
  const head = chunk.slice(tiStart, wrapperStart);
  let body = chunk.slice(cryptoStart, asyncStart);
  const buildMatch = body.match(/const\s+([A-Za-z_$][\w$]*)=/);
  const maskMatch = body.match(/,([A-Za-z_$][\w$]*)=\[/);
  const maskFunction = body.match(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*=\s*([A-Za-z_$][\w$]*)\)/);
  if (!buildMatch || !maskMatch || !maskFunction) return null;
  const buildName = buildMatch[1];
  const maskName = maskMatch[1];
  const maskFunctionName = maskFunction[1];
  body = body.replace(new RegExp(`const\\s+${buildName}=`), `var ${buildName}=`);
  body = body.replace(new RegExp(`,${maskName}=\\[`), `;var ${maskName}=[`);
  body += `\nreturn { buildId: ${buildName}, maskParts: ${maskName}, mask: Array.from(${maskFunctionName}(${buildName}) || []) };`;
  return normalizeCryptoConfig(Function(head + body)());
}

function evalCryptoChunk(chunk: string): any {
  try { const config = evalFragmentCryptoChunk(chunk); if (config) return config; } catch {}
  try { return evalModernCryptoChunk(chunk); } catch {}
  try { return evalOldCryptoChunk(chunk); } catch {}
  return null;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchText(url: string | URL, headers: Record<string, string> = {}): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await sessionFetch(url.toString(), { signal: ac.signal, headers: { 'Referer': `${REFERER}/`, ...headers } });
    if (!res.ok) throw new Error(`Fetch ${res.status}: ${url}`);
    return res.text();
  } finally { clearTimeout(timer); }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = EXTRACT_TIMEOUT_MS): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: options.signal || ac.signal });
    storeCookies(res.headers);
    return res;
  } finally { clearTimeout(timer); }
}

function appEntryUrl(html: string): string | null {
  const entry = html.match(/(?:import\(|src=)["']([^"']+\/_app\/immutable\/entry\/app\.[^"']+\.js)["']/)?.[1];
  return entry ? new URL(entry, REFERER).toString() : null;
}

async function discoverCryptoConfig(force = false): Promise<any> {
  try {
    const entryUrl = new URL(`${REFERER}/`);
    if (force) entryUrl.searchParams.set('_mkissa', String(Date.now()));
    const html = await fetchText(entryUrl, { 'Accept': 'text/html,*/*', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' });
    const appUrl = appEntryUrl(html);
    if (!appUrl) throw new Error('MKissa app entry not found');
    if (!force && cryptoConfigCache?.appUrl === appUrl) return cryptoConfigCache;
    const app = await fetchText(appUrl, { 'Accept': 'application/javascript,*/*' });
    const queue = [appUrl];
    const seen = new Set<string>();
    while (queue.length && seen.size < DISCOVERY_LIMIT) {
      const batch = queue.splice(0, DISCOVERY_CONCURRENCY).filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });
      const chunks = await Promise.all(batch.map(async (url) => {
        try { return { url, text: url === appUrl ? app : await fetchText(url, { 'Accept': 'application/javascript,*/*' }) }; }
        catch { return null; }
      }));
      for (const item of chunks.filter(Boolean) as Array<{ url: string; text: string }>) {
        const imported = [
          ...item.text.matchAll(/(?:import\(|from\s*)["']([^"']+\.js)["']/g),
          ...item.text.matchAll(/"(\.\.\/(?:chunks|nodes)\/[^"\n]+\.js)"/g),
        ].map((m) => m[1]).filter((value) => value.startsWith('.') || value.startsWith('/'));
        for (const value of imported) {
          const next = new URL(value, item.url).toString();
          if (!seen.has(next)) queue.push(next);
        }
        if (!/client-crypto|x-aa-boot|aaReq|partB/.test(item.text)) continue;
        const config = evalCryptoChunk(item.text);
        if (config) {
          cryptoConfigCache = { ...config, appUrl, sourceUrl: item.url };
          return cryptoConfigCache;
        }
      }
    }
    throw new Error('MKissa crypto chunk not found');
  } catch (error) {
    cryptoConfigCache = null;
    throw error;
  }
}

function episodeQuery(): string {
  return `
query($showId: String! $translationType: VaildTranslationTypeEnumType! $episodeString: String!) {
  episode(showId: $showId translationType: $translationType episodeString: $episodeString) {
    episodeString
    uploadDate
    sourceUrls
    thumbnail
    notes
    show { _id name englishName nativeName slugTime thumbnail type season score airedStart availableEpisodes episodeDuration episodeCount }
    pageStatus { _id notes pageId showId }
    episodeInfo { notes thumbnails vidInforssub uploadDates vidInforsdub vidInforsraw description }
    versionFix
  }
}`;
}

async function discoverEpisodeQuery(force = false): Promise<string> {
  const config = await discoverCryptoConfig(force);
  if (!force && episodeQueryCache?.appUrl === config.appUrl && episodeQueryCache.buildId === config.buildId) return episodeQueryCache.query;
  const inspect = (text: string) => {
    const query = evalEpisodeQueryChunk(text);
    if (query) {
      episodeQueryCache = { appUrl: config.appUrl, buildId: config.buildId, query };
      return query;
    }
    return null;
  };
  if (config.sourceUrl) {
    try { const query = inspect(await fetchText(config.sourceUrl, { 'Accept': 'application/javascript,*/*' })); if (query) return query; } catch {}
  }
  const html = await fetchText(`${REFERER}/`, { 'Accept': 'text/html,*/*', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' });
  const appUrl = appEntryUrl(html);
  if (!appUrl) return episodeQuery();
  const queue = [appUrl];
  const seen = new Set<string>();
  while (queue.length && seen.size < DISCOVERY_LIMIT) {
    const batch = queue.splice(0, DISCOVERY_CONCURRENCY).filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    const chunks = await Promise.all(batch.map(async (url) => {
      try { return { url, text: await fetchText(url, { 'Accept': 'application/javascript,*/*' }) }; }
      catch { return null; }
    }));
    for (const item of chunks.filter(Boolean) as Array<{ url: string; text: string }>) {
      const query = inspect(item.text);
      if (query) return query;
      const imported = [
        ...item.text.matchAll(/(?:import\(|from\s*)["']([^"']+\.js)["']/g),
        ...item.text.matchAll(/["'](\.\.\/(?:chunks|nodes)\/[^"'\n]+\.js)["']/g),
      ].map((match) => match[1]).filter((value) => value.startsWith('.') || value.startsWith('/'));
      for (const value of imported) {
        const next = new URL(value, item.url).toString();
        if (!seen.has(next)) queue.push(next);
      }
    }
  }
  return episodeQuery();
}

// ── Boot token / lane key ────────────────────────────────────────────────────

function buildMaskSeed(buildId: string): Buffer {
  const n = String(buildId || '');
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) out[i] = (n.charCodeAt(i % n.length) || 0) ^ ((i * 17 + 31) & 255);
  return out;
}

function buildMask(config: any): Buffer {
  const { buildId, maskParts } = config;
  if (config.scheme === 'fragments') {
    const salt = Buffer.alloc(32);
    const name = String(buildId || '');
    for (let i = 0; i < salt.length; i++) salt[i] = (name.charCodeAt(i % name.length) || 0) ^ ((i * config.saltMul + config.saltAdd) & 255);
    const out = Buffer.alloc(32);
    for (let i = 0; i < maskParts.length; i++) {
      const part = Buffer.from(maskParts[i], 'base64');
      const offset = i * 8;
      for (let j = 0; j < 8; j++) out[offset + j] = part[j] ^ salt[offset + j] ^ ((i * config.fragMul + j * config.fragAdd) & 255);
    }
    return out;
  }
  const seed = buildMaskSeed(buildId);
  const out = Buffer.alloc(32);
  for (let i = 0; i < maskParts.length; i++) {
    const part = Buffer.from(maskParts[i], 'base64');
    const offset = i * 8;
    for (let j = 0; j < 8; j++) out[offset + j] = (part[j] ^ seed[offset + j]) ^ ((i * 41 + j * 7) & 255);
  }
  return out;
}

function currentEpochs(now = Date.now()): number[] {
  const epoch = Math.floor(now / BOOT_EPOCH_MS);
  const previousGrace = now - epoch * BOOT_EPOCH_MS < BOOT_GRACE_MS && epoch > 0 ? epoch - 1 : epoch;
  return [...new Set([previousGrace, epoch])];
}

function makeBootToken(config: any, epoch: number, lane = CONTENT_LANE): string {
  const mask = buildMask(config);
  const bootKey = hmacBytes(mask, `${config.bootPrefix ?? 'aa-boot:'}${config.buildId}`);
  if (config.scheme !== 'fragments') {
    return hmacBytes(bootKey, `${config.buildId}:${KEY_GROUP}:${REFERER_HOST}:${epoch}:${lane}`).toString('hex');
  }
  const fields: Record<string, string> = { buildId: config.buildId, group: KEY_GROUP, host: REFERER_HOST, epoch: String(epoch), lane: String(lane || '') };
  const parts = config.omitEmptyLane && !fields.lane ? config.parts.filter((part: string) => part !== 'lane') : config.parts;
  return hmacBytes(bootKey, parts.map((part: string) => fields[part] ?? '').join(config.join)).toString('hex');
}

function isUnknownBuildId(raw: string): boolean {
  try { return JSON.parse(raw)?.error === 'unknown_build_id'; } catch { return /unknown_build_id/i.test(raw); }
}

async function fetchBootstrap(lane = CONTENT_LANE, force = false): Promise<any> {
  let lastError: Error | null = null;
  for (let refresh = 0; refresh < 2; refresh++) {
    const config = await discoverCryptoConfig(force || refresh > 0);
    let retryWithFreshEntry = false;
    for (const epoch of currentEpochs()) {
      const res = await sessionFetch(`${API}/client-crypto/v1/bootstrap?buildId=${encodeURIComponent(config.buildId)}&k=${encodeURIComponent(lane)}`, {
        headers: { 'Referer': `${REFERER}/`, 'Origin': REFERER, 'x-build-id': config.buildId, 'x-aa-boot': makeBootToken(config, epoch, lane) },
      });
      const raw = await res.text();
      if (!res.ok) {
        lastError = new Error(`Bootstrap ${res.status}: ${raw.slice(0, 180)}`);
        if (isUnknownBuildId(raw)) { cryptoConfigCache = null; episodeQueryCache = null; retryWithFreshEntry = true; break; }
        continue;
      }
      const data = JSON.parse(raw);
      if (!data?.partB) { lastError = new Error('Bootstrap missing partB'); continue; }
      return { ...data, ...config, lane, buildId: config.buildId };
    }
    if (!retryWithFreshEntry) break;
  }
  throw lastError || new Error('MKissa bootstrap failed');
}

function deriveLaneKey(partB: string, config: any): Buffer {
  const encrypted = Buffer.from(partB, 'base64');
  const mask = buildMask(config);
  const key = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) key[i] = encrypted[i] ^ mask[i % mask.length];
  return key;
}

async function getLaneKey(lane = CONTENT_LANE, force = false): Promise<{ key: Buffer; epoch: number; buildId: string }> {
  const boot = await fetchBootstrap(lane, force);
  return { key: deriveLaneKey(boot.partB, boot), epoch: boot.epoch, buildId: boot.buildId };
}

function makeAaReq(key: Buffer, epoch: number, buildId: string, queryHash: string, lane = CONTENT_LANE): string {
  const ts = Math.floor(Date.now() / AA_REQ_MS) * AA_REQ_MS;
  const payload = Buffer.from(JSON.stringify({ v: 1, ts, epoch, buildId, qh: queryHash, k: lane }));
  const iv = crypto.createHash('sha256').update(`${epoch}:${buildId}:${queryHash}:${ts}:${lane}`).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from([1]), iv, body]).toString('base64');
}

function decryptTobeparsed(b64: string, key: Buffer): any {
  const buf = Buffer.from(b64, 'base64');
  const version = buf[0];
  if (version !== 1) throw new Error(`Unsupported MKissa encryption version: ${version}`);
  const iv = buf.subarray(1, 13);
  const body = buf.subarray(13);
  const ct = body.subarray(0, body.length - 16);
  const tag = body.subarray(body.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
}

// ── GraphQL API ──────────────────────────────────────────────────────────────

async function apiPost(query: string, variables: any, options: any = {}): Promise<any> {
  const config = options.buildId ? options : await discoverCryptoConfig();
  const body = options.extensions ? { query, variables, extensions: options.extensions } : { query, variables };
  const res = await apiSessionFetch(API_URL, {
    method: 'POST',
    headers: apiHeaders(config.buildId, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const raw = await res.text();
  if (!res.ok) { const err = new Error(`API POST ${res.status}`) as any; err.rawBody = raw; throw err; }
  const json = JSON.parse(raw);
  if (json.errors?.length) {
    const messages = json.errors.map((e: any) => e.message || e.extensions?.code || 'GraphQL error');
    const err = new Error(messages.join(' · ')) as any;
    if (messages.includes('NEED_CAPTCHA')) err.code = 'NEED_CAPTCHA';
    err.rawBody = raw; err.graphql = json; throw err;
  }
  return json.data;
}

async function apiEpisode(query: string, variables: any, options: any = {}): Promise<any> {
  const { force = false, captchaRetry = 0, captcha = null, postFallback = false } = options;
  const hash = sha256Hex(query);
  const { key, epoch, buildId } = await getLaneKey(CONTENT_LANE, force);
  const extensions: any = { persistedQuery: { version: 1, sha256Hash: hash }, k: CONTENT_LANE, aaReq: makeAaReq(key, epoch, buildId, hash, CONTENT_LANE) };
  if (captcha) extensions.captcha = captcha;
  if (captcha) {
    const posted = await apiPost(query, variables, { buildId, extensions });
    return posted?.tobeparsed ? decryptTobeparsed(posted.tobeparsed, key) : posted;
  }
  const url = `${API_URL}?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;
  const res = await apiSessionFetch(url, { headers: apiHeaders(buildId), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const raw = await res.text();
  if (!res.ok) { const err = new Error(`API ${res.status}`) as any; err.rawBody = raw; throw err; }
  const json = JSON.parse(raw);
  const messages = json.errors?.map((e: any) => e.message || e.extensions?.code).filter(Boolean) || [];
  if (messages.includes('PersistedQueryNotFound') || messages.some((m: string) => /Context creation failed/i.test(m))) {
    const posted = await apiPost(query, variables, { buildId, extensions });
    return posted?.tobeparsed ? decryptTobeparsed(posted.tobeparsed, key) : posted;
  }
  if (messages.includes('NEED_CAPTCHA')) {
    if (!postFallback) {
      try {
        const postHash = sha256Hex(query);
        const postExtensions = { persistedQuery: { version: 1, sha256Hash: postHash }, k: CONTENT_LANE, aaReq: makeAaReq(key, epoch, buildId, postHash, CONTENT_LANE) };
        const posted = await apiPost(query, variables, { buildId, extensions: postExtensions });
        return posted?.tobeparsed ? decryptTobeparsed(posted.tobeparsed, key) : posted;
      } catch (err: any) { if (err.code !== 'NEED_CAPTCHA') throw err; }
    }
    if (captchaRetry < 5) {
      await sleep(1500 + captchaRetry * 1200);
      return apiEpisode(query, variables, { force: true, captchaRetry: captchaRetry + 1, postFallback: true });
    }
    const err = new Error('MKissa requested captcha') as any;
    err.code = 'NEED_CAPTCHA'; err.rawBody = raw; throw err;
  }
  if (messages.some((m: string) => /^AA_CRYPTO_/.test(m))) {
    if (!force) return apiEpisode(query, variables, { force: true, captchaRetry, captcha, postFallback });
    const err = new Error(messages.join(' · ')) as any; err.rawBody = raw; throw err;
  }
  if (json.data?.tobeparsed) return decryptTobeparsed(json.data.tobeparsed, key);
  if (messages.length) { const err = new Error(messages.join(' · ')) as any; err.rawBody = raw; throw err; }
  return json.data;
}

// ── Search / resolve ─────────────────────────────────────────────────────────

async function searchMkissa(query: string, mode = 'sub'): Promise<any[]> {
  // The search query is a plain GraphQL POST — it does NOT require the crypto
  // handshake (bootstrap/lane-key). Only apiEpisode needs that. Using a simple
  // fetch here avoids the ~48s crypto discovery on every search.
  const gql = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){edges{_id name englishName nativeName slugTime availableEpisodes availableEpisodesDetail aniListId __typename}}}`;
  try {
    const res = await fetch(`${API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': `${REFERER}/`,
        'Origin': REFERER,
        'User-Agent': UA,
        'x-build-id': 'search',
        'Accept': 'application/json, text/plain, */*',
      },
      body: JSON.stringify({
        query: gql,
        variables: { search: { allowAdult: false, allowUnknown: false, query }, limit: 40, page: 1, translationType: mode, countryOrigin: 'ALL' },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = await res.json() as any;
    if (json.errors?.length) return [];
    return json?.data?.shows?.edges ?? [];
  } catch {
    return [];
  }
}

function extractYear(title: string): number | null {
  if (!title) return null;
  const m = title.match(/\b(19\d{2}|20\d{2})\b/);
  return m ? parseInt(m[1]) : null;
}

function titleIdentityScore(titles: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normC = candidate.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    for (const title of titles) {
      if (!title) continue;
      const normT = title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      if (normT === normC) return 1;
      if (normT.includes(normC) || normC.includes(normT)) return 0.7;
    }
  }
  return 0;
}

function findBestMatch(results: any[], titles: string[], targetYear: number | null, targetId: number): any {
  const scored: Array<{ show: any; score: number }> = [];
  for (const r of results) {
    if (targetId && r.aniListId && String(r.aniListId) === String(targetId)) return r;
    const titleScore = titleIdentityScore(titles, [r.name, r.englishName, r.nativeName]);
    if (titleScore < 0.62) continue;
    const rYear = extractYear(r.name) || extractYear(r.englishName) || extractYear(r.nativeName);
    const yearAdj = targetYear && rYear ? (rYear === targetYear ? 0.08 : -0.08) : 0;
    scored.push({ show: r, score: titleScore + yearAdj });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < 0.62 || (runnerUp && best.score - runnerUp.score < 0.06)) throw new Error('MKissa title match is ambiguous');
  return best.show;
}

function buildTitleSearchQueries(titles: string[], max = 16): string[] {
  const queries = new Set<string>();
  for (const title of titles) {
    if (!title?.trim()) continue;
    queries.add(title.trim());
    queries.add(title.trim().replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return Array.from(queries).slice(0, max);
}

async function resolveMkissaId(anilistId: number): Promise<{ showId: string; show: any }> {
  const [anizipRes, alMedia] = await Promise.all([
    fetch(`${ANIZIP}?anilist_id=${anilistId}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    getAniListMedia(anilistId).catch(() => null),
  ]);
  const anizip: any = anizipRes || {};
  let titlesToTry = [...new Set([
    ...[alMedia?.title?.english, alMedia?.title?.romaji, alMedia?.title?.native].filter(Boolean),
    ...Object.values(anizip.titles || {}).filter(Boolean),
  ] as string[])];
  if (!titlesToTry.length && anizip.mappings?.animeplanet_id) {
    titlesToTry = [(anizip.mappings.animeplanet_id as string).split(/[-_]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')];
  }
  if (!titlesToTry.length) throw new Error(`Could not resolve titles for AniList ID: ${anilistId}`);
  const targetYear = alMedia?.seasonYear || alMedia?.startDate?.year || null;
  const queries = buildTitleSearchQueries(titlesToTry, 16);
  const resultMap = new Map<string, any>();
  for (let index = 0; index < queries.length; index += 4) {
    const batches = await Promise.all(queries.slice(index, index + 4).map((query) => searchMkissa(query, 'sub').catch(() => [])));
    for (const results of batches) {
      for (const result of results) {
        if (result?._id && !resultMap.has(result._id)) resultMap.set(result._id, result);
      }
    }
  }
  const allResults = [...resultMap.values()];
  if (!allResults.length) throw new Error(`No MKissa match for "${titlesToTry[0]}"`);
  const match = findBestMatch(allResults, titlesToTry, targetYear, anilistId);
  return { showId: match._id, show: match };
}

// ── Source extraction ────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function aesDecrypt(hex: string): Promise<string> {
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from('kiemtienmua911ca'), Buffer.from('1234567890oiuytr'));
  return Buffer.concat([decipher.update(Buffer.from(hexToBytes(hex))), decipher.final()]).toString('utf8');
}

async function extractMp4(id: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(`https://www.mp4upload.com/embed-${id}.html`, { headers: { 'User-Agent': UA, Referer: 'https://mp4upload.com/' } });
    if (!r.ok) return null;
    const h = await r.text();
    const m = h.match(/player\.src\s*\(\s*\{[^}]*\bsrc\s*:\s*"([^"]+)"/) || h.match(/"file"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/) || h.match(/\bsrc\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/);
    return m?.[1]?.replace(/\\/g, '') || null;
  } catch { return null; }
}

async function extractUns(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    const id = parsed.hash.replace(/^#/, '').split('&')[0];
    if (!id) return null;
    const base = `${parsed.protocol}//${parsed.host}`;
    const r = await fetchWithTimeout(`${base}/api/v1/video?id=${encodeURIComponent(id)}&w=1280&h=720&r=`, { headers: { 'User-Agent': UA, Referer: `${base}/#${id}`, Origin: base } });
    if (!r.ok) return null;
    const hex = (await r.text()).trim();
    if (!hex || !/^[0-9a-f]+$/i.test(hex)) return null;
    const data = JSON.parse(await aesDecrypt(hex));
    return data?.source || data?.cf || null;
  } catch { return null; }
}

async function extractOk(id: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(`https://ok.ru/videoembed/${id}`, { headers: { 'User-Agent': UA, Referer: 'https://ok.ru/' } });
    if (!r.ok) return null;
    const h = await r.text();
    const m = h.match(/ondemandHls\\&quot;:\\&quot;(https?:\/\/.*?)\\&quot;/);
    return m?.[1]?.replace(/\\u0026/g, '&') || null;
  } catch { return null; }
}

async function extractStreamSB(id: string): Promise<string | null> {
  try {
    const baseHeaders = { 'User-Agent': UA, 'Referer': `${REFERER}/`, 'watchsb': 'streamsb', 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9' };
    const r1 = await fetchWithTimeout(`https://streamsb.net/api/v1/video?id=${id}`, { headers: baseHeaders });
    const sid = (r1.headers.get('set-cookie') || '').match(/sid=([^;]+)/)?.[1] ?? '';
    const html = await r1.text();
    const m = html.match(/window\.location\.replace\('([^']+)'\)/);
    if (!m) return null;
    const r2 = await fetchWithTimeout(m[1], { headers: { ...baseHeaders, Cookie: `sid=${sid}`, Referer: `https://streamsb.net/e/${id}.html` } });
    if (!r2.ok) return null;
    const ct = r2.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null;
    const data = await r2.json() as any;
    return data?.stream_data?.file ?? data?.data?.file ?? null;
  } catch { return null; }
}

async function extractStreamlare(id: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout('https://streamlare.com/api/video/stream/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://streamlare.com/', 'Origin': 'https://streamlare.com', 'Accept': 'application/json, */*' },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) return null;
    const data = await r.json() as any;
    return data?.data?.file ?? null;
  } catch { return null; }
}

async function extractClock(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    const clockUrl = parsed.pathname.includes('/clock.json') ? url : url.replace('/clock', '/clock.json');
    const r = await fetchWithTimeout(clockUrl, {
      headers: {
        'User-Agent': UA, 'Referer': 'https://allanime.day/player.html',
        'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
      },
    });
    if (!r.ok) return null;
    const data = await r.json() as any;
    const links = Array.isArray(data?.links) ? data.links : [];
    const best = links.find((item: any) => item?.hls && item?.link) || links.find((item: any) => item?.link);
    return best?.link || null;
  } catch { return null; }
}

function embedMediaType(url: string): string | null {
  if (!url) return null;
  if (url.includes('.m3u8')) return 'hls';
  if (url.includes('.mp4')) return 'mp4';
  return 'direct';
}

async function extractSource(src: any): Promise<any> {
  let url = src.sourceUrl;
  if (url && url.startsWith('--')) url = decodeHexUrl(url.slice(2));
  if (url && url.startsWith('/apivtwo/clock')) url = 'https://allanime.day' + url.replace('/clock', '/clock.json');
  if (url && /^https?:\/\/allanime\.day\/apivtwo\/clock(?:\.json)?/i.test(url)) url = url.replace('/clock?', '/clock.json?');
  let extractedUrl: string | null = null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'allanime.day' && /\/apivtwo\/clock(?:\.json)?/i.test(new URL(url).pathname)) {
      extractedUrl = await extractClock(url);
    } else if (src.type === 'player') extractedUrl = url;
    else if (host === 'mp4upload.com') {
      const m = url.match(/embed-([a-zA-Z0-9]+)\.html/i);
      if (m?.[1]) extractedUrl = await extractMp4(m[1]);
    } else if (/uns\.bio$/i.test(host)) {
      extractedUrl = await extractUns(url);
    } else if (host === 'ok.ru') {
      const m = url.match(/\/(?:videoembed\/)?(\d+)(?:[/?#]|$)/i);
      if (m?.[1]) extractedUrl = await extractOk(m[1]);
    } else if (/streamsb\./i.test(host)) {
      const m = url.match(/\/(?:e\/|embed-)([a-zA-Z0-9]+)(?:\.html)?/i);
      if (m?.[1]) extractedUrl = await extractStreamSB(m[1]);
    } else if (/streamlare\./i.test(host)) {
      const m = url.match(/\/e\/([a-zA-Z0-9]+)/i);
      if (m?.[1]) extractedUrl = await extractStreamlare(m[1]);
    }
  } catch {}
  return {
    name: src.sourceName || '', url, extractedUrl, extractedType: embedMediaType(extractedUrl),
    type: src.type, priority: src.priority, headers: { 'Referer': REFERER, 'User-Agent': UA }, downloads: src.downloads || null,
  };
}

// ── Public provider functions ────────────────────────────────────────────────

export async function getMkissaStreams(input: AnimeProviderInput): Promise<RawStream[]> {
  try {
    const { showId, show } = await resolveMkissaId(input.anilist_id);
    // Warm the watch page to establish session cookies
    const slug = show?.slugTime || String(show?.englishName || show?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (slug && showId) {
      try {
        await fetchWithTimeout(`${REFERER}/anime/${slug}-${showId}/${input.dub ? 'dub' : 'sub'}/${input.episode}`, {
          headers: browserHeaders({ 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Referer': `${REFERER}/`, 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1', 'Upgrade-Insecure-Requests': '1' }),
        }, FETCH_TIMEOUT_MS);
      } catch {}
    }
    const query = await discoverEpisodeQuery();
    const data = await apiEpisode(query, { showId, translationType: input.dub ? 'dub' : 'sub', episodeString: String(input.episode) });
    const episode = data?.episode ?? null;
    if (!episode) return [];

    const sources = await Promise.all((episode.sourceUrls || []).map(extractSource));
    const streams: RawStream[] = [];
    for (const src of sources) {
      const playUrl = src.extractedUrl || src.url;
      if (!playUrl || !isSafeHttpUrl(playUrl)) continue;
      const format = detectFormat(playUrl, embedMediaType(playUrl) || 'hls') as 'hls' | 'mp4' | 'dash';
      streams.push({
        url: playUrl,
        format,
        quality: normalizeQuality('1080p'),
        audio: input.dub ? 'Dub' : 'Original',
        provider: 'mkissa',
        headers: { 'Referer': REFERER, 'User-Agent': UA },
      });
    }
    return streams;
  } catch (error) {
    console.error(`MKissa error: ${String(error)}`);
    return [];
  }
}

export async function getMkissaDownloads(input: MovieProviderInput | TvProviderInput, _tmdbApiKey: string): Promise<RawDownload[]> {
  // MKissa is an anime streaming provider; download support is not available via the GraphQL API.
  return [];
}