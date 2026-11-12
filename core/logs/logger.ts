export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogService = 'metadata' | 'providers';

export interface LogEvent {
  service: LogService;
  namespace: string;
  level: LogLevel;
  message: string;
  line: string;
  occurredAt: string;
}

export interface LoggerOptions {
  service: LogService;
  minLevel?: LogLevel;
  onLine?: (line: string, event: LogEvent) => void;
  omitService?: boolean;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function configuredLevel(): LogLevel {
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = String(processEnv?.LOG_LEVEL ?? '').toLowerCase();
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info';
}

function stringifySafe(value: unknown): string {
  if (value === undefined) return '';
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return '[unserializable-data]';
  }
}

export function redactLogText(input: string): string {
  return input
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]')
    .replace(/(x-(?:spun|admin|diagnostic|log-upload)-key\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]')
    .replace(/([?&](?:t|token|key|secret|api_key|apikey)=)([^&\s]+)/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s]+/g, (url) => {
      if (/[?&](?:t|token|key|secret|api_key|apikey)=/i.test(url)) return '[upstream-url-redacted]';
      return url;
    });
}

/**
 * Deduplicate console logs: collapse identical messages within DEDUPE_WINDOW_MS.
 * File logs (via onLine) are NOT deduplicated — they remain the complete audit trail.
 */
const dedupeCache = new Map<string, { count: number; firstSeen: number }>();
const DEDUPE_WINDOW_MS = 10000;

function dedupeMessage(message: string): { message: string; isDuplicate: boolean } {
  const now = Date.now();
  const entry = dedupeCache.get(message);
  if (!entry) {
    dedupeCache.set(message, { count: 1, firstSeen: now });
    return { message, isDuplicate: false };
  }
  if (now - entry.firstSeen > DEDUPE_WINDOW_MS) {
    dedupeCache.set(message, { count: 1, firstSeen: now });
    return { message, isDuplicate: false };
  }
  entry.count += 1;
  if (entry.count === 2) {
    return { message: `×2 duplicate: ${message}`, isDuplicate: false };
  }
  // Suppress 3rd+ duplicates entirely
  return { message, isDuplicate: true };
}

function cleanupDedupeCache(): void {
  const now = Date.now();
  for (const [key, entry] of dedupeCache.entries()) {
    if (now - entry.firstSeen > DEDUPE_WINDOW_MS * 2) {
      dedupeCache.delete(key);
    }
  }
}
// Cleanup stale entries every minute.
setInterval(cleanupDedupeCache, 60000);

export function formatLogLine(
  service: LogService,
  namespace: string,
  level: LogLevel,
  message: string,
  occurredAt = new Date().toISOString(),
  omitService = false,
): string {
  const paddedLevel = level.toUpperCase().padEnd(5);
  const deduped = dedupeMessage(message);
  if (deduped.isDuplicate) {
    return ''; // Signal to skip logging
  }
  return omitService
    ? `[${occurredAt}] [${namespace}] [${paddedLevel}] ${deduped.message}`
    : `[${occurredAt}] [${service}] [${namespace}] [${paddedLevel}] ${deduped.message}`;
}

export function createLogger(options: LoggerOptions) {
  const minimum = options.minLevel ?? configuredLevel();

  function write(level: LogLevel, namespace: string, message: string, data?: unknown): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minimum]) return;

    const suffix = data === undefined ? '' : ` ${stringifySafe(data)}`;
    const occurredAt = new Date().toISOString();
    const fullMessage = `${message}${suffix}`;
    const line = formatLogLine(options.service, namespace, level, fullMessage, occurredAt, options.omitService);

    // Skip if deduped (empty string returned)
    if (!line) return;

    const event: LogEvent = {
      service: options.service,
      namespace,
      level,
      message: redactLogText(fullMessage),
      line: redactLogText(line),
      occurredAt,
    };

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    // onLine writes to file — store the original non-deduplicated line for the complete audit trail.
    options.onLine?.(line, event);
  }

  return {
    debug: (namespace: string, message: string, data?: unknown) => write('debug', namespace, message, data),
    info: (namespace: string, message: string, data?: unknown) => write('info', namespace, message, data),
    warn: (namespace: string, message: string, data?: unknown) => write('warn', namespace, message, data),
    error: (namespace: string, message: string, data?: unknown) => write('error', namespace, message, data),
  };
}
