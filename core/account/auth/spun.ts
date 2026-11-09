import type { AuthSession } from '../types.js';
import { readBearerToken } from './headers.js';

export class AuthAdapterNotConfiguredError extends Error {
  constructor() {
    super('Spün Auth session verification is not configured');
    this.name = 'AuthAdapterNotConfiguredError';
  }
}

export interface SpunAuthAdapter {
  verify(request: Request, env: Record<string, unknown>): Promise<AuthSession>;
}

/**
 * Placeholder adapter for the real Spün Auth verification contract.
 * It deliberately fails closed until Spün Auth provides a verification endpoint
 * or a locally verifiable token contract. No unverified claims are trusted.
 */
export const spunAuthAdapter: SpunAuthAdapter = {
  async verify(request, env) {
    const token = readBearerToken(request.headers.get('Authorization') ?? undefined);
    if (!token) throw new AuthAdapterNotConfiguredError();

    const verifyUrl = typeof env.SPUN_AUTH_VERIFY_URL === 'string' ? env.SPUN_AUTH_VERIFY_URL : '';
    if (!verifyUrl) throw new AuthAdapterNotConfiguredError();

    const verifyKey = typeof env.SPUN_AUTH_VERIFY_KEY === 'string' ? env.SPUN_AUTH_VERIFY_KEY : '';
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(verifyKey ? { 'X-Internals-Key': verifyKey } : {}),
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Spün Auth verification failed with status ${response.status}`);

    const payload = await response.json() as { subject?: string; email?: string | null; name?: string | null };
    if (!payload.subject) throw new Error('Spün Auth verification response did not contain a subject');
    return { subject: payload.subject, email: payload.email ?? null, name: payload.name ?? null };
  },
};
