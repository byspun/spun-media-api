import { createLogger, type LogLevel } from '../../logs/logger.js';
import { appendLogLine } from './log-archive.js';
import type { Env } from './types/env.js';

export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function metadataLogger(env: Env, ctx?: WaitUntilContext) {
  return createLogger({
    service: 'metadata',
    onLine: (line) => {
      if (!ctx || !env.NEON_DATABASE_URL) return;
      ctx.waitUntil(
        appendLogLine(env, 'metadata', line.slice(1, 11), line).catch(() => undefined),
      );
    },
  });
}

export function logMetadata(
  env: Env,
  ctx: WaitUntilContext | undefined,
  level: LogLevel,
  namespace: string,
  message: string,
  data?: unknown,
): void {
  metadataLogger(env, ctx)[level](namespace, message, data);
}
