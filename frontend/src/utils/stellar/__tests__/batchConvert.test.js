// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import {
  assetLabel, computeDestMin, targetHasRoom, targetRoomStroops,
  MAX_OPS_PER_TX, NATIVE_TARGET, buildBatchTx, chunkQuotes, parseTargetAsset, planItem, quoteItem, targetTrustlineStatus,
} from '../batchConvert.js';

const ME = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const id = (n) => `00000000${String(n).padStart(64, '0')}`;
const token = (code, extra = {}) => ({ isNative: false, code, issuer: ISSUER, key: `${code}:${ISSUER}`, ...extra });
const item = (n, asset, extra = {}) => ({ id: id(n), amount: '5.0000000', asset, hasTrustline: false, isIssuer: false, claimableNow: true, ...extra });
const LDEX = token('LDEX');

describe('parseTargetAsset', () => {
  it('XLM, CODE:ISSUER und ungueltige Eingaben', () => {
    expect(parseTargetAsset('XLM')).toBe(NATIVE_TARGET);
    expect(parseTargetAsset('')).toBe(NATIVE_TARGET);
    expect(parseTargetAsset(`LDEX:${ISSUER}`)).toMatchObject({ code: 'LDEX', issuer: ISSUER });
    expect(parseTargetAsset('LDEX:kaputt')).toBeNull();
    expect(parseTargetAsset(`ZU-LANGER-CODE-XX:${ISSUER}`)).toBeNull();
  });
});

describe('planItem', () => {
  it('temporaere Trustline nur ohne vorhandene Trustline', () => {
    expect(planItem(item(1, token('SPAM')), NATIVE_TARGET)).toEqual({ mode: 'convert', tempTrustline: true, ops: 4 });
    expect(planItem(item(2, token('FOO'), { hasTrustline: true }), NATIVE_TARGET)).toEqual({ mode: 'convert', tempTrustline: false, ops: 2 });
    expect(planItem(item(3, NATIVE_TARGET, { hasTrustline: true }), LDEX)).toEqual({ mode: 'convert', tempTrustline: false, ops: 2 });
    expect(planItem(item(4, NATIVE_TARGET), NATIVE_TARGET)).toEqual({ mode: 'claimOnly', tempTrustline: false, ops: 1 });
    expect(planItem(item(5, LDEX), LDEX).mode).toBe('claimOnly');
  });
});

describe('chunkQuotes', () => {
  const quotes = Array.from({ length: 30 }, (_, i) => ({ item: item(i, token(`T${i}`)), plan: { ops: 4 } }));
  it('haelt die Obergrenze von 100 Operationen ein', () => {
    const chunks = chunkQuotes(quotes);
    expect(chunks.map((c) => c.length)).toEqual([25, 5]);
  });
  it('rechnet die Ziel-Trustline in die erste Transaktion ein', () => {
    const chunks = chunkQuotes(quotes, { needTargetTrustline: true });
    expect(chunks[0].length).toBe(24);
    expect(1 + chunks[0].length * 4).toBeLessThanOrEqual(MAX_OPS_PER_TX);
  });
});

describe('buildBatchTx', () => {
  it('legt die Trustline an, loest ein, tauscht alles und loescht die Trustline wieder', () => {
    const spam = item(1, token('SPAM'));
    const tx = buildBatchTx({
      account: new Account(ME, '1'),
      accountId: ME,
      chunk: [{ item: spam, plan: planItem(spam, LDEX), destMin: '1.2', path: [] }],
      target: LDEX,
      includeTargetTrustline: true,
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    });
    expect(tx.operations.map((o) => o.type)).toEqual(['changeTrust', 'changeTrust', 'claimClaimableBalance', 'pathPaymentStrictSend', 'changeTrust']);
    expect(tx.operations[0].line.code).toBe('LDEX');
    expect(tx.operations[1].line.code).toBe('SPAM');
    expect(tx.operations[3]).toMatchObject({ sendAmount: '5.0000000', destMin: '1.2000000', destination: ME });
    expect(tx.operations[4]).toMatchObject({ limit: '0.0000000' });
    expect(tx.operations[4].line.code).toBe('SPAM');
  });
});

