export function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function readBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function readUserKey(headers: Headers): string | null {
  return headers.get('X-User-Key')?.trim() || null;
}

export function readAdminKey(headers: Headers): string | null {
  return headers.get('X-Admin-Key')?.trim() || null;
}

export function readInternalsKey(headers: Headers): string | null {
  return headers.get('X-Internals-Key')?.trim() || null;
}
