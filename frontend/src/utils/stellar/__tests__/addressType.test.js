// C- und W-Adressen (Contract, muxed Contract seit Protocol 30 / CAP-84) werden erkannt und mit
// eigener Meldung abgelehnt: in der Klassifizierung, in resolveOrValidateAccount, bei Federation
// und im SEP-7-/QR-Parser.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { classifyStellarAddress, isContractAddress, CONTRACT_ADDRESS_ERROR } from '../addressType.js';
import { resolveOrValidateAccount, resolveFederationAddress } from '../stellarUtils.js';
import { parsePaymentInput, parseSep7Pay } from '../sep7.js';

const G = Keypair.random().publicKey();
const M = StrKey.encodeMed25519PublicKey(new Uint8Array([...StrKey.decodeEd25519PublicKey(G), 0, 0, 0, 0, 0, 0, 0, 7]));
// Gleiche Vektoren wie test/assets/federationCases.json (accounts.contract)
const C = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const W = 'WADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOAAAAAAAAAAAFIH4U';

afterEach(() => vi.unstubAllGlobals());

describe('classifyStellarAddress', () => {
  it.each([
    ['G', G, 'account'],
    ['M', M, 'muxed'],
    ['C', C, 'contract'],
    ['W', W, 'muxedContract'],
    ['C mit falscher Checksumme', C.slice(0, -1) + 'A', 'invalid'],
    ['W mit falscher Checksumme', W.slice(0, -1) + 'A', 'invalid'],
    ['W zu kurz', W.slice(0, -1), 'invalid'],
    ['W kleingeschrieben', W.toLowerCase(), 'invalid'],
    ['W mit Leerzeichen', ` ${W}`, 'invalid'],
    ['leer', '', 'invalid'],
    ['kein String', null, 'invalid'],
    ['Muell', 'hallo', 'invalid'],
  ])('%s', (_label, input, expected) => {
    expect(classifyStellarAddress(input)).toBe(expected);
  });

  it('isContractAddress nur fuer C und W', () => {
    expect([G, M, C, W, 'x'].map(isContractAddress)).toEqual([false, false, true, true, false]);
  });
});

describe('resolveOrValidateAccount', () => {
  it.each([['C', C], ['W', W]])('lehnt %s-Adressen mit eigenem Schluessel ab', async (_l, addr) => {
    await expect(resolveOrValidateAccount(addr)).rejects.toThrow(CONTRACT_ADDRESS_ERROR);
  });

  it('G, M und Muell verhalten sich wie bisher', async () => {
    await expect(resolveOrValidateAccount(G)).resolves.toMatchObject({ accountId: G, muxedAddress: null });
    await expect(resolveOrValidateAccount(M)).resolves.toMatchObject({ accountId: G, muxedAddress: M });
    await expect(resolveOrValidateAccount('GNOTVALID')).rejects.toThrow('resolveOrValidatePublicKey.invalid');
  });
});

describe('resolveFederationAddress', () => {
  function stubFetch(status, body) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })));
  }

  it('meldet den Backend-Code federation.contractAddress als Contract-Adresse', async () => {
    stubFetch(422, { ok: false, error: 'federation.contractAddress' });
    await expect(resolveFederationAddress('shop*example.com')).rejects.toThrow(CONTRACT_ADDRESS_ERROR);
  });

  it.each([['C', C], ['W', W]])('meldet eine %s-account_id auch ohne Backend-Code als Contract-Adresse', async (_l, addr) => {
    stubFetch(200, { ok: true, account_id: addr });
    await expect(resolveFederationAddress('shop*example.com')).rejects.toThrow(CONTRACT_ADDRESS_ERROR);
  });

  it('W-Adresse mit Memo wird ebenfalls abgelehnt, das Memo spielt keine Rolle', async () => {
    stubFetch(200, { ok: true, account_id: W, memo_type: 'id', memo: '1' });
    await expect(resolveOrValidateAccount('shop*example.com')).rejects.toThrow(CONTRACT_ADDRESS_ERROR);
  });
});

describe('SEP-7 / QR', () => {
  it.each([['C', C], ['W', W]])('reine %s-Adresse ergibt contractAddress', (_l, addr) => {
    expect(parsePaymentInput(addr)).toEqual({ ok: false, error: 'contractAddress' });
  });

  it('SEP-7-Anfrage mit W-Ziel ergibt contractAddress', () => {
    expect(parseSep7Pay(`web+stellar:pay?destination=${W}&amount=1`)).toEqual({ ok: false, error: 'contractAddress' });
    expect(parsePaymentInput(`web+stellar:pay?destination=${C}`)).toEqual({ ok: false, error: 'contractAddress' });
  });

  it('eingefuegte Adresse mit Zeilenumbruch wird wie bisher getrimmt', () => {
    expect(parsePaymentInput(`${W}\n`)).toEqual({ ok: false, error: 'contractAddress' });
    expect(parsePaymentInput(`${G}\n`)).toMatchObject({ ok: true, destination: G });
  });
});
