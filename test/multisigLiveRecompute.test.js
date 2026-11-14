// Schritt 3 der Fable-Befunde (Node), Pendant: test/multisigLiveRecompute.test.php.
// - F-8: Anlegen bei Horizon-Ausfall 503 horizon_unavailable, bei unbekanntem Konto 400
//   account_not_found, beide ohne Job.
// - F-9: Merge bei Horizon-Ausfall 502 signers_unavailable, nichts geaendert, nichts gesendet.
// - F-11: Offene Jobs werden beim Lesen live neu berechnet (Signer, Schwellen, requiredWeight,
//   collected, Status), ohne zu speichern. Bei Horizon-Ausfall gilt der gespeicherte Stand,
//   gespeicherte collectedSigners nur bei nicht lesbarem XDR, Endzustaende ohne Abfrage.
// - Ablehnen und Loeschen entscheiden mit dem neu berechneten Stand.
// Horizon per test/helpers/horizonAccountsMock.js; SKM_TEST_SUBMIT_HASH faengt ein (falsches)
// Senden ab, damit nie das echte Testnet erreicht wird.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');

const PORT = 3951;
const BASE = `http://127.0.0.1:${PORT}/api/multisig/jobs`;
const kp = () => Keypair.random();
const accR = kp(); // R: Signer C wurde entfernt
const C = kp();
const B = kp();
const accL = kp(); // L: Altjob, bei Horizon-Ausfall angelegt (signers leer)
const accA = kp(); // A: normaler offener Job
const down = kp(); // Horizon nicht erreichbar
const ghost = kp(); // Horizon 404

const txFor = (source, signers = []) => {
  const tx = new TransactionBuilder(new Account(source.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(3600)
    .build();
  signers.forEach((s) => tx.sign(s));
  return tx;
};
const sig = (k, weight = 1) => ({ publicKey: k.publicKey(), weight });
const job = (id, source, tx, extra) => ({
  id, accessToken: `tok-${id}`, network: 'testnet', accountId: source.publicKey(),
  txHash: Buffer.from(tx.hash()).toString('hex'), txXdrOriginal: tx.toXDR(), txXdrCurrent: tx.toXDR(),
  status: 'pending_signatures', createdAt: new Date().toISOString(), maxTimeUnix: Math.floor(Date.now() / 1000) + 3600,
  collectedWeight: 0, ...extra,
});

const txDownMerge = txFor(down);
const txDownRead = txFor(down, [down]);
const items = [
  // F-11a: C hat signiert und wurde danach aus dem Konto entfernt; gespeichert noch [R, C], noetig 1.
  job('removed', accR, txFor(accR, [C]), { signers: [sig(accR), sig(C)], thresholds: { low: 1, med: 1, high: 1 }, requiredWeight: 1, collectedSigners: [sig(C)], collectedWeight: 1 }),
  // F-8-Altjob: leere Signer, Schwellen 0, noetig 1, XDR von L signiert. Live: L und B, med 2.
  job('legacy', accL, txFor(accL, [accL]), { signers: [], thresholds: { low: 0, med: 0, high: 0 }, requiredWeight: 1, collectedSigners: [], collectedWeight: 0 }),
  // Horizon-Ausfall beim Lesen: gespeicherter Stand.
  job('down-read', down, txDownRead, { signers: [sig(down), sig(B)], thresholds: { low: 2, med: 2, high: 2 }, requiredWeight: 2, collectedSigners: [sig(down)], collectedWeight: 1 }),
  // F-9: Horizon-Ausfall beim Merge, gespeicherte Signer reichen allein (noetig 1).
  job('down-merge', down, txDownMerge, { signers: [sig(down)], thresholds: { low: 1, med: 1, high: 1 }, requiredWeight: 1, collectedSigners: [], collectedWeight: 0 }),
  // Lesbares XDR ohne Signatur, gespeicherte collectedSigners veraltet: kein Rueckgriff.
  job('stale-collected', accA, txFor(accA), { signers: [sig(accA), sig(B)], thresholds: { low: 2, med: 2, high: 2 }, requiredWeight: 2, collectedSigners: [sig(accA)], collectedWeight: 1 }),
  // Nicht lesbares XDR: Rueckgriff auf gespeicherte collectedSigners.
  { ...job('broken-xdr', accA, txFor(accA), { signers: [sig(accA), sig(B)], thresholds: { low: 2, med: 2, high: 2 }, requiredWeight: 2, collectedSigners: [sig(accA)], collectedWeight: 1 }), txXdrCurrent: 'kaputt', txXdrOriginal: 'kaputt' },
  // Endzustaende: gespeicherter Stand, auch mit leeren Signern.
  job('final', accR, txFor(accR, [C]), { status: 'submitted_failed', signers: [sig(accR), sig(C)], thresholds: { low: 1, med: 1, high: 1 }, requiredWeight: 1, collectedSigners: [sig(C)], collectedWeight: 1 }),
  job('final-empty', accL, txFor(accL), { status: 'submitted_failed', signers: [], thresholds: { low: 0, med: 0, high: 0 }, requiredWeight: 1, collectedSigners: [], collectedWeight: 0 }),
];
const accounts = {
  [accR.publicKey()]: { signers: [{ key: accR.publicKey(), weight: 1 }, { key: B.publicKey(), weight: 1 }], thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }, sequence: '100' },
  [accL.publicKey()]: { signers: [{ key: accL.publicKey(), weight: 1 }, { key: B.publicKey(), weight: 1 }], thresholds: { low_threshold: 0, med_threshold: 2, high_threshold: 2 }, sequence: '100' },
  [accA.publicKey()]: { signers: [{ key: accA.publicKey(), weight: 1 }, { key: B.publicKey(), weight: 1 }], thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 }, sequence: '100' },
  [ghost.publicKey()]: { notFound: true },
  // down fehlt: loadAccount wirft wie bei einem Ausfall.
};

