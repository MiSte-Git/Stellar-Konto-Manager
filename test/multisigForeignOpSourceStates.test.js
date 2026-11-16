// ADR 0013 (Node), Zustaende eines Jobs mit fremder op.source (Review FS-3, FS-7.3 bis FS-7.5).
// Ein solcher Job wird nie automatisch gesendet und wartet als ready_to_submit bis zum Ablauf oder Widerruf.
// - FS-3: Faellt das Gewicht nach dem Speichern (Signer entfernt), berechnet ein Merge ohne neue Signatur
//   den Status neu (pending_signatures), statt das gespeicherte ready_to_submit zu uebernehmen.
// - FS-7.3: Altjob ohne gespeichertes Feld foreignOpSources: Detail und Liste liefern es aus dem XDR,
//   ein Merge bis zum Gewicht sendet nicht.
// - FS-7.4: wartender Job laeuft ab (expired, Merge 409) oder seine Sequence ist verbraucht (obsolete_seq, Loeschen
//   erst nach der Klaerung, ADR 0014);
//   Loeschen erst im Endzustand.
// - FS-7.5: Ablehnen durch einen nicht gesammelten Signer laesst ready_to_submit stehen.
// - FS-4: Fee-Bump-Altjob (von vor #15): Lesen liefert foreignOpSources der inneren Transaktion und das
//   strenge Mindestgewicht wie PHP; Merge lehnt ab. Altjob von vor K1 (Tx-Quelle ungleich accountId):
//   die Tx-Quelle zaehlt als fremd; Merge lehnt ab (account_mismatch). Beides sendet nie.
// Altjob und FS-3-Job liegen vor dem Start in der Jobdatei (der Konto-Cache in server.js haelt 30 s,
// darum sind die Kontodaten von Anfang an der Stand nach der Aenderung). Kontodaten ueber
// test/helpers/horizonAccountsMock.js, Senden gegen einen lokalen Horizon-Stub, der jedes POST zaehlt.
// Pendant: test/multisigForeignOpSourceStates.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3975;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const foreign = Keypair.random().publicKey();
const dropped = Keypair.random(); // FS-3: 2 von 2, Signer d2 inzwischen entfernt
const d1 = Keypair.random();
const d2 = Keypair.random();
const legacy = Keypair.random(); // FS-7.3: 2 von 2
const l1 = Keypair.random();
const l2 = Keypair.random();
const expiring = Keypair.random(); // FS-7.4: Single-Sig, kurzes Zeitfenster
const revoked = Keypair.random(); // FS-7.4: Single-Sig, Sequence schon verbraucht
const decl = Keypair.random(); // FS-7.5: 2 von 3
const e1 = Keypair.random();
const e2 = Keypair.random();
const e3 = Keypair.random();

let server;
let stub;
let dataDir;
let dbPath;
const requests = [];
const posts = () => requests.filter((r) => r.method === 'POST' && r.url === '/transactions').length;
const stored = (id) => JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.find((j) => j.id === id);

const payment = (source, { opSource = foreign, signers = [], timeout = 3600 } = {}) => {
  const tx = new TransactionBuilder(new Account(source.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1', source: opSource }))
    .setTimeout(timeout)
    .build();
  signers.forEach((kp) => tx.sign(kp));
  return tx;
};
const fbAcc = Keypair.random(); // FS-4: Fee-Bump-Altjob
const feePayer = Keypair.random();
const preK1 = Keypair.random(); // FS-4: Altjob von vor K1, accountId
const preK1Source = Keypair.random(); // dessen Tx-Quelle
const sig = (kp, weight = 1) => ({ publicKey: kp.publicKey(), weight });
const seeded = (id, source, tx, extra) => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId: source.publicKey(),
  txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600, ...extra,
});
const live = (signers, threshold, sequence = '100') => ({
  signers: signers.map(([kp, weight]) => ({ key: kp.publicKey(), weight })),
  thresholds: { low_threshold: threshold, med_threshold: threshold, high_threshold: threshold },
  sequence,
});

