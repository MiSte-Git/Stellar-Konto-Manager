// F-2 (Node): Unklares Sendeergebnis wird submit_unclear statt submitted_failed. Unklar ist keine
// Antwort, Timeout, 408, 429, >= 500 ohne result_codes oder 2xx ohne Hash. Mit result_codes bleibt es
// eine Ablehnung. Solange submit_unclear: Merge, Ablehnen und Loeschen 409, nie erneutes Senden, die
// Live-Neuberechnung und expireStalePendingJobs lassen den Status stehen. Beim Lesen (Liste, Detail)
// klaert das Backend ueber GET /transactions/{hash}, sobald die Sequence verbraucht oder maxTime + 120 s
// vorbei ist, hoechstens 5 Klaerungen je Anfrage. Gefunden ist sofort endgueltig, ein 404 erst nach
// maxTime + 120 s (nachhinkender Horizon-Knoten hinter dem Load Balancer). Horizon per test/helpers/horizonAccountsMock.js
// (SKM_TEST_SUBMIT_FILE, SKM_TEST_HORIZON_TXS). Pendant: test/multisigSubmitUnclear.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const {
  isUnclearSubmitError, isUnclearSubmitSuccess, isUnclearResolveDue, isUnclearTimePassed, unclearOutcome,
  SUBMIT_UNCLEAR_GRACE_SECONDS, SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST,
} = require('../services/submitUnclear');
const { expireStalePendingJobs } = require('../services/multisigJobsGuard');

const PORT = 3954;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const NOW = Math.floor(Date.now() / 1000);

const kp = () => Keypair.random();
// Konten je Szenario, damit der 30-s-Cache der Kontodaten nicht zwischen Szenarien wirkt.
const acc = {
  merge: kp(), locked: kp(), b: kp(),
  resSuccess: kp(), resFailed: kp(), resObsolete: kp(), resExpired: kp(), resError: kp(), notDue: kp(), early404: kp(),
  many: kp(),
};

// Transaktion mit Sequence 101 (Konto-Sequence 100 beim Bauen).
const buildTx = (owner, { minTime = 0, maxTime = NOW + 3600, sign = false } = {}) => {
  const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), {
    fee: '1000', networkPassphrase: Networks.TESTNET, timebounds: { minTime, maxTime },
  })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .build();
  if (sign) tx.sign(owner);
  return tx;
};
const hashOf = (tx) => Buffer.from(tx.hash()).toString('hex');
const job = (id, owner, tx, extra = {}) => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId: owner.publicKey(),
  txHash: hashOf(tx), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  status: 'submit_unclear', createdAt: new Date().toISOString(), maxTimeUnix: Number(tx.timeBounds.maxTime),
  signers: [{ publicKey: owner.publicKey(), weight: 1, type: 'ed25519_public_key' }],
  requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
  submittedAt: new Date().toISOString(),
  submittedResult: { error: 'submit_timeout', detail: { message: 'submit_timeout', extras: {} } },
  ...extra,
});
const accountEntry = (owner, sequence, extraSigners = []) => ({
  signers: [{ key: owner.publicKey(), weight: 1 }, ...extraSigners.map((s) => ({ key: s.publicKey(), weight: 1 }))],
  thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
  sequence,
});

const mergeTx = buildTx(acc.merge);
const mergeSigned = TransactionBuilder.fromXDR(mergeTx.toXDR(), Networks.TESTNET);
mergeSigned.sign(acc.merge);
// Voll signiert, Zeitfenster offen: die Live-Neuberechnung ergaebe ready_to_submit.
const lockedTx = buildTx(acc.locked, { sign: true });
const lockedSignedAgain = TransactionBuilder.fromXDR(lockedTx.toXDR(), Networks.TESTNET);
lockedSignedAgain.sign(acc.b);
const tx = {
  resSuccess: buildTx(acc.resSuccess, { sign: true }),
  resFailed: buildTx(acc.resFailed, { sign: true }),
  resObsolete: buildTx(acc.resObsolete, { maxTime: NOW - SUBMIT_UNCLEAR_GRACE_SECONDS - 80, sign: true }),
  // Sequence verbraucht, Zeitfenster offen, Horizon meldet 404 (nachhinkender Knoten): bleibt unklar.
  early404: buildTx(acc.early404, { sign: true }),
  resExpired: buildTx(acc.resExpired, { maxTime: NOW - SUBMIT_UNCLEAR_GRACE_SECONDS - 80, sign: true }),
  resError: buildTx(acc.resError, { sign: true }),
  // maxTime vorbei, aber innerhalb der Karenz: die Lebenszyklus-Rechnung ergaebe expired.
  notDue: buildTx(acc.notDue, { maxTime: NOW - 30, sign: true }),
};
const manyTxs = Array.from({ length: 6 }, () => buildTx(acc.many, { maxTime: NOW - SUBMIT_UNCLEAR_GRACE_SECONDS - 80, sign: true }));

