// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { buildSep7Pay, networkMismatch, parsePaymentInput, parseSep7Pay, validateRequestFields } from '../sep7.js';

const DEST = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();

describe('buildSep7Pay und parseSep7Pay', () => {
  it('Hin- und Rueckweg mit Betrag, Asset, Memo und Testnet', () => {
    const uri = buildSep7Pay({ destination: DEST, amount: '12.5', asset: { isNative: false, code: 'USDC', issuer: ISSUER }, memo: { type: 'text', value: 'Rechnung 7 & 8' }, network: 'TESTNET' });
    expect(uri.startsWith('web+stellar:pay?destination=')).toBe(true);
    const r = parseSep7Pay(uri);
    expect(r).toMatchObject({ ok: true, destination: DEST, amount: '12.5', asset: { code: 'USDC', issuer: ISSUER }, memo: { type: 'text', value: 'Rechnung 7 & 8' }, networkPassphrase: Networks.TESTNET });
  });

  it('nur Adresse: XLM, kein Memo, Mainnet ohne Passphrase', () => {
    const uri = buildSep7Pay({ destination: DEST });
    expect(uri).toBe(`web+stellar:pay?destination=${DEST}`);
    expect(parseSep7Pay(uri)).toMatchObject({ ok: true, asset: { isNative: true }, memo: null, networkPassphrase: '' });
  });

  it('MEMO_ID und MEMO_HASH (base64 mit +) werden korrekt gelesen', () => {
    expect(parseSep7Pay(`web+stellar:pay?destination=${DEST}&memo=123456789&memo_type=MEMO_ID`).memo).toEqual({ type: 'id', value: '123456789' });
    const b64 = Buffer.from('fb'.repeat(32), 'hex').toString('base64'); // enthaelt + und /
    const r = parseSep7Pay(`web+stellar:pay?destination=${DEST}&memo=${encodeURIComponent(b64)}&memo_type=MEMO_HASH`);
    expect(r.memo).toEqual({ type: 'hash', value: 'fb'.repeat(32) });
  });

  it('meldet Herkunft, Signatur und Callback nur als Flags', () => {
    const r = parseSep7Pay(`web+stellar:pay?destination=${DEST}&origin_domain=shop.example&signature=abc&callback=url%3Ahttps%3A%2F%2Fevil.example&msg=Danke`);
    expect(r).toMatchObject({ ok: true, originDomain: 'shop.example', hasSignature: true, hasCallback: true, msg: 'Danke' });
  });

  it('lehnt ungueltige oder gefaehrliche Anfragen ab', () => {
    expect(parseSep7Pay('web+stellar:tx?xdr=AAAA').error).toBe('txUnsupported');
    expect(parseSep7Pay('web+stellar:pay?destination=kaputt').error).toBe('invalidDestination');
    expect(parseSep7Pay(`web+stellar:pay?destination=${DEST}&amount=-1`).error).toBe('invalidAmount');
    expect(parseSep7Pay(`web+stellar:pay?destination=${DEST}&amount=1.12345678`).error).toBe('invalidAmount');
    expect(parseSep7Pay(`web+stellar:pay?destination=${DEST}&asset_code=USDC`).error).toBe('invalidAsset');
    expect(parseSep7Pay(`web+stellar:pay?destination=${DEST}&memo=${'x'.repeat(29)}`).error).toBe('invalidMemo');
    expect(parseSep7Pay(`web+stellar:pay?destination=${DEST}&memo=99999999999999999999&memo_type=MEMO_ID`).error).toBe('invalidMemo');
    expect(parseSep7Pay(`web+stellar:pay?destination=${DEST}&destination=${ISSUER}`).error).toBe('invalid');
  });
});

describe('parsePaymentInput', () => {
  it('erkennt Adresse, Federation und SEP-7', () => {
    expect(parsePaymentInput(` ${DEST} `)).toEqual({ ok: true, kind: 'address', destination: DEST });
    expect(parsePaymentInput('bob*lobstr.co')).toEqual({ ok: true, kind: 'address', destination: 'bob*lobstr.co' });
    expect(parsePaymentInput(`web+stellar:pay?destination=${DEST}`).kind).toBe('pay');
    expect(parsePaymentInput('https://example.com').error).toBe('unrecognized');
    expect(parsePaymentInput('').error).toBe('empty');
  });
});

describe('networkMismatch', () => {
  it('ohne Passphrase gilt Mainnet', () => {
    expect(networkMismatch({ networkPassphrase: '' }, 'PUBLIC')).toBe(false);
    expect(networkMismatch({ networkPassphrase: '' }, 'TESTNET')).toBe(true);
    expect(networkMismatch({ networkPassphrase: Networks.TESTNET }, 'TESTNET')).toBe(false);
    expect(networkMismatch({ networkPassphrase: Networks.TESTNET }, 'PUBLIC')).toBe(true);
  });
});

describe('validateRequestFields', () => {
  it('prueft Betrag und Memo', () => {
    expect(validateRequestFields({ amount: '', memoType: 'text', memo: '' })).toBeNull();
    expect(validateRequestFields({ amount: '0', memoType: 'text', memo: '' })).toBe('invalidAmount');
    expect(validateRequestFields({ amount: '1', memoType: 'id', memo: 'abc' })).toBe('invalidMemoId');
    expect(validateRequestFields({ amount: '1', memoType: 'text', memo: 'ä'.repeat(15) })).toBe('memoTooLong');
  });
});