let server;
let dataDir;
let dbPath;
const stored = (id) => JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.find((j) => j.id === id);
const post = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const detail = async (id) => {
  const res = await fetch(`${BASE}/${id}`, { headers: { 'x-job-token': `tok-${id}` } });
  return { status: res.status, body: await res.json() };
};
const signedChallenge = async (id, signer, purpose) => {
  const { body } = await post(`${BASE}/${id}/challenge`, { signer: signer.publicKey() });
  const data = Buffer.concat([Buffer.from(`skm:${purpose}:`), Buffer.from(body.challenge, 'base64')]);
  return { signer: signer.publicKey(), signature: Buffer.from(signer.sign(data)).toString('base64') };
};
const pks = (list) => (list || []).map((s) => s.publicKey).sort();

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-liverecompute-'));
  dbPath = path.join(dataDir, 'multisig_jobs.json');
  const accountsPath = path.join(dataDir, 'horizon_accounts.json');
  fs.writeFileSync(dbPath, JSON.stringify({ items }));
  fs.writeFileSync(accountsPath, JSON.stringify(accounts));
  server = spawn(process.execPath, ['--require', './test/helpers/horizonAccountsMock.js', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BUG_DB_DIR: dataDir, MULTISIG_DB_PATH: dbPath, SKM_TEST_HORIZON_ACCOUNTS: accountsPath, SKM_TEST_SUBMIT_HASH: 'mockhash' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    try { await fetch(`${BASE}?network=testnet&accountId=${accA.publicKey()}`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// --- F-8 ---------------------------------------------------------------------
test('F-8: Anlegen bei Horizon-Ausfall ergibt 503 horizon_unavailable, kein Job', async () => {
  const before = JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.length;
  const res = await post(BASE, { network: 'testnet', accountId: down.publicKey(), txXdr: txFor(down, [down]).toXDR() });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { ok: false, error: 'horizon_unavailable' });
  assert.equal(JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.length, before);
});

test('F-8: Anlegen fuer ein unbekanntes Konto (Horizon 404) ergibt 400 account_not_found, kein Job', async () => {
  const before = JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.length;
  const res = await post(BASE, { network: 'testnet', accountId: ghost.publicKey(), txXdr: txFor(ghost).toXDR() });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, error: 'account_not_found' });
  assert.equal(JSON.parse(fs.readFileSync(dbPath, 'utf8')).items.length, before);
});

// --- F-9 ---------------------------------------------------------------------
test('F-9: Merge bei Horizon-Ausfall ergibt 502 signers_unavailable, Job unveraendert, nicht gesendet', async () => {
  const signed = TransactionBuilder.fromXDR(txDownMerge.toXDR(), Networks.TESTNET);
  signed.sign(down);
  const res = await post(`${BASE}/down-merge/merge-signed-xdr`, { signedXdr: signed.toXDR() }, { 'x-job-token': 'tok-down-merge' });
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { ok: false, error: 'signers_unavailable' });
  const s = stored('down-merge');
  assert.equal(s.status, 'pending_signatures');
  assert.equal(s.txXdrCurrent, txDownMerge.toXDR());
  assert.equal(s.submittedResult, undefined);
});