describe('quoteItem', () => {
  function server({ paths = [{ destination_amount: '2.5', path: [] }], authRequired = false, fail = false } = {}) {
    return {
      loadAccount: vi.fn(async () => ({ flags: { auth_required: authRequired } })),
      strictSendPaths: vi.fn(() => ({ call: async () => { if (fail) throw new Error('down'); return { records: paths }; } })),
    };
  }

  it('liefert Betrag und Mindestbetrag nach Slippage', async () => {
    const q = await quoteItem(server(), item(1, token('SPAM')), NATIVE_TARGET, '2');
    expect(q).toMatchObject({ status: 'ok', destAmount: '2.5', destMin: '2.45' });
  });

  it('erkennt fehlenden Markt, Freigabe-Pflicht, Endzustaende und Fehler', async () => {
    expect((await quoteItem(server({ paths: [] }), item(1, token('SPAM')), NATIVE_TARGET, '2')).status).toBe('noMarket');
    expect((await quoteItem(server({ authRequired: true }), item(1, token('SPAM')), NATIVE_TARGET, '2')).status).toBe('authRequired');
    expect((await quoteItem(server(), item(1, token('SPAM'), { claimableNow: false }), NATIVE_TARGET, '2')).status).toBe('notClaimable');
    expect((await quoteItem(server(), item(1, token('SPAM'), { isIssuer: true }), NATIVE_TARGET, '2')).status).toBe('ownAsset');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await quoteItem(server({ fail: true }), item(1, token('SPAM')), NATIVE_TARGET, '2')).status).toBe('quoteFailed');
    warn.mockRestore();
  });

  it('fragt bei nur einloesen keinen Markt ab', async () => {
    const s = server();
    const q = await quoteItem(s, item(1, NATIVE_TARGET), NATIVE_TARGET, '2');
    expect(q).toMatchObject({ status: 'ok', destAmount: '5.0000000' });
    expect(s.strictSendPaths).not.toHaveBeenCalled();
  });
});

describe('targetTrustlineStatus', () => {
  it('native, vorhanden, fehlend, nicht freigegeben', () => {
    const acct = { balances: [{ asset_code: 'LDEX', asset_issuer: ISSUER, is_authorized: true }, { asset_code: 'LOCK', asset_issuer: ISSUER, is_authorized: false }] };
    expect(targetTrustlineStatus(acct, NATIVE_TARGET)).toBe('native');
    expect(targetTrustlineStatus(acct, LDEX)).toBe('ok');
    expect(targetTrustlineStatus(acct, token('NEU'))).toBe('missing');
    expect(targetTrustlineStatus(acct, token('LOCK'))).toBe('notAuthorized');
  });
});

describe('computeDestMin', () => {
  it('rechnet exakt in Stroops und rundet ab', () => {
    expect(computeDestMin('1.5', '2')).toBe('1.47');
    expect(computeDestMin('0.0000003', '50')).toBe('0.0000001');
    expect(computeDestMin('922337203685.4775807', '0')).toBe('922337203685.4775807');
    expect(computeDestMin('1', '0.5')).toBe('0.995');
  });
  it('liefert leer bei unsinnigen Werten', () => {
    expect(computeDestMin('0', '2')).toBe('');
    expect(computeDestMin('1', '60')).toBe('');
    expect(computeDestMin('abc', '2')).toBe('');
  });
});

describe('assetLabel', () => {
  it('zeigt Herausgeber, damit ein Token mit Code XLM erkennbar bleibt', () => {
    expect(assetLabel(NATIVE_TARGET)).toBe('XLM');
    expect(assetLabel(token('XLM'), (v) => v.slice(0, 4))).toBe(`XLM (${ISSUER.slice(0, 4)})`);
  });
});

describe('quoteItem mit gesperrter Trustline', () => {
  it('fragt keinen Markt ab und meldet den Grund', async () => {
    const s = { loadAccount: vi.fn(), strictSendPaths: vi.fn() };
    const q = await quoteItem(s, item(1, token('LOCK'), { hasTrustline: true, blockedReason: 'trustlineNotAuthorized' }), NATIVE_TARGET, '2');
    expect(q.status).toBe('trustlineNotAuthorized');
    expect(s.strictSendPaths).not.toHaveBeenCalled();
  });
});

describe('Limit der Ziel-Trustline', () => {
  const acct = { balances: [{ asset_code: 'LDEX', asset_issuer: ISSUER, balance: '90', limit: '100', buying_liabilities: '5', is_authorized: true }] };
  it('berechnet den freien Platz exakt', () => {
    expect(targetRoomStroops(acct, LDEX)).toBe(50000000n);
    expect(targetRoomStroops(acct, NATIVE_TARGET)).toBeNull();
    expect(targetRoomStroops(acct, token('NEU'))).toBeNull();
  });
  it('prueft, ob der erwartete Erloes passt', () => {
    expect(targetHasRoom(acct, LDEX, ['2', '3'])).toBe(true);
    expect(targetHasRoom(acct, LDEX, ['2', '3.0000001'])).toBe(false);
    expect(targetHasRoom(acct, NATIVE_TARGET, ['999999'])).toBe(true);
  });
});

