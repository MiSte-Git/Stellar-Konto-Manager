import { Account, Asset, Keypair, Memo, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import i18n from '../../../i18n.js';
import { describeTransaction, HIGH_FEE_PER_OP_STROOPS } from '../describeTransaction.js';

const SOURCE = Keypair.random().publicKey();
const DEST = Keypair.random();
const t = i18n.getFixedT('de', 'multisig');
const tEn = (key, opts) => (typeof opts === 'string' ? opts : opts?.defaultValue || key).replace(/\{\{(\w+)\}\}/g, (_, v) => String(opts?.[v] ?? ''));

function build({ fee = '100', ops = 1, memo, ...opts } = {}) {
  const builder = new TransactionBuilder(new Account(SOURCE, '100'), { fee, networkPassphrase: Networks.TESTNET, ...opts });
  for (let i = 0; i < ops; i += 1) builder.addOperation(Operation.payment({ destination: DEST.publicKey(), asset: Asset.native(), amount: '1' }));
  if (memo) builder.addMemo(memo);
  if (!opts.timebounds) builder.setTimeout(0);
  // Wie im Job-Detail: aus dem XDR dekodiert.
  return TransactionBuilder.fromXDR(builder.build().toXDR(), Networks.TESTNET);
}

const rowsOf = (d) => Object.fromEntries(d.rows.map((r) => [r.key, r]));

describe('describeTransaction', () => {
  it('nennt Quelle, Sequenz, kein Memo und Zeitfenster ohne Grenzen', () => {
    const d = describeTransaction(build(), t, { locale: 'de' });
    const r = rowsOf(d);
    expect(r.source.value).toBe(SOURCE);
    expect(r.sequence.value).toBe('101');
    expect(r.memoType.value).toBe('Kein Memo');
    expect(r.memo).toBeUndefined();
    expect(r.validFrom.value).toBe('sofort');
    expect(r.validUntil.value).toBe('unbegrenzt');
    expect(d.warnings).toEqual([]);
    expect(d.unusualPreconditions).toEqual([]);
    expect(d.feeBump).toBe(false);
  });

  it('zeigt jeden Memo-Typ mit Wert, eine grosse Memo ID exakt', () => {
    expect(rowsOf(describeTransaction(build({ memo: Memo.text('Kunde 7') }), t)).memo.value).toBe('"Kunde 7"');
    const id = rowsOf(describeTransaction(build({ memo: Memo.id('18446744073709551615') }), t));
    expect(id.memoType.value).toBe('ID');
    expect(id.memo.value).toBe('18446744073709551615');
    const hash = rowsOf(describeTransaction(build({ memo: Memo.hash('ab'.repeat(32)) }), t));
    expect(hash.memoType.value).toBe('Hash');
    expect(hash.memo.value).toBe('ab'.repeat(32));
    const ret = rowsOf(describeTransaction(build({ memo: Memo.return('cd'.repeat(32)) }), t));
    expect(ret.memoType.value).toBe('Return');
    expect(ret.memo.value).toBe('cd'.repeat(32));
  });

  it('macht unsichtbare Zeichen und Leerzeichen am Rand sichtbar', () => {
    const d = describeTransaction(build({ memo: Memo.text(' a​b‮c\u0007') }), t);
    expect(rowsOf(d).memo.value).toBe('" a\\u200Bb\\u202Ec\\u0007"');
    expect(rowsOf(d).memo.warn).toBe(true);
    expect(d.warnings.join(' ')).toContain('unsichtbare oder leicht verwechselbare Zeichen');
    expect(d.warnings.join(' ')).toContain('beginnt oder endet mit einem Leerzeichen');
  });

  it('verschluckt kein fuehrendes BOM', () => {
    const d = describeTransaction(build({ memo: Memo.text(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61])) }), t);
    expect(rowsOf(d).memo.value).toBe('"\\uFEFFa"');
    expect(d.warnings.join(' ')).toContain('unsichtbare');
  });

  it('macht besondere Leerzeichen, Filler und Variation Selectors sichtbar', () => {
    const d = describeTransaction(build({ memo: Memo.text('1 2　3ㅤ⠀️') }), t);
    expect(rowsOf(d).memo.value).toBe('"1\\u00A02\\u30003\\u3164\\u2800\\uFE0F"');
    const plain = describeTransaction(build({ memo: Memo.text('Kunde 7') }), t);
    expect(plain.warnings).toEqual([]);
  });

  it('zeigt ein Text-Memo, das kein UTF-8 ist, als Hex', () => {
    const d = describeTransaction(build({ memo: Memo.text(Uint8Array.from([0x61, 0xff, 0x62])) }), t);
    expect(rowsOf(d).memo.value).toBe('61ff62');
    expect(rowsOf(d).memo.label).toBe('Memo (Hex)');
    expect(d.warnings.join(' ')).toContain('kein gültiges UTF-8');
  });

  it('formatiert die Fee ohne Float in de und en, gesamt und je Operation', () => {
    const de = rowsOf(describeTransaction(build({ fee: '1234', ops: 2 }), t, { locale: 'de' }));
    expect(de.fee.value).toBe('0,0002468 XLM');
    expect(de.feePerOp.value).toBe('0,0001234 XLM');
    const en = rowsOf(describeTransaction(build({ fee: '1234', ops: 2 }), tEn, { locale: 'en' }));
    expect(en.fee.value).toBe('0.0002468 XLM');
  });

  it('hebt die Fee erst ueber dem SKM-Hoechstsatz je Operation hervor', () => {
    const atCap = describeTransaction(build({ fee: String(HIGH_FEE_PER_OP_STROOPS), ops: 2 }), t, { locale: 'de' });
    expect(atCap.highFee).toBe(false);
    const above = describeTransaction(build({ fee: String(HIGH_FEE_PER_OP_STROOPS + 1n), ops: 2 }), t, { locale: 'de' });
    expect(above.highFee).toBe(true);
    expect(rowsOf(above).fee.warn).toBe(true);
    expect(above.warnings.join(' ')).toContain('höchstens 0,01 XLM je Operation');
    const huge = describeTransaction(build({ fee: '2500000000' }), t, { locale: 'de' });
    expect(rowsOf(huge).fee.value).toBe('250,0 XLM');
    expect(huge.highFee).toBe(true);
  });

  it('nennt minTime und meldet SKM-fremde Preconditions einzeln', () => {
    const other = Keypair.random();
    const payload = StrKey.encodeSignedPayload(Buffer.concat([other.rawPublicKey(), Buffer.from([0, 0, 0, 4]), Buffer.from('abcd')]));
    const d = describeTransaction(build({
      timebounds: { minTime: 1700000000, maxTime: 1800000000 },
      ledgerbounds: { minLedger: 5, maxLedger: 0 },
      minAccountSequence: '42',
      minAccountSequenceAge: 3600,
      minAccountSequenceLedgerGap: 7,
      extraSigners: [other.publicKey(), payload],
    }), t, { locale: 'de' });
    const r = rowsOf(d);
    expect(r.validFrom.value).not.toBe('sofort');
    expect(r.minLedger.value).toBe('5');
    expect(r.maxLedger.value).toBe('unbegrenzt');
    expect(r.minAccountSequence.value).toBe('42');
    expect(r.minAccountSequenceAge.value).toBe('3600 Sekunden');
    expect(r.minAccountSequenceLedgerGap.value).toBe('7');
    expect(r.extraSigner1.value).toBe(other.publicKey());
    expect(r.extraSigner2.value).toBe(payload);
    expect(r.extraSigner2Account.value).toBe(other.publicKey());
    expect(r.extraSigner2Payload.value).toBe('61626364');
    expect(d.unusualPreconditions).toEqual(['ledgerBounds', 'minAccountSequence', 'minAccountSequenceAge', 'minAccountSequenceLedgerGap', 'extraSigners']);
    expect(d.rows.filter((row) => row.warn).length).toBeGreaterThanOrEqual(8);
  });

  it('ignoriert Preconditions mit Wert 0, minTime allein verlangt keine Bestaetigung', () => {
    const d = describeTransaction(build({ timebounds: { minTime: 1700000000, maxTime: 0 }, minAccountSequenceAge: 0, ledgerbounds: { minLedger: 0, maxLedger: 0 } }), t);
    expect(d.unusualPreconditions).toEqual([]);
    expect(rowsOf(d).minLedger).toBeUndefined();
  });

  it('stuerzt bei Fee-Bump nicht ab und zeigt innere Tx plus aeussere Fee', () => {
    const inner = build({ memo: Memo.text('x') });
    const feeSource = Keypair.random();
    const bump = TransactionBuilder.buildFeeBumpTransaction(feeSource, '1000', inner, Networks.TESTNET);
    const d = describeTransaction(bump, t, { locale: 'de' });
    const r = rowsOf(d);
    expect(d.feeBump).toBe(true);
    expect(r.memo.value).toBe('"x"');
    expect(r.feeBumpSource.value).toBe(feeSource.publicKey());
    expect(r.feeBumpFee.value).toBe('0,0002 XLM');
  });
});
