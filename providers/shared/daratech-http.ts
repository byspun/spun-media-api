import { fetchWithRetry, type FetchOptions } from './http.js';

function responseShape(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload)) return { body_type: 'array', body_length: payload.length };
  if (payload && typeof payload === 'object') {
    const object = payload as Record<string, unknown>;
    const items = Array.isArray(object.items) ? object.items : Array.isArray(object.results) ? object.results : null;
    const qualities = Array.isArray(object.qualities) ? object.qualities : null;
    return {
      body_type: 'object',
      top_keys: Object.keys(object).slice(0, 20),
      item_count: items?.length ?? null,
      quality_count: qualities?.length ?? null,
    };
  }
  return { body_type: payload === null ? 'null' : typeof payload };
}

export async function fetchDaratechJson<T>(url: string, operation: string, options: FetchOptions = {}): Promise<T | null> {
  let path = '[invalid-url]';
  try { path = new URL(url).pathname; } catch { /* keep redacted fallback */ }
  try {
    const response = await fetchWithRetry(url, options);
    const text = await response.text();
    let payload: unknown = null;
    try { payload = JSON.parse(text); } catch { /* retain response-shape diagnostic */ }
    console.warn('[daratech-upstream]', { operation, path, status: response.status, ok: response.ok, ...responseShape(payload), text_bytes: text.length });
    if (!response.ok) return null;
    return payload as T;
  } catch (error) {
    console.warn('[daratech-upstream-error]', { operation, path, error: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}
