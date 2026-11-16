// ADR 0013: foreignOpSourcesOf (services/txSignatures.js) gegen die gemeinsame Fixture
// test/assets/foreign-op-sources.json. Pendant: test/txSignatures.test.php (gleiche Fixture) und
// frontend/src/utils/multisig/__tests__/describeOperations.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Account, Asset, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const { foreignOpSourcesOf } = require('../services/txSignatures.js');
const fixture = require('./assets/foreign-op-sources.json');

const addr = (name) => fixture.accounts[name];

function buildTx(c) {
  const builder = new TransactionBuilder(new Account(addr('A'), '100'), { fee: '100', networkPassphrase: Networks.TESTNET });
  for (const source of c.ops) {
    const opts = { destination: addr('C'), asset: Asset.native(), amount: '1' };
    if (source) opts.source = addr(source);
    builder.addOperation(Operation.payment(opts));
  }
  const inner = builder.setTimeout(3600).build();
  if (!c.feeBump) return inner;
  return TransactionBuilder.buildFeeBumpTransaction(addr(c.feeSource), '200', inner, Networks.TESTNET);
}

for (const c of fixture.cases) {
  test(`Fixture: ${c.label}`, () => {
    assert.deepEqual(foreignOpSourcesOf(buildTx(c), addr('A')), c.expected.map(addr));
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
