import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, isSafeHttpUrl } from '../mapper.js';
import { getHealthRecords, isHealthy, recordFailure, recordSuccess } from '../health.js';

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
