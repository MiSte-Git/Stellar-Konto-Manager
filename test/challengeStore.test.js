const test = require('node:test');
const assert = require('node:assert/strict');
const { Keypair } = require('@stellar/stellar-sdk');
const {
  createChallenge,
  consumeChallenge,
  verifyChallengeSignature,
  parseChallengeNonce,
  MAX_CHALLENGES_TOTAL,
  MAX_CHALLENGES_PER_JOB,
  MAX_CHALLENGES_PER_SIGNER,
  CHALLENGE_NONCE_BYTES,
} = require('../services/challengeStore.js');
const cases = require('./assets/challenge-cases.json');

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
  const first = consumeChallenge('job-2', 'GSIGNER2', challenge);
  assert.deepEqual(first, { nonce: challenge });
  const second = consumeChallenge('job-2', 'GSIGNER2', challenge);
  assert.equal(second, null);
});

test('consumeChallenge returns null for a (jobId, signer) pair that never requested a challenge', () => {
  assert.equal(consumeChallenge('never-requested-job', 'GNOBODY', Buffer.alloc(32).toString('base64')), null);
});

test('consumeChallenge ohne Nonce verbraucht nichts (frueher: einzige offene Challenge des Paars)', () => {
  const { challenge } = createChallenge('job-3', 'GSIGNER3');
  assert.equal(consumeChallenge('job-3', 'GSIGNER3'), null);
  assert.equal(consumeChallenge('job-3', 'GSIGNER3', undefined), null);
  assert.deepEqual(consumeChallenge('job-3', 'GSIGNER3', challenge), { nonce: challenge });
});

test('eine neue Challenge fuer dasselbe Paar ueberschreibt die vorige nicht (frueher: nur die neueste galt)', () => {
  const first = createChallenge('job-3b', 'GSIGNER3').challenge;
  const second = createChallenge('job-3b', 'GSIGNER3').challenge;
  assert.notEqual(first, second);
  assert.deepEqual(consumeChallenge('job-3b', 'GSIGNER3', first), { nonce: first });
  assert.deepEqual(consumeChallenge('job-3b', 'GSIGNER3', second), { nonce: second });
});

test('consumeChallenge treats an expired challenge as absent', async () => {
  const jobId = 'job-4';
  const signerPk = 'GSIGNER4';
  const { challenge } = createChallenge(jobId, signerPk, -1); // already expired the instant it's created
  assert.equal(consumeChallenge(jobId, signerPk, challenge), null);
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

  const pending = consumeChallenge(jobId, keypair.publicKey(), challenge);
  assert.ok(pending, 'challenge should still be pending before redemption');
  assert.equal(verifyChallengeSignature(pending.nonce, signature, keypair.publicKey(), 'token'), true);

  // Replaying the same nonce after consumption must fail closed, even though the
  // signature itself is still valid.
  assert.equal(consumeChallenge(jobId, keypair.publicKey(), challenge), null);
});

// --- Gemeinsame Faelle (test/assets/challenge-cases.json, gleich in PHP) -------

for (const scenario of cases.scenarios) {
  test(`Fixture: ${scenario.name}`, () => {
    const tag = `fx-${Math.random().toString(36).slice(2)}`;
    const jobs = { j1: `${tag}-j1`, j2: `${tag}-j2` };
    const keys = { S1: Keypair.random(), S2: Keypair.random() };
    const nonces = {};
    for (const [i, step] of scenario.steps.entries()) {
      const pk = keys[step.signer].publicKey();
      if (step.op === 'create') {
        nonces[step.nonce] = createChallenge(jobs[step.job], pk).challenge;
        continue;
      }
      const nonce = nonces[step.nonce];
      const pending = consumeChallenge(jobs[step.job], pk, nonce);
      let outcome = 'missing';
      if (pending) {
        const signWith = step.sign === 'valid' ? keys[step.signer] : Keypair.random();
        outcome = verifyChallengeSignature(pending.nonce, sign(signWith, nonce), pk, 'token') ? 'ok' : 'invalid_signature';
      }
      assert.equal(outcome, step.expect, `Schritt ${i + 1} (${step.nonce} fuer ${step.job}/${step.signer})`);
    }
  });
}

test('Fixture: Grenzen stimmen mit den Konstanten ueberein', () => {
  assert.equal(MAX_CHALLENGES_PER_SIGNER, cases.limits.perSigner);
  assert.equal(MAX_CHALLENGES_PER_JOB, cases.limits.perJob);
  assert.equal(MAX_CHALLENGES_TOTAL, cases.limits.total);
  assert.equal(CHALLENGE_NONCE_BYTES, cases.limits.nonceBytes);
  const before = Date.now();
  const { expiresAt } = createChallenge('fx-ttl', 'GTTL');
  assert.ok(expiresAt - before >= cases.limits.ttlSeconds * 1000 - 1000 && expiresAt - before <= cases.limits.ttlSeconds * 1000 + 1000);
});

