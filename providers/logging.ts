import fs from 'node:fs';
import path from 'node:path';
import { createLogger, type LogLevel } from '../logs/logger.js';

const service = 'providers' as const;
const logsDir = path.resolve(process.cwd(), '../logs/providers');
const uploadUrl = process.env.LOG_UPLOAD_URL ?? 'https://media.byspun.xyz/v1/admin/logs/upload';
const uploadKey = process.env.LOG_UPLOAD_KEY ?? process.env.X_SPUN_SECRET ?? '';
const checkpointMs = Number(process.env.LOG_UPLOAD_INTERVAL_MS ?? 900_000);

let currentDate = new Date().toISOString().slice(0, 10);
let currentStream: fs.WriteStream | null = null;
let uploadTimer: NodeJS.Timeout | null = null;

function filePath(date = currentDate): string {
  return path.join(logsDir, `${date}.log`);
}

function ensureStream(): fs.WriteStream {
  fs.mkdirSync(logsDir, { recursive: true });
  if (!currentStream) {
    currentStream = fs.createWriteStream(filePath(), { flags: 'a' });
  }
  return currentStream;
}

function rotateIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today === currentDate) return;
  currentStream?.end();
  currentStream = null;
  const previous = currentDate;
  currentDate = today;
  void uploadLog(previous);
  ensureStream();
}

function writeLine(line: string): void {
  try {
    rotateIfNeeded();
    ensureStream().write(`${line}\n`);
  } catch {
    // Logging must never crash the provider service.
  }
}

async function uploadLog(date: string): Promise<void> {
  if (!uploadKey || !fs.existsSync(filePath(date))) return;
  try {
    const content = fs.readFileSync(filePath(date), 'utf8');
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Log-Upload-Key': uploadKey,
      },
      body: JSON.stringify({ service, date, content }),
    });
    if (!response.ok) {
      console.error(`[${new Date().toISOString()}] [providers] [logs] [WARN ] Archive upload failed with HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [providers] [logs] [WARN ] Archive upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const providerLogger = createLogger({
  service,
  onLine: (line) => writeLine(line),
});

export function startProviderLogArchiver(): void {
  ensureStream();
  if (uploadTimer) return;
  uploadTimer = setInterval(() => {
    void uploadLog(currentDate);
  }, Number.isFinite(checkpointMs) && checkpointMs >= 60_000 ? checkpointMs : 900_000);
  uploadTimer.unref?.();
}

export async function flushProviderLogs(): Promise<{ service: string; date: string; uploaded: boolean }> {
  currentStream?.end();
  currentStream = null;
  const date = currentDate;
  const before = fs.existsSync(filePath(date));
  await uploadLog(date);
  ensureStream();
  return { service, date, uploaded: Boolean(uploadKey && before) };
}

export function stopProviderLogArchiver(): void {
  if (uploadTimer) clearInterval(uploadTimer);
  uploadTimer = null;
  currentStream?.end();
  currentStream = null;
}

export function providerLog(level: LogLevel, namespace: string, message: string, data?: unknown): void {
  providerLogger[level](namespace, message, data);
}
