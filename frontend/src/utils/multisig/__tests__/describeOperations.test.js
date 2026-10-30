import { describe, expect, it } from 'vitest';
import { Buffer } from 'buffer';
import { Account, Asset, Keypair, LiquidityPoolAsset, LiquidityPoolFeeV18, MuxedAccount, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { DESCRIBED_OPERATION_TYPES, TRUSTLINE_LIMIT_MAX_STROOPS, describeOperations, findOperationWarnings, formatAsset, shortKey } from '../describeOperations.js';
import { getJobSequenceInfo } from '../jobRevocation.js';

// Mirrors react-i18next's t() signature closely enough for describeOperations()'s
// purposes: interpolates {{var}} placeholders from the options object, ignoring
// the reserved `defaultValue`/`ns` keys, and otherwise falls back to the key path.
function fakeT(key, opts = {}) {
  const { defaultValue, ...vars } = opts;
  let out = defaultValue || key;
  Object.entries(vars).forEach(([k, v]) => {
    out = out.replaceAll(`{{${k}}}`, String(v));
  });
  return out;
}

const SOURCE = Keypair.random().publicKey();

function buildTx(ops, source = SOURCE) {
  const builder = new TransactionBuilder(new Account(source, '100'), { fee: '100', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(60).build();
}

// Umweg ueber XDR: so dekodiert auch das Job-Detail, u. a. M-Adressen und Bytes.
function decoded(ops, source) {
  return TransactionBuilder.fromXDR(buildTx(ops, source).toXDR(), Networks.TESTNET).operations;
}

function describeOne(op, options = {}) {
  const [block] = describeOperations(decoded([op]), fakeT, SOURCE, { locale: 'de', ...options });
  return block;
}

const rowOf = (block, key) => block.rows.find((row) => row.key === key);
const valueOf = (block, key) => rowOf(block, key)?.value;
const keysOf = (block) => block.rows.map((row) => row.key);
const issuerLabels = (block) => block.rows.filter((row) => row.key.startsWith('issuer:')).map((row) => [row.label, row.value]);
const muxedOf = (publicKey, id = '42') => new MuxedAccount(new Account(publicKey, '1'), id).accountId();

describe('shortKey', () => {
  it('abbreviates a full public key to first8…last8', () => {
    const pk = Keypair.random().publicKey();
    expect(shortKey(pk)).toBe(`${pk.slice(0, 8)}…${pk.slice(-8)}`);
  });

  it('returns short strings unchanged', () => {
    expect(shortKey('abc')).toBe('abc');
    expect(shortKey('')).toBe('');
  });
});

describe('describeOperations: Blockmodell', () => {
  it('returns an empty array for no operations', () => {
    expect(describeOperations([], fakeT)).toEqual([]);
    expect(describeOperations(null, fakeT)).toEqual([]);
    expect(describeOperations(undefined, fakeT)).toEqual([]);
  });

  it('liefert je Operation einen Block in der Reihenfolge der Transaktion', () => {
    const blocks = describeOperations(decoded([
      Operation.createAccount({ destination: Keypair.random().publicKey(), startingBalance: '2' }),
      Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '0.0000001' }),
    ]), fakeT, SOURCE, { locale: 'de' });
    expect(blocks.map((b) => b.type)).toEqual(['createAccount', 'payment']);
    expect(blocks.map((b) => b.title)).toEqual(['Konto erstellen', 'Zahlung']);
    blocks.forEach((block) => {
      expect(block.warnings).toEqual([]);
      expect(block.source).toBeUndefined();
    });
  });

  it('jede Zeile hat key, label, value und innerhalb des Blocks eindeutige Keys', () => {
    const issuerA = Keypair.random().publicKey();
    const issuerB = Keypair.random().publicKey();
    const block = describeOne(Operation.pathPaymentStrictSend({
      sendAsset: new Asset('USD', issuerA), sendAmount: '5', destination: Keypair.random().publicKey(),
      destAsset: new Asset('USD', issuerB), destMin: '1', path: [new Asset('USD', issuerA), Asset.native()],
    }));
    const keys = keysOf(block);
    expect(new Set(keys).size).toBe(keys.length);
    block.rows.forEach((row) => {
      expect(typeof row.label).toBe('string');
      expect(typeof row.value).toBe('string');
    });
  });

  it('keine Platzhalter bleiben stehen (Regression: DeepL hat Platzhalter umbenannt)', () => {
    const blocks = describeOperations(decoded([
      Operation.accountMerge({ destination: Keypair.random().publicKey() }),
      Operation.changeTrust({ asset: new Asset('TRUST', Keypair.random().publicKey()) }),
    ]), fakeT, SOURCE, { locale: 'de' });
    expect(JSON.stringify(blocks)).not.toMatch(/\{\{.*\}\}/);
  });

  it('sanity: shortKey output is a validly-shaped ed25519 abbreviation', () => {
    expect(StrKey.isValidEd25519PublicKey(Keypair.random().publicKey())).toBe(true);
  });
});

describe('Betraege', () => {
  const dest = Keypair.random().publicKey();
  const payment = (amount, asset = Asset.native()) => Operation.payment({ destination: dest, asset, amount });

  it.each([
    ['de', /^1\.111,0 XLM$/],
    ['en', /^1,111\.0 XLM$/],
    // Apostroph je nach ICU-Version gerade oder typografisch
    ['de-CH', /^1['’]111\.0 XLM$/],
  ])('formatiert im Locale %s mit eindeutigem Trenner', (locale, expected) => {
    expect(valueOf(describeOne(payment('1111'), { locale }), 'amount')).toMatch(expected);
  });

  it('bleibt ohne Float-Umweg exakt, auch am oberen Ende', () => {
    expect(valueOf(describeOne(payment('922337203685.4775807'), { locale: 'en' }), 'amount')).toBe('922,337,203,685.4775807 XLM');
    expect(valueOf(describeOne(payment('0.0000001')), 'amount')).toBe('0,0000001 XLM');
  });

  it('nur natives XLM heisst XLM: ein Token XLM behaelt den Issuer', () => {
    const issuer = Keypair.random().publicKey();
    const block = describeOne(payment('1', new Asset('XLM', issuer)));
    expect(valueOf(block, 'amount')).toBe(`1,0 XLM (${shortKey(issuer)})`);
    expect(valueOf(block, `issuer:XLM:${issuer}`)).toBe(issuer);
  });

  it('zeigt einen nicht lesbaren Betrag unveraendert statt ihn zu verlieren', () => {
    const [block] = describeOperations([{ type: 'payment', amount: 'kaputt', asset: Asset.native(), destination: dest }], fakeT, SOURCE, { locale: 'de' });
    expect(valueOf(block, 'amount')).toBe('kaputt XLM');
  });

  it('createAccount: Startguthaben im Dialog-Format, Adresse voll', () => {
    const block = describeOne(Operation.createAccount({ destination: dest, startingBalance: '5' }));
    expect(valueOf(block, 'startingBalance')).toBe('5,0 XLM');
    expect(rowOf(block, 'destination')).toMatchObject({ value: dest, wrap: true });
  });

  it('pathPaymentStrictSend und StrictReceive zeigen alle Betraege und das eigene Konto', () => {
    const issuer = Keypair.random().publicKey();
    const spam = new Asset('SPAM', issuer);
    const send = describeOne(Operation.pathPaymentStrictSend({ sendAsset: spam, sendAmount: '5', destination: SOURCE, destAsset: Asset.native(), destMin: '1.2', path: [] }));
    expect(valueOf(send, 'sendAmount')).toBe(`5,0 SPAM (${shortKey(issuer)})`);
    expect(valueOf(send, 'destMin')).toBe('1,2 XLM');
    expect(valueOf(send, 'destination')).toBe(SOURCE);
    expect(valueOf(send, 'ownAccount')).toBe('das eigene Konto');
    expect(valueOf(send, 'path')).toBe('-');

    const receive = describeOne(Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: '9', destination: dest, destAsset: spam, destAmount: '3', path: [spam] }));
    expect(valueOf(receive, 'sendMax')).toBe('9,0 XLM');
    expect(valueOf(receive, 'destAmount')).toBe(`3,0 SPAM (${shortKey(issuer)})`);
    expect(valueOf(receive, 'destination')).toBe(dest);
    expect(rowOf(receive, 'ownAccount')).toBeUndefined();
    expect(valueOf(receive, 'path')).toBe(`SPAM (${shortKey(issuer)})`);
  });

  it('nennt jeden Issuer einmal vollstaendig, auch aus dem Pfad', () => {
    const issuerA = Keypair.random().publicKey();
    const issuerB = Keypair.random().publicKey();
    const usd = new Asset('USD', issuerA);
    const block = describeOne(Operation.pathPaymentStrictSend({ sendAsset: usd, sendAmount: '1', destination: dest, destAsset: Asset.native(), destMin: '1', path: [new Asset('EUR', issuerB), usd] }));
    expect(issuerLabels(block)).toEqual([
      ['Issuer USD (sendet, Pfad 2)', issuerA],
      ['Issuer EUR (Pfad 1)', issuerB],
    ]);
  });

  it('haelt gleichen Code mit zwei Issuern im Tausch auseinander', () => {
    const issuerA = Keypair.random().publicKey();
    const issuerB = Keypair.random().publicKey();
    const block = describeOne(Operation.pathPaymentStrictSend({ sendAsset: new Asset('USD', issuerA), sendAmount: '1', destination: dest, destAsset: new Asset('USD', issuerB), destMin: '1', path: [] }));
    expect(issuerLabels(block)).toEqual([
      ['Issuer USD (sendet)', issuerA],
      ['Issuer USD (erhält)', issuerB],
    ]);
  });

  it('fasst identisches Asset in mehreren Rollen zu einer Zeile zusammen', () => {
    const issuer = Keypair.random().publicKey();
    const usd = new Asset('USD', issuer);
    const block = describeOne(Operation.pathPaymentStrictReceive({ sendAsset: usd, sendMax: '1', destination: dest, destAsset: usd, destAmount: '1', path: [] }));
    expect(issuerLabels(block)).toEqual([['Issuer USD (sendet, erhält)', issuer]]);
  });

  it('nennt bei nur einem Asset keine Rolle', () => {
    const issuer = Keypair.random().publicKey();
    expect(issuerLabels(describeOne(Operation.payment({ destination: dest, asset: new Asset('USD', issuer), amount: '1' })))).toEqual([['Issuer USD', issuer]]);
  });

  it.each([
    ['acht Nachkommastellen', '1.12345678', '1.12345678 XLM'],
    ['Exponent', '1e3', '1e3 XLM'],
    ['negativ', '-5', '-5 XLM'],
    ['Leerzeichen', ' 7 ', ' 7  XLM'],
    ['leerer String', '', '- XLM'],
    ['undefined', undefined, '- XLM'],
    ['null', null, '- XLM'],
  ])('zeigt einen nicht darstellbaren Betrag (%s) roh, nie gekuerzt oder als 0', (_name, value, expected) => {
    const [block] = describeOperations([{ type: 'payment', amount: value, asset: Asset.native(), destination: dest }], fakeT, SOURCE, { locale: 'de' });
    expect(valueOf(block, 'amount')).toBe(expected);
  });

  it('nimmt genau 7 Nachkommastellen noch als Betrag', () => {
    const [block] = describeOperations([{ type: 'payment', amount: '1.1234567', asset: Asset.native(), destination: dest }], fakeT, SOURCE, { locale: 'de' });
    expect(valueOf(block, 'amount')).toBe('1,1234567 XLM');
  });
});

describe('changeTrust', () => {
  const issuer = Keypair.random().publicKey();
  const asset = new Asset('TRUST', issuer);
  const label = `TRUST (${shortKey(issuer)})`;

  it('zeigt Asset und Limit im Dialog-Format', () => {
    const block = describeOne(Operation.changeTrust({ asset, limit: '1000' }));
    expect(block.title).toBe(`Trustline für ${label} setzen`);
    expect(valueOf(block, 'limit')).toBe(`1.000,0 ${label}`);
    expect(valueOf(block, `issuer:TRUST:${issuer}`)).toBe(issuer);
  });

  it('Maximum heisst unbegrenzt, mit und ohne explizites Limit', () => {
    expect(TRUSTLINE_LIMIT_MAX_STROOPS).toBe(9223372036854775807n);
    expect(valueOf(describeOne(Operation.changeTrust({ asset })), 'limit')).toBe('unbegrenzt');
    expect(valueOf(describeOne(Operation.changeTrust({ asset, limit: '922337203685.4775807' })), 'limit')).toBe('unbegrenzt');
  });

  it('ein Stroop unter dem Maximum ist nicht unbegrenzt', () => {
    expect(valueOf(describeOne(Operation.changeTrust({ asset, limit: '922337203685.4775806' })), 'limit')).toBe(`922.337.203.685,4775806 ${label}`);
  });

  it('zeigt ein nicht lesbares Limit roh und nicht als Entfernen', () => {
    const [block] = describeOperations([{ type: 'changeTrust', line: asset, limit: '0.00000000' }], fakeT, SOURCE, { locale: 'de' });
    expect(block.title).toBe(`Trustline für ${label} setzen`);
    expect(valueOf(block, 'limit')).toBe(`0.00000000 ${label}`);
  });

  it('Limit 0 bleibt Trustline entfernen', () => {
    const block = describeOne(Operation.changeTrust({ asset, limit: '0' }));
    expect(block.title).toBe(`Trustline für ${label} entfernen`);
    expect(rowOf(block, 'limit')).toBeUndefined();
  });

  it('zeigt Pool-Assets als Pool A/B und das Limit in Pool Shares', () => {
    const usd = new Asset('USD', issuer);
    const poolAsset = new LiquidityPoolAsset(Asset.native(), usd, LiquidityPoolFeeV18);
    const set = describeOne(Operation.changeTrust({ asset: poolAsset }));
    expect(set.title).toBe(`Trustline für Pool XLM/USD (${shortKey(issuer)}) setzen`);
    expect(valueOf(set, 'limit')).toBe('unbegrenzt');
    expect(rowOf(set, `issuer:USD:${issuer}`)).toMatchObject({ label: 'Issuer USD (Asset B)', value: issuer });
    expect(describeOne(Operation.changeTrust({ asset: poolAsset, limit: '0' })).title).toBe(`Trustline für Pool XLM/USD (${shortKey(issuer)}) entfernen`);
    expect(valueOf(describeOne(Operation.changeTrust({ asset: poolAsset, limit: '5' })), 'limit')).toBe('5,0 Pool Shares');
  });
});

describe('setOptions', () => {
  it('fasst mehrere Felder als Zeilen in einem Block zusammen', () => {
    const signerKey = Keypair.random().publicKey();
    const blocks = describeOperations(decoded([Operation.setOptions({
      masterWeight: 2,
      signer: { ed25519PublicKey: signerKey, weight: 4 },
      lowThreshold: 1,
      medThreshold: 2,
      highThreshold: 3,
      homeDomain: 'example.org',
    })]), fakeT, SOURCE, { locale: 'de' });
    expect(blocks).toHaveLength(1);
    expect(keysOf(blocks[0])).toEqual(['masterWeight', 'signer', 'signerWeight', 'lowThreshold', 'medThreshold', 'highThreshold', 'homeDomain']);
    expect(valueOf(blocks[0], 'signer')).toBe(signerKey);
    expect(valueOf(blocks[0], 'signerWeight')).toBe('4');
    expect(valueOf(blocks[0], 'homeDomain')).toBe('example.org');
  });

  it('zeigt nur gesetzte Felder, auch den Wert 0', () => {
    const block = describeOne(Operation.setOptions({ masterWeight: 0, lowThreshold: 0 }));
    expect(keysOf(block)).toEqual(['masterWeight', 'lowThreshold']);
    expect(valueOf(block, 'masterWeight')).toBe('0');
  });

  it('Gewicht 0 entfernt den Signer', () => {
    const signerKey = Keypair.random().publicKey();
    const block = describeOne(Operation.setOptions({ signer: { ed25519PublicKey: signerKey, weight: 0 } }));
    expect(keysOf(block)).toEqual(['signerRemove']);
    expect(valueOf(block, 'signerRemove')).toBe(signerKey);
  });

  it('zeigt Hash- und PreAuth-Signer als X.../T... statt als Bytes', () => {
    const hash = 'a'.repeat(64);
    const expected = StrKey.encodeSha256Hash(Buffer.from(hash, 'hex'));
    expect(valueOf(describeOne(Operation.setOptions({ signer: { sha256Hash: hash, weight: 1 } })), 'signer')).toBe(expected);
    const preAuth = StrKey.encodePreAuthTx(Buffer.from(hash, 'hex'));
    expect(valueOf(describeOne(Operation.setOptions({ signer: { preAuthTx: hash, weight: 1 } })), 'signer')).toBe(preAuth);
  });

  it('unbekannter Signer-Typ: Block-Warnung und Rohdaten statt "-"', () => {
    const [block] = describeOperations([{ type: 'setOptions', signer: { futureKey: Uint8Array.from([0xab, 0x01]), weight: 2 } }], fakeT, SOURCE);
    expect(valueOf(block, 'signer')).toBe('{"futureKey":"ab01"}');
    expect(valueOf(block, 'signerWeight')).toBe('2');
    expect(block.warnings).toEqual(['Signer-Typ nicht erkannt.']);
  });

  it('Signer ohne erkennbare Daten: Warnung, auch beim Entfernen', () => {
    const [block] = describeOperations([{ type: 'setOptions', signer: { weight: 0 } }], fakeT, SOURCE);
    expect(valueOf(block, 'signerRemove')).toBe('-');
    expect(block.warnings).toEqual(['Signer-Typ nicht erkannt.']);
  });

  it('bekannte Signer-Typen loesen keine Warnung aus', () => {
    expect(describeOne(Operation.setOptions({ signer: { ed25519PublicKey: Keypair.random().publicKey(), weight: 1 } })).warnings).toEqual([]);
  });

  it('unterschlaegt keine Flags und keine Inflation Destination (Regression: gab frueher keine Zeile)', () => {
    const inflation = Keypair.random().publicKey();
    const block = describeOne(Operation.setOptions({ setFlags: 9, clearFlags: 2, inflationDest: inflation }));
    expect(valueOf(block, 'setFlags')).toBe('auth_required, auth_clawback_enabled (9)');
    expect(valueOf(block, 'clearFlags')).toBe('auth_revocable (2)');
    expect(rowOf(block, 'inflationDest')).toMatchObject({ label: 'Inflation Destination', value: inflation });
    expect(rowOf(block, 'noFields')).toBeUndefined();
  });

  it('nennt ein unbekanntes Flag-Bit als Zahl', () => {
    const [block] = describeOperations([{ type: 'setOptions', setFlags: 16 }], fakeT, SOURCE);
    expect(valueOf(block, 'setFlags')).toBe('16');
  });

  it('macht das Leeren der Home-Domain sichtbar', () => {
    expect(valueOf(describeOne(Operation.setOptions({ homeDomain: '' })), 'homeDomain')).toBe('wird entfernt');
  });

  it('ohne gesetzte Felder: Block mit Hinweis statt leerem Block', () => {
    const block = describeOne(Operation.setOptions({}));
    expect(block.title).toBe('Kontooptionen ändern');
    expect(keysOf(block)).toEqual(['noFields']);
    expect(valueOf(block, 'noFields')).toBe('Diese Operation setzt keine Felder.');
  });
});

describe('weitere Operationen', () => {
  it('claimClaimableBalance und accountMerge zeigen volle IDs', () => {
    const balanceId = `00000000${'a'.repeat(64)}`;
    expect(valueOf(describeOne(Operation.claimClaimableBalance({ balanceId })), 'balanceId')).toBe(balanceId);
    const dest = Keypair.random().publicKey();
    const merge = describeOne(Operation.accountMerge({ destination: dest }));
    expect(merge.title).toBe('Konto zusammenführen');
    expect(valueOf(merge, 'destination')).toBe(dest);
  });

  it('bumpSequence zeigt die neue Sequenz', () => {
    expect(valueOf(describeOne(Operation.bumpSequence({ bumpTo: '101' })), 'bumpTo')).toBe('101');
  });

  it('unbekannte Operation: eigener Block mit Typ und Warnung, Bestaetigungspflicht bleibt', () => {
    const ops = decoded([Operation.manageData({ name: 'x', value: 'y' })]);
    const [block] = describeOperations(ops, fakeT, SOURCE);
    expect(block.type).toBe('manageData');
    expect(block.title).toBe('Unbekannte Operation: manageData');
    expect(valueOf(block, 'type')).toBe('manageData');
    expect(block.warnings).toEqual(['SKM kann diese Operation nicht im Klartext anzeigen.']);
    expect(DESCRIBED_OPERATION_TYPES.has(block.type)).toBe(false);
    expect(findOperationWarnings(ops, SOURCE).unknownTypes).toEqual(['manageData']);
  });

  it('uebersteht eine fehlende Operation ohne Absturz', () => {
    const [block] = describeOperations([null], fakeT, SOURCE);
    expect(block.type).toBe('?');
  });
});

describe('Quellkonto je Operation', () => {
  const dest = Keypair.random().publicKey();
  const foreign = Keypair.random().publicKey();
  const paymentFrom = (source) => Operation.payment({ destination: dest, asset: Asset.native(), amount: '1', source });
  const WARN = 'Diese Operation wird von einem anderen Konto ausgeführt.';

  it('fremde op.source: Zeile mit voller Adresse, Warnung und Eintrag in findOperationWarnings', () => {
    const ops = decoded([paymentFrom(foreign)]);
    const [block] = describeOperations(ops, fakeT, SOURCE, { locale: 'de' });
    expect(block.source).toBe(foreign);
    expect(block.rows[0]).toMatchObject({ key: 'source', label: 'Quellkonto', value: foreign, emphasis: true, wrap: true });
    expect(block.warnings).toEqual([WARN]);
    expect(findOperationWarnings(ops, SOURCE).foreignOpSources).toEqual([foreign]);
  });

  it('op.source gleich tx-Source: keine Zeile, keine Warnung', () => {
    const ops = decoded([paymentFrom(SOURCE)]);
    const [block] = describeOperations(ops, fakeT, SOURCE, { locale: 'de' });
    expect(rowOf(block, 'source')).toBeUndefined();
    expect(block.source).toBeUndefined();
    expect(block.warnings).toEqual([]);
    expect(findOperationWarnings(ops, SOURCE).foreignOpSources).toEqual([]);
  });

  it('ohne op.source: keine Zeile', () => {
    expect(findOperationWarnings(decoded([paymentFrom(undefined)]), SOURCE).foreignOpSources).toEqual([]);
  });

  it('listet fremde Konten einmal, auch bei unbekannten Operationen', () => {
    const ops = decoded([paymentFrom(foreign), Operation.manageData({ name: 'x', value: 'y', source: foreign })]);
    expect(findOperationWarnings(ops, SOURCE).foreignOpSources).toEqual([foreign]);
    const blocks = describeOperations(ops, fakeT, SOURCE, { locale: 'de' });
    expect(rowOf(blocks[1], 'source').value).toBe(foreign);
    expect(blocks[1].warnings).toContain(WARN);
  });

  it('warnt bei unbekanntem Quellkonto lieber einmal zu viel', () => {
    const ops = decoded([paymentFrom(foreign)]);
    expect(describeOperations(ops, fakeT, '', { locale: 'de' })[0].warnings).toEqual([WARN]);
    expect(findOperationWarnings(ops, '').foreignOpSources).toEqual([foreign]);
  });

  it('Muxed mit gleichem Basiskonto: keine Zeile, kein Alarm', () => {
    const ownMuxed = muxedOf(SOURCE);
    const ops = decoded([paymentFrom(ownMuxed)]);
    const [block] = describeOperations(ops, fakeT, SOURCE, { locale: 'de' });
    expect(rowOf(block, 'source')).toBeUndefined();
    expect(block.source).toBeUndefined();
    expect(block.warnings).toEqual([]);
    expect(findOperationWarnings(ops, SOURCE).foreignOpSources).toEqual([]);
  });

  it('Muxed mit fremdem Basiskonto: Warnung, Basis-G-Adresse wird genannt', () => {
    const foreignMuxed = muxedOf(foreign);
    const ops = decoded([paymentFrom(foreignMuxed)]);
    const [block] = describeOperations(ops, fakeT, SOURCE, { locale: 'de' });
    expect(valueOf(block, 'source')).toBe(foreignMuxed);
    expect(valueOf(block, 'sourceBase')).toBe(foreign);
    expect(block.warnings).toEqual([WARN]);
    expect(findOperationWarnings(ops, SOURCE).foreignOpSources).toEqual([foreign]);
  });

  it('Muxed-Tx-Source: gleiche M-Adresse und ihre G-Adresse ergeben keine Zeile', () => {
    const ownMuxed = muxedOf(SOURCE);
    const same = describeOperations(decoded([paymentFrom(ownMuxed)]), fakeT, ownMuxed, { locale: 'de' })[0];
    expect(rowOf(same, 'source')).toBeUndefined();
    const base = describeOperations(decoded([paymentFrom(SOURCE)]), fakeT, ownMuxed, { locale: 'de' })[0];
    expect(rowOf(base, 'source')).toBeUndefined();
    expect(base.warnings).toEqual([]);
  });

  it('Muxed-Empfaenger: Basiskonto wird genannt', () => {
    const muxed = muxedOf(foreign);
    const block = describeOne(Operation.payment({ destination: muxed, asset: Asset.native(), amount: '1' }));
    expect(valueOf(block, 'destination')).toBe(muxed);
    expect(valueOf(block, 'destinationBase')).toBe(foreign);
  });

  it('Tausch an eine eigene M-Adresse ist kein Alarm, an eine fremde schon', () => {
    const swap = (destination) => Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: '1', destination, destAsset: new Asset('USD', foreign), destMin: '1', path: [] });
    const own = decoded([swap(muxedOf(SOURCE))]);
    expect(findOperationWarnings(own, SOURCE).pathPaymentToOther).toBe(false);
    expect(valueOf(describeOperations(own, fakeT, SOURCE, { locale: 'de' })[0], 'ownAccount')).toBe('das eigene Konto');
    expect(findOperationWarnings(decoded([swap(muxedOf(foreign))]), SOURCE).pathPaymentToOther).toBe(true);
  });

  it('Fee-Bump: massgeblich ist das Quellkonto der inneren Transaktion', () => {
    const feeSource = Keypair.random();
    const innerSource = Keypair.random();
    const buildBump = (opSource) => {
      const inner = buildTx([paymentFrom(opSource)], innerSource.publicKey());
      inner.sign(innerSource);
      const bump = TransactionBuilder.buildFeeBumpTransaction(feeSource, '200', inner, Networks.TESTNET);
      return TransactionBuilder.fromXDR(bump.toXDR(), Networks.TESTNET);
    };

    const same = buildBump(innerSource.publicKey());
    const sourceId = getJobSequenceInfo(same).sourceAccountId;
    expect(sourceId).toBe(innerSource.publicKey());
    expect(findOperationWarnings(same.innerTransaction.operations, sourceId).foreignOpSources).toEqual([]);

    // Der Fee-Zahler ist nicht das Quellkonto: op.source auf ihn ist fremd.
    const viaFeeSource = buildBump(feeSource.publicKey());
    const ops = viaFeeSource.innerTransaction.operations;
    const id = getJobSequenceInfo(viaFeeSource).sourceAccountId;
    expect(findOperationWarnings(ops, id).foreignOpSources).toEqual([feeSource.publicKey()]);
    expect(describeOperations(ops, fakeT, id, { locale: 'de' })[0].warnings).toEqual([WARN]);
  });
});

