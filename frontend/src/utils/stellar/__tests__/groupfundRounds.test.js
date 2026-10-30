import { describe, expect, it } from 'vitest';
import {
  RESET_MIN_DRAIN_PERCENT, analyzeRounds, applyBoundaryCorrections, buildDateRangeRound, buildRounds, countUnsureEffects, coveredFromOpId,
  isRecordInRound, isResetTransaction, opIdOfEffect, outgoingOf, reconstructTxBalances, txKeyOfOp,
} from '../groupfundRounds.js';
import { toStroops } from '../liquidityPools.js';
import { G, SENDER_A, TARGET, effect, opId, payment } from './groupfundFixtures.js';

const stroops = toStroops;

function analyze(overrides = {}) {
  return analyzeRounds({
    payments: [], effects: [], paymentsDone: true, effectsDone: true,
    currentStroops: stroops('10'), reserveStroops: stroops('1'), bufferStroops: stroops('5'), accountId: G, ...overrides,
  });
}

const out = (ledger, amount, fields) => payment(ledger, { from: G, to: TARGET, amount, ...fields });
const debit = (ledger, amount, fields) => effect(ledger, 'account_debited', amount, fields);
const credit = (ledger, amount, fields) => effect(ledger, 'account_credited', amount, fields);

describe('Saldo-Rekonstruktion', () => {
  const entry = (result, ledger) => result.get(txKeyOfOp(opId(ledger)));

  it('rechnet rueckwaerts ueber credited und debited, je Transaktion davor und danach', () => {
    const balances = reconstructTxBalances({
      currentStroops: stroops('10'),
      accountId: G,
      effects: [credit(30, '4.0000000'), debit(20, '90.0000000'), credit(10, '100.0000000')],
    });
    expect(entry(balances, 30)).toMatchObject({ after: stroops('10'), before: stroops('6') });
    expect(entry(balances, 20)).toMatchObject({ after: stroops('6'), before: stroops('96') });
    expect(entry(balances, 10)).toMatchObject({ after: stroops('96'), before: -stroops('4') });
  });

  it('zaehlt account_created als Zufluss, ignoriert Tokens und fremde Konten', () => {
    const balances = reconstructTxBalances({
      currentStroops: stroops('10'),
      accountId: G,
      effects: [
        credit(30, '1.0000000', { asset_type: 'credit_alphanum4', asset_code: 'USD' }),
        debit(30, '1.0000000', { account: SENDER_A, effectIndex: 2 }),
        debit(20, '1.0000000'),
        { ...effect(10, 'account_created', undefined), starting_balance: '11.0000000' },
      ],
    });
    expect(entry(balances, 30)).toBeUndefined();
    expect(entry(balances, 20).after).toBe(stroops('10'));
    expect(entry(balances, 10).after).toBe(stroops('11'));
  });

  it('fasst alle Operationen einer Transaktion zusammen und merkt die Abbuchungen je Operation', () => {
    const balances = reconstructTxBalances({
      currentStroops: stroops('10'),
      accountId: G,
      effects: [debit(30, '1.0000000', { index: 2 }), credit(30, '3.0000000', { index: 1 }), debit(20, '1.0000000')],
    });
    expect(entry(balances, 20).after).toBe(stroops('8'));
    expect(entry(balances, 30).debits.get(opId(30, 2))).toBe(stroops('1'));
    expect(entry(balances, 30).debits.has(opId(30, 1))).toBe(false);
  });

  it('laesst Effects nach dem Saldo-Stand aussen vor', () => {
    const balances = reconstructTxBalances({
      currentStroops: stroops('10'),
      accountId: G,
      snapshotLedger: 25,
      effects: [credit(30, '50.0000000'), debit(20, '1.0000000')],
    });
    expect(entry(balances, 30)).toBeUndefined();
    expect(entry(balances, 20).after).toBe(stroops('10'));
  });

  it('liest die Operations-ID aus der Effect-ID ohne fuehrende Nullen', () => {
    expect(opIdOfEffect({ id: '0280090906321203201-0000000001' })).toBe('280090906321203201');
    expect(opIdOfEffect({ id: 'kaputt' })).toBe('');
  });

  it('trennt Transaktionen im selben Ledger, fasst Operationen derselben zusammen', () => {
    expect(txKeyOfOp(opId(20, 1))).toBe(txKeyOfOp(opId(20, 2)));
    expect(txKeyOfOp(opId(20, 1, 1))).not.toBe(txKeyOfOp(opId(20, 1, 2)));
  });
});

