import { describe, expect, it } from 'vitest';
import { aggregateRound, assetUnitLabel, counterpartiesOfRound, mergeCreditsFromEffects } from '../groupfundAggregate.js';
import { buildRounds } from '../groupfundRounds.js';
import { fromStroops, toStroops } from '../liquidityPools.js';
import { G, ISSUER, MUX_ID, SENDER_A, SENDER_B, TARGET, effect, opId, payment } from './groupfundFixtures.js';

const ROUND = buildRounds([], { complete: true })[0];
const MUXED = { mode: 'muxed', id: MUX_ID };
const incoming = (ledger, fields) => payment(ledger, { to_muxed_id: MUX_ID, ...fields });
const usd = { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: ISSUER };

const run = (payments, identifier = MUXED, extra = {}) => aggregateRound({ payments, effects: [], accountId: G, identifier, round: ROUND, ...extra });
const rowOf = (result, sender, code = 'XLM') => result.rows.find((r) => r.sender === sender && r.asset.code === code);

describe('Brutto und Netto', () => {
  it('summiert exakt ohne Float-Rundung', () => {
    const result = run([incoming(10, { amount: '0.1000000' }), incoming(11, { amount: '0.2000000' })]);
    const row = rowOf(result, SENDER_A);
    expect(fromStroops(row.gross)).toBe('0.3000000');
    expect(row.count).toBe(2);
  });

  it('rechnet am oberen Ende ohne Genauigkeitsverlust', () => {
    const result = run([incoming(10, { amount: '922337203685.4775807' }), incoming(11, { amount: '0.0000001' })]);
    expect(fromStroops(rowOf(result, SENDER_A).gross)).toBe('922337203685.4775808');
  });

  it('zieht Rueckzahlungen mit from_muxed_id vom Netto ab, Netto kann negativ sein', () => {
    const result = run([
      incoming(10, { amount: '5.0000000' }),
      payment(11, { from: G, to: SENDER_A, amount: '7.0000000', from_muxed_id: MUX_ID }),
    ]);
    const row = rowOf(result, SENDER_A);
    expect(fromStroops(row.refunds)).toBe('7.0000000');
    expect(row.net).toBe(toStroops('5') - toStroops('7'));
    expect(row.count).toBe(1);
    expect(row.txHashes).toHaveLength(2);
  });

  it('haelt Assets und Absender getrennt, XLM zuerst, dann nach Brutto', () => {
    const result = run([
      incoming(10, { amount: '1.0000000' }),
      incoming(11, { from: SENDER_B, amount: '9.0000000' }),
      incoming(12, { amount: '3.0000000', ...usd }),
    ]);
    expect(result.rows.map((r) => [r.sender, r.asset.code])).toEqual([[SENDER_B, 'XLM'], [SENDER_A, 'XLM'], [SENDER_A, 'USD']]);
    expect(result.totals.map((t) => [t.asset.code, fromStroops(t.gross), t.senders])).toEqual([['XLM', '10.0000000', 2], ['USD', '3.0000000', 1]]);
  });

  it('trennt gleiche Codes verschiedener Issuer', () => {
    const result = run([incoming(10, usd), incoming(11, { ...usd, asset_issuer: TARGET })]);
    expect(result.rows).toHaveLength(2);
  });

  it('merkt erste und letzte Zahlung', () => {
    const row = rowOf(run([incoming(50), incoming(10), incoming(30)]), SENDER_A);
    expect(row.firstAt < row.lastAt).toBe(true);
    expect(row.txHashes).toHaveLength(3);
  });

  it('erste und letzte Zahlung kommen nur aus Eingaengen', () => {
    const inflow = incoming(20);
    const row = rowOf(run([
      payment(40, { from: G, to: SENDER_A, amount: '0.1000000', from_muxed_id: MUX_ID }),
      inflow,
      payment(5, { from: G, to: SENDER_A, amount: '0.1000000', from_muxed_id: MUX_ID }),
    ]), SENDER_A);
    expect(row.firstAt).toBe(inflow.created_at);
    expect(row.lastAt).toBe(inflow.created_at);
    expect(row.txHashes).toHaveLength(3);
  });

  it('prueft Kleinstbetraege je Zahlung, nicht auf der Summe', () => {
    const many = run([incoming(10, { amount: '0.0060000' }), incoming(11, { amount: '0.0060000' })]);
    expect(rowOf(many, SENDER_A).dustCount).toBe(2);
    const mixed = run([incoming(10, { amount: '0.0060000' }), incoming(11, { amount: '5.0000000' })]);
    expect(rowOf(mixed, SENDER_A).dustCount).toBe(1);
    expect(rowOf(run([incoming(10, { amount: '0.0100000' })]), SENDER_A).dustCount).toBe(0);
    expect(rowOf(run([incoming(10, { amount: '0.0010000', ...usd })]), SENDER_A, 'USD').dustCount).toBe(0);
  });

  it('zaehlt mehrere Operationen einer Transaktion, den Hash nur einmal', () => {
    const row = rowOf(run([incoming(10, { transaction_hash: 'same' }), incoming(10, { index: 2, transaction_hash: 'same' })]), SENDER_A);
    expect(row.count).toBe(2);
    expect(row.txHashes).toEqual(['same']);
  });
});

