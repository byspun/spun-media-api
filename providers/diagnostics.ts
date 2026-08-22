import { fetchWithRetry, findBestMatch } from './shared/http.js';

export type DiagnosticConfig = {
  daratechBase: string;
  daratechKey: string;
};

export type DiagnosticStep = {
  operation: string;
  upstream_path: string;
  status: number | null;
  ok: boolean;
  elapsed_ms: number;
  response_headers?: Record<string, string>;
  response_bytes?: number;
  response_body?: string;
  response_shape?: Record<string, unknown>;
  error?: string;
  payload?: unknown;
};

export function redactDiagnosticText(value: string, config: DiagnosticConfig): string {
  let redacted = value;
  if (config.daratechKey) redacted = redacted.split(config.daratechKey).join('[redacted-secret]');
  return redacted
    .replace(/(authorization\s*[:=]\s*)([^,\s}]+)/gi, '$1[redacted]')
    .replace(/([?&](?:api[-_]?key|token|secret|authorization)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 8000);
}

export function diagnosticResponseShape(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload)) return { body_type: 'array', body_length: payload.length };
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    const items = Array.isArray(body.items) ? body.items : Array.isArray(body.results) ? body.results : null;
    const qualities = Array.isArray(body.qualities) ? body.qualities : null;
    return {
      body_type: 'object',
      top_keys: Object.keys(body).slice(0, 30),
      item_count: items?.length ?? null,
      quality_count: qualities?.length ?? null,
    };
  }
  return { body_type: payload === null ? 'null' : typeof payload };
}

export async function diagnosticFetch(
  url: string,
  operation: string,
  headers: Record<string, string>,
  timeout: number,
  config: DiagnosticConfig,
): Promise<DiagnosticStep> {
  const started = Date.now();
  let upstreamPath = '[invalid-url]';
  try {
    const parsed = new URL(url);
    upstreamPath = `${parsed.pathname}${parsed.search}`;
  } catch {
    // Keep the redacted fallback path.
  }

  try {
    const response = await fetchWithRetry(url, { headers, timeout, retries: 0 });
    const rawBody = await response.text();
    const responseBody = redactDiagnosticText(rawBody, config);
    let payload: unknown = null;
    try { payload = JSON.parse(rawBody); } catch { /* preserve non-JSON output below */ }
    const responseHeaders: Record<string, string> = {};
    for (const name of ['content-type', 'server', 'www-authenticate', 'retry-after', 'cf-ray']) {
      const value = response.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    return {
      operation,
      upstream_path: upstreamPath,
      status: response.status,
      ok: response.ok,
      elapsed_ms: Date.now() - started,
      response_headers: responseHeaders,
      response_bytes: rawBody.length,
      response_body: response.ok ? undefined : responseBody,
      response_shape: diagnosticResponseShape(payload),
      payload,
    };
  } catch (error) {
    return {
      operation,
      upstream_path: upstreamPath,
      status: null,
      ok: false,
      elapsed_ms: Date.now() - started,
      error: redactDiagnosticText(String(error instanceof Error ? error.message : error), config),
      payload: null,
    };
  }
}

export function publicDiagnosticStep(step: DiagnosticStep): Omit<DiagnosticStep, 'payload'> {
  const { payload: _payload, ...publicStep } = step;
  return publicStep;
}

export async function runDaratechDiagnostic(type: 'movie' | 'tv', query: any, config: DiagnosticConfig) {
  const title = String(query.title ?? '').trim();
  const year = query.year !== undefined && query.year !== '' ? Number(query.year) : null;
  const season = type === 'tv' ? Number(query.season ?? 1) : null;
  const episode = type === 'tv' ? Number(query.episode ?? 1) : null;
  const headers = { Authorization: `Bearer ${config.daratechKey}`, Accept: 'application/json' };
  const base = config.daratechBase.replace(/\/$/, '');
  const searchUrl = type === 'movie'
    ? `${base}/search/movies?q=${encodeURIComponent(title)}`
    : `${base}/search/tvshows?q=${encodeURIComponent(title)}`;
  const search = await diagnosticFetch(searchUrl, `${type}-search`, headers, 15_000, config);
  const searchPayload = search.payload as any;
  const items = Array.isArray(searchPayload?.items) ? searchPayload.items : Array.isArray(searchPayload?.results) ? searchPayload.results : [];
  const candidates = items.map((item: any) => ({ title: String(item.title ?? ''), year: Number(item.year) || null }));
  const index = findBestMatch(candidates, { title, year }, 40);
  const matched = index >= 0 ? items[index] : null;
  const subjectId = matched?.subjectId ?? matched?.id ?? null;
  const result: Record<string, unknown> = {
    provider: 'daratech',
    type,
    request: { title, year, ...(type === 'tv' ? { season, episode } : {}) },
    search: {
      candidate_count: items.length,
      matched: Boolean(matched),
      selected: matched ? { subject_id: String(subjectId), title: String(matched.title ?? ''), year: Number(matched.year) || null } : null,
    },
    steps: [publicDiagnosticStep(search)],
  };
  if (!search.ok || !subjectId) {
    result.outcome = search.ok ? 'no_match' : 'upstream_error';
    return result;
  }
  const playbackUrl = type === 'movie'
    ? `${base}/movies/${encodeURIComponent(String(subjectId))}/stream`
    : `${base}/tvshows/${encodeURIComponent(String(subjectId))}/season/${season}/episode/${episode}/stream`;
  const playback = await diagnosticFetch(playbackUrl, `${type}-playback`, headers, 20_000, config);
  result.outcome = playback.ok ? 'upstream_ok' : 'upstream_error';
  result.steps = [publicDiagnosticStep(search), publicDiagnosticStep(playback)];
  return result;
}
