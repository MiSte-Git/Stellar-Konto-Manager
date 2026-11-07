import { Account, Keypair, MuxedAccount, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import {
  AMBIGUOUS_LEDGER_BUFFER_SECONDS, ambiguousClearAt, assetDisplay, routingFingerprint, toStroops, buildSignedRowTx, checkRowOnNetwork, checkSourceAccount, computeSourceTotals, describeSubmitError,
  paymentFingerprint, resolveAmbiguous, validateRowInput,
  AMBIGUOUS_STRICT_RECHECK_MS, findAnyTransaction, findRecentMatchingPayment, isBadSeqError, pinnedSendAccount, resolveAmbiguousDetailed,
} from '../batchPaymentLogic.js';
import { createEmptyRow } from '../batchPaymentStore.js';

const hoisted = vi.hoisted(() => ({ resolveMock: vi.fn() }));
vi.mock('../../stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveOrValidateAccount: hoisted.resolveMock,
}));

const SRC = Keypair.random();
const DST = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();

function horizonAccount(id, { balances = [{ asset_type: 'native', balance: '100' }], signers, thresholds, data = {} } = {}) {
  return {
    account_id: id,
    subentry_count: 0,
    balances,
    signers: signers || [{ key: id, weight: 1 }],
    thresholds: thresholds || { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    data_attr: data,
  };
}

function serverWith(accounts) {
  return {
    loadAccount: vi.fn(async (id) => {
      if (accounts[id]) return accounts[id];
      const err = new Error('not found');
      err.response = { status: 404 };
      throw err;
    }),
  };
}

const row = (o = {}) => createEmptyRow({ source: SRC.publicKey(), dest: DST, amount: '5', memoVal: 'r1', ...o });

beforeEach(() => {
  hoisted.resolveMock.mockReset();
  hoisted.resolveMock.mockImplementation(async (input) => ({ accountId: input, muxedAddress: null }));
});

describe('validateRowInput', () => {
  it('accepts a complete row', () => expect(validateRowInput(row())).toBeNull());
  it('reports missing or invalid fields', () => {
    expect(validateRowInput(row({ source: '' }))).toBe('sourceMissing');
    expect(validateRowInput(row({ source: 'GABC' }))).toBe('sourceInvalid');
    expect(validateRowInput(row({ dest: '' }))).toBe('destMissing');
    expect(validateRowInput(row({ amount: '0' }))).toBe('amountInvalid');
    expect(validateRowInput(row({ assetKey: 'FOO:bad' }))).toBe('assetInvalid');
    expect(validateRowInput(row({ memoType: 'hash', memoVal: 'xyz' }))).toBe('memoInvalid');
    expect(validateRowInput(row({ memoType: 'id', memoVal: 'abc' }))).toBe('memoInvalid');
  });
});

describe('checkSourceAccount', () => {
  it('accepts a single-signature account', () => {
    expect(checkSourceAccount(horizonAccount(SRC.publicKey()))).toBeNull();
  });
  it('rejects multisig setups', () => {
    const id = SRC.publicKey();
    expect(checkSourceAccount(horizonAccount(id, { signers: [{ key: id, weight: 1 }, { key: DST, weight: 1 }] }))).toBe('sourceMultisig');
    expect(checkSourceAccount(horizonAccount(id, { thresholds: { med_threshold: 2 } }))).toBe('sourceMultisig');
    expect(checkSourceAccount(horizonAccount(id, { signers: [{ key: id, weight: 0 }] }))).toBe('sourceMultisig');
  });
});

describe('checkRowOnNetwork', () => {
  it('is ready for a funded destination', async () => {
    const server = serverWith({ [DST]: horizonAccount(DST) });
    expect(await checkRowOnNetwork({ server, row: row() })).toMatchObject({ code: null, destination: DST });
  });
  it('blocks unfunded destination, same account and missing trustline', async () => {
    expect((await checkRowOnNetwork({ server: serverWith({}), row: row() })).code).toBe('destUnfunded');
    const server = serverWith({ [DST]: horizonAccount(DST) });
    expect((await checkRowOnNetwork({ server, row: row({ dest: SRC.publicKey() }) })).code).toBe('sameAccount');
    expect((await checkRowOnNetwork({ server, row: row({ assetKey: `FOO:${ISSUER}` }) })).code).toBe('noTrustline');
  });
  it('blocks a not authorized trustline', async () => {
    const server = serverWith({ [DST]: horizonAccount(DST, { balances: [{ asset_type: 'native', balance: '1' }, { asset_code: 'FOO', asset_issuer: ISSUER, balance: '0', is_authorized: false }] }) });
    expect((await checkRowOnNetwork({ server, row: row({ assetKey: `FOO:${ISSUER}` }) })).code).toBe('notAuthorized');
  });
  it('blocks a missing memo when the destination requires one (SEP-29)', async () => {
    const server = serverWith({ [DST]: horizonAccount(DST, { data: { 'config.memo_required': 'MQ==' } }) });
    expect((await checkRowOnNetwork({ server, row: row({ memoVal: '' }) })).code).toBe('memoRequired');
    expect((await checkRowOnNetwork({ server, row: row() })).code).toBeNull();
  });
  it('blocks a memo that differs from what the federation server expects', async () => {
    hoisted.resolveMock.mockResolvedValue({ accountId: DST, muxedAddress: null, memo: '999', memoType: 'id' });
    const server = serverWith({ [DST]: horizonAccount(DST) });
    const res = await checkRowOnNetwork({ server, row: row({ dest: 'x*example.com', memoType: 'text', memoVal: 'r1' }) });
    expect(res).toMatchObject({ code: 'federationMemoMismatch', params: { memo: '999' } });
    expect((await checkRowOnNetwork({ server, row: row({ dest: 'x*example.com', memoType: 'id', memoVal: '999' }) })).code).toBeNull();
  });
  it('reports an unresolvable destination', async () => {
    hoisted.resolveMock.mockRejectedValue(new Error('bad'));
    expect((await checkRowOnNetwork({ server: serverWith({}), row: row() })).code).toBe('destInvalid');
  });
});

describe('computeSourceTotals', () => {
  it('sums per source including fees and compares with available XLM', () => {
    const id = SRC.publicKey();
    const accounts = new Map([[id, horizonAccount(id, { balances: [{ asset_type: 'native', balance: '11' }] })]]);
    // verfuegbar: 11 - 2 * 0.5 = 10 XLM
    const ok = computeSourceTotals({ rows: [row({ amount: '4' }), row({ amount: '5.9999' })], accounts, baseReserveStroops: 5000000n, feeStroops: 100 });
    expect(ok.get(id)).toMatchObject({ xlmNeeded: '9.99992', xlmAvailable: '10', ok: true });
    const tooMuch = computeSourceTotals({ rows: [row({ amount: '10' })], accounts, baseReserveStroops: 5000000n, feeStroops: 100 });
    expect(tooMuch.get(id).ok).toBe(false);
  });
  it('checks asset balances separately', () => {
    const id = SRC.publicKey();
    const accounts = new Map([[id, horizonAccount(id, { balances: [{ asset_type: 'native', balance: '10' }, { asset_code: 'FOO', asset_issuer: ISSUER, balance: '3', selling_liabilities: '1' }] })]]);
    const res = computeSourceTotals({ rows: [row({ assetKey: `FOO:${ISSUER}`, amount: '3' })], accounts, baseReserveStroops: 5000000n, feeStroops: 100 });
    expect(res.get(id).assets[0]).toMatchObject({ code: 'FOO', needed: '3', available: '2', ok: false });
  });
  it('compares very large asset balances exactly (no floating point)', () => {
    const id = SRC.publicKey();
    const accounts = new Map([[id, horizonAccount(id, { balances: [{ asset_type: 'native', balance: '10' }, { asset_code: 'FOO', asset_issuer: ISSUER, balance: '90071992547.4099999' }] })]]);
    const exact = computeSourceTotals({ rows: [row({ assetKey: `FOO:${ISSUER}`, amount: '90071992547.4099999' })], accounts, baseReserveStroops: 5000000n, feeStroops: 100 });
    expect(exact.get(id).assets[0].ok).toBe(true);
    const over = computeSourceTotals({ rows: [row({ assetKey: `FOO:${ISSUER}`, amount: '90071992547.41' })], accounts, baseReserveStroops: 5000000n, feeStroops: 100 });
    expect(over.get(id).assets[0].ok).toBe(false);
  });
  it('lets the issuer send its own asset', () => {
    const issuer = Keypair.random().publicKey();
    const accounts = new Map([[issuer, horizonAccount(issuer, { balances: [{ asset_type: 'native', balance: '10' }] })]]);
    const res = computeSourceTotals({ rows: [row({ source: issuer, assetKey: `FOO:${issuer}`, amount: '1000000' })], accounts, baseReserveStroops: 5000000n, feeStroops: 100 });
    expect(res.get(issuer).ok).toBe(true);
  });
  it('includes reserve for subentries and sponsoring', () => {
    const id = SRC.publicKey();
    const acc = { ...horizonAccount(id, { balances: [{ asset_type: 'native', balance: '5', selling_liabilities: '1' }] }), subentry_count: 2, num_sponsoring: 1, num_sponsored: 0 };
    // verfuegbar: 5 - (2+2+1)*0.5 - 1 = 1.5
    const res = computeSourceTotals({ rows: [row({ amount: '1' })], accounts: new Map([[id, acc]]), baseReserveStroops: 5000000n, feeStroops: 100 });
    expect(res.get(id)).toMatchObject({ xlmAvailable: '1.5', ok: true });
  });
});

describe('paymentFingerprint', () => {
  const fp = (o, destination = DST) => paymentFingerprint({ network: 'PUBLIC', row: row(o), destination });
  it('treats equivalent memos and amounts as the same payment', () => {
    expect(fp({ memoType: 'text', memoVal: '' })).toBe(fp({ memoType: 'none', memoVal: '' }));
    expect(fp({ memoType: 'id', memoVal: '' })).toBe(fp({ memoType: 'none', memoVal: 'x' }));
    expect(fp({ memoType: 'id', memoVal: '0123' })).toBe(fp({ memoType: 'id', memoVal: '123' }));
    const h = 'AB'.repeat(32);
    expect(fp({ memoType: 'hash', memoVal: `0x${h}` })).toBe(fp({ memoType: 'hash', memoVal: h.toLowerCase() }));
    expect(fp({ amount: '5,0' })).toBe(fp({ amount: '5' }));
  });
  it('uses the resolved destination, not the input', () => {
    expect(fp({ dest: 'name*example.com' })).toBe(fp({ dest: DST }));
  });
  it('distinguishes real differences', () => {
    expect(fp({ amount: '6' })).not.toBe(fp());
    expect(fp({ memoVal: 'r2' })).not.toBe(fp());
    expect(fp({ memoType: 'id', memoVal: '1' })).not.toBe(fp({ memoType: 'text', memoVal: '1' }));
    expect(fp({}, Keypair.random().publicKey())).not.toBe(fp());
  });
});

describe('resolveAmbiguous', () => {
  const entry = { hash: 'a'.repeat(64), at: 1000, status: 'ambiguous', maxTime: 2000 };
  const server = ({ tx, closedAt }) => ({
    transactions: () => ({ transaction: (hash) => ({ call: () => tx(hash) }) }),
    ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ closed_at: closedAt }] }) }) }) }),
  });
  const notFound = async () => { const e = new Error('nf'); e.response = { status: 404 }; throw e; };
  const iso = (sec) => new Date(sec * 1000).toISOString();
  // Ohne Wartezeit: Der Abstand der Abfragen wird in eigenen Tests mit Fake-Timern geprueft.
  const run = (tx, closedSec, e = entry) => resolveAmbiguous({
    server: server({ tx, closedAt: closedSec === undefined ? undefined : iso(closedSec) }), entry: e, retryDelayMs: 0, sleep: async () => {},
  });
  it('maps the ledger result', async () => {
    expect(await run(async (hash) => ({ hash, successful: true }), 1)).toBe('success');
    expect(await run(async (hash) => ({ hash, successful: false }), 1)).toBe('failed');
  });
  it('F5: counts a 200 only with the searched hash and successful true', async () => {
    // Gegenprobe zu "maps the ledger result": dieselbe Antwort ohne oder mit fremdem Hash
    expect(await run(async () => ({ successful: true }), 1)).toBe('unknown');
    expect(await run(async () => ({ hash: 'b'.repeat(64), successful: true }), 1)).toBe('unknown');
    expect(await run(async () => ({}), 1)).toBe('unknown');
    expect(await run(async (hash) => ({ hash }), 1)).toBe('unknown'); // successful fehlt
    expect(await run(async (hash) => ({ hash: hash.toUpperCase(), successful: true }), 1)).toBe('success');
  });
  it('expires only with a ledger beyond maxTime plus buffer, independent of the client clock', async () => {
    expect(await run(notFound, 1999)).toBe('pending');
    expect(await run(notFound, 2000 + AMBIGUOUS_LEDGER_BUFFER_SECONDS)).toBe('pending');
    expect(await run(notFound, 2001 + AMBIGUOUS_LEDGER_BUFFER_SECONDS)).toBe('expired');
  });
  it('F3: never expires with maxTime <= 0 (unlimited validity), treats it as unknown', async () => {
    let ledgerCalls = 0;
    const srv = {
      ...server({ tx: notFound, closedAt: iso(99999) }),
      ledgers: () => { ledgerCalls += 1; return server({ tx: notFound, closedAt: iso(99999) }).ledgers(); },
    };
    for (const maxTime of [0, -5]) {
      expect(await resolveAmbiguous({ server: srv, entry: { ...entry, maxTime }, retryDelayMs: 0, sleep: async () => {} })).toBe('unknown');
    }
    expect(ledgerCalls).toBe(0);
    // Gegenprobe: mit positivem maxTime wird der Ledger gefragt und es kann ablaufen
    expect(await resolveAmbiguous({ server: srv, entry, retryDelayMs: 0, sleep: async () => {} })).toBe('expired');
    expect(ledgerCalls).toBeGreaterThan(0);
  });
  it('computes the time from which the status can become clear (maxTime plus buffer)', () => {
    expect(ambiguousClearAt(entry)).toBe((2000 + AMBIGUOUS_LEDGER_BUFFER_SECONDS) * 1000);
    expect(ambiguousClearAt({ ...entry, maxTime: undefined })).toBeNull();
    expect(ambiguousClearAt(null)).toBeNull();
  });
  it('looks up the transaction a second time before releasing (lagging Horizon node)', async () => {
    let calls = 0;
    const tx = async (hash) => { calls += 1; if (calls === 1) return notFound(); return { hash, successful: true }; };
    expect(await run(tx, 3000)).toBe('success');
    expect(calls).toBe(2);
  });
  it('stays unknown without maxTime, on network errors or without ledger data', async () => {
    expect(await run(notFound, 9999, { ...entry, maxTime: undefined })).toBe('unknown');
    expect(await run(async () => { throw new Error('net'); }, 9999)).toBe('unknown');
    expect(await run(notFound, undefined)).toBe('unknown');
  });
});

