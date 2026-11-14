// Signer-Pruefung zentral im Node-Backend (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 4).
// services/signerAuth.js und verifyCollected/filterValidSignatures in services/txSignatures.js.
// PHP-Zwilling: test/signerAuth.test.php, gleiche Fixtures (signer-types.json, challenge-vector.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Account, Keypair, Networks, Operation, StrKey, TransactionBuilder, WebAuth, xdr } = require('@stellar/stellar-sdk');
const {
  SIGNATURE_BYTES, SIGNER_TYPES, decodeStrictBase64, isInteractiveSigner, normalizeHorizonSigners,
  signatureMatchesSigner, signerTypeOf, verifyChallenge,
} = require('../services/signerAuth.js');
const { filterValidSignatures, verifyCollected, decoratedSignatureBytes } = require('../services/txSignatures.js');
const { challengeMessage, verifyChallengeSignature } = require('../services/challengeStore.js');

const signerTypes = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'signer-types.json'), 'utf8'));
const vector = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'challenge-vector.json'), 'utf8'));

// --- Signer-Typ: gemeinsame Fixture mit PHP und Frontend --------------------------------------
for (const c of signerTypes.cases) {
  test(`signerTypeOf: ${c.label}`, () => {
    const signer = c.type === null ? { key: c.key } : { key: c.key, type: c.type };
    assert.equal(signerTypeOf(signer), c.expected);
    assert.equal(isInteractiveSigner(signer), c.interactive);
  });
}

test('normalizeHorizonSigners: Typ aus Horizon, gegen den Schluessel geprueft', () => {
  const g = Keypair.random().publicKey();
  const x = StrKey.encodeSha256Hash(Buffer.alloc(32, 2));
  const out = normalizeHorizonSigners({ signers: [
    { key: g, weight: 2, type: 'ed25519_public_key' },
    { key: x, weight: 1, type: 'sha256_hash' },
    { key: x, weight: 1, type: 'ed25519_public_key' },
    { weight: 1 },
  ] });
  assert.deepEqual(out, [
    { publicKey: g, weight: 2, type: SIGNER_TYPES.ED25519 },
    { publicKey: x, weight: 1, type: SIGNER_TYPES.SHA256_HASH },
    { publicKey: x, weight: 1, type: SIGNER_TYPES.UNKNOWN },
  ]);
});