describe('Kennzeichen Muxed-ID', () => {
  it('vergleicht die ID als String, auch ueber 2^53', () => {
    expect(run([incoming(10, { to_muxed_id: '18446744073709551614' })]).rows).toEqual([]);
    expect(run([incoming(10)]).rows).toHaveLength(1);
  });

  it('zaehlt Zahlungen an die G-Adresse oder eine andere ID nicht', () => {
    expect(run([payment(10), incoming(11, { to_muxed_id: '7' })]).rows).toEqual([]);
  });

  it('zaehlt path_payment_strict_send und _receive mit dem Betrag, der ankommt', () => {
    const result = run([
      incoming(10, { type: 'path_payment_strict_send', amount: '2.0000000', source_amount: '99.0000000', ...usd, source_asset_type: 'native' }),
      incoming(11, { type: 'path_payment_strict_receive', amount: '3.0000000', source_amount: '88.0000000', ...usd, source_asset_type: 'native' }),
    ]);
    expect(fromStroops(rowOf(result, SENDER_A, 'USD').gross)).toBe('5.0000000');
  });

  it('nimmt den Betrag von account_merge aus dem Effect', () => {
    const merge = payment(10, { type: 'account_merge', account: SENDER_B, into: G, into_muxed_id: MUX_ID, from: undefined, to: undefined, amount: undefined });
    const effects = [effect(10, 'account_credited', '12.5000000'), effect(10, 'account_debited', '12.5000000', { account: SENDER_B, effectIndex: 2 })];
    const result = run([merge], MUXED, { effects });
    const row = rowOf(result, SENDER_B);
    expect(fromStroops(row.gross)).toBe('12.5000000');
    expect(row.count).toBe(1);
  });

  it('markiert account_merge ohne Credit-Effect als unbekannt, nicht als 0', () => {
    const merge = payment(10, { type: 'account_merge', account: SENDER_B, into: G, into_muxed_id: MUX_ID, from: undefined, to: undefined, amount: undefined });
    const result = run([merge, incoming(11, { from: SENDER_B, amount: '2.0000000' })]);
    const row = rowOf(result, SENDER_B);
    expect(row.amountUnknown).toBe(true);
    expect(fromStroops(row.gross)).toBe('2.0000000');
    expect(row.count).toBe(2);
    expect(result.amountUnknownCount).toBe(1);
    expect(result.totals[0]).toMatchObject({ amountUnknown: true, count: 2 });
  });

  it('die Summe bleibt ohne fehlenden Betrag vollstaendig', () => {
    expect(run([incoming(10)]).totals[0].amountUnknown).toBe(false);
  });

  it('kennt ohne Merge keinen unbekannten Betrag', () => {
    const result = run([incoming(10)]);
    expect(result.amountUnknownCount).toBe(0);
    expect(rowOf(result, SENDER_A).amountUnknown).toBe(false);
  });

  it('liefert Merge-Betraege nur fuer das eigene Konto', () => {
    const credits = mergeCreditsFromEffects([effect(10, 'account_credited', '1.0000000', { account: SENDER_A })], G);
    expect(credits.size).toBe(0);
  });
});