describe('assets', () => {
  it('shows the issuer so equal codes are distinguishable', () => {
    expect(assetDisplay('XLM')).toBe('XLM');
    expect(assetDisplay(`USDC:${ISSUER}`)).toBe(`USDC (${ISSUER.slice(0, 8)}…${ISSUER.slice(-8)})`);
  });
  it('blocks an issued asset with the code XLM', () => {
    expect(validateRowInput(row({ assetKey: `XLM:${ISSUER}` }))).toBe('assetFakeXlm');
    expect(validateRowInput(row({ assetKey: `xlm:${ISSUER}` }))).toBe('assetFakeXlm');
  });
});

describe('toStroops', () => {
  it('is exact and never fail-open', () => {
    expect(toStroops('1.5')).toBe(15000000n);
    expect(toStroops(undefined)).toBe(0n);
    expect(() => toStroops('abc')).toThrow();
  });
});

describe('routingFingerprint', () => {
  it('matches M-address and G plus memo id', () => {
    const m = new MuxedAccount(new Account(DST, '0'), '42').accountId();
    const viaM = routingFingerprint({ network: 'PUBLIC', row: row({ memoType: 'none', memoVal: '' }), destination: m });
    const viaG = routingFingerprint({ network: 'PUBLIC', row: row({ memoType: 'id', memoVal: '042' }), destination: DST });
    expect(viaM).not.toBeNull();
    expect(viaM).toBe(viaG);
    expect(routingFingerprint({ network: 'PUBLIC', row: row({ memoType: 'text', memoVal: '42' }), destination: DST })).toBeNull();
  });
  it('keeps M-address payments with a different memo text apart', () => {
    const m = new MuxedAccount(new Account(DST, '0'), '42').accountId();
    const a = routingFingerprint({ network: 'PUBLIC', row: row({ memoType: 'text', memoVal: 'Rate Mai' }), destination: m });
    const b = routingFingerprint({ network: 'PUBLIC', row: row({ memoType: 'text', memoVal: 'Rate Juni' }), destination: m });
    expect(a).not.toBe(b);
  });
});