describe('Reset-Regel', () => {
  const rule = { reserveStroops: stroops('1'), bufferStroops: stroops('5') };

  it('Beispiel aus dem Review: 3 auf 2 XLM ist kein Reset (Saldo lag schon unter der Grenze)', () => {
    const result = analyze({
      currentStroops: stroops('2'),
      payments: [out(20, '1.0000000', { to: SENDER_A }), payment(10, { amount: '2.0000000' })],
      effects: [debit(20, '1.0000000'), credit(10, '2.0000000')],
    });
    expect(result.detected).toEqual([]);
    expect(result.rounds).toHaveLength(1);
  });

  it('Rueckzahlung 5 bei Saldo 10 ist kein Reset, obwohl die Grenze unterschritten wird', () => {
    const result = analyze({ currentStroops: stroops('5'), payments: [out(20, '5.0000000')], effects: [debit(20, '5.0000000')] });
    expect(result.detected).toEqual([]);
  });

  it('echte Leerung ist ein Reset, mit Abfluss, Saldo danach und Quelle', () => {
    const result = analyze({ currentStroops: stroops('3'), payments: [out(20, '97.0000000')], effects: [debit(20, '97.0000000')] });
    expect(result.detected).toHaveLength(1);
    expect(result.detected[0]).toMatchObject({ opId: opId(20), to: TARGET, source: 'detected', outflow: '97.0000000', balanceAfter: '3.0000000' });
  });

  it('Leerung auf zwei Payments in einer Transaktion wird summiert, eine einzige Grenze', () => {
    const result = analyze({
      currentStroops: stroops('2'),
      payments: [out(20, '49.0000000', { index: 2 }), out(20, '49.0000000', { index: 1, to: SENDER_A })],
      effects: [debit(20, '49.0000000', { index: 2 }), debit(20, '49.0000000', { index: 1 })],
    });
    expect(result.detected).toHaveLength(1);
    expect(result.detected[0]).toMatchObject({ opId: opId(20, 2), outflow: '98.0000000', balanceAfter: '2.0000000' });
  });

  it('Mischtransaktion mit Token-Zahlung am Ende: Ziel und opId kommen von der XLM-Operation', () => {
    const token = out(20, '1.0000000', { index: 2, to: SENDER_A, asset_type: 'credit_alphanum4', asset_code: 'USD' });
    const native = out(20, '97.0000000', { index: 1 });
    const result = analyze({ currentStroops: stroops('3'), payments: [token, native], effects: [debit(20, '97.0000000', { index: 1 })] });
    expect(result.detected[0]).toMatchObject({ opId: opId(20, 1), to: TARGET, outflow: '97.0000000' });
  });

  it('nimmt bei mehreren XLM-Zahlungen das Ziel der groessten Abbuchung', () => {
    const result = analyze({
      currentStroops: stroops('2'),
      payments: [out(20, '1.0000000', { index: 2, to: SENDER_A }), out(20, '97.0000000', { index: 1 })],
      effects: [debit(20, '1.0000000', { index: 2 }), debit(20, '97.0000000', { index: 1 })],
    });
    expect(result.detected[0]).toMatchObject({ opId: opId(20, 1), to: TARGET, outflow: '98.0000000' });
  });

  it('zaehlt native Abbuchungen ausserhalb des Payments-Feeds mit (Soroban-Transfer, create_claimable_balance)', () => {
    // Beide erzeugen account_debited, aber keinen payments-Datensatz.
    const result = analyze({
      currentStroops: stroops('3'),
      payments: [out(20, '5.0000000', { index: 1 })],
      effects: [debit(20, '92.0000000', { index: 2 }), debit(20, '5.0000000', { index: 1 })],
    });
    expect(result.detected[0]).toMatchObject({ outflow: '97.0000000', balanceAfter: '3.0000000', to: TARGET });
  });

  it('ohne ausgehende Operation im Payments-Feed entsteht kein Reset', () => {
    const result = analyze({ currentStroops: stroops('3'), payments: [], effects: [debit(20, '97.0000000')] });
    expect(result.detected).toEqual([]);
  });

  it('rechnet Abfluss netto, wenn dieselbe Transaktion auch gutschreibt', () => {
    const result = analyze({
      currentStroops: stroops('3'),
      payments: [out(20, '100.0000000', { index: 2 })],
      effects: [debit(20, '100.0000000', { index: 2 }), credit(20, '3.0000000', { index: 1 })],
    });
    expect(result.detected[0].outflow).toBe('97.0000000');
  });

  it('wertet zwei Transaktionen im selben Ledger getrennt', () => {
    const result = analyze({
      currentStroops: stroops('3'),
      payments: [out(20, '97.0000000', { txIndex: 2 }), payment(20, { txIndex: 1, amount: '90.0000000' })],
      effects: [debit(20, '97.0000000', { txIndex: 2 }), credit(20, '90.0000000', { txIndex: 1 })],
    });
    expect(result.detected.map((b) => b.opId)).toEqual([opId(20, 1, 2)]);
    const [current, past] = result.rounds;
    expect(isRecordInRound(payment(20, { txIndex: 1 }), past)).toBe(true);
    expect(isRecordInRound(payment(20, { txIndex: 3 }), current)).toBe(true);
  });

  it('markiert Eingaenge in der Grenz-Transaktion', () => {
    const result = analyze({
      currentStroops: stroops('3'),
      payments: [out(20, '100.0000000', { index: 2 }), payment(20, { index: 1, amount: '3.0000000' })],
      effects: [debit(20, '100.0000000', { index: 2 }), credit(20, '3.0000000', { index: 1 })],
    });
    expect(result.detected[0].hasIncoming).toBe(true);
    const plain = analyze({ currentStroops: stroops('3'), payments: [out(20, '97.0000000')], effects: [debit(20, '97.0000000')] });
    expect(plain.detected[0].hasIncoming).toBe(false);
  });

  it('nennt Abfluss und Saldo ohne geladene Effects unbekannt, nicht 0', () => {
    const result = analyze({ currentStroops: stroops('3'), payments: [out(20, '97.0000000')], effects: [] });
    expect(result.candidates[0]).toMatchObject({ outflow: '', balanceAfter: '', tokenAmount: '' });
    expect(result.detected).toEqual([]);
  });

  it('gestueckelte Leerung: Die letzte Transaktion zaehlt, wenn sie die Regel allein erfuellt', () => {
    const result = analyze({
      currentStroops: stroops('2'),
      payments: [out(21, '49.0000000'), out(20, '49.0000000')],
      effects: [debit(21, '49.0000000'), debit(20, '49.0000000')],
    });
    expect(result.detected.map((b) => b.opId)).toEqual([opId(21)]);
  });

  it('gestueckelte Leerung ohne passende Einzeltransaktion wird nicht erkannt (dokumentierte Grenze)', () => {
    const result = analyze({
      currentStroops: stroops('3'),
      payments: [out(21, '5.0000000'), out(20, '92.0000000')],
      effects: [debit(21, '5.0000000'), debit(20, '92.0000000')],
    });
    expect(result.detected).toEqual([]);
  });

  it('Leerung per create_account', () => {
    const record = payment(20, { type: 'create_account', funder: G, account: TARGET, starting_balance: '97.0000000', from: undefined, to: undefined, amount: undefined });
    const result = analyze({ currentStroops: stroops('3'), payments: [record], effects: [debit(20, '97.0000000')] });
    expect(result.detected[0]).toMatchObject({ to: TARGET, outflow: '97.0000000' });
  });

  it('Leerung per account_merge, Betrag aus dem Effect', () => {
    const record = payment(20, { type: 'account_merge', account: G, into: TARGET, from: undefined, to: undefined, amount: undefined });
    const result = analyze({ currentStroops: 0n, payments: [record], effects: [debit(20, '100.0000000')] });
    expect(result.detected[0]).toMatchObject({ to: TARGET, outflow: '100.0000000', balanceAfter: '0.0000000' });
  });

  it('Abflussgrenze: genau 90 % des Verfuegbaren reicht, ein Stroop weniger nicht', () => {
    expect(RESET_MIN_DRAIN_PERCENT).toBe(90n);
    const wide = { reserveStroops: stroops('1'), bufferStroops: stroops('20') };
    expect(isResetTransaction({ before: stroops('101'), after: stroops('11'), ...wide })).toBe(true);
    expect(isResetTransaction({ before: stroops('101'), after: stroops('11.0000001'), ...wide })).toBe(false);
  });

  it('rechnet die 90 % stroop-genau ohne Rundung, auch bei krummem Ergebnis', () => {
    // Verfuegbar 1001 Stroops: 90 % sind 900,9, 901 reichen, 900 nicht.
    const stroopRule = { reserveStroops: 0n, bufferStroops: 200n };
    expect(isResetTransaction({ before: 1001n, after: 100n, ...stroopRule })).toBe(true);
    expect(isResetTransaction({ before: 1001n, after: 101n, ...stroopRule })).toBe(false);
  });

  it('ab Verfuegbar >= 10 x Puffer entscheidet faktisch b)', () => {
    expect(isResetTransaction({ before: stroops('51'), after: stroops('6'), ...rule })).toBe(true);
    expect(isResetTransaction({ before: stroops('1000'), after: stroops('6') + 1n, ...rule })).toBe(false);
  });

  it('Puffergrenze: danach genau an der Grenze ja, ein Stroop darueber nein; davor genau an der Grenze nein', () => {
    expect(isResetTransaction({ before: stroops('101'), after: stroops('6'), ...rule })).toBe(true);
    expect(isResetTransaction({ before: stroops('101'), after: stroops('6') + 1n, ...rule })).toBe(false);
    expect(isResetTransaction({ before: stroops('6'), after: stroops('1'), ...rule })).toBe(false);
  });

  it('der Puffer verschiebt die Grenze', () => {
    const input = { currentStroops: stroops('10'), payments: [out(20, '90.0000000')], effects: [debit(20, '90.0000000')] };
    expect(analyze({ ...input, bufferStroops: stroops('8.9999999') }).detected).toEqual([]);
    expect(analyze({ ...input, bufferStroops: stroops('9') }).detected).toHaveLength(1);
  });

  it('rechnet spaetere Eingaenge heraus', () => {
    const result = analyze({
      currentStroops: stroops('56'),
      payments: [payment(30, { amount: '50.0000000' }), out(20, '90.0000000')],
      effects: [credit(30, '50.0000000'), debit(20, '90.0000000')],
    });
    expect(result.detected.map((b) => b.opId)).toEqual([opId(20)]);
  });

  it('Token-Abfluss ist kein Reset', () => {
    const result = analyze({
      currentStroops: stroops('3'),
      payments: [out(20, '97.0000000', { asset_type: 'credit_alphanum4', asset_code: 'USD' })],
      effects: [debit(20, '97.0000000')],
    });
    expect(result.detected).toEqual([]);
  });

  it('wertet bei Path Payments die Quellseite aus', () => {
    const path = out(20, '5.0000000', { type: 'path_payment_strict_send', source_asset_type: 'native', source_amount: '97.0000000', asset_type: 'credit_alphanum4', asset_code: 'USD' });
    expect(outgoingOf(path, G).native).toBe(true);
    const result = analyze({ currentStroops: stroops('3'), payments: [path], effects: [debit(20, '97.0000000')] });
    expect(result.detected[0].outflow).toBe('97.0000000');
  });

  it('ignoriert Eingaenge, Zahlungen an sich selbst und fehlgeschlagene Transaktionen', () => {
    expect(outgoingOf(payment(20), G)).toBeNull();
    expect(outgoingOf(out(20, '1.0000000', { to: G }), G)).toBeNull();
    expect(outgoingOf(out(20, '1.0000000', { transaction_successful: false }), G)).toBeNull();
  });
});

