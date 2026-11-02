const test = require('node:test');
const assert = require('node:assert/strict');
const { Keypair } = require('@stellar/stellar-sdk');
const {
  createChallenge,
  consumeChallenge,
  verifyChallengeSignature,
  MAX_CHALLENGES_TOTAL,
  MAX_CHALLENGES_PER_JOB,
} = require('../services/challengeStore.js');

// Signiert wie das Frontend: `skm:<purpose>:` plus Nonce. purpose null signiert die
// rohe Nonce (altes Format, muss abgelehnt werden).
function sign(keypair, challengeB64, purpose = 'token') {
  const nonce = Buffer.from(challengeB64, 'base64');
  const data = purpose === null ? nonce : Buffer.concat([Buffer.from(`skm:${purpose}:`), nonce]);
  return Buffer.from(keypair.sign(data)).toString('base64');
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
  assert.equal(verifyChallengeSignature(challenge, signature, keypair.publicKey(), 'token'), true);
});

test('verifyChallengeSignature rejects a signature produced by a different keypair', () => {
  const owner = Keypair.random();
  const impostor = Keypair.random();
  const { challenge } = createChallenge('job-6', owner.publicKey());
  const signature = sign(impostor, challenge); // signed with the wrong key
  assert.equal(verifyChallengeSignature(challenge, signature, owner.publicKey(), 'token'), false);
});

test('verifyChallengeSignature rejects a signature over tampered nonce data', () => {
  const keypair = Keypair.random();
  const { challenge } = createChallenge('job-7', keypair.publicKey());
  const signature = sign(keypair, challenge);
  const tamperedChallenge = Buffer.from('completely different 32 byte value!!').toString('base64');
  assert.equal(verifyChallengeSignature(tamperedChallenge, signature, keypair.publicKey(), 'token'), false);
});

test('verifyChallengeSignature rejects the raw nonce signature (no purpose prefix)', () => {
  const keypair = Keypair.random();
  const { challenge } = createChallenge('job-9', keypair.publicKey());
  const raw = sign(keypair, challenge, null);
  assert.equal(verifyChallengeSignature(challenge, raw, keypair.publicKey(), 'token'), false);
  assert.equal(verifyChallengeSignature(challenge, raw, keypair.publicKey(), 'decline'), false);
});

test('verifyChallengeSignature without purpose is always false, even for a matching signature', () => {
  const keypair = Keypair.random();
  const { challenge } = createChallenge('job-10', keypair.publicKey());
  assert.equal(verifyChallengeSignature(challenge, sign(keypair, challenge, null), keypair.publicKey()), false);
  assert.equal(verifyChallengeSignature(challenge, sign(keypair, challenge, null), keypair.publicKey(), ''), false);
  assert.equal(verifyChallengeSignature(challenge, sign(keypair, challenge, ''), keypair.publicKey(), ''), false);
});

test('verifyChallengeSignature keeps token and decline signatures apart', () => {
  const keypair = Keypair.random();
  const { challenge } = createChallenge('job-11', keypair.publicKey());
  assert.equal(verifyChallengeSignature(challenge, sign(keypair, challenge, 'decline'), keypair.publicKey(), 'token'), false);
  assert.equal(verifyChallengeSignature(challenge, sign(keypair, challenge, 'token'), keypair.publicKey(), 'decline'), false);
  assert.equal(verifyChallengeSignature(challenge, sign(keypair, challenge, 'decline'), keypair.publicKey(), 'decline'), true);
});

test('verifyChallengeSignature never throws on malformed input (garbage base64/pubkey)', () => {
  assert.doesNotThrow(() => {
    assert.equal(verifyChallengeSignature('not-valid-base64!!', 'also-not-base64!!', 'not-a-real-key', 'token'), false);
  });
  assert.doesNotThrow(() => {
    assert.equal(verifyChallengeSignature('', '', '', ''), false);
  });
});

test('end-to-end handshake: create -> sign -> consume -> verify succeeds exactly once', () => {
  const jobId = 'job-8';
  const keypair = Keypair.random();
  const { challenge } = createChallenge(jobId, keypair.publicKey());
  const signature = sign(keypair, challenge);

  const pending = consumeChallenge(jobId, keypair.publicKey());
  assert.ok(pending, 'challenge should still be pending before redemption');
  assert.equal(verifyChallengeSignature(pending.nonce, signature, keypair.publicKey(), 'token'), true);

  // Replaying the same (jobId, signer) after consumption must fail closed:
  // no challenge left to redeem, even though the signature itself is still valid.
  assert.equal(consumeChallenge(jobId, keypair.publicKey()), null);
});

// --- Obergrenzen (C2) --------------------------------------------------------
// Am Ende der Datei: die Tests fuellen die Map und raeumen danach wieder auf.

test('je Job hoechstens MAX_CHALLENGES_PER_JOB offene Challenges, die aelteste fliegt raus', () => {
  const signers = Array.from({ length: MAX_CHALLENGES_PER_JOB + 1 }, (_, i) => `GCAPJOB${i}`);
  signers.forEach((pk) => createChallenge('cap-job', pk));
  assert.equal(consumeChallenge('cap-job', signers[0]), null, 'die aelteste wurde verdraengt');
  for (const pk of signers.slice(1)) assert.ok(consumeChallenge('cap-job', pk), `${pk} ist noch offen`);
});

test('erneute Challenge fuer dasselbe Paar zaehlt als neueste und verdraengt sie nicht', () => {
  const signers = Array.from({ length: MAX_CHALLENGES_PER_JOB }, (_, i) => `GREJOB${i}`);
  signers.forEach((pk) => createChallenge('re-job', pk));
  createChallenge('re-job', signers[0]);
  createChallenge('re-job', 'GREJOBNEU');
  assert.equal(consumeChallenge('re-job', signers[1]), null, 'jetzt ist signers[1] die aelteste');
  assert.ok(consumeChallenge('re-job', signers[0]));
  assert.ok(consumeChallenge('re-job', 'GREJOBNEU'));
  signers.slice(2).forEach((pk) => consumeChallenge('re-job', pk));
});

test('gesamt hoechstens MAX_CHALLENGES_TOTAL, die aeltesten fallen zuerst raus', () => {
  // Eine mehr als die Obergrenze: Reste frueherer Tests und total-0 fallen raus.
  createChallenge('total-expired', 'GEXPIRED', -1);
  for (let i = 0; i <= MAX_CHALLENGES_TOTAL; i += 1) createChallenge(`total-${i}`, 'GTOTAL');
  assert.equal(consumeChallenge('total-0', 'GTOTAL'), null, 'die aelteste wurde verdraengt');
  assert.ok(consumeChallenge('total-1', 'GTOTAL'));
  assert.ok(consumeChallenge(`total-${MAX_CHALLENGES_TOTAL}`, 'GTOTAL'));
});

test('nach der Verdraengung funktioniert eine frische Challenge mit Signatur weiter', () => {
  const keypair = Keypair.random();
  const { challenge } = createChallenge('fresh-job', keypair.publicKey());
  const pending = consumeChallenge('fresh-job', keypair.publicKey());
  assert.ok(pending);
  assert.equal(verifyChallengeSignature(pending.nonce, sign(keypair, challenge), keypair.publicKey(), 'token'), true);
  for (let i = 0; i <= MAX_CHALLENGES_TOTAL; i += 1) consumeChallenge(`total-${i}`, 'GTOTAL');
});