describe('validateRowInput secret guard', () => {
  it('rejects a row with a secret in any field before any network call', () => {
    const secret = Keypair.random().secret();
    expect(validateRowInput(row({ dest: `${secret}*evil.example` }))).toBe('containsSecret');
    expect(validateRowInput(row({ memoVal: `x ${secret}` }))).toBe('containsSecret');
    expect(hoisted.resolveMock).not.toHaveBeenCalled();
  });
});

describe('buildSignedRowTx', () => {
  it('builds one payment with the row memo, signed by the source', () => {
    const account = new Account(SRC.publicKey(), '10');
    const tx = buildSignedRowTx({ account, row: row(), destination: DST, fee: 100, networkPassphrase: Networks.TESTNET, keypair: SRC });
    const parsed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]).toMatchObject({ type: 'payment', destination: DST, amount: '5.0000000' });
    expect(Buffer.from(parsed.memo.value).toString()).toBe('r1');
    expect(parsed.signatures).toHaveLength(1);
    expect(Number(parsed.timeBounds.maxTime)).toBeGreaterThan(0);
  });
  it('refuses a key that is not the source', () => {
    const account = new Account(SRC.publicKey(), '10');
    expect(() => buildSignedRowTx({ account, row: row(), destination: DST, fee: 100, networkPassphrase: Networks.TESTNET, keypair: Keypair.random() }))
      .toThrow('keyMismatch');
  });
});

