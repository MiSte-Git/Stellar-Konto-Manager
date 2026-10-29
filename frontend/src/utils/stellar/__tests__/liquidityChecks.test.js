import { describe, expect, it } from 'vitest';
import { Asset, Keypair } from '@stellar/stellar-sdk';
import { toStroops } from '../liquidityPools.js';
import {
  availableXlmStroops,
  checkDepositPreconditions,
  checkWithdrawPreconditions,
  minimumReserveStroops,
} from '../liquidityChecks.js';

const ISSUER = Keypair.random().publicKey();
const ISSUER2 = Keypair.random().publicKey();
const xlm = Asset.native();
const usd = new Asset('USD', ISSUER);
const eur = new Asset('EUR', ISSUER2);
const POOL_ID = 'c'.repeat(64);

const xlmPool = { poolId: POOL_ID, assetA: xlm, assetB: usd, reserveA: toStroops('1000'), reserveB: toStroops('100'), totalShares: toStroops('300') };
const tokenPool = { poolId: POOL_ID, assetA: eur, assetB: usd, reserveA: toStroops('10'), reserveB: toStroops('10'), totalShares: toStroops('10') };

const line = (asset, balance, extra = {}) => ({
  asset_type: 'credit_alphanum4', asset_code: asset.getCode(), asset_issuer: asset.getIssuer(),
  balance, limit: '922337203685.4775807', selling_liabilities: '0', buying_liabilities: '0', is_authorized: true, ...extra,
});
const account = ({ xlmBalance = '100', subentries = 0, lines = [], sellingXlm = '0', ...rest } = {}) => ({
  subentry_count: subentries,
  num_sponsoring: 0,
  num_sponsored: 0,
  balances: [{ asset_type: 'native', balance: xlmBalance, selling_liabilities: sellingXlm }, ...lines],
  ...rest,
});
const codes = (r) => r.problems.map((p) => (p.side ? `${p.code}:${p.side}` : p.code));
const infoCodes = (r) => r.infos.map((i) => `${i.code}:${i.side}`);

describe('Reserve-Berechnung', () => {
  it('rechnet (2 + Subentries + Sponsoring - Sponsored + neu) * 0.5 XLM', () => {
    const acc = account({ subentries: 3, num_sponsoring: 1, num_sponsored: 2 });
    expect(minimumReserveStroops(acc)).toBe(toStroops('2'));
    expect(minimumReserveStroops(acc, 3n)).toBe(toStroops('3.5'));
  });

  it('zieht Verkaufsverbindlichkeiten, Reserve und Fee ab', () => {
    const acc = account({ xlmBalance: '10', sellingXlm: '2', subentries: 1 });
    // 10 - 2 - 1.5 (Reserve) - 0.00003 (Fee)
    expect(availableXlmStroops(acc, { feeStroops: 300n })).toBe(toStroops('6.4999700'));
  });
});

