import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { SelfHostConfig } from '../scripts/self-host.mjs';

const config = {
  ...JSON.parse(fs.readFileSync(new URL('../deploy/self-host.example.json', import.meta.url), 'utf8')),
  accountId: 'a'.repeat(32),
  databaseId: '00000000-0000-0000-0000-000000000001',
};

test('self-host configuration accepts an explicit zero room limit and parses distinct custom domains', () => {
  const parsed = SelfHostConfig.parse({ ...config, roomLimit: 0 });
  assert.equal(parsed.websiteOrigin.hostname, 'rooms.example.com');
  assert.equal(parsed.hubOrigin.origin, 'https://hub.example.com');
  assert.equal(parsed.roomLimit, 0);
  assert.equal(parsed.bucketName, 'my-tandry-public');
  assert.equal(parsed.publicBaseUrl, 'https://cdn.example.com');
});

test('self-host configuration deploys without account pictures when no bucket is named', () => {
  const { bucketName, ...withoutBucket } = config;
  assert.equal(SelfHostConfig.parse(withoutBucket).bucketName, undefined);
});

test('self-host configuration rejects secrets, malformed origins and invalid policy values', () => {
  for (const overrides of [
    { unexpectedSecret: 'synthetic-only' },
    { accountId: 'invalid' },
    { databaseId: 'invalid' },
    { workerPrefix: '../escape' },
    { websiteOrigin: 'http://rooms.example.com' },
    { websiteOrigin: 'https://rooms.example.com/' },
    { websiteOrigin: 'https://rooms.example.com:8443' },
    { websiteOrigin: 'https://user:password@rooms.example.com' },
    { websiteOrigin: 'https://demo.workers.dev' },
    { websiteOrigin: config.hubOrigin },
    { websiteOrigin: 123 },
    { roomLimit: -1 },
    { roomLimit: 100001 },
    { roomLimit: '1' },
    { roomLimit: 1.5 },
    { bucketName: 'Not A Bucket' },
    { publicBaseUrl: 'http://cdn.example.com' },
    { publicBaseUrl: 'https://cdn.example.com/' },
  ]) {
    assert.equal(SelfHostConfig.safeParse({ ...config, ...overrides }).success, false, JSON.stringify(overrides));
  }
});