// FS-3: gespeichert mit d1 und d2 als ready_to_submit; live ist d2 kein Signer mehr.
const txDropped = payment(dropped, { signers: [d1, d2] });
// FS-7.3: Altjob von vor ADR 0013, ohne Feld foreignOpSources, von l1 signiert.
const txLegacy = payment(legacy, { signers: [l1] });
// FS-7.4: wartender Job, danach per bumpSequence widerrufen.
const txRevoked = payment(revoked, { signers: [revoked] });
// FS-4: innere Transaktion mit bumpSequence (Low) unter fremder op.source. Ueber die Operationen waere das
// noetige Gewicht max(low 1, 1) = 1, ohne Operationen (Fee-Bump, wie PHP) max(low 1, med 2, 1) = 2.
const txFbInner = new TransactionBuilder(new Account(fbAcc.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.bumpSequence({ bumpTo: '0', source: foreign }))
  .setTimeout(3600)
  .build();
txFbInner.sign(fbAcc);
const txFeeBump = TransactionBuilder.buildFeeBumpTransaction(feePayer.publicKey(), '2000', txFbInner, Networks.TESTNET);
// FS-4: Altjob von vor K1, Tx-Quelle preK1Source, Operation ohne op.source.
const txPreK1 = new TransactionBuilder(new Account(preK1Source.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
  .setTimeout(3600)
  .build();
txPreK1.sign(preK1);
const items = [
  seeded('feebump', fbAcc, txFeeBump, {
    status: 'pending_signatures', signers: [sig(fbAcc)], requiredWeight: 2, collectedSigners: [], collectedWeight: 0,
  }),
  seeded('prek1', preK1, txPreK1, {
    status: 'pending_signatures', signers: [sig(preK1)], requiredWeight: 1, collectedSigners: [], collectedWeight: 0,
  }),
  seeded('dropped', dropped, txDropped, {
    status: 'ready_to_submit', signers: [sig(dropped, 0), sig(d1), sig(d2)], requiredWeight: 2,
    collectedSigners: [sig(d1), sig(d2)], collectedWeight: 2, foreignOpSources: [foreign],
  }),
  // FS-7.4: wartender Job, danach widerrufen (Sequence 1000). Seit ADR 0014 (ES-1) nimmt das Anlegen eine schon
  // verbrauchte Sequence nicht mehr an, der Job liegt deshalb schon in der Datei.
  seeded('revoked', revoked, txRevoked, {
    status: 'ready_to_submit', signers: [sig(revoked)], requiredWeight: 1,
    collectedSigners: [sig(revoked)], collectedWeight: 1, foreignOpSources: [foreign],
  }),
  seeded('legacy', legacy, txLegacy, {
    status: 'pending_signatures', signers: [sig(legacy, 0), sig(l1), sig(l2)], requiredWeight: 2,
    collectedSigners: [sig(l1)], collectedWeight: 1,
  }),
];
const accounts = {
  [fbAcc.publicKey()]: { ...live([[fbAcc, 1]], 1), thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 } },
  [preK1.publicKey()]: live([[preK1, 1]], 1),
  [dropped.publicKey()]: live([[dropped, 0], [d1, 1]], 2),
  [legacy.publicKey()]: live([[legacy, 0], [l1, 1], [l2, 1]], 2),
  [expiring.publicKey()]: live([[expiring, 1]], 1),
  // Sequence 1000 >= Sequence der Job-Transaktion (101): wie nach einem Widerruf per bumpSequence.
  [revoked.publicKey()]: live([[revoked, 1]], 1, '1000'),
  [decl.publicKey()]: live([[decl, 0], [e1, 1], [e2, 1], [e3, 1]], 2),
};

const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const create = (source, tx) => post(BASE, { network: 'testnet', accountId: source.publicKey(), txXdr: tx.toXDR() });
const merge = (id, token, tx) => post(`${BASE}/${id}/merge-signed-xdr`, { signedXdr: tx.toXDR() }, { 'x-job-token': token });
const detail = async (id, token) => (await fetch(`${BASE}/${id}`, { headers: { 'x-job-token': token } })).json();
const withChallenge = async (id, kp, purpose) => {
  const { body } = await post(`${BASE}/${id}/challenge`, { signer: kp.publicKey() });
  const data = Buffer.concat([Buffer.from(`skm:${purpose}:`), Buffer.from(body.challenge, 'base64')]);
  return post(`${BASE}/${id}/${purpose}`, { signer: kp.publicKey(), signature: Buffer.from(kp.sign(data)).toString('base64'), challenge: body.challenge });
};

test.before(async () => {
  stub = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/transactions') {
      res.end(JSON.stringify({ hash: 'b'.repeat(64), ledger: 7 }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-foreign-states-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items }));
  fs.writeFileSync(accountsPath, JSON.stringify(accounts));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath,
      SKM_TEST_HORIZON_ACCOUNTS: accountsPath, SKM_TEST_SUBMIT_REAL_URL: `http://127.0.0.1:${stub.address().port}`,
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${expiring.publicKey()}`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  stub?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('FS-3: Gewicht gefallen, Merge ohne neue Signatur speichert pending_signatures und sendet nicht', async () => {
  const before = posts();
  const res = await merge('dropped', 'tok-dropped', txDropped);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'pending_signatures');
  assert.equal(res.body.collectedWeight, 1, 'nur d1 zaehlt noch');
  assert.equal(stored('dropped').status, 'pending_signatures', 'gespeichert, nicht nur in der Antwort');
  assert.deepEqual(stored('dropped').foreignOpSources, [foreign]);
  assert.equal(posts(), before, 'nichts an Horizon gesendet');
});

test('FS-7.3: Altjob ohne gespeichertes Feld: Detail und Liste liefern foreignOpSources aus dem XDR', async () => {
  assert.equal('foreignOpSources' in stored('legacy'), false, 'sanity: Feld fehlt in der Jobdatei');
  const d = await detail('legacy', 'tok-legacy');
  assert.equal(d.status, 'pending_signatures');
  assert.deepEqual(d.foreignOpSources, [foreign]);
  const list = await (await fetch(`${BASE}?network=testnet&accountId=${legacy.publicKey()}`)).json();
  assert.deepEqual(list.find((j) => j.id === 'legacy')?.foreignOpSources, [foreign]);
});

test('FS-7.3: Altjob ohne gespeichertes Feld: Merge bis zum Gewicht sendet nicht', async () => {
  const before = posts();
  txLegacy.sign(l2);
  const res = await merge('legacy', 'tok-legacy', txLegacy);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ready_to_submit');
  assert.equal(res.body.collectedWeight, 2);
  assert.deepEqual(stored('legacy').foreignOpSources, [foreign], 'Feld beim Merge nachgetragen');
  assert.equal(stored('legacy').status, 'ready_to_submit');
  assert.equal(posts(), before, 'nichts an Horizon gesendet');
});

test('FS-7.4: wartender Job laeuft ab: vorher nicht loeschbar, danach expired, Merge 409, Loeschen moeglich', async () => {
  const tx = payment(expiring, { signers: [expiring], timeout: 3 });
  const before = posts();
  const created = await create(expiring, tx);
  assert.equal(created.body.status, 'ready_to_submit');
  const { id, accessToken } = created.body;
  const early = await withChallenge(id, expiring, 'delete');
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'not_final');
  assert.ok(stored(id), 'Job noch da');

  let status = '';
  for (let i = 0; i < 80 && status !== 'expired'; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    status = (await detail(id, accessToken)).status;
  }
  assert.equal(status, 'expired');
  const merged = await merge(id, accessToken, tx);
  assert.equal(merged.status, 409);
  assert.equal(merged.body.error, 'expired');
  assert.equal(stored(id).status, 'expired');
  const late = await withChallenge(id, expiring, 'delete');
  assert.equal(late.status, 200);
  assert.equal(stored(id), undefined, 'geloescht');
  assert.equal(posts(), before, 'nie an Horizon gesendet');
});

test('FS-7.4: verbrauchte Sequence (Widerruf): obsolete_seq, Merge 409, Loeschen erst nach der Klaerung (ADR 0014)', async () => {
  const before = posts();
  assert.equal((await detail('revoked', 'tok-revoked')).status, 'obsolete_seq');
  const merged = await merge('revoked', 'tok-revoked', txRevoked);
  assert.equal(merged.status, 409);
  assert.equal(merged.body.error, 'obsolete_seq');
  // Ohne Ledger-Pruefung (hier kein Horizon fuer GET /transactions) koennte der Job extern gesendet sein: 409.
  const del = await withChallenge('revoked', revoked, 'delete');
  assert.equal(del.status, 409);
  assert.equal(del.body.error, 'ledger_check_pending');
  assert.ok(stored('revoked'), 'nicht geloescht');
  assert.equal(posts(), before, 'nie an Horizon gesendet');
});

test('FS-7.5: Ablehnen eines wartenden Jobs durch nicht gesammelten Signer: bleibt ready_to_submit, kein Senden', async () => {
  const before = posts();
  const created = await create(decl, payment(decl, { signers: [e1, e2] }));
  assert.equal(created.body.status, 'ready_to_submit');
  const { id, accessToken } = created.body;
  const res = await withChallenge(id, e3, 'decline');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ready_to_submit');
  assert.deepEqual(res.body.declinedSigners.map((d) => d.publicKey), [e3.publicKey()]);
  assert.equal(stored(id).status, 'ready_to_submit');
  assert.equal((await detail(id, accessToken)).status, 'ready_to_submit');
  assert.equal(posts(), before, 'nichts an Horizon gesendet');
});

test('FS-4: Fee-Bump-Altjob: Detail und Liste mit foreignOpSources der inneren Transaktion, Gewicht wie PHP', async () => {
  const d = await detail('feebump', 'tok-feebump');
  assert.deepEqual(d.foreignOpSources, [foreign], 'innere op.source, nicht leer');
  assert.equal(d.requiredWeight, 2, 'ohne Operationen: max(low, med, 1) wie api/txSignatures.php');
  assert.equal(d.status, 'pending_signatures');
  const list = await (await fetch(`${BASE}?network=testnet&accountId=${fbAcc.publicKey()}`)).json();
  assert.deepEqual(list.find((j) => j.id === 'feebump')?.foreignOpSources, [foreign]);
});

test('FS-4: Fee-Bump-Altjob: Merge lehnt ab (Fee-Bump und normale Transaktion), nichts gesendet', async () => {
  const before = posts();
  const asFeeBump = await merge('feebump', 'tok-feebump', txFeeBump);
  assert.equal(asFeeBump.status, 400);
  assert.equal(asFeeBump.body.error, 'fee_bump_not_supported');
  const asInner = await merge('feebump', 'tok-feebump', txFbInner);
  assert.equal(asInner.status, 400);
  assert.equal(asInner.body.error, 'mismatched_hash');
  assert.equal(stored('feebump').status, 'pending_signatures');
  assert.equal(posts(), before, 'nichts an Horizon gesendet');
});

test('FS-4: Altjob von vor K1: Tx-Quelle zaehlt als fremd, Merge account_mismatch, nichts gesendet', async () => {
  const d = await detail('prek1', 'tok-prek1');
  assert.deepEqual(d.foreignOpSources, [preK1Source.publicKey()]);
  const list = await (await fetch(`${BASE}?network=testnet&accountId=${preK1.publicKey()}`)).json();
  assert.deepEqual(list.find((j) => j.id === 'prek1')?.foreignOpSources, [preK1Source.publicKey()]);
  const before = posts();
  const res = await merge('prek1', 'tok-prek1', txPreK1);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'account_mismatch');
  assert.equal(posts(), before, 'nichts an Horizon gesendet');
});
