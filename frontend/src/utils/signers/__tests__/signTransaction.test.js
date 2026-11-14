// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { NO_KEYS_ERROR, SIGNING_FAILED_ERROR, attachSignatures, toCollectedSigner } from '../signTransaction.js';
import { SIGNER_TYPES } from '../signerRules.js';

const a = Keypair.random();
const b = Keypair.random();

function buildTx() {
  return new TransactionBuilder(new Account(a.publicKey(), '100'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .setTimeout(60)
    .build();
}
const collected = (kp, extra = {}) => ({ publicKey: kp.publicKey(), weight: 1, keypair: kp, ...extra });
const sigsOf = (tx) => tx.signatures.map((s) => s.toXDR('base64'));

describe('toCollectedSigner', () => {
  it('bringt ein Keypair ins Format des Key-Dialogs', () => {
    expect(toCollectedSigner(a, { weight: 2 })).toEqual({ publicKey: a.publicKey(), weight: 2, type: SIGNER_TYPES.ED25519, keypair: a });
    expect(toCollectedSigner(a).weight).toBe(0);
  });
  it('wirft nie, auch nicht bei Muell', () => {
    expect(toCollectedSigner(null).publicKey).toBe('');
    expect(toCollectedSigner({ publicKey: () => { throw new Error('x'); } }).publicKey).toBe('');
  });
});

describe('attachSignatures', () => {
  it('ein Signer: genau eine Signatur, identisch mit tx.sign', () => {
    const tx = buildTx();
    const ref = buildTx();
    ref.sign(a);
    expect(attachSignatures(tx, [collected(a)])).toBe(tx);
    expect(sigsOf(tx)).toEqual(sigsOf(ref));
  });

  it('zwei Signer: beide Signaturen in Reihenfolge der Liste', () => {
    const tx = buildTx();
    const ref = buildTx();
    ref.sign(a, b);
    attachSignatures(tx, [collected(a), collected(b)]);
    expect(sigsOf(tx)).toEqual(sigsOf(ref));
  });

  it('Eintraege ohne publicKey und type (z. B. aus collectEffectiveSigners) werden angenommen', () => {
    const tx = buildTx();
    attachSignatures(tx, [{ keypair: a, weight: 99 }]);
    expect(tx.signatures).toHaveLength(1);
  });

  it('doppelter Signer: nur eine Signatur', () => {
    const tx = buildTx();
    attachSignatures(tx, [collected(a), collected(a), toCollectedSigner(a)]);
    expect(tx.signatures).toHaveLength(1);
  });

  it('leere oder fehlende Liste: noKeysProvided, nichts angehaengt', () => {
    const tx = buildTx();
    expect(() => attachSignatures(tx, [])).toThrow(NO_KEYS_ERROR);
    expect(() => attachSignatures(tx, undefined)).toThrow(NO_KEYS_ERROR);
    expect(tx.signatures).toHaveLength(0);
  });

  describe('Teilfehler: wirft signingFailed, Transaktion unveraendert (auch mit vorhandener Signatur)', () => {
    const cases = [
      ['zweiter Eintrag ohne Secret', () => [collected(a), { publicKey: b.publicKey(), keypair: Keypair.fromPublicKey(b.publicKey()) }]],
      ['zweiter Eintrag ohne keypair', () => [collected(a), { publicKey: b.publicKey() }]],
      ['nicht unterstuetzter Typ', () => [collected(a), collected(b, { type: SIGNER_TYPES.SHA256_HASH })]],
      ['unbekannter Typ', () => [collected(a), collected(b, { type: 'ml_dsa_44' })]],
      ['publicKey passt nicht zum keypair', () => [collected(a), { publicKey: a.publicKey(), keypair: b }]],
      ['Muell statt Eintrag', () => [collected(a), null]],
    ];
    it.each(cases)('%s', (_name, entries) => {
      const tx = buildTx();
      tx.sign(b); // bereits vorhandene Signatur
      const before = sigsOf(tx);
      expect(() => attachSignatures(tx, entries())).toThrow(SIGNING_FAILED_ERROR);
      expect(sigsOf(tx)).toEqual(before);
    });
  });

  it('SDK wirft in der Signierphase beim zweiten Key: keine Signatur angehaengt', () => {
    const tx = buildTx();
    const broken = Keypair.fromSecret(b.secret());
    vi.spyOn(broken, 'signDecorated').mockImplementation(() => { throw new Error('boom'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => attachSignatures(tx, [collected(a), collected(broken)])).toThrow(SIGNING_FAILED_ERROR);
    expect(tx.signatures).toHaveLength(0);
    err.mockRestore();
  });

  it('der Fehler traegt die Ursache (cause), aber kein Secret', () => {
    const tx = buildTx();
    let caught;
    try { attachSignatures(tx, [collected(a, { type: 'preauth_tx' })]); } catch (e) { caught = e; }
    expect(caught.message).toBe(SIGNING_FAILED_ERROR);
    expect(caught.cause).toBeInstanceOf(Error);
    expect(String(caught.cause.message)).not.toContain(a.secret());
  });

  it('FeeBumpTransaction: signiert die aeussere Transaktion', () => {
    const inner = buildTx();
    inner.sign(a);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(b, '200', inner, Networks.TESTNET);
    const ref = TransactionBuilder.buildFeeBumpTransaction(b, '200', inner, Networks.TESTNET);
    ref.sign(b);
    attachSignatures(feeBump, [collected(b)]);
    expect(feeBump.signatures).toHaveLength(1);
    expect(sigsOf(feeBump)).toEqual(sigsOf(ref));
  });
});