describe('describeSubmitError', () => {
  it('uses Horizon result codes', () => {
    const err = { response: { data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } } } } };
    expect(describeSubmitError(err)).toBe('tx_failed / op_underfunded');
  });
});

// F1: Sequence der Transaktion beim Aufloesen und beim erneuten Senden.
describe('resolveAmbiguous mit Sequence (F1)', () => {
  const SOURCE = SRC.publicKey();
  const HASH = 'a'.repeat(64);
  const nf = () => { const e = new Error('nf'); e.response = { status: 404 }; return e; };
  const iso = (sec) => new Date(sec * 1000).toISOString();
  const entry = { hash: HASH, at: 1000, status: 'ambiguous', maxTime: 2000, seq: '101', source: SOURCE };
  const PAST = 2000 + AMBIGUOUS_LEDGER_BUFFER_SECONDS + 5;

  // Horizon hinter einem Load-Balancer: ledgers(), transaction() und loadAccount() koennen
  // von verschiedenen Knoten kommen. Jede Funktion bekommt die Zahl ihrer bisherigen Aufrufe.
  function lbServer({ ledger, tx, accountSeq }) {
    const calls = { ledgers: [], tx: [], account: 0 };
    return {
      calls,
      ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => {
        calls.ledgers.push(Date.now());
        return { records: [{ closed_at: iso(ledger(calls.ledgers.length)) }] };
      } }) }) }),
      transactions: () => ({ transaction: (hash) => ({ call: async () => {
        calls.tx.push({ at: Date.now(), hash });
        const r = tx(calls.tx.length, hash);
        if (r instanceof Error) throw r;
        return r;
      } }) }),
      loadAccount: async (id) => {
        calls.account += 1;
        const s = typeof accountSeq === 'function' ? accountSeq() : accountSeq;
        if (s instanceof Error) throw s;
        return new Account(id, s);
      },
    };
  }

  it('Sequence noch frei: abgelaufen mit Pin nach kurzer Wiederholung (expiredPinned)', async () => {
    const srv = lbServer({ ledger: () => PAST, tx: () => nf(), accountSeq: '100' });
    const sleeps = [];
    const res = await resolveAmbiguousDetailed({ server: srv, entry, retryDelayMs: 2000, sleep: async (ms) => { sleeps.push(ms); } });
    expect(res.outcome).toBe('expiredPinned');
    expect(sleeps).toEqual([2000]); // keine 30 s, weil die Sequence die Doppelzahlung ausschliesst
    expect(srv.calls.tx).toHaveLength(2);
  });

  it('Sequence verbraucht: expired erst nach zwei Abfragen im Abstand von mindestens 30 s, beide mit Ledger nach maxTime plus Puffer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const srv = lbServer({ ledger: () => PAST, tx: () => nf(), accountSeq: '101' });
      let outcome = null;
      const p = resolveAmbiguous({ server: srv, entry }).then((o) => { outcome = o; });
      await vi.advanceTimersByTimeAsync(AMBIGUOUS_STRICT_RECHECK_MS - 1000);
      // Gegenprobe: vor Ablauf der 30 s noch keine zweite Abfrage und kein Ergebnis
      expect(outcome).toBeNull();
      expect(srv.calls.tx).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2000);
      await p;
      expect(outcome).toBe('expired');
      expect(srv.calls.tx).toHaveLength(2);
      expect(srv.calls.tx[1].at - srv.calls.tx[0].at).toBeGreaterThanOrEqual(AMBIGUOUS_STRICT_RECHECK_MS);
      expect(srv.calls.ledgers).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Sequence verbraucht, zweiter Ledger-Knoten noch vor maxTime plus Puffer: bleibt unklar (pending)', async () => {
    const srv = lbServer({ ledger: (n) => (n === 1 ? PAST : 2000), tx: () => nf(), accountSeq: '150' });
    expect(await resolveAmbiguous({ server: srv, entry, sleep: async () => {} })).toBe('pending');
  });

  it('Knoten A meldet den Ledger, Knoten B hinkt (404) bei verbrauchter Sequence: nicht expired', async () => {
    // Die Transaktion steht im Ledger; Knoten B kennt sie erst nach 20 s. Frueher reichten
    // zwei 404 im Abstand von 2 s fuer "abgelaufen".
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const start = Date.now();
      const srv = lbServer({
        ledger: () => PAST,
        tx: (_n, hash) => (Date.now() - start < 20000 ? nf() : { hash, successful: true }),
        accountSeq: '101',
      });
      const p = resolveAmbiguous({ server: srv, entry, retryDelayMs: 2000 });
      await vi.advanceTimersByTimeAsync(AMBIGUOUS_STRICT_RECHECK_MS + 1000);
      expect(await p).toBe('success');
      // Gegenprobe: Knoten B hinkt dauerhaft und der zweite Ledger kommt ebenfalls von einem
      // hinkenden Knoten -> unklar, nicht expired
      const srv2 = lbServer({ ledger: (n) => (n === 1 ? PAST : 1990), tx: () => nf(), accountSeq: '101' });
      const p2 = resolveAmbiguous({ server: srv2, entry });
      await vi.advanceTimersByTimeAsync(AMBIGUOUS_STRICT_RECHECK_MS + 1000);
      expect(await p2).toBe('pending');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ohne Sequence im Eintrag (alter Eintrag) gilt der strenge Pfad', async () => {
    const legacy = { hash: HASH, at: 1000, status: 'ambiguous', maxTime: 2000 };
    const srv = lbServer({ ledger: () => PAST, tx: () => nf(), accountSeq: '100' });
    const sleeps = [];
    expect(await resolveAmbiguous({ server: srv, entry: legacy, sleep: async (ms) => { sleeps.push(ms); } })).toBe('expired');
    expect(sleeps).toEqual([AMBIGUOUS_STRICT_RECHECK_MS]);
    expect(srv.calls.account).toBe(0);
  });

  it('Konto nicht ladbar (Netzfehler): unknown, nicht expired', async () => {
    const srv = lbServer({ ledger: () => PAST, tx: () => nf(), accountSeq: new Error('net') });
    expect(await resolveAmbiguous({ server: srv, entry, sleep: async () => {} })).toBe('unknown');
  });

  it('findet eine fruehere Transaktion derselben Zahlung (prev) und meldet deren Hash', async () => {
    const OLD = 'b'.repeat(64);
    const srv = lbServer({ ledger: () => PAST, tx: (_n, hash) => (hash === OLD ? { hash, successful: true } : nf()), accountSeq: '101' });
    const res = await resolveAmbiguousDetailed({ server: srv, entry: { ...entry, prev: [OLD] }, sleep: async () => {} });
    expect(res).toEqual({ outcome: 'success', hash: OLD });
    // Gegenprobe: eine fruehere, fehlgeschlagene Transaktion entscheidet nichts
    const srv2 = lbServer({ ledger: () => PAST, tx: (_n, hash) => (hash === OLD ? { hash, successful: false } : nf()), accountSeq: '100' });
    expect((await resolveAmbiguousDetailed({ server: srv2, entry: { ...entry, prev: [OLD] }, sleep: async () => {} })).outcome).toBe('expiredPinned');
  });
});

