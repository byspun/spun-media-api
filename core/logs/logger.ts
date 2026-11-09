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

export function formatLogLine(
  service: LogService,
  namespace: string,
  level: LogLevel,
  message: string,
  occurredAt = new Date().toISOString(),
): string {
  const paddedLevel = level.toUpperCase().padEnd(5);
  return `[${occurredAt}] [${service}] [${namespace}] [${paddedLevel}] ${redactLogText(message)}`;
}

export function createLogger(options: LoggerOptions) {
  const minimum = options.minLevel ?? configuredLevel();

  function write(level: LogLevel, namespace: string, message: string, data?: unknown): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minimum]) return;

    const suffix = data === undefined ? '' : ` ${stringifySafe(data)}`;
    const occurredAt = new Date().toISOString();
    const line = formatLogLine(options.service, namespace, level, `${message}${suffix}`, occurredAt);
    const event: LogEvent = {
      service: options.service,
      namespace,
      level,
      message: redactLogText(`${message}${suffix}`),
      line,
      occurredAt,
    };

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    options.onLine?.(line, event);
  }

  return {
    debug: (namespace: string, message: string, data?: unknown) => write('debug', namespace, message, data),
    info: (namespace: string, message: string, data?: unknown) => write('info', namespace, message, data),
    warn: (namespace: string, message: string, data?: unknown) => write('warn', namespace, message, data),
    error: (namespace: string, message: string, data?: unknown) => write('error', namespace, message, data),
  };
}
