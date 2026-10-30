import { Account, Keypair, MuxedAccount, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import {
  AMBIGUOUS_LEDGER_BUFFER_SECONDS, assetDisplay, routingFingerprint, toStroops, buildSignedRowTx, checkRowOnNetwork, checkSourceAccount, computeSourceTotals, describeSubmitError,
  paymentFingerprint, resolveAmbiguous, validateRowInput,
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
    transactions: () => ({ transaction: () => ({ call: tx }) }),
    ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ closed_at: closedAt }] }) }) }) }),
  });
  const notFound = async () => { const e = new Error('nf'); e.response = { status: 404 }; throw e; };
  const iso = (sec) => new Date(sec * 1000).toISOString();
  const run = (tx, closedSec, e = entry) => resolveAmbiguous({ server: server({ tx, closedAt: closedSec === undefined ? undefined : iso(closedSec) }), entry: e, retryDelayMs: 0 });
  it('maps the ledger result', async () => {
    expect(await run(async () => ({ successful: true }), 1)).toBe('success');
    expect(await run(async () => ({ successful: false }), 1)).toBe('failed');
  });
  it('expires only with a ledger beyond maxTime plus buffer, independent of the client clock', async () => {
    expect(await run(notFound, 1999)).toBe('unknown');
    expect(await run(notFound, 2000 + AMBIGUOUS_LEDGER_BUFFER_SECONDS)).toBe('unknown');
    expect(await run(notFound, 2001 + AMBIGUOUS_LEDGER_BUFFER_SECONDS)).toBe('expired');
  });
  it('looks up the transaction a second time before releasing (lagging Horizon node)', async () => {
    let calls = 0;
    const tx = async () => { calls += 1; if (calls === 1) return notFound(); return { successful: true }; };
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