describe('pinnedSendAccount und tx_bad_seq (F1)', () => {
  const SOURCE = SRC.publicKey();
  // F7: gleiche Bedingung wie beim Vergeben des Pins (Konto-Sequence genau Pin - 1). Frueher
  // wurde auch bei einer kleineren Konto-Sequence (100) gepinnt; das Netz haette die
  // Transaktion dann mit tx_bad_seq abgelehnt.
  it('nutzt genau die gespeicherte Sequence, wenn die aktuelle genau eins darunter ist', () => {
    const p = pinnedSendAccount({ account: new Account(SOURCE, '104'), source: SOURCE, pinSeq: '105' });
    expect(p.pinned).toBe(true);
    expect(p.account.sequenceNumber()).toBe('104');
    const tx = new TransactionBuilder(p.account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: '0' })).setTimeout(30).build();
    expect(tx.sequence).toBe('105');
  });
  it('Gegenprobe: Sequence erreicht oder ueberschritten -> consumed, kein Konto', () => {
    expect(pinnedSendAccount({ account: new Account(SOURCE, '105'), source: SOURCE, pinSeq: '105' })).toEqual({ consumed: true });
    expect(pinnedSendAccount({ account: new Account(SOURCE, '200'), source: SOURCE, pinSeq: '105' })).toEqual({ consumed: true });
  });
  it('F7: Konto-Sequence weiter darunter -> nicht nutzbar (behind), kein Konto', () => {
    expect(pinnedSendAccount({ account: new Account(SOURCE, '100'), source: SOURCE, pinSeq: '105' })).toEqual({ consumed: true, behind: true });
    expect(pinnedSendAccount({ account: new Account(SOURCE, '103'), source: SOURCE, pinSeq: '105' })).toEqual({ consumed: true, behind: true });
  });
  it('erkennt tx_bad_seq', () => {
    expect(isBadSeqError({ response: { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } } })).toBe(true);
    expect(isBadSeqError({ response: { data: { extras: { result_codes: { transaction: 'tx_failed' } } } } })).toBe(false);
    expect(isBadSeqError(new Error('x'))).toBe(false);
  });
  it('findAnyTransaction sucht alle frueheren Hashes', async () => {
    const A = 'a'.repeat(64); const B = 'b'.repeat(64);
    const nf = () => { const e = new Error('nf'); e.response = { status: 404 }; throw e; };
    const srv = { transactions: () => ({ transaction: (hash) => ({ call: async () => (hash === B ? { hash, successful: true } : nf()) }) }) };
    expect(await findAnyTransaction({ server: srv, hashes: [A, B], sleep: async () => {} })).toEqual({ result: 'success', hash: B });
    expect((await findAnyTransaction({ server: srv, hashes: [A], attempts: 2, sleep: async () => {} })).result).toBe('notFound');
  });
});

