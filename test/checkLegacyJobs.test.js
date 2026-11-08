// N2: scripts/check-legacy-jobs.js erkennt Fee-Bump-Altjobs (txSourceBaseAccount kennt dafuer keine Quelle,
// null) und meldet sie gesondert: innere Quelle als Tx-Quelle, kein loadAccount(null), keine falsche Meldung
// "accountId ungleich Tx-Quelle". Dazu ein Probelauf des Skripts mit einer Fee-Bump-Zeile in einer Jobdatei.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { inspectJob } = require('../scripts/check-legacy-jobs.js');

function paymentTx(owner) {
  const tx = new TransactionBuilder(new Account(owner.publicKey(), '100'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(3600)
    .build();
  tx.sign(owner);
  return tx;
}

const owner = Keypair.random();
const plain = paymentTx(owner);
const feePayer = Keypair.random();
const feeBump = TransactionBuilder.buildFeeBumpTransaction(feePayer, '200', paymentTx(owner), Networks.TESTNET);
// Einloesbar ist ein Fee-Bump nur mit Signatur der Huelle.
feeBump.sign(feePayer);
const jobOf = (tx, extra = {}) => ({ id: 'j', network: 'testnet', accountId: owner.publicKey(), status: 'pending_signatures', txXdrCurrent: tx.toXDR(), ...extra });

test('Fee-Bump mit passender innerer Quelle: gesondert gemeldet, kein Kontenkonflikt, Quelle nicht null', async () => {
  const f = await inspectJob(jobOf(feeBump));
  assert.ok(f);
  assert.equal(f.kind, 'Fee-Bump');
  const text = f.detail.join('\n');
  assert.match(text, new RegExp(`Tx-Quelle  ${owner.publicKey()}`));
  assert.doesNotMatch(text, /null/);
  assert.equal(f.risky, true);
});

test('Fee-Bump mit abweichendem Konto: beide Gruende, Vergleich gegen die innere Quelle', async () => {
  const f = await inspectJob(jobOf(feeBump, { accountId: Keypair.random().publicKey() }));
  assert.equal(f.kind, 'Fee-Bump, accountId ungleich Tx-Quelle');
});

test('normale Transaktion mit passendem Konto ist unauffaellig, abweichendes Konto wird gemeldet', async () => {
  assert.equal(await inspectJob(jobOf(plain)), null);
  const f = await inspectJob(jobOf(plain, { accountId: Keypair.random().publicKey() }));
  assert.equal(f.kind, 'accountId ungleich Tx-Quelle');
});

test('Probelauf des Skripts mit einer Fee-Bump-Zeile (offline)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-legacy-'));
  const file = path.join(dir, 'jobs.json');
  fs.writeFileSync(file, JSON.stringify({ items: [jobOf(feeBump, { id: 'fb1' }), jobOf(plain, { id: 'ok1' })] }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-legacy-jobs.js'), file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 Jobs geprueft, 1 auffaellig/);
  assert.match(r.stdout, /Job fb1: Fee-Bump\n/);
  assert.doesNotMatch(r.stdout, /accountId ungleich|null/);
});
