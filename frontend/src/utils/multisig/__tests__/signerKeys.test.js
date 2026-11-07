import { describe, expect, it } from 'vitest';
import { Keypair, MuxedAccount, Account } from '@stellar/stellar-sdk';
import { findInvalidSignerKey, isValidSignerKey } from '../signerKeys.js';

const G = Keypair.random().publicKey();
const S = Keypair.random().secret();
const M = new MuxedAccount(new Account(G, '1'), '7').accountId();
// gueltige Form, falsche Pruefsumme: letztes Zeichen aendern
const BAD_CHECKSUM = G.slice(0, -1) + (G.endsWith('A') ? 'B' : 'A');

describe('Signer-Adresse', () => {
  it('akzeptiert eine gueltige G-Adresse (auch mit Leerzeichen)', () => {
    expect(isValidSignerKey(G)).toBe(true);
    expect(isValidSignerKey(` ${G} `)).toBe(true);
  });
  it('lehnt ungueltige Pruefsumme, M-Adresse und S-Key ab', () => {
    expect(isValidSignerKey(BAD_CHECKSUM)).toBe(false);
    expect(M.startsWith('M')).toBe(true);
    expect(isValidSignerKey(M)).toBe(false);
    expect(isValidSignerKey(S)).toBe(false);
    expect(isValidSignerKey('GABC')).toBe(false);
  });
  it('findInvalidSignerKey meldet den ersten ungueltigen, leere Zeilen sind erlaubt', () => {
    expect(findInvalidSignerKey([{ key: G }, { key: '' }, { key: ' ' }])).toBeNull();
    expect(findInvalidSignerKey([{ key: G }, { key: M }, { key: S }])).toBe(M);
    expect(findInvalidSignerKey([G, BAD_CHECKSUM])).toBe(BAD_CHECKSUM);
    expect(findInvalidSignerKey(null)).toBeNull();
  });
});
