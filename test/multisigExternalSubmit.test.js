// ADR 0014 (Node): Ein Job, der ausserhalb von SKM gesendet wurde, wird beim Lesen ueber den txHash geklaert.
// Kandidaten: gespeichert offen (pending_signatures, ready_to_submit) oder expired/obsolete_seq/rejected ohne
// ledgerCheckedAt, jeweils nur bei verbrauchter Sequence. Gefunden: submitted_success bzw. submitted_failed mit
// submittedExternally, Ledger und Zeit aus Horizon. Sicherer 404 (R-1, Ledger-Zeit mehr als 60 s nach maxTime):
// offene Jobs obsolete_seq, Endzustaende bleiben, beides mit ledgerCheckedAt. Sonst nichts speichern, beim
// naechsten Lesen erneut. Gemeinsames Budget von 5 mit submit_unclear, Reihenfolge nach compareResolvePriority.
// Geloeschter oder geaenderter Job unter dem Lock: nichts speichern. Anlegen lehnt tote Transaktionen ab (ES-1),
// Loeschen eines Kandidaten mit verbrauchter Sequence ergibt 409 ledger_check_pending (ES-3), Konto unbekannt zaehlt
// als verbrauchte Sequence (ES-4). Unsignierte Jobs verdraengen signierte nicht (ES-2), Liste und Detail tragen
// ledgerCheckPending (ES-8). Gesendet wird nie.
// Faelle aus test/assets/external-submit.json (routeCases). Horizon per test/helpers/horizonAccountsMock.js.
// Die Ledger-Zeit von Horizon liegt bei jetzt + 2000 s; offene Jobs mit ledgerPast haben maxTime jetzt + 1000 s.
// So setzt der Waechter (Serveruhr) sie zwischen den Faellen nicht auf expired, R-1 entscheidet trotzdem.
// Pendant: test/multisigExternalSubmit.test.php.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3978;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const NOW = Math.floor(Date.now() / 1000);
const LEDGER_NOW = NOW + 2000;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'external-submit.json'), 'utf8'));

// source: Tx-Quelle (Standard owner; ein anderes Konto bildet einen Altjob von vor K1 nach, ES-11).
// signers: wer signiert (Standard owner; [] fuer einen unsignierten Job, ES-2).
const buildTx = (owner, maxTime, { source = owner, signers = [owner] } = {}) => {
  const tx = new TransactionBuilder(new Account(source.publicKey(), '100'), {
    fee: '1000', networkPassphrase: Networks.TESTNET, timebounds: { minTime: 0, maxTime },
  })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .build();
  for (const kp of signers) tx.sign(kp);
  return tx;
};
const hashOf = (tx) => Buffer.from(tx.hash()).toString('hex');
const seedJob = (id, owner, tx, status, extra = {}) => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId: owner.publicKey(),
  txHash: hashOf(tx), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  status, createdAt: new Date().toISOString(), maxTimeUnix: Number(tx.timeBounds.maxTime),
  signers: [{ publicKey: owner.publicKey(), weight: 1, type: 'ed25519_public_key' }],
  requiredWeight: 1, collectedSigners: [{ publicKey: owner.publicKey(), weight: 1 }], collectedWeight: 1,
  ...extra,
});
const accountEntry = (owner, sequence) => ({
  signers: [{ key: owner.publicKey(), weight: 1 }],
  thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
  sequence,
});
const withHash = (value, hash) => JSON.parse(JSON.stringify(value).split('$JOB_HASH').join(hash));

