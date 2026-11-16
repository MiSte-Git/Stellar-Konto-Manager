// ADR 0013: foreignOpSourcesOf (services/txSignatures.js) gegen die gemeinsame Fixture
// test/assets/foreign-op-sources.json. Pendant: test/txSignatures.test.php (gleiche Fixture) und
// frontend/src/utils/multisig/__tests__/describeOperations.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Account, Asset, MuxedAccount, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { foreignOpSourcesOf } = require('../services/txSignatures.js');
const fixture = require('./assets/foreign-op-sources.json');

const addr = (name) => fixture.accounts[name];

// Tx-Quelle: c.txSource (Altjob von vor K1) oder das Job-Konto A. M-Adressen der Fixture haben die ID 7.
function txSourceAccount(name = 'A') {
  if (!name.endsWith('_M')) return new Account(addr(name), '100');
  return new MuxedAccount(new Account(addr(name.slice(0, -2)), '100'), '7');
}

function buildTx(c) {
  const builder = new TransactionBuilder(txSourceAccount(c.txSource), { fee: '100', networkPassphrase: Networks.TESTNET });
  for (const source of c.ops) {
    const opts = { destination: addr('C'), asset: Asset.native(), amount: '1' };
    if (source) opts.source = addr(source);
    builder.addOperation(Operation.payment(opts));
  }
  const inner = builder.setTimeout(3600).build();
  const tx = c.feeBump ? TransactionBuilder.buildFeeBumpTransaction(addr(c.feeSource), '200', inner, Networks.TESTNET) : inner;
  // Ueber XDR wie im Backend (parseJobTx), nicht das gebaute Objekt.
  return TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
}

for (const c of fixture.cases) {
  test(`Fixture: ${c.label}`, () => {
    assert.deepEqual(foreignOpSourcesOf(buildTx(c), addr('A')), c.expected.map(addr));
    assert.equal(c.autoSubmit, c.expected.length === 0, 'Fixture in sich stimmig');
  });
}

// FS-4: Altjobs von vor K1, Tx-Quelle ungleich Job-Konto (nur Backends, siehe _txSourceComment).
test('Fixture txSourceCases vorhanden', () => assert.ok(fixture.txSourceCases.length > 0));
for (const c of fixture.txSourceCases) {
  test(`Fixture Tx-Quelle: ${c.label}`, () => {
    const tx = buildTx(c);
    assert.equal((tx.innerTransaction || tx).source, addr(c.txSource), 'sanity: Tx-Quelle wie in der Fixture');
    assert.deepEqual(foreignOpSourcesOf(tx, addr('A')), c.expected.map(addr));
    assert.equal(c.autoSubmit, c.expected.length === 0, 'Fixture in sich stimmig');
  });
}

test('M-Adresse als Job-Konto: eigene Operationen sind nicht fremd', () => {
  const c = fixture.cases.find((x) => x.label === 'op.source gleich Job-Konto');
  assert.deepEqual(foreignOpSourcesOf(buildTx(c), addr('A_M')), []);
});

test('ohne Transaktion leer', () => {
  assert.deepEqual(foreignOpSourcesOf(null, addr('A')), []);
});

test('Quelle ohne bestimmbares Basiskonto zaehlt als fremd (Rohwert), wie isForeignOpSource im Frontend', () => {
  // Stub statt echter Transaktion: das SDK baut keine Operation mit ungueltiger source.
  const stub = { operations: [{ source: 'GKAPUTT' }, { source: addr('B') }, { source: 'GKAPUTT' }, { source: addr('A') }] };
  assert.deepEqual(foreignOpSourcesOf(stub, addr('A')), ['GKAPUTT', addr('B')], 'Rohwert einmal, eigenes Konto nicht');
});