test('Fixture: Nonce im Body nur als strikte base64 mit genau 32 Byte, kaputte verbrauchen nichts', () => {
  const kp = Keypair.random();
  const { challenge } = createChallenge('fx-body', kp.publicKey());
  for (const c of cases.bodyNonces) {
    const value = c.omit ? undefined : c.value;
    assert.equal(parseChallengeNonce(value) !== null, c.wellFormed, c.label);
    assert.equal(consumeChallenge('fx-body', kp.publicKey(), value), null, c.label);
  }
  assert.equal(parseChallengeNonce(challenge), challenge);
  assert.deepEqual(consumeChallenge('fx-body', kp.publicKey(), challenge), { nonce: challenge }, 'offene Challenge bleibt');
});

test('fremde Nonce bleibt unangetastet, auch wenn sie abgelaufen ist, und wird beim richtigen Paar verworfen', () => {
  const { challenge } = createChallenge('fx-exp', 'GEXP', -1);
  assert.equal(consumeChallenge('fx-exp', 'GANDERER', challenge), null);
  assert.equal(consumeChallenge('fx-exp', 'GEXP', challenge), null);
});

// --- Obergrenzen (C2) --------------------------------------------------------
// Am Ende der Datei: die Tests fuellen die Map und raeumen danach wieder auf.

test('je Job hoechstens MAX_CHALLENGES_PER_JOB offene Challenges, die aelteste fliegt raus', () => {
  const signers = Array.from({ length: MAX_CHALLENGES_PER_JOB + 1 }, (_, i) => `GCAPJOB${i}`);
  const nonces = signers.map((pk) => createChallenge('cap-job', pk).challenge);
  assert.equal(consumeChallenge('cap-job', signers[0], nonces[0]), null, 'die aelteste wurde verdraengt');
  signers.slice(1).forEach((pk, i) => assert.ok(consumeChallenge('cap-job', pk, nonces[i + 1]), `${pk} ist noch offen`));
});

test('weitere Challenge fuer dasselbe Paar zaehlt je Job mit, verdraengt wird die aelteste des Jobs', () => {
  const signers = Array.from({ length: MAX_CHALLENGES_PER_JOB }, (_, i) => `GREJOB${i}`);
  const nonces = signers.map((pk) => createChallenge('re-job', pk).challenge);
  const again = createChallenge('re-job', signers[0]).challenge;
  assert.equal(consumeChallenge('re-job', signers[0], nonces[0]), null, 'die aelteste des Jobs wurde verdraengt');
  assert.ok(consumeChallenge('re-job', signers[0], again));
  signers.slice(1).forEach((pk, i) => assert.ok(consumeChallenge('re-job', pk, nonces[i + 1]), `${pk} ist noch offen`));
});

test('gesamt hoechstens MAX_CHALLENGES_TOTAL, die aeltesten fallen zuerst raus', () => {
  // Eine mehr als die Obergrenze: Reste frueherer Tests und total-0 fallen raus.
  createChallenge('total-expired', 'GEXPIRED', -1);
  const nonces = [];
  for (let i = 0; i <= MAX_CHALLENGES_TOTAL; i += 1) nonces.push(createChallenge(`total-${i}`, 'GTOTAL').challenge);
  assert.equal(consumeChallenge('total-0', 'GTOTAL', nonces[0]), null, 'die aelteste wurde verdraengt');
  assert.ok(consumeChallenge('total-1', 'GTOTAL', nonces[1]));
  assert.ok(consumeChallenge(`total-${MAX_CHALLENGES_TOTAL}`, 'GTOTAL', nonces[MAX_CHALLENGES_TOTAL]));
  globalThis.__skmTotalNonces = nonces;
});

test('nach der Verdraengung funktioniert eine frische Challenge mit Signatur weiter', () => {
  const keypair = Keypair.random();
  const { challenge } = createChallenge('fresh-job', keypair.publicKey());
  const pending = consumeChallenge('fresh-job', keypair.publicKey(), challenge);
  assert.ok(pending);
  assert.equal(verifyChallengeSignature(pending.nonce, sign(keypair, challenge), keypair.publicKey(), 'token'), true);
  const nonces = globalThis.__skmTotalNonces || [];
  nonces.forEach((nonce, i) => consumeChallenge(`total-${i}`, 'GTOTAL', nonce));
  delete globalThis.__skmTotalNonces;
});