describe('Ausgaenge ohne Kennzeichen', () => {
  const inflow = incoming(10, { amount: '5.0000000' });

  it('zeigt sie getrennt und verrechnet sie nicht', () => {
    const row = rowOf(run([inflow, payment(11, { from: G, to: SENDER_A, amount: '2.0000000' })]), SENDER_A);
    expect(fromStroops(row.unmarkedOut)).toBe('2.0000000');
    expect(row.refunds).toBe(0n);
    expect(fromStroops(row.net)).toBe('5.0000000');
  });

  it('ignoriert Ausgaenge mit anderer Muxed-ID und an Nicht-Absender', () => {
    const row = rowOf(run([
      inflow,
      payment(11, { from: G, to: SENDER_A, amount: '2.0000000', from_muxed_id: '7' }),
      payment(12, { from: G, to: TARGET, amount: '2.0000000' }),
    ]), SENDER_A);
    expect(row.unmarkedOut).toBe(0n);
    expect(row.refunds).toBe(0n);
  });

  it('legt eine Zeile an, wenn in einem anderen Asset zurueckgezahlt wird', () => {
    const result = run([inflow, payment(11, { from: G, to: SENDER_A, amount: '2.0000000', from_muxed_id: MUX_ID, ...usd })]);
    const row = rowOf(result, SENDER_A, 'USD');
    expect(fromStroops(row.net)).toBe('-2.0000000');
    expect(row.count).toBe(0);
    expect(result.totals.find((t) => t.asset.code === 'USD').senders).toBe(0);
  });
});

describe('Kennzeichen Memo', () => {
  const MEMO = { mode: 'memo', memo: ' GF-1 ' };

  it('nutzt dieselbe Aggregation und vergleicht wie die Memo-Suche', () => {
    const result = run([
      payment(10, { amount: '4.0000000', transaction: { memo: 'GF-1​' } }),
      payment(11, { amount: '4.0000000', transaction: { memo: 'gf-1' } }),
      payment(12, { from: G, to: SENDER_A, amount: '1.0000000', transaction: { memo: 'GF-1' } }),
      payment(13, { from: G, to: SENDER_A, amount: '2.0000000', transaction: { memo: '' } }),
      payment(14, { from: G, to: SENDER_A, amount: '3.0000000', transaction: { memo: 'ANDERS' } }),
    ], MEMO);
    const row = rowOf(result, SENDER_A);
    expect(fromStroops(row.gross)).toBe('4.0000000');
    expect(fromStroops(row.refunds)).toBe('1.0000000');
    expect(fromStroops(row.unmarkedOut)).toBe('2.0000000');
  });

  it('ohne Memo keine Treffer', () => {
    expect(run([payment(10, { transaction: { memo: '' } })], { mode: 'memo', memo: '  ' }).rows).toEqual([]);
  });

  it('meldet Datensaetze ohne Transaktion im Join', () => {
    expect(run([payment(10, {}, false)], MEMO).memoJoinMissing).toBe(1);
  });

  it('liest das Memo aus transaction_attr, transaction ist im SDK eine Funktion (Regression)', () => {
    const record = payment(10, { transaction: { memo: 'GF-1' } });
    expect(typeof record.transaction).toBe('function');
    expect(run([record], MEMO).rows).toHaveLength(1);
    expect(run([{ ...record, transaction_attr: undefined, transaction: { memo: 'GF-1' } }], MEMO).rows).toHaveLength(1);
  });
});

describe('Ausschluesse und Hinweise', () => {
  it('zaehlt create_account nicht, meldet es aber in der Runde', () => {
    const result = run([payment(10, { type: 'create_account', account: G, funder: SENDER_A, starting_balance: '9.0000000', memo: 'x' })], { mode: 'memo', memo: 'x' });
    expect(result.rows).toEqual([]);
    expect(result.accountCreatedInRound).toBe(true);
  });

  it('ignoriert Zahlungen vom eigenen G-Konto und fehlgeschlagene Transaktionen', () => {
    expect(run([incoming(10, { from: G }), incoming(11, { transaction_successful: false })]).rows).toEqual([]);
  });

  it('wertet nur die gewaehlte Runde aus', () => {
    const [current] = buildRounds([{ opId: opId(20), createdAt: '', txHash: '', to: TARGET, source: 'detected' }], { complete: true });
    const result = run([incoming(30), incoming(10)], MUXED, { round: current });
    expect(rowOf(result, SENDER_A).count).toBe(1);
  });

  it('liefert Gegenparteien fuer die Lookalike-Pruefung', () => {
    const items = counterpartiesOfRound({ payments: [incoming(10), payment(11, { from: G, to: TARGET })], accountId: G, round: ROUND });
    expect(items).toEqual([{ direction: 'in', counterparty: SENDER_A }, { direction: 'out', counterparty: TARGET }]);
  });

  it('nennt natives XLM so, Tokens mit Issuer', () => {
    expect(assetUnitLabel({ isNative: true, code: 'XLM', issuer: '' })).toBe('XLM');
    expect(assetUnitLabel({ isNative: false, code: 'XLM', issuer: ISSUER })).toContain('XLM (GA5ZSEJY');
  });
});