describe('Abdeckung', () => {
  it('nimmt den Feed, der weniger weit zurueckreicht', () => {
    expect(coveredFromOpId({ payments: [payment(50), payment(20)], effects: [debit(30, '1')], paymentsDone: false, effectsDone: false })).toBe(opId(30));
  });

  it('ist leer, wenn beide Feeds zu Ende sind, und null vor dem ersten Abruf', () => {
    expect(coveredFromOpId({ payments: [], effects: [], paymentsDone: true, effectsDone: true })).toBe('');
    expect(coveredFromOpId({ payments: [], effects: [], paymentsDone: false, effectsDone: false })).toBeNull();
  });

  it('nimmt die Transaktion an der Grenze aus, sie kann ueber zwei Seiten verteilt sein', () => {
    const payments = [out(30, '97.0000000')];
    const effects = [debit(30, '97.0000000')];
    const atEdge = analyze({ currentStroops: stroops('3'), paymentsDone: false, effectsDone: false, payments, effects });
    expect(atEdge.coveredFrom).toBe(opId(30));
    expect(atEdge.detected).toEqual([]);
    expect(atEdge.candidates).toEqual([]);

    const older = analyze({ currentStroops: stroops('3'), paymentsDone: false, effectsDone: false, payments: [...payments, payment(10)], effects: [...effects, credit(10, '1.0000000')] });
    expect(older.detected).toHaveLength(1);
  });
});