describe('findOperationWarnings', () => {
  const issuer = Keypair.random().publicKey();

  it('meldet nichts bei einem Tausch an das eigene Konto', () => {
    const ops = decoded([Operation.pathPaymentStrictSend({ sendAsset: new Asset('SPAM', issuer), sendAmount: '5', destination: SOURCE, destAsset: Asset.native(), destMin: '1.2', path: [] })]);
    expect(findOperationWarnings(ops, SOURCE)).toEqual({ unknownTypes: [], pathPaymentToOther: false, foreignOpSources: [] });
  });

  it('warnt, wenn ein Tausch an ein anderes Konto geht', () => {
    const other = Keypair.random().publicKey();
    const ops = decoded([Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: '5', destination: other, destAsset: new Asset('USD', issuer), destMin: '1', path: [] })]);
    expect(valueOf(describeOperations(ops, fakeT, SOURCE, { locale: 'de' })[0], 'destination')).toBe(other);
    expect(findOperationWarnings(ops, SOURCE).pathPaymentToOther).toBe(true);
  });
});

describe('Liquidity-Pool-Operationen', () => {
  const issuer = Keypair.random().publicKey();
  const usd = new Asset('USD', issuer);
  const poolId = 'a468d41d8e9b8f3c7209651608b74b7db7ac9952dcae0cdf24871d1d9c7b0088';
  const usdLabel = formatAsset(usd);
  const poolInfo = { [poolId]: { assetA: Asset.native(), assetB: usd } };
  const deposit = (minPrice = '1.9', maxPrice = '2.1') => Operation.liquidityPoolDeposit({ liquidityPoolId: poolId, maxAmountA: '100', maxAmountB: '50.5', minPrice, maxPrice });
  const withdraw = () => Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId, amount: '10', minAmountA: '1', minAmountB: '2.25' });

  it('Deposit ohne Pool-Info: Asset A/B, volle Pool-ID, Preisgrenzen', () => {
    const block = describeOne(deposit());
    expect(block.title).toBe(`Liquidität einzahlen in Pool ${shortKey(poolId)}`);
    expect(valueOf(block, 'poolId')).toBe(poolId);
    expect(valueOf(block, 'maxAmountA')).toBe('100,0 Asset A');
    expect(valueOf(block, 'maxAmountB')).toBe('50,5 Asset B');
    expect(rowOf(block, 'minPrice')).toMatchObject({ label: 'Mindestpreis A/B', value: '1,9' });
    expect(rowOf(block, 'maxPrice')).toMatchObject({ label: 'Höchstpreis A/B', value: '2,1' });
    expect(findOperationWarnings(decoded([deposit()]), SOURCE).unknownTypes).toEqual([]);
  });

  it('Withdraw ohne Pool-Info: Shares und Mindestbetraege', () => {
    const block = describeOne(withdraw());
    expect(block.title).toBe(`Liquidität abheben aus Pool ${shortKey(poolId)}`);
    expect(valueOf(block, 'shares')).toBe('10,0 Pool Shares');
    expect(valueOf(block, 'minAmountA')).toBe('1,0 Asset A');
    expect(valueOf(block, 'minAmountB')).toBe('2,25 Asset B');
  });

  it('mit Pool-Info: echte Assets, voller Issuer, Preise als Dezimalzahl', () => {
    const [depositBlock, withdrawBlock] = describeOperations(decoded([deposit({ n: 1, d: 3 }, { n: 2, d: 3 }), withdraw()]), fakeT, '', { poolInfo, locale: 'de' });
    expect(depositBlock.title).toBe(`Liquidität einzahlen in Pool XLM/${usdLabel} (${shortKey(poolId)})`);
    expect(valueOf(depositBlock, 'maxAmountA')).toBe('100,0 XLM');
    expect(valueOf(depositBlock, 'maxAmountB')).toBe(`50,5 ${usdLabel}`);
    expect(rowOf(depositBlock, 'minPrice')).toMatchObject({ label: `Mindestpreis XLM/${usdLabel}`, value: '0,3333333' });
    expect(valueOf(depositBlock, 'maxPrice')).toBe('0,6666667');
    expect(rowOf(depositBlock, `issuer:USD:${issuer}`)).toMatchObject({ label: 'Issuer USD (Asset B)', value: issuer });
    expect(depositBlock.warnings).toEqual([]);
    expect(withdrawBlock.title).toBe(`Liquidität abheben aus Pool XLM/${usdLabel} (${shortKey(poolId)})`);
    expect(valueOf(withdrawBlock, 'minAmountB')).toBe(`2,25 ${usdLabel}`);
  });

  it.each([
    ['{}', {}],
    ['anderer Pool bekannt', { [`${'b'.repeat(64)}`]: poolInfo[poolId] }],
  ])('faellt bei gesetztem poolInfo ohne den Pool (%s) auf Asset A/B mit Hinweis zurueck', (_name, info) => {
    const block = describeOne(withdraw(), { poolInfo: info });
    expect(valueOf(block, 'minAmountA')).toBe('1,0 Asset A');
    expect(block.warnings).toEqual(['(Pool-Assets konnten nicht geladen werden)']);
  });

  it('ohne poolInfo (laedt) kein Hinweis', () => {
    expect(describeOne(withdraw()).warnings).toEqual([]);
  });

  it('Preisgrenzen bleiben bei 7 signifikanten Stellen, auch sehr kleine Preise', () => {
    const block = describeOne(Operation.liquidityPoolDeposit({ liquidityPoolId: poolId, maxAmountA: '1', maxAmountB: '1', minPrice: { n: 1, d: 300000000 }, maxPrice: { n: 1, d: 3 } }));
    expect(valueOf(block, 'minPrice')).toBe('0,000000003333333');
    expect(valueOf(block, 'maxPrice')).toBe('0,3333333');
  });
});