const seeded = [
  job('merge-job', acc.merge, mergeTx, { status: 'pending_signatures', submittedAt: undefined, submittedResult: undefined }),
  job('locked', acc.locked, lockedTx, {
    signers: [{ publicKey: acc.locked.publicKey(), weight: 1 }, { publicKey: acc.b.publicKey(), weight: 1 }],
    collectedSigners: [{ publicKey: acc.locked.publicKey(), weight: 1 }], collectedWeight: 1,
  }),
  job('res-success', acc.resSuccess, tx.resSuccess),
  job('res-failed', acc.resFailed, tx.resFailed),
  job('res-obsolete', acc.resObsolete, tx.resObsolete),
  job('res-expired', acc.resExpired, tx.resExpired),
  job('res-error', acc.resError, tx.resError),
  job('not-due', acc.notDue, tx.notDue),
  job('early-404', acc.early404, tx.early404),
  ...manyTxs.map((t, i) => job(`many-${i}`, acc.many, t)),
];

let server;
let dataDir;
let dbPath;
let submitFile;
let submitLog;
let txLog;
const setSubmit = (spec) => fs.writeFileSync(submitFile, JSON.stringify(spec));
const submitCount = () => (fs.existsSync(submitLog) ? fs.readFileSync(submitLog, 'utf8').split('\n').filter(Boolean).length : 0);
const lookups = (hash) => (fs.existsSync(txLog) ? fs.readFileSync(txLog, 'utf8').split('\n').filter((l) => !hash || l === hash).length : 0);
const lookupLines = () => (fs.existsSync(txLog) ? fs.readFileSync(txLog, 'utf8').split('\n').filter(Boolean) : []);
const stored = (id) => JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.find((j) => j.id === id);
const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const list = (owner, query = '') => get(`${BASE}?network=testnet&accountId=${owner.publicKey()}${query}`);
const detail = (id) => get(`${BASE}/${id}`, { 'x-job-token': `tok-${id}` });
const signedChallenge = async (jobId, signer, purpose) => {
  const ch = (await post(`${BASE}/${jobId}/challenge`, { signer: signer.publicKey() })).body.challenge;
  return {
    signer: signer.publicKey(),
    signature: Buffer.from(signer.sign(Buffer.concat([Buffer.from(`skm:${purpose}:`), Buffer.from(ch, 'base64')]))).toString('base64'),
  };
};
const createFor = (owner) => post(BASE, { network: 'testnet', accountId: owner.publicKey(), txXdr: buildTx(owner, { sign: true }).toXDR() });

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-unclear-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  submitFile = path.join(dataDir, 'submit.json');
  submitLog = path.join(dataDir, 'submit.log');
  txLog = path.join(dataDir, 'tx_lookups.log');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  const txsPath = path.join(dataDir, 'horizon_txs.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items: seeded }));
  setSubmit({ mode: 'hang' });
  fs.writeFileSync(accountsPath, JSON.stringify({
    '*': { thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }, sequence: '100' },
    [acc.merge.publicKey()]: accountEntry(acc.merge, '100'),
    [acc.locked.publicKey()]: accountEntry(acc.locked, '100', [acc.b]),
    [acc.resSuccess.publicKey()]: accountEntry(acc.resSuccess, '101'),
    [acc.resFailed.publicKey()]: accountEntry(acc.resFailed, '105'),
    [acc.resObsolete.publicKey()]: accountEntry(acc.resObsolete, '101'),
    [acc.resExpired.publicKey()]: accountEntry(acc.resExpired, '100'),
    [acc.resError.publicKey()]: accountEntry(acc.resError, '101'),
    [acc.notDue.publicKey()]: accountEntry(acc.notDue, '100'),
    [acc.early404.publicKey()]: accountEntry(acc.early404, '101'),
    [acc.many.publicKey()]: accountEntry(acc.many, '101'),
  }));
  fs.writeFileSync(txsPath, JSON.stringify({
    [hashOf(tx.resSuccess)]: { successful: true, ledger: 4242 },
    [hashOf(tx.resFailed)]: { successful: false, ledger: 77 },
    [hashOf(tx.resError)]: { status: 500 },
  }));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath,
      SKM_TEST_HORIZON_ACCOUNTS: accountsPath, SKM_TEST_SUBMIT_FILE: submitFile, SKM_TEST_SUBMIT_LOG: submitLog,
      SKM_TEST_HORIZON_TXS: txsPath, SKM_TEST_HORIZON_TX_LOG: txLog, HORIZON_SUBMIT_TIMEOUT_MS: '300',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${acc.b.publicKey()}`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// --- Helfer ---

test('Helfer: unklar sind keine Antwort, Timeout, 408, 429 und >= 500 ohne result_codes', () => {
  const http = (status, data = {}) => Object.assign(new Error(`status ${status}`), { response: { status, data } });
  assert.equal(isUnclearSubmitError(new Error('socket hang up')), true);
  assert.equal(isUnclearSubmitError(Object.assign(new Error('submit_timeout'), { code: 'submit_timeout' })), true);
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isUnclearSubmitError(http(status, { title: 'Timeout' })), true, String(status));
  assert.equal(isUnclearSubmitError(http(504, { extras: { result_codes: { transaction: 'tx_failed' } } })), false, '504 mit result_codes');
  assert.equal(isUnclearSubmitError(http(400, { extras: { result_codes: { transaction: 'tx_bad_seq' } } })), false);
  assert.equal(isUnclearSubmitError(http(400, { title: 'Transaction Malformed' })), false, '400 ohne result_codes bleibt Ablehnung');
  assert.equal(isUnclearSubmitError(http(404)), false);
});

test('Helfer: 2xx ohne Hash ist unklar', () => {
  assert.equal(isUnclearSubmitSuccess({}), true);
  assert.equal(isUnclearSubmitSuccess(null), true);
  assert.equal(isUnclearSubmitSuccess({ hash: '' }), true);
  assert.equal(isUnclearSubmitSuccess({ hash: 'abc', ledger: 1 }), false);
});

test('Helfer: Klaerung faellig bei verbrauchter Sequence oder nach maxTime + Karenz', () => {
  assert.equal(SUBMIT_UNCLEAR_GRACE_SECONDS, 120);
  assert.equal(SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST, 5);
  assert.equal(isUnclearResolveDue({ sequenceConsumed: true, maxTimeUnix: NOW + 3600, nowUnix: NOW }), true);
  assert.equal(isUnclearResolveDue({ sequenceConsumed: false, maxTimeUnix: NOW - 121, nowUnix: NOW }), true);
  assert.equal(isUnclearResolveDue({ sequenceConsumed: false, maxTimeUnix: NOW - 120, nowUnix: NOW }), false);
  assert.equal(isUnclearResolveDue({ sequenceConsumed: false, maxTimeUnix: NOW + 10, nowUnix: NOW }), false);
  assert.equal(isUnclearResolveDue({ sequenceConsumed: false, maxTimeUnix: 0, nowUnix: NOW }), false);
  assert.equal(isUnclearTimePassed(NOW - 121, NOW), true);
  assert.equal(isUnclearTimePassed(NOW - 120, NOW), false);
  assert.equal(isUnclearTimePassed(0, NOW), false);
});

test('Helfer: Ergebnis der Klaerung', () => {
  // Gefunden ist sofort endgueltig, auch vor Ablauf der Zeit.
  assert.deepEqual(unclearOutcome({ kind: 'found', successful: true, hash: 'h', ledger: 9 }, true, false),
    { status: 'submitted_success', submittedResult: { hash: 'h', ledger: 9 } });
  const failed = unclearOutcome({ kind: 'found', successful: false, hash: 'h', ledger: 9 }, true, false);
  assert.equal(failed.status, 'submitted_failed');
  assert.equal(typeof failed.submittedResult.error, 'string');
  // 404 erst nach maxTime + Karenz endgueltig.
  assert.deepEqual(unclearOutcome({ kind: 'not_found' }, true, true), { status: 'obsolete_seq' });
  assert.deepEqual(unclearOutcome({ kind: 'not_found' }, false, true), { status: 'expired' });
  assert.equal(unclearOutcome({ kind: 'not_found' }, true, false), null, 'Sequence verbraucht, 404 vor maxTime + Karenz: unklar');
  assert.equal(unclearOutcome({ kind: 'not_found' }, false, false), null);
  assert.equal(unclearOutcome({ kind: 'error' }, true, true), null);
  assert.equal(unclearOutcome({ kind: 'found', hash: 'h' }, true, true), null, 'ohne successful bleibt unklar');
});

test('expireStalePendingJobs laesst submit_unclear stehen (auch abgelaufen und alt)', () => {
  const old = { id: 'x', status: 'submit_unclear', maxTimeUnix: NOW - 999999, createdAt: '2020-01-01T00:00:00Z' };
  const noBound = { id: 'y', status: 'submit_unclear', maxTimeUnix: 0, createdAt: '2020-01-01T00:00:00Z' };
  assert.deepEqual(expireStalePendingJobs([old, noBound]).map((j) => j.status), ['submit_unclear', 'submit_unclear']);
});

// --- Senden ---

test('Anlegen mit Timeout beim Senden: submit_unclear mit Fehlertext, gespeichert', async () => {
  setSubmit({ mode: 'hang' });
  const res = await createFor(kp());
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submit_unclear');
  assert.equal(res.body.submittedResult.error, 'submit_timeout');
  assert.deepEqual(res.body.submittedResult.detail.extras, {});
  assert.equal(stored(res.body.id).status, 'submit_unclear');
});

test('Anlegen mit Netzfehler beim Senden: submit_unclear', async () => {
  setSubmit({ mode: 'network' });
  const res = await createFor(kp());
  assert.equal(res.body.status, 'submit_unclear');
  assert.equal(res.body.submittedResult.error, 'socket hang up');
});

test('Anlegen mit 504 ohne result_codes: submit_unclear, Fehlertext aus title', async () => {
  setSubmit({ status: 504, data: { type: 'https://stellar.org/horizon-errors/timeout', title: 'Timeout', status: 504 } });
  const res = await createFor(kp());
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submit_unclear');
  assert.equal(res.body.submittedResult.error, 'Timeout');
});

test('Anlegen mit 429 und mit 2xx ohne Hash: submit_unclear', async () => {
  setSubmit({ status: 429, data: { title: 'Rate Limit Exceeded' } });
  assert.equal((await createFor(kp())).body.status, 'submit_unclear');
  setSubmit({ mode: 'success', data: { successful: true } });
  const res = await createFor(kp());
  assert.equal(res.body.status, 'submit_unclear');
  assert.equal(typeof res.body.submittedResult.error, 'string');
});

test('Anlegen mit 400 und result_codes: weiterhin submitted_failed', async () => {
  setSubmit({ status: 400, data: { title: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_insufficient_fee' } } } });
  const res = await createFor(kp());
  assert.equal(res.body.status, 'submitted_failed');
  assert.equal(res.body.submittedResult.detail.extras.result_codes.transaction, 'tx_insufficient_fee');
});

test('Merge mit 504 beim Senden: submit_unclear, Signatur gespeichert', async () => {
  setSubmit({ status: 504, data: { title: 'Timeout', status: 504 } });
  const res = await post(`${BASE}/merge-job/merge-signed-xdr`, { signedXdr: mergeSigned.toXDR() }, { 'x-job-token': 'tok-merge-job' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submit_unclear');
  assert.equal(res.body.submittedResult.error, 'Timeout');
  const s = stored('merge-job');
  assert.equal(s.status, 'submit_unclear');
  assert.equal(s.txXdrCurrent, mergeSigned.toXDR());
});

// --- Gesperrt solange unklar ---

test('submit_unclear: Merge 409 ohne erneutes Senden', async () => {
  setSubmit({ mode: 'success', data: { hash: 'x', ledger: 1 } });
  const before = submitCount();
  const res = await post(`${BASE}/locked/merge-signed-xdr`, { signedXdr: lockedSignedAgain.toXDR() }, { 'x-job-token': 'tok-locked' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'submit_unclear');
  assert.equal(submitCount(), before, 'nicht erneut gesendet');
  assert.equal(stored('locked').status, 'submit_unclear');
  assert.equal(stored('locked').txXdrCurrent, lockedTx.toXDR());
});

test('submit_unclear: Ablehnen 409', async () => {
  const res = await post(`${BASE}/locked/decline`, await signedChallenge('locked', acc.b, 'decline'));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'submit_unclear');
  assert.equal(stored('locked').status, 'submit_unclear');
  assert.equal(stored('locked').declinedSigners, undefined);
});

test('submit_unclear: Loeschen 409 not_final', async () => {
  const res = await post(`${BASE}/locked/delete`, await signedChallenge('locked', acc.locked, 'delete'));
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { ok: false, error: 'not_final', status: 'submit_unclear' });
  assert.ok(stored('locked'));
});

test('Live-Neuberechnung laesst submit_unclear stehen (voll signiert, Liste und Detail), keine Klaerung', async () => {
  const l = await list(acc.locked);
  assert.equal(l.body.find((j) => j.id === 'locked').status, 'submit_unclear');
  assert.equal((await detail('locked')).body.status, 'submit_unclear');
  assert.equal(lookups(hashOf(lockedTx)), 0);
  const filtered = await list(acc.locked, '&status=submit_unclear');
  assert.deepEqual(filtered.body.map((j) => j.id), ['locked']);
});

test('Innerhalb der Karenz nach maxTime: bleibt submit_unclear, keine Klaerung', async () => {
  const l = await list(acc.notDue);
  assert.equal(l.body.find((j) => j.id === 'not-due').status, 'submit_unclear');
  assert.equal(lookups(hashOf(tx.notDue)), 0);
  assert.equal(stored('not-due').status, 'submit_unclear');
});

// --- Klaerung ---

test('Klaerung im Detail: gefunden und erfolgreich -> submitted_success mit Hash und Ledger, nur einmal', async () => {
  const res = await detail('res-success');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'submitted_success');
  assert.deepEqual(res.body.submittedResult, { hash: hashOf(tx.resSuccess), ledger: 4242 });
  assert.equal(stored('res-success').status, 'submitted_success');
  assert.deepEqual(stored('res-success').submittedResult, { hash: hashOf(tx.resSuccess), ledger: 4242 });
  await detail('res-success');
  await list(acc.resSuccess);
  assert.equal(lookups(hashOf(tx.resSuccess)), 1);
});

test('Klaerung in der Liste: gefunden und nicht erfolgreich -> submitted_failed', async () => {
  const l = await list(acc.resFailed);
  const j = l.body.find((x) => x.id === 'res-failed');
  assert.equal(j.status, 'submitted_failed');
  assert.equal(typeof j.submittedResult.error, 'string');
  assert.equal(stored('res-failed').status, 'submitted_failed');
  await list(acc.resFailed);
  assert.equal(lookups(hashOf(tx.resFailed)), 1);
});

test('Klaerung: Sequence verbraucht, 404 vor maxTime + Karenz -> bleibt submit_unclear, nichts gespeichert', async () => {
  const l = await list(acc.early404);
  assert.equal(l.body.find((x) => x.id === 'early-404').status, 'submit_unclear');
  assert.equal((await detail('early-404')).body.status, 'submit_unclear');
  const s = stored('early-404');
  assert.equal(s.status, 'submit_unclear');
  assert.equal(s.resolvedAt, undefined);
  assert.equal(lookups(hashOf(tx.early404)), 2, 'jede Lese-Anfrage fragt erneut');
});

test('Klaerung: 404 und Sequence verbraucht nach maxTime + Karenz -> obsolete_seq', async () => {
  const l = await list(acc.resObsolete);
  assert.equal(l.body.find((x) => x.id === 'res-obsolete').status, 'obsolete_seq');
  assert.equal(stored('res-obsolete').status, 'obsolete_seq');
  await detail('res-obsolete');
  assert.equal(lookups(hashOf(tx.resObsolete)), 1);
});

test('Klaerung: 404, Sequence nicht verbraucht, maxTime + Karenz vorbei -> expired', async () => {
  const l = await list(acc.resExpired);
  assert.equal(l.body.find((x) => x.id === 'res-expired').status, 'expired');
  assert.equal(stored('res-expired').status, 'expired');
  await list(acc.resExpired);
  assert.equal(lookups(hashOf(tx.resExpired)), 1);
});

test('Klaerung: sonstiger Fehler beim Abruf -> bleibt submit_unclear', async () => {
  const l = await list(acc.resError);
  assert.equal(l.body.find((x) => x.id === 'res-error').status, 'submit_unclear');
  assert.equal(stored('res-error').status, 'submit_unclear');
  assert.equal(lookups(hashOf(tx.resError)), 1);
});

test('Hoechstens 5 Klaerungen je Anfrage', async () => {
  const manyHashes = new Set(manyTxs.map(hashOf));
  const countMany = () => lookupLines().filter((h) => manyHashes.has(h)).length;
  const first = await list(acc.many);
  assert.equal(countMany(), 5);
  assert.equal(first.body.filter((j) => j.status === 'obsolete_seq').length, 5);
  assert.equal(first.body.filter((j) => j.status === 'submit_unclear').length, 1);
  const second = await list(acc.many);
  assert.equal(countMany(), 6);
  assert.equal(second.body.filter((j) => j.status === 'obsolete_seq').length, 6);
});
