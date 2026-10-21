const test = require('node:test');
const assert = require('node:assert/strict');
const { Account, TransactionBuilder, Operation, Networks, Keypair, xdr } = require('@stellar/stellar-sdk');
const { filterValidSignatures, MAX_TX_SIGNATURES, operationThresholdCategory, requiredWeightForOperations, signatureKey, decoratedSignatureBytes } = require('../services/txSignatures.js');

function buildTx(sourceKeypair) {
  const account = new Account(sourceKeypair.publicKey(), '100');
  return new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: '101' }))
    .setTimeout(60)
    .build();
}

function signerEntry(keypair, weight = 1) {
  return { publicKey: keypair.publicKey(), weight };
}

function garbageSignature() {
  return new xdr.DecoratedSignature({
    hint: require('crypto').randomBytes(4),
    signature: require('crypto').randomBytes(64),
  });
}

test('filterValidSignatures keeps a genuine signature from a known signer', () => {
  const source = Keypair.random();
  const signerA = Keypair.random();
  const tx = buildTx(source);
  tx.sign(signerA);

  const kept = filterValidSignatures(tx, [signerEntry(signerA)]);
  assert.equal(kept.length, 1);
});

test('filterValidSignatures drops a genuine signature from a key that is not a known signer', () => {
  const source = Keypair.random();
  const impostor = Keypair.random();
  const knownSigner = Keypair.random();
  const tx = buildTx(source);
  tx.sign(impostor); // valid signature, but not one of the known signers below

  const kept = filterValidSignatures(tx, [signerEntry(knownSigner)]);
  assert.equal(kept.length, 0);
});

test('filterValidSignatures drops a garbage signature while keeping genuine ones', () => {
  const source = Keypair.random();
  const signerA = Keypair.random();
  const signerB = Keypair.random();
  const tx = buildTx(source);
  tx.sign(signerA);
  tx.sign(signerB);
  tx.signatures.push(garbageSignature());
  assert.equal(tx.signatures.length, 3, 'sanity: 2 genuine + 1 garbage before filtering');

  const kept = filterValidSignatures(tx, [signerEntry(signerA), signerEntry(signerB)]);
  assert.equal(kept.length, 2);
});

test('filterValidSignatures ignores a signer entry with weight 0', () => {
  const source = Keypair.random();
  const revokedSigner = Keypair.random();
  const tx = buildTx(source);
  tx.sign(revokedSigner);

  const kept = filterValidSignatures(tx, [signerEntry(revokedSigner, 0)]);
  assert.equal(kept.length, 0);
});

test('filterValidSignatures caps the result at MAX_TX_SIGNATURES even for all-genuine input', () => {
  const source = Keypair.random();
  const tx = buildTx(source);
  const signers = [];
  for (let i = 0; i < 22; i += 1) {
    const kp = Keypair.random();
    tx.sign(kp);
    signers.push(signerEntry(kp));
  }
  assert.equal(tx.signatures.length, 22, 'sanity: 22 genuine signatures before capping');

  const kept = filterValidSignatures(tx, signers);
  assert.equal(kept.length, MAX_TX_SIGNATURES);
  assert.equal(MAX_TX_SIGNATURES, 20);
});

test('end-to-end: a garbage signature merged in from an incoming XDR never survives filtering', () => {
  const source = Keypair.random();
  const signerA = Keypair.random();
  const signerB = Keypair.random();

  // Mirrors the merge route: target already has A's signature, incoming XDR
  // brings B's signature plus a garbage one an attacker tacked on.
  const target = buildTx(source);
  target.sign(signerA);
  const incoming = buildTx(source);
  incoming.sign(signerB);
  incoming.signatures.push(garbageSignature());

  const existingKeys = new Set(target.signatures.map((s) => `${s.hint().toString('base64')}:${s.signature().toString('base64')}`));
  incoming.signatures.forEach((sig) => {
    const key = `${sig.hint().toString('base64')}:${sig.signature().toString('base64')}`;
    if (!existingKeys.has(key)) {
      target.signatures.push(sig);
      existingKeys.add(key);
    }
  });
  assert.equal(target.signatures.length, 3, 'sanity: A + B + garbage before filtering');

  // tx.signatures has no public setter (stellar-sdk throws "Transaction is
  // immutable" on assignment) - the array itself is mutable in place, same
  // as the fix applied in server.js's merge route.
  const validSignatures = filterValidSignatures(target, [signerEntry(signerA, 4), signerEntry(signerB, 6)]);
  target.signatures.length = 0;
  target.signatures.push(...validSignatures);
  assert.equal(target.signatures.length, 2, 'garbage signature stripped, A and B remain');
});

// --- operationThresholdCategory / requiredWeightForOperations ---------------
// Bug fix (analyse_multisig.md b1): requiredWeight used to be hardcoded to
// med_threshold regardless of operation type. setOptions (what "Multisig
// bearbeiten" builds) is a High-threshold operation on the real Stellar
// protocol, so a job for it must require high_threshold, not med_threshold.

