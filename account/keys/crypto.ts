const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEY_PREFIX_LENGTH = 12;

function cryptoApi(): Crypto {
  const webCrypto = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!webCrypto?.getRandomValues || !webCrypto.subtle) {
    throw new Error('Web Crypto API is unavailable');
  }
  return webCrypto;
}

export function generateApiKey(): string {
  const crypto = cryptoApi();
  const suffix: string[] = [];
  const limit = 256 - (256 % KEY_ALPHABET.length);
  const random = new Uint8Array(32);
  while (suffix.length < 32) {
    crypto.getRandomValues(random);
    for (const byte of random) {
      if (byte >= limit) continue;
      suffix.push(KEY_ALPHABET[byte % KEY_ALPHABET.length]);
      if (suffix.length === 32) break;
    }
  }
  return `spn_${suffix.join('')}`;
}

export function keyPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX_LENGTH);
}

export async function hashApiKey(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  const digest = await cryptoApi().subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function secureEqual(left: string, right: string): Promise<boolean> {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let result = 0;
  for (let index = 0; index < leftBytes.length; index += 1) result |= leftBytes[index] ^ rightBytes[index];
  return result === 0;
}