// --- Faelle aus der Fixture ---
const cases = fixture.routeCases.map((c, i) => {
  const owner = Keypair.random();
  const source = c.txSourceDiffers ? Keypair.random() : owner;
  const maxTime = NOW + (c.maxTimeOffset ?? (c.ledgerPast ? 1000 : 3600));
  const tx = buildTx(owner, maxTime, { source });
  const extra = { ...(c.storedExtra || {}) };
  if (c.storedStatus === 'submitted_success') {
    Object.assign(extra, { submittedAt: new Date().toISOString(), submittedResult: { hash: hashOf(tx), ledger: 1 } });
  }
  return { ...c, id: `case-${i}`, owner, source, tx, hash: hashOf(tx), job: seedJob(`case-${i}`, owner, tx, c.storedStatus, extra) };
});

// --- Budget und Reihenfolge: ein Konto, alle Sequences verbraucht ---
// Fuenf nicht entscheidbare offene Jobs (404, Ledger vor maxTime) stehen in der Datei vorne, juengste maxTime zuerst.
// Dahinter zwei entscheidbare (expired gespeichert, maxTime laut Serveruhr und Ledger vorbei, 404) und am Ende ein
// submit_unclear (gefunden). Eine Lese-Anfrage darf 5 Abfragen: unklar, beide entscheidbaren, dann die zwei
// nicht entscheidbaren mit der aeltesten maxTime.
const many = Keypair.random();
const undecided = [4400, 4300, 4200, 4100, 4000].map((d) => buildTx(many, NOW + d));
const decidable = [NOW - 3000, NOW - 3600].map((t) => buildTx(many, t));
const unclearTx = buildTx(many, NOW + 5000);
const manyJobs = [
  ...undecided.map((t, i) => seedJob(`undecided-${i}`, many, t, 'pending_signatures')),
  ...decidable.map((t, i) => seedJob(`decidable-${i}`, many, t, 'expired')),
  seedJob('unclear', many, unclearTx, 'submit_unclear', {
    submittedAt: new Date().toISOString(),
    submittedResult: { error: 'submit_timeout', detail: { message: 'submit_timeout', extras: {} } },
  }),
];

// --- Geloeschter Job: Abfrage verzoegert, waehrenddessen geloescht. Das Loeschen trifft einen nachhinkenden
// Horizon-Knoten (Sequence dort noch nicht verbraucht), sonst lehnte es den ungeprueften Kandidaten ab (ES-3).
const delOwner = Keypair.random();
const delTx = buildTx(delOwner, NOW - 3600);
const delJob = seedJob('deleted', delOwner, delTx, 'expired');
// --- Status geaendert: Abfrage verzoegert, waehrenddessen speichert der Merge obsolete_seq ---
const raceOwner = Keypair.random();
const raceTx = buildTx(raceOwner, NOW + 3600);
const raceJob = seedJob('race', raceOwner, raceTx, 'pending_signatures');
// --- ES-3: Kandidat mit verbrauchter Sequence, noch ungeklaert (404 vor der Marge), und Gegenprobe ohne ---
const pendOwner = Keypair.random();
const pendTx = buildTx(pendOwner, NOW + 3600);
const pendJob = seedJob('pending-check', pendOwner, pendTx, 'rejected');
const freeOwner = Keypair.random();
const freeTx = buildTx(freeOwner, NOW + 3600);
const freeJob = seedJob('free', freeOwner, freeTx, 'rejected');
// --- ES-2: untergeschobene unsignierte Jobs mit derselben Sequence (vor dem externen Senden angelegt; danach lehnt das
// Anlegen sie ab, ES-1) und maxTime vor der des echten Jobs. Echter Job signiert: wird trotzdem zuerst geprueft.
// Gegenprobe: echter Job ohne Signatur, dann verdraengen ihn die fuenf (Reihenfolge nach maxTime).
const victimSigner = Keypair.random();
const victim = Keypair.random();
const victimJobTx = buildTx(victim, NOW + 3600, { signers: [victimSigner] });
const victimUnsigned = Keypair.random();
const victimUnsignedTx = buildTx(victimUnsigned, NOW + 3600, { signers: [] });
// maxTime nach der Ledger-Zeit des Tests (jetzt + 2000 s), also bis zum Ende nicht sicher geklaert.
const planted = (account) => [2100, 2200, 2300, 2400, 2500].map((d, i) => {
  const t = buildTx(account, NOW + d, { signers: [] });
  return { tx: t, job: seedJob(`planted-${account.publicKey().slice(0, 6)}-${i}`, account, t, 'pending_signatures', { collectedSigners: [], collectedWeight: 0 }) };
});
const plantedVictim = planted(victim);
const plantedUnsigned = planted(victimUnsigned);
const victimSigners = (account) => ({
  signers: [{ key: victimSigner.publicKey(), weight: 1 }],
  thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
  sequence: '101',
});
const victimJobs = [
  ...plantedVictim.map((p) => p.job),
  seedJob('victim-signed', victim, victimJobTx, 'pending_signatures', {
    signers: [{ publicKey: victimSigner.publicKey(), weight: 1, type: 'ed25519_public_key' }],
    requiredWeight: 2, collectedSigners: [{ publicKey: victimSigner.publicKey(), weight: 1 }], collectedWeight: 1,
  }),
  ...plantedUnsigned.map((p) => p.job),
  seedJob('victim-unsigned', victimUnsigned, victimUnsignedTx, 'pending_signatures', { collectedSigners: [], collectedWeight: 0 }),
];
// --- ES-1: Anlegen mit toter Transaktion ---
const deadSeqOwner = Keypair.random();
const deadTimeOwner = Keypair.random();
let accountsPath;
let accounts;