// --- Transaktionssignaturen -------------------------------------------------------------------
const a = Keypair.random();
const b = Keypair.random();
function buildTx(source = a) {
  return new TransactionBuilder(new Account(source.publicKey(), '100'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .setTimeout(60)
    .build();
}
const entry = (kp, weight = 1, type) => (type ? { publicKey: kp.publicKey(), weight, type } : { publicKey: kp.publicKey(), weight });
const rawSig = (tx, kp) => ({ hint: kp.signatureHint(), signature: kp.sign(tx.hash()) });
function decorated(hint, signature) {
  return new xdr.DecoratedSignature({ hint: Buffer.from(hint), signature: Buffer.from(signature) });
}

test('gueltige Signatur eines Signers passt', () => {
  const tx = buildTx();
  assert.equal(signatureMatchesSigner(rawSig(tx, a), a.publicKey(), tx.hash()), true);
});

test('manipulierte Signatur, fremder Hash oder falscher Signer passen nicht', () => {
  const tx = buildTx();
  const sig = rawSig(tx, a);
  const bad = Buffer.from(sig.signature); bad[0] ^= 1;
  assert.equal(signatureMatchesSigner({ hint: sig.hint, signature: bad }, a.publicKey(), tx.hash()), false);
  assert.equal(signatureMatchesSigner(sig, a.publicKey(), buildTx(b).hash()), false);
  assert.equal(signatureMatchesSigner(sig, b.publicKey(), tx.hash()), false);
  assert.equal(signatureMatchesSigner(sig, 'kein-key', tx.hash()), false);
  assert.equal(signatureMatchesSigner(null, a.publicKey(), tx.hash()), false);
});

test('K4: Signatur mit 63 oder 65 Byte und Hint mit 3 oder 5 Byte passen nie', () => {
  const tx = buildTx();
  const sig = rawSig(tx, a);
  assert.equal(SIGNATURE_BYTES, 64);
  assert.equal(signatureMatchesSigner({ hint: sig.hint, signature: Buffer.from(sig.signature).subarray(0, 63) }, a.publicKey(), tx.hash()), false);
  assert.equal(signatureMatchesSigner({ hint: sig.hint, signature: Buffer.concat([Buffer.from(sig.signature), Buffer.from([0])]) }, a.publicKey(), tx.hash()), false);
  assert.equal(signatureMatchesSigner({ hint: Buffer.from(sig.hint).subarray(0, 3), signature: sig.signature }, a.publicKey(), tx.hash()), false);
  assert.equal(signatureMatchesSigner({ hint: Buffer.concat([Buffer.from(sig.hint), Buffer.from([0])]), signature: sig.signature }, a.publicKey(), tx.hash()), false);
  // decoratedSignatureBytes wirft bei 63 Byte (vorher erlaubt: hoechstens 64)
  assert.throws(() => decoratedSignatureBytes(decorated(sig.hint, Buffer.from(sig.signature).subarray(0, 63))));
  assert.doesNotThrow(() => decoratedSignatureBytes(decorated(sig.hint, sig.signature)));
});

test('Nicht-Signer mit passendem Hint zaehlt nicht', () => {
  const tx = buildTx();
  // Fremder Key mit denselben letzten 4 Byte wie a: Hint passt, Signatur nicht.
  const other = Keypair.random();
  const sigOfOther = other.sign(tx.hash());
  tx.signatures.push(decorated(a.signatureHint(), sigOfOther));
  assert.deepEqual(verifyCollected(tx, [entry(a)]), []);
  assert.equal(filterValidSignatures(tx, [entry(a)]).length, 0);
});

test('zwei Signaturen desselben Signers: Gewicht einmal', () => {
  const tx = buildTx();
  tx.sign(a);
  tx.sign(a); // gleiche Signatur nochmals
  assert.deepEqual(verifyCollected(tx, [entry(a, 2)]), [{ publicKey: a.publicKey(), weight: 2 }]);
  assert.deepEqual(verifyCollected(tx, [entry(a, 2), entry(a, 2)]), [{ publicKey: a.publicKey(), weight: 2 }]);
});

test('Signer mit Gewicht 0: zaehlt nicht, Signatur wird beim Merge verworfen', () => {
  const tx = buildTx();
  tx.sign(a, b);
  assert.deepEqual(verifyCollected(tx, [entry(a, 1), entry(b, 0)]), [{ publicKey: a.publicKey(), weight: 1 }]);
  assert.equal(filterValidSignatures(tx, [entry(a, 1), entry(b, 0)]).length, 1);
});

test('T-, X-, P-Signer und Widerspruchs-Typen in der Liste werden uebersprungen', () => {
  const tx = buildTx();
  tx.sign(a);
  const t = StrKey.encodePreAuthTx(Buffer.alloc(32, 1));
  const x = StrKey.encodeSha256Hash(Buffer.alloc(32, 2));
  const list = [{ publicKey: t, weight: 5 }, { publicKey: x, weight: 5, type: 'sha256_hash' }];
  assert.deepEqual(verifyCollected(tx, list), []);
  // G-Key mit falschem Horizon-Typ (Widerspruch): zaehlt nicht
  assert.deepEqual(verifyCollected(tx, [entry(a, 1, 'sha256_hash')]), []);
  assert.deepEqual(verifyCollected(tx, [entry(a, 1, 'ed25519_public_key')]), [{ publicKey: a.publicKey(), weight: 1 }]);
});

// Vergleichslauf (Plan 8.2): das alte collectSignersForTx aus server.js (WebAuth.verifyTxSignedBy,
// wortgleich) gegen verifyCollected. Gleiches Ergebnis fuer alle Signer mit Gewicht > 0; Signer
// mit Gewicht 0 nahm die alte Version mit auf (ohne Einfluss aufs Gewicht), die neue wie PHP nicht.
function oldCollectSignersForTx(tx, signers = []) {
  const collected = [];
  for (const s of signers) {
    try {
      if (WebAuth.verifyTxSignedBy(tx, s.publicKey)) {
        collected.push({ publicKey: s.publicKey, weight: Number(s.weight || 0) });
      }
    } catch {}
  }
  return collected;
}

test('Vergleichslauf alt (WebAuth.verifyTxSignedBy) gegen neu (verifyCollected)', () => {
  const c = Keypair.random();
  const cases = [];
  const t1 = buildTx(); t1.sign(a); cases.push([t1, [entry(a), entry(b)]]);
  const t2 = buildTx(); t2.sign(a, b); cases.push([t2, [entry(a, 1), entry(b, 2), entry(c, 3)]]);
  const t3 = buildTx(); cases.push([t3, [entry(a), entry(b)]]);
  const t4 = buildTx(); t4.sign(c); cases.push([t4, [entry(a), entry(b)]]);
  const t5 = buildTx(); t5.sign(a, b); cases.push([t5, [entry(a, 0), entry(b, 1)]]);
  const t6 = buildTx(); t6.signatures.push(decorated(a.signatureHint(), c.sign(t6.hash()))); cases.push([t6, [entry(a)]]);
  const t7 = buildTx(); t7.sign(b); t7.sign(a); cases.push([t7, [entry(a, 1), entry(b, 1)]]);
  const sum = (list) => list.reduce((acc, s) => acc + Number(s.weight || 0), 0);
  for (const [tx, signers] of cases) {
    const oldResult = oldCollectSignersForTx(tx, signers);
    const newResult = verifyCollected(tx, signers);
    assert.deepEqual(newResult, oldResult.filter((s) => s.weight > 0));
    assert.equal(sum(newResult), sum(oldResult));
  }
});

// --- Challenge (ADR 0004), Korrektur K5 ---------------------------------------------------------
test('Challenge: Ausgabe von signMultisigJobChallenge (fester Vektor) wird angenommen', () => {
  assert.equal(Keypair.fromSecret(vector.secret).publicKey(), vector.publicKey);
  assert.equal(verifyChallengeSignature(vector.nonce, vector.signature, vector.publicKey, vector.purpose), true);
  assert.equal(verifyChallenge(vector.publicKey, challengeMessage(vector.nonce, vector.purpose), vector.signature), true);
});

test('K5: dieselbe Signatur mit Fremdzeichen, ohne Padding oder als base64url wird abgelehnt', () => {
  const sig = vector.signature;
  assert.ok(sig.includes('+') && sig.includes('/') && sig.endsWith('=='));
  const variants = {
    fremdzeichen: `${sig.slice(0, 10)}!${sig.slice(10)}`,
    leerzeichen: ` ${sig}`,
    zeilenumbruch: `${sig}\n`,
    ohnePadding: sig.replace(/=+$/, ''),
    base64url: sig.replace(/\+/g, '-').replace(/\//g, '_'),
    base64urlOhnePadding: sig.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    gekuerzt: sig.slice(0, -4),
  };
  for (const [name, value] of Object.entries(variants)) {
    assert.equal(verifyChallengeSignature(vector.nonce, value, vector.publicKey, vector.purpose), false, name);
  }
  // Vorher (Buffer.from tolerant) haette Node die Variante ohne Padding angenommen:
  assert.equal(Keypair.fromPublicKey(vector.publicKey).verify(challengeMessage(vector.nonce, vector.purpose), Buffer.from(variants.ohnePadding, 'base64')), true);
});

test('Challenge: falscher Zweck, falscher Key oder 63 Byte werden abgelehnt', () => {
  assert.equal(verifyChallengeSignature(vector.nonce, vector.signature, vector.publicKey, 'decline'), false);
  assert.equal(verifyChallengeSignature(vector.nonce, vector.signature, Keypair.random().publicKey(), vector.purpose), false);
  const short = Buffer.from(vector.signature, 'base64').subarray(0, 63).toString('base64');
  assert.equal(verifyChallengeSignature(vector.nonce, short, vector.publicKey, vector.purpose), false);
});

test('decodeStrictBase64: nur kanonisches Standard-base64 mit Padding', () => {
  assert.deepEqual(decodeStrictBase64('AAEC'), Buffer.from([0, 1, 2]));
  assert.deepEqual(decodeStrictBase64('AAE='), Buffer.from([0, 1]));
  for (const v of ['', 'AAE', 'AA-_', 'AAF=', 'AA==AA==', null, 123]) assert.equal(decodeStrictBase64(v), null, String(v));
});
