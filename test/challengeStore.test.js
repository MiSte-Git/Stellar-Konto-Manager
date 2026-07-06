const test = require('node:test');
const assert = require('node:assert/strict');
const { Keypair } = require('@stellar/stellar-sdk');
const { createChallenge, consumeChallenge, verifyChallengeSignature } = require('../services/challengeStore.js');

function sign(keypair, challengeB64) {
  return keypair.sign(Buffer.from(challengeB64, 'base64')).toString('base64');
}

test('createChallenge returns a base64 nonce with a ~60s expiry', () => {
  const before = Date.now();
  const { challenge, expiresAt } = createChallenge('job-1', 'GSIGNER1');
  assert.equal(typeof challenge, 'string');
  assert.ok(challenge.length > 0);
  assert.ok(Buffer.from(challenge, 'base64').length === 32, 'nonce should decode to 32 raw bytes');
  assert.ok(expiresAt >= before + 59_000 && expiresAt <= before + 61_000);
});

test('consumeChallenge returns the nonce once, then null (single-use)', () => {
  const { challenge } = createChallenge('job-2', 'GSIGNER2');
  const first = consumeChallenge('job-2', 'GSIGNER2');
  assert.deepEqual(first, { nonce: challenge });
  const second = consumeChallenge('job-2', 'GSIGNER2');
  assert.equal(second, null);
});

test('consumeChallenge returns null for a (jobId, signer) pair that never requested a challenge', () => {
  assert.equal(consumeChallenge('never-requested-job', 'GNOBODY'), null);
});

test('requesting a new challenge overwrites the previous pending one for the same pair', () => {
  const jobId = 'job-3';
  const signerPk = 'GSIGNER3';
  const firstChallenge = createChallenge(jobId, signerPk).challenge;
  const secondChallenge = createChallenge(jobId, signerPk).challenge;
  assert.notEqual(firstChallenge, secondChallenge);
  const consumed = consumeChallenge(jobId, signerPk);
  assert.deepEqual(consumed, { nonce: secondChallenge });
});

test('consumeChallenge treats an expired challenge as absent', async () => {
  const jobId = 'job-4';
  const signerPk = 'GSIGNER4';
  createChallenge(jobId, signerPk, -1); // already expired the instant it's created
  assert.equal(consumeChallenge(jobId, signerPk), null);
});

test('verifyChallengeSignature accepts a genuine signature from the claimed keypair', () => {
  const keypair = Keypair.random();
  const { challenge } = createChallenge('job-5', keypair.publicKey());
  const signature = sign(keypair, challenge);
  assert.equal(verifyChallengeSignature(challenge, signature, keypair.publicKey()), true);
});

test('verifyChallengeSignature rejects a signature produced by a different keypair', () => {
  const owner = Keypair.random();
  const impostor = Keypair.random();
  const { challenge } = createChallenge('job-6', owner.publicKey());
  const signature = sign(impostor, challenge); // signed with the wrong key
  assert.equal(verifyChallengeSignature(challenge, signature, owner.publicKey()), false);
});

test('verifyChallengeSignature rejects a signature over tampered nonce data', () => {
  const keypair = Keypair.random();
  const { challenge } = createChallenge('job-7', keypair.publicKey());
  const signature = sign(keypair, challenge);
  const tamperedChallenge = Buffer.from('completely different 32 byte value!!').toString('base64');
  assert.equal(verifyChallengeSignature(tamperedChallenge, signature, keypair.publicKey()), false);
});

test('verifyChallengeSignature never throws on malformed input (garbage base64/pubkey)', () => {
  assert.doesNotThrow(() => {
    assert.equal(verifyChallengeSignature('not-valid-base64!!', 'also-not-base64!!', 'not-a-real-key'), false);
  });
  assert.doesNotThrow(() => {
    assert.equal(verifyChallengeSignature('', '', ''), false);
  });
});

test('end-to-end handshake: create -> sign -> consume -> verify succeeds exactly once', () => {
  const jobId = 'job-8';
  const keypair = Keypair.random();
  const { challenge } = createChallenge(jobId, keypair.publicKey());
  const signature = sign(keypair, challenge);

  const pending = consumeChallenge(jobId, keypair.publicKey());
  assert.ok(pending, 'challenge should still be pending before redemption');
  assert.equal(verifyChallengeSignature(pending.nonce, signature, keypair.publicKey()), true);

  // Replaying the same (jobId, signer) after consumption must fail closed:
  // no challenge left to redeem, even though the signature itself is still valid.
  assert.equal(consumeChallenge(jobId, keypair.publicKey()), null);
});
