// F-3 (Node): submittedResult enthaelt nur Fehlertext und result_codes (Ablehnung) bzw. Hash und
// Ledger (Erfolg), nie envelope_xdr oder result_xdr aus der Horizon-Antwort. Sonst liest jeder, der
// die G-Adresse kennt, ueber die Job-Liste die signierte Transaktion ohne Token. Altjobs, die noch
// die ganze Antwort gespeichert haben, werden beim Lesen (Liste, Detail, Merge-Antwort) bereinigt.
// Horizon per test/helpers/horizonAccountsMock.js (SKM_TEST_SUBMIT_REJECT: Ablehnung mit extras).
// Pendant: test/submitResultLeak.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { sanitizeSubmittedResult, submitErrorResult, submitSuccessResult } = require('../services/submitResult');

const PORT = 3946;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const owner = Keypair.random();
const LEAKS = ['envelope_xdr', 'result_xdr', 'envelopeXdr', 'resultXdr', 'MOCK_ENVELOPE_XDR', 'MOCK_RESULT_XDR', 'OLD_ENVELOPE', 'OLD_RESULT'];
const assertNoLeak = (value, label) => {
  const text = JSON.stringify(value);
  for (const needle of LEAKS) assert.ok(!text.includes(needle), `${label}: enthaelt ${needle}`);
};

const newTx = (sign) => {
  const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(3600)
    .build();
  if (sign) tx.sign(owner);
  return tx;
};
const baseJob = (id, tx, extra) => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId: owner.publicKey(),
  txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  signers: [{ publicKey: owner.publicKey(), weight: 1 }], requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
  ...extra,
});
const mergeTx = newTx(false);
const mergeSigned = TransactionBuilder.fromXDR(mergeTx.toXDR(), Networks.TESTNET);
mergeSigned.sign(owner);
const oldExtras = { envelope_xdr: 'OLD_ENVELOPE', result_xdr: 'OLD_RESULT', result_codes: { transaction: 'tx_insufficient_fee' } };
const jobs = [
  baseJob('merge-job', mergeTx, { status: 'pending_signatures' }),
  // Altjob Node: error ist die ganze Horizon-Antwort.
  baseJob('old-node', newTx(false), { status: 'submitted_failed', submittedResult: { error: { title: 'Transaction Failed', extras: oldExtras } } }),
  // Altjob PHP: detail.extras ist die ganze Horizon-Antwort.
  baseJob('old-php', newTx(false), { status: 'submitted_failed', submittedResult: { error: 'Transaction Failed', detail: { message: 'Transaction Failed', extras: oldExtras } } }),
  // Altjob PHP: Erfolg mit envelopeXdr/resultXdr.
  baseJob('old-success', newTx(false), { status: 'submitted_success', submittedResult: { hash: 'abc', ledger: 7, envelopeXdr: 'OLD_ENVELOPE', resultXdr: 'OLD_RESULT' } }),
];