test('operationThresholdCategory classifies setOptions and accountMerge as high', () => {
  assert.equal(operationThresholdCategory('setOptions'), 'high');
  assert.equal(operationThresholdCategory('accountMerge'), 'high');
});

test('operationThresholdCategory classifies allowTrust/inflation/bumpSequence/setTrustLineFlags as low', () => {
  assert.equal(operationThresholdCategory('allowTrust'), 'low');
  assert.equal(operationThresholdCategory('inflation'), 'low');
  assert.equal(operationThresholdCategory('bumpSequence'), 'low');
  assert.equal(operationThresholdCategory('setTrustLineFlags'), 'low');
});

test('operationThresholdCategory classifies payment, createAccount, changeTrust and unknown types as medium', () => {
  assert.equal(operationThresholdCategory('payment'), 'med');
  assert.equal(operationThresholdCategory('createAccount'), 'med');
  assert.equal(operationThresholdCategory('changeTrust'), 'med');
  assert.equal(operationThresholdCategory('somethingFuture'), 'med');
});

test('requiredWeightForOperations uses high_threshold for a setOptions-only job (the actual bug)', () => {
  const thresholds = { low: 1, med: 2, high: 3 };
  assert.equal(requiredWeightForOperations([{ type: 'setOptions' }], thresholds), 3);
});

test('requiredWeightForOperations uses med_threshold for a payment-only job', () => {
  const thresholds = { low: 1, med: 2, high: 3 };
  assert.equal(requiredWeightForOperations([{ type: 'payment' }], thresholds), 2);
});

test('requiredWeightForOperations picks the highest category when operation types are mixed', () => {
  const thresholds = { low: 1, med: 2, high: 3 };
  assert.equal(
    requiredWeightForOperations([{ type: 'payment' }, { type: 'setOptions' }], thresholds),
    3,
    'high must win even though payment (medium) also appears in the same transaction'
  );
  assert.equal(
    requiredWeightForOperations([{ type: 'bumpSequence' }, { type: 'payment' }], thresholds),
    2,
    'medium must win over a co-occurring low-category operation'
  );
});

test('requiredWeightForOperations falls back through the chain when a category threshold is 0, mirroring getRequiredThreshold.js', () => {
  assert.equal(requiredWeightForOperations([{ type: 'setOptions' }], { low: 1, med: 2, high: 0 }), 2);
  assert.equal(requiredWeightForOperations([{ type: 'setOptions' }], { low: 1, med: 0, high: 0 }), 1);
  assert.equal(requiredWeightForOperations([{ type: 'payment' }], { low: 1, med: 0, high: 3 }), 3);
  assert.equal(requiredWeightForOperations([{ type: 'bumpSequence' }], { low: 0, med: 0, high: 3 }), 3);
});

test('requiredWeightForOperations returns 0 for an all-zero threshold set (account has no multisig configured)', () => {
  assert.equal(requiredWeightForOperations([{ type: 'setOptions' }], { low: 0, med: 0, high: 0 }), 0);
});

test('requiredWeightForOperations falls back to med_threshold when no operations are given (defensive, matches pre-fix behavior)', () => {
  assert.equal(requiredWeightForOperations([], { low: 1, med: 2, high: 3 }), 2);
  assert.equal(requiredWeightForOperations(undefined, { low: 1, med: 2, high: 3 }), 2);
});

test('requiredWeightForOperations reads real .type values off SDK-built setOptions and payment transactions', () => {
  const source = Keypair.random();
  const account = new Account(source.publicKey(), '100');
  const setOptionsTx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.setOptions({ masterWeight: 2 }))
    .addOperation(Operation.setOptions({ highThreshold: 3, medThreshold: 2, lowThreshold: 1 }))
    .setTimeout(60)
    .build();
  assert.equal(
    requiredWeightForOperations(setOptionsTx.operations, { low: 1, med: 2, high: 3 }),
    3,
    'a real multi-operation setOptions transaction (as MultisigEditPage.jsx builds) requires the high threshold'
  );

  const paymentTx = new TransactionBuilder(new Account(source.publicKey(), '100'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: require('@stellar/stellar-sdk').Asset.native(), amount: '1' }))
    .setTimeout(60)
    .build();
  assert.equal(requiredWeightForOperations(paymentTx.operations, { low: 1, med: 2, high: 3 }), 2);
});

// --- stellar-sdk v17 Vorbereitung: Signatur-Bytes unabhaengig von der XDR-API ---

