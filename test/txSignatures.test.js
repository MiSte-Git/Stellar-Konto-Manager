const test = require('node:test');
const assert = require('node:assert/strict');
const { Account, TransactionBuilder, Operation, Networks, Keypair, xdr } = require('@stellar/stellar-sdk');
const { filterValidSignatures, MAX_TX_SIGNATURES } = require('../services/txSignatures.js');

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