// F2: Suche bei Horizon nach einer Zahlung, deren Protokolleintrag fehlt.
describe('findRecentMatchingPayment (F2)', () => {
  const SOURCE = SRC.publicKey();
  const NOW = Date.parse('2026-11-06T12:00:00Z');
  const row = createEmptyRow({ source: SOURCE, dest: DST, amount: '5', memoType: 'text', memoVal: 'Miete' });
  const pay = (o = {}) => ({
    type: 'payment', from: SOURCE, to: DST, asset_type: 'native', amount: '5.0000000', transaction_successful: true,
    created_at: new Date(NOW - 3600 * 1000).toISOString(), transaction_hash: 'C'.repeat(64),
    transaction_attr: { memo_type: 'text', memo: 'Miete' }, ...o,
  });
  function srv(pages, { fail } = {}) {
    let i = 0;
    const page = () => ({ records: pages[i] || [], next: async () => { i += 1; return page(); } });
    const builder = { order: () => builder, limit: () => builder, join: (j) => { builder.joined = j; return builder; },
      call: async () => { if (fail) throw fail; return page(); } };
    return { builder, payments: () => ({ forAccount: (id) => { builder.account = id; return builder; } }) };
  }
  const find = (s, o = {}) => findRecentMatchingPayment({ server: s, row, destination: DST, nowMs: NOW, pageLimit: 2, ...o });

  it('Treffer: gleiche Zahlung in den letzten 24 h', async () => {
    const s = srv([[pay()]]);
    expect(await find(s)).toEqual({ status: 'found', hash: 'c'.repeat(64), at: NOW - 3600 * 1000 });
    expect(s.builder.account).toBe(SOURCE);
    expect(s.builder.joined).toBe('transactions');
  });
  it('Gegenproben: anderer Betrag, anderes Memo, anderes Ziel, anderer Sender, aelter als 24 h -> kein Treffer', async () => {
    expect((await find(srv([[pay({ amount: '5.0000001' })]]))).status).toBe('none');
    expect((await find(srv([[pay({ transaction_attr: { memo_type: 'text', memo: 'Mieten' } })]]))).status).toBe('none');
    expect((await find(srv([[pay({ transaction_attr: { memo_type: 'id', memo: 'Miete' } })]]))).status).toBe('none');
    expect((await find(srv([[pay({ to: Keypair.random().publicKey() })]]))).status).toBe('none');
    expect((await find(srv([[pay({ from: DST, to: SOURCE })]]))).status).toBe('none');
    expect((await find(srv([[pay({ created_at: new Date(NOW - 25 * 3600 * 1000).toISOString() })]]))).status).toBe('none');
    expect((await find(srv([[pay({ asset_type: 'credit_alphanum4', asset_code: 'XLM', asset_issuer: ISSUER })]]))).status).toBe('none');
  });
  it('blaettert weiter, solange das Fenster nicht zu Ende ist', async () => {
    const other = pay({ amount: '1' });
    expect((await find(srv([[other, other], [other, pay()]]))).status).toBe('found');
  });
  it('Horizon nicht erreichbar oder Fenster nach maxPages nicht durchsucht: unreachable', async () => {
    expect((await find(srv([], { fail: new TypeError('Failed to fetch') }))).status).toBe('unreachable');
    const other = pay({ amount: '1' });
    expect((await find(srv([[other, other], [other, other], [other, other]]), { maxPages: 2 })).status).toBe('unreachable');
  });
  it('Konto ohne Zahlungen (404): kein Treffer', async () => {
    const e = new Error('nf'); e.response = { status: 404 };
    expect((await find(srv([], { fail: e }))).status).toBe('none');
  });
  it('M-Adresse: Treffer nur mit to_muxed', async () => {
    const m = new MuxedAccount(new Account(DST, '0'), '9').accountId();
    const r = createEmptyRow({ source: SOURCE, dest: m, amount: '5', memoType: 'none', memoVal: '' });
    const base = pay({ transaction_attr: { memo_type: 'none' } });
    expect((await findRecentMatchingPayment({ server: srv([[{ ...base, to_muxed: m }]]), row: r, destination: m, nowMs: NOW })).status).toBe('found');
    expect((await findRecentMatchingPayment({ server: srv([[base]]), row: r, destination: m, nowMs: NOW })).status).toBe('none');
    // Gegenprobe: G-Ziel trifft keine Zahlung an eine M-Adresse desselben Kontos
    expect((await findRecentMatchingPayment({ server: srv([[{ ...base, to_muxed: m }]]), row: { ...r, dest: DST }, destination: DST, nowMs: NOW })).status).toBe('none');
  });
});
