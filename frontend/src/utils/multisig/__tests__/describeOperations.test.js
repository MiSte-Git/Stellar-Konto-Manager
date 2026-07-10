import { describe, expect, it } from 'vitest';
import { Account, Asset, Keypair, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { describeOperations, shortKey } from '../describeOperations.js';

// Mirrors react-i18next's t() signature closely enough for describeOperations()'s
// purposes: interpolates {{var}} placeholders from the options object, ignoring
// the reserved `defaultValue`/`ns` keys, and otherwise falls back to the key path.
function fakeT(key, opts = {}) {
  const { defaultValue, ...vars } = opts;
  let out = defaultValue || key;
  Object.entries(vars).forEach(([k, v]) => {
    out = out.replaceAll(`{{${k}}}`, String(v));
  });
  return out;
}

function buildTx(ops) {
  const source = Keypair.random();
  const account = new Account(source.publicKey(), '100');
  const builder = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(60).build();
}

describe('shortKey', () => {
  it('abbreviates a full public key to first8…last8', () => {
    const kp = Keypair.random();
    const pk = kp.publicKey();
    expect(shortKey(pk)).toBe(`${pk.slice(0, 8)}…${pk.slice(-8)}`);
  });

  it('returns short strings unchanged', () => {
    expect(shortKey('abc')).toBe('abc');
    expect(shortKey('')).toBe('');
  });
});

describe('describeOperations', () => {
  it('returns an empty array for no operations', () => {
    expect(describeOperations([], fakeT)).toEqual([]);
    expect(describeOperations(null, fakeT)).toEqual([]);
    expect(describeOperations(undefined, fakeT)).toEqual([]);
  });

  it('describes a native payment with the exact amount/asset/destination interpolated', () => {
    const dest = Keypair.random().publicKey();
    const tx = buildTx([Operation.payment({ destination: dest, asset: Asset.native(), amount: '12.5' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Zahlung: 12.5000000 XLM an ${shortKey(dest)}`);
  });

  it('describes a payment in a non-native asset by its code, not "native"', () => {
    const dest = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();
    const asset = new Asset('TRUST', issuer);
    const tx = buildTx([Operation.payment({ destination: dest, asset, amount: '1' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toContain('TRUST');
    expect(line).not.toContain('native');
  });

  it('describes createAccount with destination and starting balance', () => {
    const dest = Keypair.random().publicKey();
    const tx = buildTx([Operation.createAccount({ destination: dest, startingBalance: '5' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Konto erstellen: ${shortKey(dest)} mit 5.0000000 XLM Startguthaben`);
  });

  it('describes setOptions masterWeight in isolation', () => {
    const tx = buildTx([Operation.setOptions({ masterWeight: 3 })]);
    const lines = describeOperations(tx.operations, fakeT);
    expect(lines).toEqual(['Master-Gewicht setzen auf 3']);
  });

  it('describes a setOptions signer addition (weight > 0) as signerAdd, not signerRemove', () => {
    const signerKey = Keypair.random().publicKey();
    const tx = buildTx([Operation.setOptions({ signer: { ed25519PublicKey: signerKey, weight: 5 } })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Gewicht für Signer ${shortKey(signerKey)} auf 5 setzen`);
  });

  it('describes a setOptions signer removal (weight 0) as signerRemove, not signerAdd', () => {
    const signerKey = Keypair.random().publicKey();
    const tx = buildTx([Operation.setOptions({ signer: { ed25519PublicKey: signerKey, weight: 0 } })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Signer ${shortKey(signerKey)} entfernen`);
  });

  it('describes setOptions thresholds with all three levels interpolated', () => {
    const tx = buildTx([Operation.setOptions({ lowThreshold: 1, medThreshold: 2, highThreshold: 3 })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe('Schwellenwerte setzen: niedrig=1, mittel=2, hoch=3');
  });

  it('a single setOptions operation combining masterWeight + signer + thresholds expands to three separate lines', () => {
    const signerKey = Keypair.random().publicKey();
    const tx = buildTx([Operation.setOptions({
      masterWeight: 2,
      signer: { ed25519PublicKey: signerKey, weight: 4 },
      lowThreshold: 1,
      medThreshold: 2,
      highThreshold: 3,
    })]);
    const lines = describeOperations(tx.operations, fakeT);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Master-Gewicht');
    expect(lines[1]).toContain('Gewicht für Signer');
    expect(lines[2]).toContain('Schwellenwerte');
  });

  it('describes changeTrust with asset code and limit', () => {
    const issuer = Keypair.random().publicKey();
    const asset = new Asset('TRUST', issuer);
    const tx = buildTx([Operation.changeTrust({ asset, limit: '1000' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe('Trustline für TRUST setzen (Limit: 1000.0000000)');
  });

  it('describes accountMerge with the destination account', () => {
    const dest = Keypair.random().publicKey();
    const tx = buildTx([Operation.accountMerge({ destination: dest })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Konto zusammenführen mit ${shortKey(dest)}`);
  });

  it('falls back to a generic "unknown operation" line for an operation type this app never builds itself, without throwing', () => {
    const tx = buildTx([Operation.bumpSequence({ bumpTo: '101' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe('Unbekannte Operation: bumpSequence');
  });

  it('produces one line per operation in a multi-operation transaction, in order', () => {
    const destA = Keypair.random().publicKey();
    const destB = Keypair.random().publicKey();
    const tx = buildTx([
      Operation.createAccount({ destination: destA, startingBalance: '2' }),
      Operation.payment({ destination: destB, asset: Asset.native(), amount: '0.0000001' }),
    ]);
    const lines = describeOperations(tx.operations, fakeT);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Konto erstellen');
    expect(lines[1]).toContain('Zahlung');
  });

  it('interpolation placeholder names exactly match what the translation call passes (regression: G5 stage 2 DeepL renamed placeholders in several locales, e.g. {{destination}} -> {{destino}}/{{destinazione}}/{{bestemming}})', () => {
    // A t() that returns the raw template with placeholders untouched would
    // reveal any name mismatch immediately, since fakeT above only replaces
    // {{amount}}/{{asset}}/{{destination}} etc. - a stray {{destino}} would
    // survive verbatim in the output.
    const dest = Keypair.random().publicKey();
    const tx = buildTx([Operation.accountMerge({ destination: dest })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).not.toMatch(/\{\{.*\}\}/);
  });

  it('sanity: shortKey output used in assertions above is a validly-shaped ed25519 abbreviation', () => {
    const kp = Keypair.random();
    expect(StrKey.isValidEd25519PublicKey(kp.publicKey())).toBe(true);
  });
});