describe('checkDepositPreconditions', () => {
  it('rechnet die neue Reserve fuer die Pool-Trustline (2 Subentries = 1 XLM) ein', () => {
    const acc = account({ xlmBalance: '13', subentries: 1, lines: [line(usd, '50')] });
    const r = checkDepositPreconditions({ account: acc, pool: xlmPool, maxAmountA: toStroops('10'), maxAmountB: toStroops('1'), feePerOp: 100 });
    expect(r.needPoolTrust).toBe(true);
    expect(r.newSubentries).toBe(2n);
    expect(r.opCount).toBe(2);
    expect(r.reserveIncrease).toBe(toStroops('1'));
    // 13 - (2+1+2)*0.5 - 0.00002 = 10.49998 >= 10
    expect(r.xlmAvailable).toBe(toStroops('10.49998'));
    expect(r.problems).toEqual([]);
  });

  it('meldet zu wenig XLM, wenn die neue Reserve die Einzahlung uebersteigt', () => {
    const acc = account({ xlmBalance: '12', subentries: 1, lines: [line(usd, '50')] });
    const r = checkDepositPreconditions({ account: acc, pool: xlmPool, maxAmountA: toStroops('10'), maxAmountB: toStroops('1'), feePerOp: 100 });
    expect(codes(r)).toEqual(['insufficientBalance:A']);
  });

  it('braucht keine Pool-Trustline, wenn sie schon existiert', () => {
    const acc = account({ subentries: 3, lines: [line(usd, '50'), { asset_type: 'liquidity_pool_shares', liquidity_pool_id: POOL_ID, balance: '0' }] });
    const r = checkDepositPreconditions({ account: acc, pool: xlmPool, maxAmountA: toStroops('10'), maxAmountB: toStroops('1'), feePerOp: 100 });
    expect(r.needPoolTrust).toBe(false);
    expect(r.newSubentries).toBe(0n);
    expect(r.opCount).toBe(1);
  });

  it('beruecksichtigt selling_liabilities beim Token', () => {
    const acc = account({ lines: [line(usd, '5', { selling_liabilities: '4.5' })] });
    const r = checkDepositPreconditions({ account: acc, pool: xlmPool, maxAmountA: toStroops('1'), maxAmountB: toStroops('0.6'), feePerOp: 100 });
    expect(codes(r)).toEqual(['insufficientBalance:B']);
  });

  it('meldet fehlende Trustline und auth_required als Problem, Clawback des Issuers nur als Info', () => {
    const acc = account();
    const r = checkDepositPreconditions({
      account: acc, pool: xlmPool, maxAmountA: toStroops('1'), maxAmountB: toStroops('0.1'), feePerOp: 100,
      issuerFlags: { [`USD:${ISSUER}`]: { auth_required: true, auth_clawback_enabled: true } },
    });
    expect(r.missingTrustAssets.map((a) => a.getCode())).toEqual(['USD']);
    expect(r.newSubentries).toBe(3n);
    expect(codes(r)).toEqual(['authRequiredMissingTrust:B', 'missingTrustNoBalance:B']);
    expect(infoCodes(r)).toEqual(['clawbackEnabled:B']);
  });

  it('meldet nicht autorisierte Trustline als Problem und Clawback auf der Trustline als Info', () => {
    const acc = account({ lines: [line(usd, '50', { is_authorized: false, is_clawback_enabled: true })] });
    const r = checkDepositPreconditions({ account: acc, pool: xlmPool, maxAmountA: toStroops('1'), maxAmountB: toStroops('0.1'), feePerOp: 100 });
    expect(codes(r)).toEqual(['notAuthorized:B']);
    expect(infoCodes(r)).toEqual(['clawbackEnabled:B']);
  });

  it('sperrt Clawback allein nicht', () => {
    const acc = account({ lines: [line(usd, '50', { is_clawback_enabled: true })] });
    const r = checkDepositPreconditions({ account: acc, pool: xlmPool, maxAmountA: toStroops('1'), maxAmountB: toStroops('0.1'), feePerOp: 100 });
    expect(r.problems).toEqual([]);
    expect(infoCodes(r)).toEqual(['clawbackEnabled:B']);
  });

  it('braucht als Issuer des eigenen Assets keine Trustline und kein Guthaben dafuer', () => {
    // Konto ist Issuer von USD, hat also keine USD-Trustline
    const acc = account({ account_id: ISSUER });
    const r = checkDepositPreconditions({
      account: acc, pool: xlmPool, maxAmountA: toStroops('1'), maxAmountB: toStroops('1000000'), feePerOp: 100,
      issuerFlags: { [`USD:${ISSUER}`]: { auth_required: true, auth_clawback_enabled: true } },
    });
    expect(r.missingTrustAssets).toEqual([]);
    expect(r.newSubentries).toBe(2n);
    expect(r.opCount).toBe(2);
    expect(r.problems).toEqual([]);
    expect(r.infos).toEqual([]);
  });

  it('erkennt den Issuer auch ueber accountId() (Account-Objekt)', () => {
    const acc = { ...account(), accountId: () => ISSUER };
    const r = checkDepositPreconditions({ account: acc, pool: tokenPool, maxAmountA: toStroops('1'), maxAmountB: toStroops('1'), feePerOp: 100 });
    // EUR fehlt weiterhin, USD (eigenes Asset) nicht
    expect(r.missingTrustAssets.map((a) => a.getCode())).toEqual(['EUR']);
    expect(codes(r)).toEqual(['missingTrustNoBalance:A']);
  });

  it('prueft bei Token/Token-Pools die XLM-Reserve getrennt und beide Seiten', () => {
    const acc = account({ xlmBalance: '2.4', lines: [line(eur, '1')] });
    const r = checkDepositPreconditions({ account: acc, pool: tokenPool, maxAmountA: toStroops('1'), maxAmountB: toStroops('1'), feePerOp: 100 });
    // nur EUR vorhanden: USD fehlt (+1), Pool fehlt (+2) -> Reserve (2+0+3)*0.5 = 2.5 > 2.4
    expect(codes(r)).toEqual(['missingTrustNoBalance:B', 'insufficientXlmReserve']);
  });
});

describe('checkWithdrawPreconditions', () => {
  const shares = { asset_type: 'liquidity_pool_shares', liquidity_pool_id: POOL_ID, balance: '10.0000000' };

  it('ist ohne Probleme bei ausreichendem Bestand und Platz', () => {
    const acc = account({ subentries: 3, lines: [line(usd, '1'), shares] });
    const r = checkWithdrawPreconditions({ account: acc, pool: xlmPool, shares: toStroops('10'), amountA: toStroops('33'), amountB: toStroops('3'), feePerOp: 100, opCount: 2 });
    expect(r.problems).toEqual([]);
    expect(r.shareBalance).toBe(toStroops('10'));
    expect(r.feeStroops).toBe(200n);
  });

  it('meldet zu wenige Shares, vollen Trustline-Rahmen und fehlende Fee', () => {
    const acc = account({ xlmBalance: '2.5', subentries: 3, lines: [line(usd, '9', { limit: '10', buying_liabilities: '0.5' }), shares] });
    const r = checkWithdrawPreconditions({ account: acc, pool: xlmPool, shares: toStroops('11'), amountA: toStroops('1'), amountB: toStroops('0.6'), feePerOp: 100 });
    expect(codes(r)).toEqual(['insufficientShares', 'lineFull:B', 'insufficientXlmFee']);
  });

  it('braucht als Issuer des eigenen Assets weder Trustline noch Platzpruefung', () => {
    const acc = account({ account_id: ISSUER, subentries: 2, lines: [shares] });
    const r = checkWithdrawPreconditions({ account: acc, pool: xlmPool, shares: toStroops('10'), amountA: toStroops('33'), amountB: toStroops('1000000'), feePerOp: 100 });
    expect(r.problems).toEqual([]);
  });

  it('meldet bei fremdem Asset ohne Trustline weiterhin missingAssetTrust', () => {
    const acc = account({ account_id: ISSUER2, subentries: 2, lines: [shares] });
    const r = checkWithdrawPreconditions({ account: acc, pool: xlmPool, shares: toStroops('10'), amountA: toStroops('33'), amountB: toStroops('3'), feePerOp: 100 });
    expect(codes(r)).toEqual(['missingAssetTrust:B']);
  });
});
