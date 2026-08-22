import { neon } from '@neondatabase/serverless';
import type { Env } from './types/env.js';

export type LogService = 'metadata' | 'providers';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ArchivedLog {
  service: LogService;
  date: string;
  path: string;
  size: number;
  updated_at: string;
}

export interface ArchivedLogPage {
  logs: ArchivedLog[];
  total: number;
}

function sqlFor(env: Env) {
  return neon(env.NEON_DATABASE_URL);
}

function validService(value: string): value is LogService {
  return value === 'metadata' || value === 'providers';
}

function archivePath(service: LogService, date: string): string {
  const [year, month] = date.split('-');
  return `${service}/${year}/${month}/${date}.log`;
}

export async function appendLogLine(env: Env, service: LogService, date: string, line: string): Promise<void> {
  const sql = sqlFor(env);
  await sql`
    INSERT INTO log_archives (service, log_date, content)
    VALUES (${service}, ${date}::date, ${line})
    ON CONFLICT (service, log_date) DO UPDATE
      SET content = CASE
        WHEN log_archives.content = '' THEN EXCLUDED.content
        ELSE log_archives.content || E'\\n' || EXCLUDED.content
      END,
      updated_at = now()
  `;
}

export async function replaceLogArchive(
  env: Env,
  service: LogService,
  date: string,
  content: string,
): Promise<void> {
  const sql = sqlFor(env);
  await sql`
    INSERT INTO log_archives (service, log_date, content)
    VALUES (${service}, ${date}::date, ${content})
    ON CONFLICT (service, log_date) DO UPDATE
      SET content = EXCLUDED.content,
          updated_at = now()
  `;
}

export async function listLogArchives(
  env: Env,
  filters: { service?: string; from?: string; to?: string; page?: number; limit?: number },
): Promise<ArchivedLogPage> {
  const sql = sqlFor(env);
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(filters.limit ?? 100)));
  const offset = (page - 1) * limit;
  const rows = filters.service && validService(filters.service)
    ? await sql`
        SELECT service, log_date::text AS date, octet_length(content)::int AS size, updated_at::text AS updated_at, COUNT(*) OVER()::int AS total
        FROM log_archives
        WHERE service = ${filters.service}
          AND (${filters.from ?? null}::date IS NULL OR log_date >= ${filters.from ?? null}::date)
          AND (${filters.to ?? null}::date IS NULL OR log_date <= ${filters.to ?? null}::date)
        ORDER BY log_date DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    : await sql`
        SELECT service, log_date::text AS date, octet_length(content)::int AS size, updated_at::text AS updated_at, COUNT(*) OVER()::int AS total
        FROM log_archives
        WHERE (${filters.from ?? null}::date IS NULL OR log_date >= ${filters.from ?? null}::date)
          AND (${filters.to ?? null}::date IS NULL OR log_date <= ${filters.to ?? null}::date)
        ORDER BY log_date DESC, service ASC
        LIMIT ${limit} OFFSET ${offset}
      `;

  return {
    logs: rows.map((row: any) => ({
      service: row.service as LogService,
      date: String(row.date),
      path: archivePath(row.service as LogService, String(row.date)),
      size: Number(row.size ?? 0),
      updated_at: String(row.updated_at),
    })),
    total: Number((rows[0] as any)?.total ?? 0),
  };
}

export async function readLogArchive(
  env: Env,
  service: string,
  date: string,
  filters: { level?: string; namespace?: string } = {},
): Promise<string | null> {
  if (!validService(service)) return null;
  const sql = sqlFor(env);
  const rows = await sql`
    SELECT content
    FROM log_archives
    WHERE service = ${service} AND log_date = ${date}::date
    LIMIT 1
  `;
  if (!rows.length) return null;

  let lines = String((rows[0] as any).content ?? '').split('\n');
  if (filters.level) {
    const tag = `[${filters.level.toUpperCase().padEnd(5)}]`;
    lines = lines.filter((line) => line.includes(tag));
  }
  if (filters.namespace) {
    lines = lines.filter((line) => line.includes(`[${filters.namespace}]`));
  }
  return lines.join('\n');
}
