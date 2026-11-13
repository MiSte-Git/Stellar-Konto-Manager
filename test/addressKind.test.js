// Kontotyp zentral, Backend Node (Plan Signer-Buendelung, Schritt b2). services/addressKind.js
// laeuft gegen die gemeinsame Fixture test/assets/address-kinds.json, dieselbe wie
// test/addressKind.test.php und frontend/src/utils/stellar/__tests__/addressKind.test.js.
//
// Verhaltensneutral: Die Referenzen unten sind die Ausdruecke vor der Umstellung (Stand
// 7f20a96), wortgleich. Die umgestellten Stellen muessen fuer jede Eingabe dasselbe liefern.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Account, Keypair, MuxedAccount, Networks, Operation, StrKey, TransactionBuilder } = require('@stellar/stellar-sdk');
const {
  ADDRESS_KINDS,
  baseAccountOf,
  classifyAddress,
  isClassicAccount,
  isClassicAccountSyntax,
  isContractAddress,
} = require('../services/addressKind.js');
const { txSourceBaseAccount } = require('../services/txSignatures.js');
const { isContractAddressId } = require('../services/federationService.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'address-kinds.json'), 'utf8'));

// --- Referenzen: Stand vor der Umstellung -----------------------------------------------------
const OLD = {
  // services/txSignatures.js
  txSourceBaseAccount(tx) {
    const source = String(tx?.source || '');
    if (StrKey.isValidMed25519PublicKey(source)) {
      return StrKey.encodeEd25519PublicKey(StrKey.decodeMed25519PublicKey(source).subarray(0, 32));
    }
    return StrKey.isValidEd25519PublicKey(source) ? source : null;
  },
  // services/federationService.js
  isContractAddressId(id) {
    if (typeof id !== 'string') return false;
    return StrKey.isValidContract(id) || StrKey.isValidMuxedContract(id);
  },
  // server.js (Job anlegen), tradeService.js, federationService.js (G-Pruefungen)
  isValidEd25519PublicKey: (v) => StrKey.isValidEd25519PublicKey(v),
  // api/trade.php STELLAR_PUBLIC_KEY_RE und frontend assetSearchUtils (Stand vor b1)
  STELLAR_PUBLIC_KEY_RE: /^G[A-Z2-7]{55}$/,
};

test('ADDRESS_KINDS: gleiche Werte wie das Frontend', () => {
  assert.deepEqual(ADDRESS_KINDS, { ACCOUNT: 'account', MUXED: 'muxed', CONTRACT: 'contract', MUXED_CONTRACT: 'muxedContract', INVALID: 'invalid' });
  assert.ok(Object.isFrozen(ADDRESS_KINDS));
});

test('Fixture deckt die geforderten Faelle ab', () => {
  const kinds = new Set(fixture.cases.map((c) => c.kind));
  for (const k of Object.values(ADDRESS_KINDS)) assert.ok(kinds.has(k), k);
  const muxedIds = fixture.cases.filter((c) => c.kind === 'muxed').map((c) => c.muxedId);
  assert.ok(muxedIds.includes('0') && muxedIds.includes('18446744073709551615'));
  for (const prefix of ['S', 'T', 'X', 'P']) assert.ok(fixture.cases.some((c) => c.address.startsWith(prefix) && c.kind === 'invalid'), prefix);
});

for (const c of fixture.cases) {
  test(`Fixture: ${c.label}`, () => {
    assert.equal(classifyAddress(c.address), c.kind);
    assert.equal(baseAccountOf(c.address), c.baseAccountId);
    assert.equal(isClassicAccount(c.address), c.isClassicAccount);
    assert.equal(isClassicAccountSyntax(c.address), c.isClassicAccountSyntax);
    assert.equal(isContractAddress(c.address), c.kind === 'contract' || c.kind === 'muxedContract');
  });

  test(`Alt gegen neu: ${c.label}`, () => {
    assert.equal(txSourceBaseAccount({ source: c.address }), OLD.txSourceBaseAccount({ source: c.address }));
    assert.equal(isContractAddressId(c.address), OLD.isContractAddressId(c.address));
    assert.equal(isClassicAccount(c.address), OLD.isValidEd25519PublicKey(c.address));
    assert.equal(isClassicAccount(c.address.trim()), OLD.isValidEd25519PublicKey(c.address.trim()));
    assert.equal(isClassicAccountSyntax(c.address), OLD.STELLAR_PUBLIC_KEY_RE.test(c.address));
  });
}

test('Kein String: invalid, null, false wie vorher', () => {
  for (const v of [null, undefined, 123, {}, [], true]) {
    assert.equal(classifyAddress(v), 'invalid');
    assert.equal(baseAccountOf(v), null);
    assert.equal(isClassicAccount(v), OLD.isValidEd25519PublicKey(v));
    assert.equal(isContractAddressId(v), OLD.isContractAddressId(v));
    assert.equal(isClassicAccountSyntax(v), OLD.STELLAR_PUBLIC_KEY_RE.test(v));
    assert.equal(txSourceBaseAccount({ source: v }), OLD.txSourceBaseAccount({ source: v }));
  }
  assert.equal(txSourceBaseAccount(null), OLD.txSourceBaseAccount(null));
  assert.equal(txSourceBaseAccount({}), OLD.txSourceBaseAccount({}));
});

test('isClassicAccountSyntax wie die alte Regex, auch ohne Pruefsumme', () => {
  for (const v of [`G${'A'.repeat(55)}`, `G${'A'.repeat(54)}`, `G${'A'.repeat(56)}`, `G${'1'.repeat(55)}`, 'G', `g${'A'.repeat(55)}`]) {
    assert.equal(isClassicAccountSyntax(v), OLD.STELLAR_PUBLIC_KEY_RE.test(v), v);
  }
});

test('txSourceBaseAccount mit echten Transaktionen (G und M als Quelle)', () => {
  for (let i = 0; i < 20; i++) {
    const kp = Keypair.random();
    const plain = new Account(kp.publicKey(), '100');
    const muxed = new MuxedAccount(plain, String(i * 7919));
    for (const source of [plain, muxed]) {
      const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.bumpSequence({ bumpTo: '200' }))
        .setTimeout(60)
        .build();
      assert.equal(txSourceBaseAccount(tx), kp.publicKey());
      assert.equal(txSourceBaseAccount(tx), OLD.txSourceBaseAccount(tx));
    }
  }
});
