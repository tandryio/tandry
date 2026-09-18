// Research only: run in an isolated directory with @hpke/core@1.9.0 installed.
// This is a primitive compatibility probe, not a Tandry encryption implementation.
// Optional argument: a single RFC 9180 Auth/P-256/SHA-256/AES-256-GCM vector.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';

const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});
const bytes = text => new TextEncoder().encode(text);
const checks = [];
const info = bytes('tandry/research/hpke-auth/v1');
const sender = await suite.kem.generateKeyPair();
const recipient = await suite.kem.generateKeyPair();
const stranger = await suite.kem.generateKeyPair();
const header = [1, 'synthetic-hub', 'synthetic-room-instance', 'sender-account',
  'sender-session', 'recipient-account', 'recipient-session', randomUUID()];
const aad = bytes(JSON.stringify(header));
const plaintext = bytes('Synthetic message: Check sign-in 🔒');
const seal = () => suite.seal({ recipientPublicKey: recipient.publicKey, senderKey: sender.privateKey, info }, plaintext, aad);
const sealed = await seal();
const open = (overrides = {}, ciphertext = sealed.ct, context = aad) => suite.open({
  recipientKey: recipient.privateKey, senderPublicKey: sender.publicKey,
  enc: sealed.enc, info, ...overrides,
}, ciphertext, context);

assert.deepEqual(new Uint8Array(await open()), plaintext);
checks.push('authenticated round trip');
await assert.rejects(() => open({ recipientKey: stranger.privateKey }));
checks.push('wrong recipient rejected');
await assert.rejects(() => open({ senderPublicKey: stranger.publicKey }));
checks.push('wrong sender rejected');
await assert.rejects(() => open({ senderPublicKey: undefined }));
checks.push('Auth-to-Base substitution rejected');
await assert.rejects(() => open({ info: bytes('other-protocol') }));
checks.push('different protocol context rejected');

for (const index of [2, 4, 6, 7]) {
  const changed = [...header];
  changed[index] += '-changed';
  await assert.rejects(() => open({}, sealed.ct, bytes(JSON.stringify(changed))));
}
checks.push('room, sender, recipient and logical message ID changes rejected');
const corrupted = new Uint8Array(sealed.ct.slice(0));
corrupted[0] ^= 1;
await assert.rejects(() => open({}, corrupted));
checks.push('ciphertext tampering rejected');
const corruptedEnc = new Uint8Array(sealed.enc.slice(0));
corruptedEnc[1] ^= 1;
await assert.rejects(() => open({ enc: corruptedEnc }));
checks.push('encapsulation tampering rejected');

const second = await seal();
assert.notDeepEqual(new Uint8Array(second.enc), new Uint8Array(sealed.enc));
checks.push('fresh encapsulation per message');
const serialized = JSON.stringify({
  enc: Buffer.from(sealed.enc).toString('base64'),
  ct: Buffer.from(sealed.ct).toString('base64'),
});
const recovered = JSON.parse(serialized);
assert.deepEqual(new Uint8Array(await open(
  { enc: Buffer.from(recovered.enc, 'base64') }, Buffer.from(recovered.ct, 'base64'),
)), plaintext);
checks.push('persisted envelope round trip');

const restoredKey = await suite.kem.deserializePrivateKey(await suite.kem.serializePrivateKey(recipient.privateKey));
assert.deepEqual(new Uint8Array(await open({ recipientKey: restoredKey })), plaintext);
checks.push('restored recipient key decrypts old ciphertext (no recipient forward secrecy)');
assert.deepEqual(new Uint8Array(await open()), plaintext);
checks.push('replay decrypts again: application deduplication is required');

const large = new Uint8Array(64 * 1024).fill(65);
const largeSealed = await suite.seal({ recipientPublicKey: recipient.publicKey, senderKey: sender.privateKey, info }, large, aad);
assert.deepEqual(new Uint8Array(await suite.open({
  recipientKey: recipient.privateKey, senderPublicKey: sender.publicKey, enc: largeSealed.enc, info,
}, largeSealed.ct, aad)), large);
checks.push('64 KiB plaintext round trip');
assert.equal(typeof createRequire(import.meta.url)('@hpke/core').CipherSuite, 'function');
checks.push('CommonJS export loads');

let vectorResult;
if (process.argv[2]) {
  const raw = readFileSync(process.argv[2]);
  const vector = JSON.parse(raw);
  assert.deepEqual([vector.mode, vector.kem_id, vector.kdf_id, vector.aead_id], [2, 16, 1, 2]);
  const hex = value => Uint8Array.from(Buffer.from(value, 'hex'));
  const context = await suite.createRecipientContext({
    recipientKey: await suite.kem.deserializePrivateKey(hex(vector.skRm)),
    senderPublicKey: await suite.kem.deserializePublicKey(hex(vector.pkSm)),
    enc: hex(vector.enc), info: hex(vector.info),
  });
  for (const entry of vector.encryptions) {
    assert.deepEqual(new Uint8Array(await context.open(hex(entry.ct), hex(entry.aad))), hex(entry.pt));
  }
  vectorResult = {
    fixtureSha256: createHash('sha256').update(raw).digest('hex'),
    decryptions: vector.encryptions.length,
  };
}
console.log(JSON.stringify({
  node: process.version,
  package: createRequire(import.meta.url)('@hpke/core/package.json').version,
  checks,
  largeMessage: {
    plaintextBytes: large.byteLength,
    ciphertextBytes: largeSealed.ct.byteLength,
    encapsulationBytes: largeSealed.enc.byteLength,
    ciphertextBase64Bytes: Buffer.from(largeSealed.ct).toString('base64').length,
  },
  vector: vectorResult,
}, null, 2));