let server;
let dataDir;
let dbPath;
let txLog;
let submitLog;

const lookupLines = () => (fs.existsSync(txLog) ? fs.readFileSync(txLog, 'utf8').split('\n').filter(Boolean) : []);
const lookups = (hash) => lookupLines().filter((l) => l === hash).length;
const stored = (id) => JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.find((j) => j.id === id);
const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const list = (owner) => get(`${BASE}?network=testnet&accountId=${owner.publicKey()}`);
const detail = (id) => get(`${BASE}/${id}`, { 'x-job-token': `tok-${id}` });
const withChallenge = async (id, kp, purpose) => {
  const { body } = await post(`${BASE}/${id}/challenge`, { signer: kp.publicKey() });
  const data = Buffer.concat([Buffer.from(`skm:${purpose}:`), Buffer.from(body.challenge, 'base64')]);
  return post(`${BASE}/${id}/${purpose}`, { signer: kp.publicKey(), signature: Buffer.from(kp.sign(data)).toString('base64'), challenge: body.challenge });
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-external-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  txLog = path.join(dataDir, 'tx.log');
  submitLog = path.join(dataDir, 'submit.log');
  accountsPath = path.join(dataDir, 'accounts.json');
  const txsPath = path.join(dataDir, 'txs.json');
  const rootPath = path.join(dataDir, 'root.json');
  fs.writeFileSync(rootPath, JSON.stringify({ history_latest_ledger_closed_at: new Date(LEDGER_NOW * 1000).toISOString().replace('.000Z', 'Z') }));
  fs.writeFileSync(dbPath, JSON.stringify({ items: [...cases.map((c) => c.job), ...manyJobs, delJob, raceJob, pendJob, freeJob, ...victimJobs] }));
  accounts = {
    [many.publicKey()]: accountEntry(many, '101'),
    [delOwner.publicKey()]: accountEntry(delOwner, '101'),
    [raceOwner.publicKey()]: accountEntry(raceOwner, '101'),
    [pendOwner.publicKey()]: accountEntry(pendOwner, '101'),
    [freeOwner.publicKey()]: accountEntry(freeOwner, '100'),
    [deadSeqOwner.publicKey()]: accountEntry(deadSeqOwner, '101'),
    [deadTimeOwner.publicKey()]: accountEntry(deadTimeOwner, '100'),
    [victim.publicKey()]: victimSigners(victim),
    [victimUnsigned.publicKey()]: victimSigners(victimUnsigned),
  };
  const txs = {
    [hashOf(unclearTx)]: { successful: true, ledger: 900, created_at: '2026-11-16T12:00:00Z' },
    [hashOf(delTx)]: { successful: true, ledger: 901, created_at: '2026-11-16T12:00:00Z', delayMs: 1500 },
    [hashOf(raceTx)]: { successful: true, ledger: 902, created_at: '2026-11-16T12:00:00Z', delayMs: 1500 },
    [hashOf(victimJobTx)]: { successful: true, ledger: 903, created_at: '2026-11-16T12:00:00Z' },
    [hashOf(victimUnsignedTx)]: { successful: true, ledger: 904, created_at: '2026-11-16T12:00:00Z' },
  };
  for (const c of cases) {
    if (c.txSourceDiffers) {
      // ES-11: Altjob von vor K1. sequenceConsumed gilt fuer die Tx-Quelle, accountIdSequenceConsumed fuer accountId.
      accounts[c.owner.publicKey()] = accountEntry(c.owner, c.accountIdSequenceConsumed ? '101' : '100');
      accounts[c.source.publicKey()] = accountEntry(c.source, c.sequenceConsumed ? '101' : '100');
    } else {
      accounts[c.owner.publicKey()] = c.accountNotFound ? { notFound: true } : accountEntry(c.owner, c.sequenceConsumed ? '101' : '100');
    }
    if (c.horizon.record) txs[c.hash] = { hash: c.hash, ...withHash(c.horizon.record, c.hash) };
    if (c.horizon.status) txs[c.hash] = { status: c.horizon.status };
  }
  fs.writeFileSync(accountsPath, JSON.stringify(accounts));
  fs.writeFileSync(txsPath, JSON.stringify(txs));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath,
      SKM_TEST_HORIZON_ACCOUNTS: accountsPath, SKM_TEST_HORIZON_TXS: txsPath, SKM_TEST_HORIZON_TX_LOG: txLog,
      SKM_TEST_HORIZON_ROOT: rootPath,
      // Jeder Sendeversuch landete in submit.log; erwartet sind keine.
      SKM_TEST_SUBMIT_HASH: 'c'.repeat(64), SKM_TEST_SUBMIT_LOG: submitLog,
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${Keypair.random().publicKey()}`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

for (const c of cases) {
  test(`Route: ${c.name}`, async () => {
    const l = await list(c.owner);
    assert.equal(l.status, 200);
    const fromList = l.body.find((j) => j.id === c.id);
    assert.equal(fromList.status, c.expected.status, 'Liste');
    const d = await detail(c.id);
    assert.equal(d.status, 200);
    assert.equal(d.body.status, c.expected.status, 'Detail');
    assert.equal(lookups(c.hash), c.expected.lookups, 'Abfragen nach zwei Lese-Anfragen');
    const s = stored(c.id);
    assert.equal(s.status, c.expected.stored, 'gespeichert');
    assert.equal(Boolean(s.ledgerCheckedAt), c.expected.ledgerChecked, 'ledgerCheckedAt');
    assert.equal(s.submittedExternally === true, c.expected.submittedExternally, 'submittedExternally');
    assert.equal(d.body.submittedExternally === true, c.expected.submittedExternally, 'submittedExternally im Detail');
    assert.equal(fromList.submittedExternally === true, c.expected.submittedExternally, 'submittedExternally in der Liste');
    // ES-8: nur in der Antwort, nie gespeichert.
    assert.equal(fromList.ledgerCheckPending, c.expected.ledgerCheckPending, 'ledgerCheckPending in der Liste');
    assert.equal(d.body.ledgerCheckPending, c.expected.ledgerCheckPending, 'ledgerCheckPending im Detail');
    assert.equal(s.ledgerCheckPending, undefined, 'ledgerCheckPending nicht gespeichert');
    if (c.expected.submittedAt) {
      assert.equal(s.submittedAt, c.expected.submittedAt);
      assert.equal(fromList.submittedAt, c.expected.submittedAt);
    }
    if (c.expected.status === 'submitted_success' && c.expected.submittedExternally) {
      assert.deepEqual(d.body.submittedResult, { hash: c.hash, ledger: c.expected.ledger }, 'F-3-Format');
      assert.deepEqual(fromList.submittedResult, { hash: c.hash, ledger: c.expected.ledger });
    }
    if (c.expected.status === 'submitted_failed') {
      assert.equal(d.body.submittedResult.error, 'Transaction Failed');
      assert.deepEqual(d.body.submittedResult.detail.extras, {});
    }
  });
}

test('Budget: submit_unclear zuerst, dann entscheidbare, dann aelteste maxTime; entscheidbare verhungern nicht', async () => {
  const before = lookupLines().length;
  const l = await list(many);
  const order = lookupLines().slice(before);
  assert.equal(order.length, 5, 'hoechstens 5 Abfragen je Anfrage');
  assert.deepEqual(order.slice(0, 3), [hashOf(unclearTx), hashOf(decidable[1]), hashOf(decidable[0])], 'unklar, dann aelteste entscheidbare');
  assert.deepEqual(order.slice(3), [hashOf(undecided[4]), hashOf(undecided[3])], 'dann aelteste maxTime');
  assert.equal(stored('unclear').status, 'submitted_success');
  for (const id of ['decidable-0', 'decidable-1']) {
    assert.equal(stored(id).status, 'obsolete_seq', `${id}: Sequence verbraucht, sicher nicht gefunden (ES-6)`);
    assert.ok(stored(id).ledgerCheckedAt, `${id} geprueft`);
  }
  assert.equal(l.body.find((j) => j.id === 'unclear').status, 'submitted_success');
  // Naechste Anfrage: die drei uebrigen offenen Jobs, die geprueften nicht mehr.
  const before2 = lookupLines().length;
  await list(many);
  const order2 = lookupLines().slice(before2);
  assert.deepEqual(order2, [hashOf(undecided[4]), hashOf(undecided[3]), hashOf(undecided[2]), hashOf(undecided[1]), hashOf(undecided[0])]);
});

test('Geloeschter Job waehrend der Abfrage: nichts gespeichert, Antwort ohne Ergebnis', async () => {
  const pending = detail('deleted');
  await new Promise((r) => setTimeout(r, 400));
  // Das Loeschen laedt das Konto frisch (ohne Cache): nachhinkender Knoten, Sequence 100.
  fs.writeFileSync(accountsPath, JSON.stringify({ ...accounts, [delOwner.publicKey()]: accountEntry(delOwner, '100') }));
  const del = await withChallenge('deleted', delOwner, 'delete');
  fs.writeFileSync(accountsPath, JSON.stringify(accounts));
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const d = await pending;
  assert.equal(lookups(hashOf(delTx)), 1, 'abgefragt');
  assert.equal(stored('deleted'), undefined, 'nicht wieder angelegt');
  assert.equal(d.body.status, 'expired', 'kein Ergebnis fuer den geloeschten Job');
  assert.notEqual(d.body.submittedExternally, true);
});

test('Status geaendert waehrend der Abfrage (Merge speichert obsolete_seq): nichts gespeichert, danach geklaert', async () => {
  const pending = detail('race');
  await new Promise((r) => setTimeout(r, 400));
  const merged = await post(`${BASE}/race/merge-signed-xdr`, { signedXdr: raceTx.toXDR() }, { 'x-job-token': 'tok-race' });
  assert.equal(merged.status, 409);
  assert.equal(merged.body.error, 'obsolete_seq');
  const d = await pending;
  assert.equal(lookups(hashOf(raceTx)), 1);
  assert.equal(stored('race').status, 'obsolete_seq', 'Stand des Merge bleibt');
  assert.equal(stored('race').ledgerCheckedAt, undefined);
  assert.notEqual(stored('race').submittedExternally, true);
  assert.notEqual(d.body.submittedExternally, true, 'Antwort ohne Ergebnis');
  // Naechstes Lesen: gespeichert obsolete_seq ohne Marker ist Kandidat und wird geklaert.
  const again = await detail('race');
  assert.equal(again.body.status, 'submitted_success');
  assert.equal(stored('race').submittedExternally, true);
});

test('ES-3: Loeschen eines ungeprueften Kandidaten mit verbrauchter Sequence: 409, Job bleibt', async () => {
  const res = await withChallenge('pending-check', pendOwner, 'delete');
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'ledger_check_pending');
  assert.ok(stored('pending-check'), 'nicht geloescht');
  const free = await withChallenge('free', freeOwner, 'delete');
  assert.equal(free.status, 200, 'Gegenprobe: Sequence nicht verbraucht, loeschbar');
  assert.equal(stored('free'), undefined);
});

test('ES-2: untergeschobene unsignierte Jobs verdraengen einen signierten Kandidaten nicht', async () => {
  const before = lookupLines().length;
  const l = await list(victim);
  const order = lookupLines().slice(before);
  assert.equal(order.length, 5);
  assert.equal(order[0], hashOf(victimJobTx), 'signierter Job zuerst');
  assert.equal(stored('victim-signed').status, 'submitted_success');
  assert.equal(stored('victim-signed').submittedExternally, true);
  const row = l.body.find((j) => j.id === 'victim-signed');
  assert.equal(row.status, 'submitted_success');
  assert.equal(row.ledgerCheckPending, false);
  // Die untergeschobenen bleiben Kandidaten: 404 vor der Marge, Anzeige mit ledgerCheckPending.
  for (const p of plantedVictim) assert.equal(stored(p.job.id).status, 'pending_signatures');
  assert.ok(l.body.filter((j) => j.id.startsWith('planted-')).every((j) => j.ledgerCheckPending === true));
});

test('ES-2 Gegenprobe: unsignierter echter Job steht hinter den fuenf mit frueherer maxTime, ledgerCheckPending', async () => {
  const before = lookupLines().length;
  const l = await list(victimUnsigned);
  const order = lookupLines().slice(before);
  assert.deepEqual(order, plantedUnsigned.map((p) => hashOf(p.tx)), 'Budget ganz bei den untergeschobenen');
  assert.equal(lookups(hashOf(victimUnsignedTx)), 0);
  const row = l.body.find((j) => j.id === 'victim-unsigned');
  assert.equal(row.status, 'obsolete_seq');
  assert.equal(row.ledgerCheckPending, true, 'Anzeige: noch nicht geklaert, nicht neu anlegen');
  assert.equal(stored('victim-unsigned').status, 'pending_signatures');
});

test('ES-1: Anlegen mit verbrauchter Sequence oder abgelaufener maxTime: 409 tx_not_viable, kein Job', async () => {
  const before = JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.length;
  const seqRes = await post(BASE, { network: 'testnet', accountId: deadSeqOwner.publicKey(), txXdr: buildTx(deadSeqOwner, NOW + 3600).toXDR() });
  assert.equal(seqRes.status, 409);
  assert.deepEqual([seqRes.body.error, seqRes.body.status], ['tx_not_viable', 'obsolete_seq']);
  const timeRes = await post(BASE, { network: 'testnet', accountId: deadTimeOwner.publicKey(), txXdr: buildTx(deadTimeOwner, NOW - 10).toXDR() });
  assert.equal(timeRes.status, 409);
  assert.deepEqual([timeRes.body.error, timeRes.body.status], ['tx_not_viable', 'expired']);
  assert.equal(JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.length, before);
});

test('Es wird nie gesendet', () => {
  assert.equal(fs.existsSync(submitLog) ? fs.readFileSync(submitLog, 'utf8').trim() : '', '');
});
