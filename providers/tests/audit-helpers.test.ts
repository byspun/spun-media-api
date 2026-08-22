import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, isSafeHttpUrl } from '../mapper.js';
import { getHealthRecords, isHealthy, recordFailure, recordSuccess } from '../health.js';
import { isValidAccountEmail } from '../../account/validation.js';
import { defaultApiKeyExpiry, policyFromEnv } from '../../account/policy.js';

test('public URL validation accepts HTTPS and rejects insecure or malformed URLs', () => {
  assert.equal(isSafeHttpUrl('https://cdn.example.test/video.mp4'), true);
  assert.equal(isSafeHttpUrl('http://cdn.example.test/video.mp4'), false);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('not-a-url'), false);
});

test('stream format detection distinguishes HLS, DASH, MP4, and unknown URLs', () => {
  assert.equal(detectFormat('https://cdn.example.test/master.m3u8'), 'hls');
  assert.equal(detectFormat('https://cdn.example.test/manifest.mpd'), 'dash');
  assert.equal(detectFormat('https://cdn.example.test/movie.mp4'), 'mp4');
  assert.equal(detectFormat('https://cdn.example.test/file.bin'), 'unknown');
});

test('account email validation accepts normal addresses and rejects malformed addresses', () => {
  assert.equal(isValidAccountEmail('heisdanny64@gmail.com'), true);
  assert.equal(isValidAccountEmail('person+tag@example.co.uk'), true);
  assert.equal(isValidAccountEmail('not-an-email'), false);
  assert.equal(isValidAccountEmail('person@example'), false);
});

test('key expiry is indefinite while enforcement is off and defaults to 30 days when enabled', () => {
  const now = Date.parse('2026-08-22T00:00:00.000Z');
  const developmentPolicy = policyFromEnv({});
  const enforcedPolicy = policyFromEnv({ PLANS_ENABLED: 'true' });
  assert.equal(defaultApiKeyExpiry(developmentPolicy, now), null);
  assert.equal(defaultApiKeyExpiry(enforcedPolicy, now), '2026-09-21T00:00:00.000Z');
});

test('provider health suppresses after consecutive failures and recovers on success', () => {
  const provider = 'castle';
  const category = 'movie';
  assert.equal(isHealthy(provider, category), true);
  recordFailure(provider, category, new Error('first'));
  recordFailure(provider, category, new Error('second'));
  assert.equal(isHealthy(provider, category), true);
  recordFailure(provider, category, new Error('third'));
  assert.equal(isHealthy(provider, category), false);
  recordSuccess(provider, category);
  assert.equal(isHealthy(provider, category), true);
  const record = getHealthRecords().find((item) => item.provider_id === provider && item.content_type === category);
  assert.equal(record?.status, 'healthy');
  assert.equal(record?.consecutive_failures, 0);
});