describe('Korrekturen und Runden', () => {
  const b = (ledger) => ({ opId: opId(ledger), createdAt: 't', txHash: 'h', to: TARGET, source: 'detected' });

  it('verwirft Grenzen und ergaenzt manuelle, neueste zuerst', () => {
    const result = applyBoundaryCorrections({ detected: [b(30), b(10)], dismissed: [opId(30)], manual: [b(20)], coveredFrom: '' });
    expect(result.map((x) => x.opId)).toEqual([opId(20), opId(10)]);
    expect(result[0].source).toBe('manual');
  });

  it('nimmt manuelle Grenzen erst, wenn der Scan aelter ist', () => {
    expect(applyBoundaryCorrections({ detected: [], manual: [b(5)], coveredFrom: opId(10) })).toEqual([]);
    expect(applyBoundaryCorrections({ detected: [], manual: [b(10)], coveredFrom: opId(10) })).toEqual([]);
    expect(applyBoundaryCorrections({ detected: [], manual: [b(15)], coveredFrom: opId(10) })).toHaveLength(1);
  });

  it('eine manuelle Grenze ersetzt die erkannte derselben Transaktion', () => {
    const result = applyBoundaryCorrections({ detected: [b(30)], manual: [b(30)], coveredFrom: '' });
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('manual');
  });

  it('eine verworfene Grenze verschmilzt zwei Runden', () => {
    const rounds = buildRounds(applyBoundaryCorrections({ detected: [b(30), b(10)], dismissed: [opId(30)], coveredFrom: '' }), { complete: true });
    expect(isRecordInRound(payment(20), rounds[0])).toBe(true);
    expect(rounds).toHaveLength(2);
  });

  it('baut die aktuelle Runde und fruehere, die Grenz-Transaktion gehoert zu keiner', () => {
    const [current, past, oldest] = buildRounds([b(30), b(10)], { complete: true });
    expect(current).toMatchObject({ end: null, complete: true });
    expect(isRecordInRound(payment(40), current)).toBe(true);
    expect(isRecordInRound(payment(30), current)).toBe(false);
    expect(isRecordInRound(payment(20), past)).toBe(true);
    expect(isRecordInRound(payment(30), past)).toBe(false);
    expect(isRecordInRound(payment(10), past)).toBe(false);
    expect(isRecordInRound(payment(5), oldest)).toBe(true);
    expect(oldest).toMatchObject({ start: null, historyEnd: true });
  });

  it('nimmt alle Operationen der Grenz-Transaktion aus beiden Runden', () => {
    const [current, past] = buildRounds([{ ...b(20), opId: opId(20, 2) }], { complete: true });
    expect(isRecordInRound(payment(20, { index: 3 }), current)).toBe(false);
    expect(isRecordInRound(payment(20, { index: 1 }), past)).toBe(false);
  });

  it('trennt Transaktionen im selben Ledger', () => {
    const [current, past] = buildRounds([{ ...b(20), opId: opId(20, 1, 2) }], { complete: true });
    expect(isRecordInRound(payment(20, { txIndex: 3 }), current)).toBe(true);
    expect(isRecordInRound(payment(20, { txIndex: 1 }), past)).toBe(true);
  });

  it('ohne Reset: Runde bis Historienbeginn, vollstaendig erst am Ende des Scans', () => {
    expect(buildRounds([], { complete: false })[0]).toMatchObject({ id: 'all', complete: false, historyEnd: false });
    expect(buildRounds([], { complete: true })[0]).toMatchObject({ complete: true, historyEnd: true });
  });

  it('Datumsbereich: from inklusive, to exklusiv, vollstaendig sobald der Scan aelter ist', () => {
    const round = buildDateRangeRound({ fromISO: '2026-10-10T10:00:00Z', toISO: '2026-10-10T12:00:00Z', coveredAt: '2026-10-10T09:00:00Z' });
    expect(round.complete).toBe(true);
    expect(isRecordInRound({ created_at: '2026-10-10T10:00:00Z' }, round)).toBe(true);
    expect(isRecordInRound({ created_at: '2026-10-10T12:00:00Z' }, round)).toBe(false);
    expect(buildDateRangeRound({ fromISO: '2026-10-10T10:00:00Z', coveredAt: '2026-10-10T11:00:00Z' }).complete).toBe(false);
  });

  it('Kandidaten sind Transaktionen, mit Abfluss und Saldo danach, auch fuer account_merge', () => {
    const merge = payment(20, { type: 'account_merge', account: G, into: TARGET, from: undefined, to: undefined, amount: undefined });
    const result = analyze({
      currentStroops: stroops('50'),
      payments: [out(30, '1.0000000', { index: 2 }), out(30, '2.0000000', { index: 1 }), merge],
      effects: [debit(30, '1.0000000', { index: 2 }), debit(30, '2.0000000', { index: 1 }), debit(20, '7.0000000')],
    });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({ outflow: '3.0000000', tokenAmount: '', balanceAfter: '50.0000000' });
    expect(result.candidates[1]).toMatchObject({ outflow: '7.0000000', tokenAmount: '', balanceAfter: '53.0000000' });
  });

  it('nennt bei reiner Token-Zahlung deren Betrag', () => {
    const result = analyze({ payments: [out(20, '4.0000000', { asset_type: 'credit_alphanum4', asset_code: 'USD' })], effects: [] });
    expect(result.candidates[0]).toMatchObject({ tokenAmount: '4.0000000 USD', outflow: '' });
  });
});

