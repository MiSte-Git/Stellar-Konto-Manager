// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair, Horizon } from '@stellar/stellar-sdk';
import { describeHorizonError, fetchAccountCreatedAt, fetchGroupfundByMemo } from '../investmentUtils.js';

const ME = Keypair.random().publicKey();
const DEST = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const BASE = 'https://horizon.stellar.org';

const RATE_LIMIT_BODY = {
  type: 'https://stellar.org/horizon-errors/rate_limit_exceeded',
  title: 'Rate Limit Exceeded',
  status: 429,
  detail: 'The rate limit for the requesting IP address is over its alloted limit.',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Horizon-HAL-Seite; mit join=transactions steht die TX direkt im Feld `transaction`
const halPage = (records, nextHref) => ({
  _links: { self: { href: '' }, next: { href: nextHref || `${BASE}/end` }, prev: { href: '' } },
  _embedded: { records },
});
const payment = (n, { from = ME, to = DEST, memo, created = `2025-10-0${n}T00:00:00Z` } = {}) => ({
  id: String(n),
  paging_token: String(n),
  type: 'payment',
  created_at: created,
  transaction_hash: `hash${n}`,
  asset_type: 'native',
  from,
  to,
  amount: `${n}.0000000`,
  transaction: { hash: `hash${n}`, memo_type: memo ? 'text' : 'none', ...(memo ? { memo } : {}) },
  _links: { transaction: { href: `${BASE}/transactions/hash${n}` } },
});

let calls;
function mockHorizon(routes) {
  calls = [];
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input?.url || input);
    calls.push(url);
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) return handler(url);
    }
    throw new Error(`unerwarteter Request: ${url}`);
  });
}

const origFetch = globalThis.fetch;
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout'] }); });
afterEach(() => { globalThis.fetch = origFetch; vi.useRealTimers(); });

describe('describeHorizonError', () => {
  it('liest Status und Titel aus einem stellar-sdk-Fehler (e.response = Horizon-Body)', async () => {
    vi.useRealTimers();
    mockHorizon([[/ledgers/, () => json(RATE_LIMIT_BODY, 429)]]);
    const err = await new Horizon.Server(BASE).ledgers().limit(1).call().catch((e) => e);
    expect(describeHorizonError(err)).toBe('HTTP 429 – Rate Limit Exceeded');
  });

  it('liefert result_codes, message und nie ein Objekt/undefined', () => {
    const txErr = { response: { status: 400, title: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_failed' } } } };
    expect(describeHorizonError(txErr)).toBe('HTTP 400 – Transaction Failed – {"transaction":"tx_failed"}');
    expect(describeHorizonError({ response: { status: 504, data: { title: 'Timeout' } } })).toBe('HTTP 504 – Timeout');
    expect(describeHorizonError(new TypeError('fetch failed'))).toBe('fetch failed');
    expect(describeHorizonError(undefined)).toBe('unknown');
    expect(describeHorizonError({})).toBe('[object Object]');
    expect(typeof describeHorizonError({ response: {} })).toBe('string');
  });
});

describe('fetchGroupfundByMemo', () => {
  it('liest Memos aus dem join (transaction_attr) und endet an der History-Grenze ohne Fehler und ohne TX-Fallback', async () => {
    mockHorizon([
      [/\/accounts\/[^/]+\/payments\?(?!.*cursor)/, () => json(halPage([
        payment(3, { memo: 'GF-A' }),
        payment(2, { memo: 'GF-A' }),
        payment(1, { memo: 'GF-B', created: '2025-09-04T02:29:38Z' }),
        payment(4, { from: OTHER, to: ME, memo: 'eingehend' }),
        payment(5, {}),
      ], `${BASE}/accounts/${ME}/payments?cursor=1&order=desc&limit=200&join=transactions`))],
      // Ende der verfügbaren History: Horizon liefert 200 mit leerer Seite
      [/\/accounts\/[^/]+\/payments\?.*cursor=/, () => json(halPage([]))],
    ]);

    const res = await fetchGroupfundByMemo({ publicKey: ME, limitPages: 5000 });

    const byMemo = Object.fromEntries(res.items.map((i) => [i.group, i]));
    expect(Object.keys(byMemo).sort()).toEqual(['GF-A', 'GF-B']);
    expect(byMemo['GF-A'].occurrences).toBe(2);
    expect(byMemo['GF-A'].totalAmount).toBe(5);
    expect(byMemo['GF-A'].topDestination).toBe(DEST);
    expect(calls.some((u) => /\/transactions/.test(u.split('?')[0]))).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('meldet echte Fehler (429 nach Retries) mit lesbarem Detail statt sie zu verschlucken', async () => {
    mockHorizon([
      [/\/accounts\/[^/]+\/payments\?(?!.*cursor)/, () => json(halPage(
        [payment(2, { memo: 'GF-A' })],
        `${BASE}/accounts/${ME}/payments?cursor=2&order=desc&limit=200&join=transactions`,
      ))],
      [/\/accounts\/[^/]+\/payments\?.*cursor=/, () => json(RATE_LIMIT_BODY, 429)],
    ]);

    const p = fetchGroupfundByMemo({ publicKey: ME, limitPages: 5000 }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;

    expect(err).toBeInstanceOf(Error);
    expect(err.detail).toBe('HTTP 429 – Rate Limit Exceeded');
    expect(err.message).toBe('fetchInvestedTokens.failed:HTTP 429 – Rate Limit Exceeded');
    // 1 + 4 Versuche (withRetry), kein TX-Fallback
    expect(calls).toHaveLength(5);
  });
});

describe('fetchAccountCreatedAt', () => {
  const op = (fields) => ({ id: '1', paging_token: '1', created_at: '2025-11-02T10:00:00Z', _links: {}, ...fields });
  const run = (firstOp) => {
    mockHorizon([[/\/accounts\/[^/]+\/operations\?/, () => json(halPage(firstOp ? [firstOp] : []))]]);
    return fetchAccountCreatedAt({ server: new Horizon.Server(BASE), publicKey: ME });
  };

  it('liefert das Datum, wenn die erste Operation create_account mit dem Konto als Ziel ist', async () => {
    await expect(run(op({ type: 'create_account', account: ME, funder: OTHER }))).resolves.toBe('2025-11-02T10:00:00Z');
    // Nur die erste Operation wird geladen, kein Weiterblättern
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.searchParams.get('order')).toBe('asc');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('unbekannt, wenn die erste Operation kein create_account ist (Erstellung vor der History-Grenze)', async () => {
    await expect(run(op({ type: 'payment', from: OTHER, to: ME, asset_type: 'native', amount: '1' }))).resolves.toBe('');
  });

  it('unbekannt, wenn das Konto beim create_account nur der Funder ist', async () => {
    await expect(run(op({ type: 'create_account', account: DEST, funder: ME }))).resolves.toBe('');
  });

  it('unbekannt bei leerer Operations-Seite', async () => {
    await expect(run(null)).resolves.toBe('');
  });
});
