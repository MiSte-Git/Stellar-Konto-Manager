// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { bytesToHex, txHashHex } from '../txHash.js';

function buildTx() {
  const source = new Account(Keypair.random().publicKey(), '1');
  return new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(30)
    .build();
}

describe('txHashHex', () => {
  it('entspricht dem bisherigen Buffer-Hex unter SDK v16', () => {
    const tx = buildTx();
    expect(txHashHex(tx)).toBe(Buffer.from(tx.hash()).toString('hex'));
    expect(txHashHex(tx)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('liefert auch fuer ein reines Uint8Array (SDK v17) Hex statt "12,34,..."', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 171, 255]);
    expect(bytes.toString('hex')).toBe('0,1,15,16,171,255');
    expect(bytesToHex(bytes)).toBe('00010f10abff');
    expect(txHashHex({ hash: () => bytes })).toBe('00010f10abff');
  });

  it('lehnt alles ab, was keine Bytes sind', () => {
    expect(() => bytesToHex('abc')).toThrow(TypeError);
    expect(() => bytesToHex([1, 2])).toThrow(TypeError);
  });
});