describe('Nicht modellierte Effects', () => {
  const trade = (ledger, fields) => effect(ledger, 'trade', undefined, { sold_asset_type: 'native', bought_asset_type: 'credit_alphanum4', ...fields });

  it('meldet Trades mit XLM, auch als Offer-Besitzer in einer fremden Path Payment', () => {
    expect(countUnsureEffects([trade(30)], [], G)).toBe(1);
    expect(countUnsureEffects([trade(30)], [payment(30, { type: 'path_payment_strict_send', from: SENDER_A })], G)).toBe(1);
  });

  it('meldet keine Trades ohne XLM und keine eigener Path Payments', () => {
    expect(countUnsureEffects([trade(30, { sold_asset_type: 'credit_alphanum4' })], [], G)).toBe(0);
    expect(countUnsureEffects([trade(30)], [payment(30, { type: 'path_payment_strict_send', from: G, to: TARGET })], G)).toBe(0);
  });

  it('meldet Liquidity-Pool-Ein- und Auszahlungen nur mit XLM', () => {
    const native = [{ asset: 'native', amount: '1.0000000' }];
    const token = [{ asset: 'USD:G', amount: '1.0000000' }];
    expect(countUnsureEffects([effect(30, 'liquidity_pool_deposited', undefined, { reserves_deposited: native })], [], G)).toBe(1);
    expect(countUnsureEffects([effect(30, 'liquidity_pool_withdrew', undefined, { reserves_received: native })], [], G)).toBe(1);
    expect(countUnsureEffects([effect(30, 'liquidity_pool_deposited', undefined, { reserves_deposited: token })], [], G)).toBe(0);
  });

  it.each(['liquidity_pool_trade', 'contract_credited', 'contract_debited', 'claimable_balance_claimed', 'claimable_balance_created', 'account_created', 'account_removed'])(
    'meldet %s nicht: dazu gibt es account_credited/debited, oder der Saldo aendert sich nicht', (type) => {
      expect(countUnsureEffects([effect(30, type, undefined, { asset_type: 'native' })], [], G)).toBe(0);
    }
  );
});