// --- F-11 --------------------------------------------------------------------
test('F-11: entfernter Signer zaehlt beim Lesen nicht mehr (live Signer)', async () => {
  const { status, body } = await detail('removed');
  assert.equal(status, 200);
  assert.equal(body.collectedWeight, 0);
  assert.deepEqual(body.collectedSigners, []);
  assert.equal(body.status, 'pending_signatures');
  assert.deepEqual(pks(body.signers), pks([sig(accR), sig(B)]));
  assert.deepEqual(pks(body.missingSigners), pks([sig(accR), sig(B)]));
  // nichts gespeichert
  assert.deepEqual(pks(stored('removed').signers), pks([sig(accR), sig(C)]));
  assert.equal(stored('removed').collectedWeight, 1);
});

test('F-8/F-11: Altjob mit leeren Signern zeigt live Schwellen und noetiges Gewicht', async () => {
  const { body } = await detail('legacy');
  assert.equal(body.requiredWeight, 2);
  assert.equal(body.collectedWeight, 1);
  assert.equal(body.status, 'pending_signatures');
  assert.deepEqual(body.thresholds, { low: 0, med: 2, high: 2 });
  assert.deepEqual(pks(body.missingSigners), [B.publicKey()]);
  assert.equal(stored('legacy').requiredWeight, 1);
});

test('F-11: Liste rechnet genauso neu wie das Detail', async () => {
  const res = await fetch(`${BASE}?network=testnet&accountId=${accL.publicKey()}`);
  const item = (await res.json()).find((j) => j.id === 'legacy');
  assert.equal(item.requiredWeight, 2);
  assert.equal(item.status, 'pending_signatures');
});

test('F-11: bei Horizon-Ausfall gilt der gespeicherte Stand', async () => {
  const { body } = await detail('down-read');
  assert.equal(body.requiredWeight, 2);
  assert.equal(body.collectedWeight, 1);
  assert.equal(body.status, 'pending_signatures');
  assert.deepEqual(pks(body.signers), pks([sig(down), sig(B)]));
});

test('F-11: lesbares XDR ohne Signatur nimmt keine veralteten collectedSigners', async () => {
  const { body } = await detail('stale-collected');
  assert.equal(body.collectedWeight, 0);
  assert.deepEqual(body.collectedSigners, []);
});

test('F-11: nicht lesbares XDR nimmt die gespeicherten collectedSigners', async () => {
  const { status, body } = await detail('broken-xdr');
  assert.equal(status, 200);
  assert.equal(body.collectedWeight, 1);
  assert.deepEqual(pks(body.collectedSigners), [accA.publicKey()]);
});

test('F-11: Endzustand bleibt beim gespeicherten Stand (keine Live-Signer)', async () => {
  const { body } = await detail('final');
  assert.equal(body.status, 'submitted_failed');
  assert.deepEqual(pks(body.signers), pks([sig(accR), sig(C)]));
  assert.equal(body.collectedWeight, 1);
  const empty = (await detail('final-empty')).body;
  assert.equal(empty.status, 'submitted_failed');
  assert.deepEqual(empty.signers, []);
});

// --- Ablehnen und Loeschen mit dem neu berechneten Stand -------------------------
test('Ablehnen: Signatur nur im XDR (Altjob ohne gespeicherte collectedSigners) ergibt 409 already_signed', async () => {
  const res = await post(`${BASE}/legacy/decline`, await signedChallenge('legacy', accL, 'decline'));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'already_signed');
  assert.equal(stored('legacy').status, 'pending_signatures');
});

test('Ablehnen: noch nicht signierter Signer kann ablehnen, mit live noetigem Gewicht', async () => {
  const res = await post(`${BASE}/legacy/decline`, await signedChallenge('legacy', B, 'decline'));
  assert.equal(res.status, 200);
  // ohne B bleibt L mit 1 von live 2: abgelehnt
  assert.equal(res.body.status, 'rejected');
  assert.equal(stored('legacy').requiredWeight, 2);
});

test('Loeschen: offener Job (neu berechnet) ergibt 409 not_final', async () => {
  const res = await post(`${BASE}/removed/delete`, await signedChallenge('removed', accR, 'delete'));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'not_final');
  assert.equal(res.body.status, 'pending_signatures');
  assert.ok(stored('removed'));
});

test('Loeschen: Endzustand wird geloescht', async () => {
  const res = await post(`${BASE}/final/delete`, await signedChallenge('final', accR, 'delete'));
  assert.equal(res.status, 200);
  assert.equal(stored('final'), undefined);
});
