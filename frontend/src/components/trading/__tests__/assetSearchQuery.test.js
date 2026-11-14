// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { parseAssetSearchQuery } from '../assetSearchUtils.js';
import { sumIncomingXLMByMemo } from '../../../utils/stellar/stellarUtils.js';

// Pruefsumme statt Syntaxregel (Bestandsaufnahme 13.11., umgesetzt in c): Eine G-Adresse mit
// falscher Pruefsumme gilt nicht mehr als Issuer bzw. Konto.
const G = Keypair.random().publicKey();
const G_BAD = `${G.slice(0, -1)}${G.endsWith('A') ? 'B' : 'A'}`;

describe('parseAssetSearchQuery', () => {
  it('gueltige G-Adresse: Suche nach Issuer', () => {
    expect(parseAssetSearchQuery(G)).toEqual({ issuer: G, mode: 'issuer' });
    expect(parseAssetSearchQuery(`USDC:${G}`)).toEqual({ code: 'USDC', issuer: G, mode: 'exact' });
  });
  it('G mit falscher Pruefsumme: issuerInvalid (frueher als Issuer gesucht)', () => {
    expect(parseAssetSearchQuery(G_BAD)).toEqual({ error: 'issuerInvalid' });
    expect(parseAssetSearchQuery(`USDC:${G_BAD}`)).toEqual({ error: 'issuerInvalid' });
    expect(parseAssetSearchQuery(`G${'A'.repeat(55)}`)).toEqual({ error: 'issuerInvalid' });
  });
  it('Gegenprobe: Code-Suche und ungueltige Eingabe unveraendert', () => {
    expect(parseAssetSearchQuery('USDC')).toEqual({ code: 'USDC', mode: 'code' });
    expect(parseAssetSearchQuery('')).toEqual({ error: 'queryMissing' });
    expect(parseAssetSearchQuery('a:b:c')).toEqual({ error: 'queryInvalid' });
  });
});

describe('sumIncomingXLMByMemo: Konto mit Pruefsumme', () => {
  const server = new Horizon.Server('https://horizon-testnet.stellar.org');
  it.each([G_BAD, `G${'A'.repeat(55)}`, 'Gxyz', ''])('%s: accountInvalid', async (accountId) => {
    await expect(sumIncomingXLMByMemo({ server, accountId, memoQuery: 'x' })).rejects.toThrow('error.xlmByMemo.accountInvalid');
  });
  it('Gegenprobe: gueltige G-Adresse kommt an der Kontopruefung vorbei', async () => {
    await expect(sumIncomingXLMByMemo({ server, accountId: G, memoQuery: '' })).rejects.toThrow('error.xlmByMemo.memoInvalid');
  });
});