let server;
let dataDir;
let dbPath;
const storedHasMock = () => fs.readFileSync(dbPath, 'utf8').includes('MOCK_ENVELOPE_XDR');
const post = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const get = async (url, headers = {}) => {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.json() };
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-submitleak-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: jobs }));
  fs.writeFileSync(accountsPath, JSON.stringify({
    [owner.publicKey()]: {
      signers: [{ key: owner.publicKey(), weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      sequence: '100',
    },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath, SKM_TEST_SUBMIT_REJECT: 'tx_insufficient_fee' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${owner.publicKey()}`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Helfer: Ablehnung behaelt nur Fehlertext und result_codes', () => {
  const err = Object.assign(new Error('Request failed'), { response: { status: 400, data: { title: 'Transaction Failed', extras: oldExtras } } });
  assert.deepEqual(submitErrorResult(err), {
    error: 'Transaction Failed',
    detail: { message: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_insufficient_fee' } } },
  });
  assert.deepEqual(submitErrorResult(new Error('socket hang up')), { error: 'socket hang up', detail: { message: 'socket hang up', extras: {} } });
  assert.deepEqual(submitSuccessResult({ hash: 'h', ledger: 3, envelope_xdr: 'X', result_xdr: 'Y' }), { hash: 'h', ledger: 3 });
});

test('Helfer: Fehlertext zuerst title, dann detail, dann message (wie PHP)', () => {
  const withBoth = Object.assign(new Error('Request failed'), { response: { data: { title: 'Transaction Failed', detail: 'The transaction failed.' } } });
  assert.equal(submitErrorResult(withBoth).error, 'Transaction Failed');
  const onlyDetail = Object.assign(new Error('Request failed'), { response: { data: { detail: 'The transaction failed.' } } });
  assert.equal(submitErrorResult(onlyDetail).error, 'The transaction failed.');
  assert.equal(submitErrorResult(new Error('socket hang up')).error, 'socket hang up');
});

test('Helfer: langer Text wird nach Zeichen gekuerzt, Umlaute und Emoji bleiben ganz (wie PHP)', () => {
  const umlauts = submitErrorResult(new Error(`a${'ä'.repeat(400)}`)).error;
  assert.equal(umlauts, `a${'ä'.repeat(299)}`);
  const emoji = submitErrorResult(new Error(`${'a'.repeat(299)}😀x`)).error;
  assert.equal(emoji, `${'a'.repeat(299)}😀`);
  assert.equal(Array.from(emoji).length, 300);
  // Gegenprobe: slice() nach UTF-16-Einheiten liesse ein halbes Surrogat-Paar stehen.
  assert.equal(`${'a'.repeat(299)}😀x`.slice(0, 300).isWellFormed(), false);
  assert.ok(emoji.isWellFormed(), 'kein halbes Surrogat-Paar am Ende');
  assert.ok(umlauts.isWellFormed());
});

test('Helfer: result_codes nur als Strings, Fremdfelder fallen weg', () => {
  const out = sanitizeSubmittedResult({ error: { title: 'T', extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded', 5, { x: 1 }], inner_transaction: 'tx_bad_auth', envelope_xdr: 'OLD_ENVELOPE' } } } });
  assert.deepEqual(out, { error: 'T', detail: { message: 'T', extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'], inner_transaction: 'tx_bad_auth' } } } });
  assert.equal(sanitizeSubmittedResult(null), null);
  assert.equal(sanitizeSubmittedResult(undefined), null);
});

test('Anlegen mit Ablehnung: Antwort und Liste ohne envelope_xdr/result_xdr, result_codes bleiben', async () => {
  const res = await post(BASE, { network: 'testnet', accountId: owner.publicKey(), txXdr: newTx(true).toXDR() });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submitted_failed');
  assertNoLeak(res.body, 'Anlegen');
  assert.equal(res.body.submittedResult.detail.extras.result_codes.transaction, 'tx_insufficient_fee');
  assert.equal(res.body.submittedResult.error, 'Transaction Failed');
  assert.equal(storedHasMock(), false, 'gespeichert mit MOCK_ENVELOPE_XDR');
});

test('Merge mit Ablehnung: Antwort ohne envelope_xdr/result_xdr', async () => {
  const res = await post(`${BASE}/merge-job/merge-signed-xdr`, { signedXdr: mergeSigned.toXDR() }, { 'x-job-token': 'tok-merge-job' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submitted_failed');
  assertNoLeak(res.body, 'Merge');
  assert.equal(res.body.submittedResult.detail.extras.result_codes.transaction, 'tx_insufficient_fee');
  assert.equal(res.body.submittedResult.error, 'Transaction Failed');
  assert.equal(storedHasMock(), false, 'gespeichert mit MOCK_ENVELOPE_XDR');
});

test('Liste: auch Altjobs ohne envelope_xdr/result_xdr, result_codes und Hash bleiben', async () => {
  const res = await get(`${BASE}?network=testnet&accountId=${owner.publicKey()}`);
  assert.equal(res.status, 200);
  assertNoLeak(res.body, 'Liste');
  const byId = Object.fromEntries(res.body.map((j) => [j.id, j]));
  assert.equal(byId['old-node'].submittedResult.detail.extras.result_codes.transaction, 'tx_insufficient_fee');
  assert.equal(byId['old-node'].submittedResult.error, 'Transaction Failed');
  assert.equal(byId['old-php'].submittedResult.detail.extras.result_codes.transaction, 'tx_insufficient_fee');
  assert.deepEqual(byId['old-success'].submittedResult, { hash: 'abc', ledger: 7 });
});

test('Detail: Altjobs ohne envelope_xdr/result_xdr', async () => {
  for (const id of ['old-node', 'old-php', 'old-success']) {
    const res = await get(`${BASE}/${id}`, { 'x-job-token': `tok-${id}` });
    assert.equal(res.status, 200);
    assertNoLeak(res.body.submittedResult, `Detail ${id}`);
  }
});