// Nachbildung der v17-Form (js-xdr v5): Felder als Properties, Werte als Wrapper mit
// toBytes(), deren toString() Hex liefert und die selbst kein Uint8Array sind.
function v17Wrapper(bytes) {
  const raw = Uint8Array.from(bytes);
  return { toBytes: () => raw, toString: () => Buffer.from(raw).toString('hex') };
}
function v17Signature(sig) {
  return { hint: v17Wrapper(sig.hint()), signature: v17Wrapper(sig.signature()) };
}

test('signatureKey entspricht unter v16 dem bisherigen hint:signature in base64', () => {
  const kp = Keypair.random();
  const tx = buildTx(kp);
  tx.sign(kp);
  const sig = tx.signatures[0];
  assert.equal(signatureKey(sig), `${sig.hint().toString('base64')}:${sig.signature().toString('base64')}`);
});

test('signatureKey liefert fuer v16- und v17-Form denselben Schluessel', () => {
  const kp = Keypair.random();
  const tx = buildTx(kp);
  tx.sign(kp);
  const sig = tx.signatures[0];
  assert.equal(signatureKey(v17Signature(sig)), signatureKey(sig));
});

test('decoratedSignatureBytes wirft bei unlesbaren oder falsch langen Feldern', () => {
  assert.throws(() => decoratedSignatureBytes({}), TypeError);
  assert.throws(() => decoratedSignatureBytes({ hint: 'abcd', signature: 'x' }), TypeError);
  assert.throws(() => decoratedSignatureBytes({ hint: new Uint8Array(3), signature: new Uint8Array(64) }), TypeError);
  assert.throws(() => decoratedSignatureBytes({ hint: new Uint8Array(4), signature: new Uint8Array(65) }), TypeError);
});

test('filterValidSignatures arbeitet mit v17-Form (Uint8Array-Hash, Wrapper-Felder)', () => {
  const signer = Keypair.random();
  const stranger = Keypair.random();
  const tx = buildTx(signer);
  tx.sign(signer);
  tx.sign(stranger);
  const fakeV17Tx = {
    hash: () => Uint8Array.from(tx.hash()),
    signatures: [v17Signature(tx.signatures[0]), v17Signature(tx.signatures[1]), v17Signature(garbageSignature())],
  };
  const kept = filterValidSignatures(fakeV17Tx, [signerEntry(signer)]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0], fakeV17Tx.signatures[0]);
});

test('filterValidSignatures verwirft eine v17-Signatur mit passendem Hint, aber falscher Signatur', () => {
  const signer = Keypair.random();
  const tx = buildTx(signer);
  tx.sign(signer);
  const forged = { hint: v17Wrapper(signer.signatureHint()), signature: v17Wrapper(new Uint8Array(64)) };
  const kept = filterValidSignatures({ hash: () => Uint8Array.from(tx.hash()), signatures: [forged] }, [signerEntry(signer)]);
  assert.equal(kept.length, 0);
});

test('toBytes-Wrapper, die keine Bytes liefern, oder werfende Getter gelten als ungueltig', () => {
  const bad = [
    { hint: { toBytes: () => 'abcd' }, signature: v17Wrapper(new Uint8Array(64)) },
    { hint: v17Wrapper(new Uint8Array(4)), signature: { toBytes: () => [1, 2, 3] } },
    { hint() { throw new Error('boom'); }, signature: v17Wrapper(new Uint8Array(64)) },
  ];
  for (const sig of bad) assert.throws(() => decoratedSignatureBytes(sig));
  const signer = Keypair.random();
  const tx = buildTx(signer);
  assert.equal(filterValidSignatures({ hash: () => Uint8Array.from(tx.hash()), signatures: bad }, [signerEntry(signer)]).length, 0);
});

test('filterValidSignatures begrenzt auch v17-Signaturen auf MAX_TX_SIGNATURES', () => {
  const signers = Array.from({ length: MAX_TX_SIGNATURES + 3 }, () => Keypair.random());
  const tx = buildTx(signers[0]);
  signers.forEach((kp) => tx.sign(kp));
  const fakeV17Tx = { hash: () => Uint8Array.from(tx.hash()), signatures: tx.signatures.map(v17Signature) };
  const kept = filterValidSignatures(fakeV17Tx, signers.map((kp) => signerEntry(kp)));
  assert.equal(kept.length, MAX_TX_SIGNATURES);
});

test('filterValidSignatures akzeptiert signatureHint() als v17-Wrapper', () => {
  const signer = Keypair.random();
  const tx = buildTx(signer);
  tx.sign(signer);
  const original = Keypair.prototype.signatureHint;
  Keypair.prototype.signatureHint = function wrappedHint() { return v17Wrapper(original.call(this)); };
  try {
    const kept = filterValidSignatures({ hash: () => Uint8Array.from(tx.hash()), signatures: [v17Signature(tx.signatures[0])] }, [signerEntry(signer)]);
    assert.equal(kept.length, 1);
  } finally {
    Keypair.prototype.signatureHint = original;
  }
});
