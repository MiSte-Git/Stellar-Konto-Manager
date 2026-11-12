// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Account, Keypair, MuxedAccount } from '@stellar/stellar-sdk';
import {
  parseStroops, formatStroops, buildSearchFilters, normalizeOperation, matchesFilters,
  sumByAsset, loadOperations, sortRows, parseRecipient, SEARCH_ABORT_MESSAGE,
} from '../transactionSearch.js';

const ME = Keypair.random().publicKey();
const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const muxed = (g, id) => new MuxedAccount(new Account(g, '0'), String(id)).accountId();
const M1 = muxed(A, 1);
const M2 = muxed(A, 2);

const build = (raw) => {
  const res = buildSearchFilters(raw);
  if (!res.ok) throw new Error(`Filter ungueltig: ${JSON.stringify(res.errors)}`);
  return res.filters;
};
const pay = (o = {}) => ({
  id: '1', type: 'payment', created_at: '2026-11-01T00:00:00Z', transaction_hash: 'h1',
  from: ME, to: A, amount: '10.0000000', asset_type: 'native', ...o,
});
const row = (o, memo = '') => ({ ...normalizeOperation(pay(o), ME), memo });

describe('parseStroops', () => {
  it('liest Komma und Punkt gleich, bis 7 Stellen exakt', () => {
    expect(parseStroops('1,5')).toBe(15_000_000n);
    expect(parseStroops('1.5')).toBe(15_000_000n);
    expect(parseStroops('0.0000001')).toBe(1n);
    expect(parseStroops('922337203685.4775807')).toBe(9_223_372_036_854_775_807n);
  });
  it('lehnt 8 Stellen, Tausendertrenner, Minus und Text ab', () => {
    for (const bad of ['0.00000001', '1.000,5', '-1', 'abc', '', '1e3', '1,', ',5']) {
      expect(parseStroops(bad)).toBeNull();
    }
  });
  it('formatStroops ist die Umkehrung', () => {
    expect(formatStroops(15_000_000n)).toBe('1.5000000');
    expect(formatStroops(1n)).toBe('0.0000001');
  });
});

describe('buildSearchFilters', () => {
  it('nimmt G- und M-Adressen, trennt nach Leerzeichen, Komma, Zeilen und entfernt Doppelte', () => {
    const f = build({ recipientsText: `${A}, ${M1}\n${A}` });
    expect(f.recipients).toEqual([{ kind: 'G', value: A }, { kind: 'M', value: M1 }]);
  });
  it('lehnt Secret Keys, kaputte Pruefsummen und Text mit Fehler je Eintrag ab', () => {
    const secret = Keypair.random().secret();
    const broken = `${A.slice(0, -1)}${A.endsWith('A') ? 'B' : 'A'}`;
    const res = buildSearchFilters({ recipientsText: `${secret} ${broken} hallo` });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.key)).toEqual(['recipientSecretKey', 'recipientInvalid', 'recipientInvalid']);
    // der Secret Key darf nirgends in den Fehlern stehen
    expect(JSON.stringify(res.errors)).not.toContain(secret);
  });
  it('ein Secret Key in einem anderen Feld wird in der Fehlermeldung maskiert', () => {
    const secret = Keypair.random().secret();
    const res = buildSearchFilters({ amountMin: secret });
    expect(res.errors[0].key).toBe('amountInvalid');
    expect(JSON.stringify(res.errors)).not.toContain(secret);
  });
  it('Memos: eine Zeile je Eintrag, unsichtbare Zeichen und Leerzeilen fallen weg', () => {
    const f = build({ memosText: ' abc \n\n​xyz\nabc' });
    expect(f.memos).toEqual(['abc', 'xyz']);
  });
  it('Betrag: von groesser als bis ist ein Fehler, einzelne Grenze ist erlaubt', () => {
    expect(buildSearchFilters({ amountMin: '5', amountMax: '1' }).errors[0].key).toBe('amountRange');
    expect(build({ amountMin: '5' }).amount).toEqual({ assetKey: 'native', min: 50_000_000n, max: null });
    expect(build({ amountMax: '5,5' }).amount).toEqual({ assetKey: 'native', min: null, max: 55_000_000n });
    expect(buildSearchFilters({ amountMin: 'x' }).errors[0].key).toBe('amountInvalid');
  });
  it('anderes Asset braucht gueltigen Code und Issuer, aber nur wenn ein Betrag gesetzt ist', () => {
    expect(buildSearchFilters({ amountAsset: 'custom', amountMin: '1', assetCode: '', assetIssuer: '' }).ok).toBe(false);
    expect(buildSearchFilters({ amountAsset: 'custom', amountMin: '1', assetCode: 'USD', assetIssuer: 'GX' }).errors[0].key).toBe('assetIssuerInvalid');
    expect(buildSearchFilters({ amountAsset: 'custom', assetCode: '', assetIssuer: '' }).ok).toBe(true);
    expect(build({ amountAsset: 'custom', amountMin: '1', assetCode: 'USD', assetIssuer: ISSUER }).amount.assetKey).toBe(`USD:${ISSUER}`);
  });
});

describe('matchesFilters: Empfaenger (G und M)', () => {
  it('G-Filter trifft die G-Adresse und jede M-Adresse mit dieser Basis', () => {
    const f = build({ recipientsText: A });
    expect(matchesFilters(row({ to: A }), f)).toBe(true);
    expect(matchesFilters(row({ to: A, to_muxed: M1 }), f)).toBe(true);
    expect(matchesFilters(row({ to: B }), f)).toBe(false);
  });
  it('M-Filter trifft nur genau diese M-Adresse', () => {
    const f = build({ recipientsText: M1 });
    expect(matchesFilters(row({ to: A, to_muxed: M1 }), f)).toBe(true);
    expect(matchesFilters(row({ to: A, to_muxed: M2 }), f)).toBe(false);
    expect(matchesFilters(row({ to: A }), f)).toBe(false);
  });
  it('mehrere Empfaenger sind ODER', () => {
    const f = build({ recipientsText: `${A} ${B}` });
    expect(matchesFilters(row({ to: A }), f)).toBe(true);
    expect(matchesFilters(row({ to: B }), f)).toBe(true);
    expect(matchesFilters(row({ to: ME }), f)).toBe(false);
  });
  it('create_account, account_merge und Claimants zaehlen als Empfaenger', () => {
    const f = build({ recipientsText: A });
    const base = { id: '2', created_at: '2026-11-01T00:00:00Z', transaction_hash: 'h2' };
    const ca = normalizeOperation({ ...base, type: 'create_account', funder: ME, account: A, starting_balance: '2.0000000' }, ME);
    const am = normalizeOperation({ ...base, type: 'account_merge', account: ME, into: A }, ME);
    const cb = normalizeOperation({ ...base, type: 'create_claimable_balance', source_account: ME, asset: 'native', amount: '3.0000000', claimants: [{ destination: B }, { destination: A }] }, ME);
    for (const r of [ca, am, cb]) expect(matchesFilters(r, f)).toBe(true);
    expect(matchesFilters(cb, build({ recipientsText: ME }))).toBe(false);
  });
});

describe('matchesFilters: Betrag', () => {
  it('Grenzen sind inklusive und exakt auf 7 Stellen', () => {
    const f = build({ amountMin: '10', amountMax: '10,0000001' });
    expect(matchesFilters(row({ amount: '10.0000000' }), f)).toBe(true);
    expect(matchesFilters(row({ amount: '10.0000001' }), f)).toBe(true);
    expect(matchesFilters(row({ amount: '9.9999999' }), f)).toBe(false);
    expect(matchesFilters(row({ amount: '10.0000002' }), f)).toBe(false);
  });
  it('vergleicht je Asset getrennt: 10 USD trifft keinen XLM-Filter und umgekehrt', () => {
    const usd = { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: ISSUER, amount: '10.0000000' };
    const fXlm = build({ amountMin: '5' });
    const fUsd = build({ amountMin: '5', amountAsset: 'custom', assetCode: 'USD', assetIssuer: ISSUER });
    expect(matchesFilters(row(usd), fXlm)).toBe(false);
    expect(matchesFilters(row({}), fXlm)).toBe(true);
    expect(matchesFilters(row(usd), fUsd)).toBe(true);
    expect(matchesFilters(row({}), fUsd)).toBe(false);
    // gleicher Code, anderer Issuer
    expect(matchesFilters(row({ ...usd, asset_issuer: A }), fUsd)).toBe(false);
  });
  it('Tausch: es gilt der gesendete Betrag im gesendeten Asset', () => {
    const swap = {
      type: 'path_payment_strict_send', amount: '99.0000000', source_amount: '4.0000000',
      asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: ISSUER, source_asset_type: 'native',
    };
    expect(matchesFilters(row(swap), build({ amountMin: '3', amountMax: '5' }))).toBe(true);
    expect(matchesFilters(row(swap), build({ amountMin: '50' }))).toBe(false);
  });
  it('account_merge hat keinen Betrag und faellt aus jedem Betragsfilter', () => {
    const am = normalizeOperation({ id: '3', type: 'account_merge', account: ME, into: A, created_at: '2026-11-01T00:00:00Z' }, ME);
    expect(am.stroops).toBeNull();
    expect(matchesFilters(am, build({ amountMax: '100' }))).toBe(false);
    expect(matchesFilters(am, build({ recipientsText: A }))).toBe(true);
  });
});

describe('matchesFilters: Memo, Richtung, Verknuepfung', () => {
  it('Memo ist Teilstring, Gross-/Kleinschreibung zaehlt, mehrere Memos sind ODER, leeres Memo trifft nie', () => {
    const f = build({ memosText: 'Abo\nxyz' });
    expect(matchesFilters(row({}, 'mein Abo 5'), f)).toBe(true);
    expect(matchesFilters(row({}, 'a xyz'), f)).toBe(true);
    expect(matchesFilters(row({}, 'abo'), f)).toBe(false);
    expect(matchesFilters(row({}, ''), f)).toBe(false);
  });
  it('Richtung: ein, aus, an sich selbst zaehlt in beiden', () => {
    const rIn = row({ from: A, to: ME });
    const rOut = row({ from: ME, to: A });
    const rSelf = row({ from: ME, to: ME });
    expect(rIn.dir).toBe('in'); expect(rOut.dir).toBe('out'); expect(rSelf.dir).toBe('self');
    const fin = build({ direction: 'in' });
    const fout = build({ direction: 'out' });
    expect([rIn, rOut, rSelf].map((r) => matchesFilters(r, fin))).toEqual([true, false, true]);
    expect([rIn, rOut, rSelf].map((r) => matchesFilters(r, fout))).toEqual([false, true, true]);
  });
  it('Beispiel: Empfaenger A ODER B, UND Betrag von bis', () => {
    const f = build({ recipientsText: `${A} ${B}`, amountMin: '5', amountMax: '20' });
    expect(matchesFilters(row({ to: A, amount: '10.0000000' }), f)).toBe(true);
    expect(matchesFilters(row({ to: B, amount: '20.0000000' }), f)).toBe(true);
    expect(matchesFilters(row({ to: B, amount: '21.0000000' }), f)).toBe(false);
    expect(matchesFilters(row({ to: ME, amount: '10.0000000' }), f)).toBe(false);
  });
  it('ohne Filter trifft alles', () => {
    expect(matchesFilters(row({}), build({}))).toBe(true);
  });
});

describe('sumByAsset', () => {
  it('summiert exakt je Asset und ueberspringt Zeilen ohne Betrag', () => {
    const usd = { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: ISSUER };
    const rows = [row({ amount: '0.1000000' }), row({ amount: '0.2000000' }), row({ ...usd, amount: '5.0000000' }),
      normalizeOperation({ id: '9', type: 'account_merge', account: ME, into: A }, ME)];
    const sums = sumByAsset(rows);
    expect(sums.find((s) => s.label === 'XLM')).toMatchObject({ amount: '0.3000000', count: 2 });
    expect(sums.find((s) => s.label === 'USD')).toMatchObject({ amount: '5.0000000', count: 1 });
  });
});

// Kleiner Horizon-Ersatz mit Seiten
function fakeServer({ ops, txs }) {
  const pager = (pages) => {
    const make = (i) => ({ records: pages[i] || [], next: async () => make(i + 1) });
    return make(0);
  };
  const chain = (pages) => { const b = { forAccount: () => b, order: () => b, limit: () => b, call: async () => pager(pages) }; return b; };
  return { operations: () => chain(ops), transactions: () => chain(txs || [[]]) };
}
const op = (n, o = {}) => pay({ id: String(n), transaction_hash: `h${n}`, created_at: `2026-11-0${n}T00:00:00Z`, amount: `${n}.0000000`, ...o });

describe('matchesFilters: Memo enthaelt nicht', () => {
  it('schliesst Treffer aus, leeres Memo besteht den Filter (wie die frueheren falschen/leeren Memos)', () => {
    const f = build({ notMemosText: 'Miete' });
    expect(matchesFilters(row({}, 'Miete Nov'), f)).toBe(false);
    expect(matchesFilters(row({}, 'Danke'), f)).toBe(true);
    expect(matchesFilters(row({}, ''), f)).toBe(true);
  });
  it('mehrere Eintraege sind ODER (ein Treffer reicht zum Ausschluss) und wirken UND mit Memo enthaelt', () => {
    const f = build({ memosText: 'Abo', notMemosText: 'alt\nstorno' });
    expect(matchesFilters(row({}, 'Abo neu'), f)).toBe(true);
    expect(matchesFilters(row({}, 'Abo alt'), f)).toBe(false);
    expect(matchesFilters(row({}, 'Abo storno'), f)).toBe(false);
    expect(matchesFilters(row({}, 'neu'), f)).toBe(false);
  });
});

describe('matchesFilters: falsches Memo (genauer Vergleich)', () => {
  const f = build({ notExactMemosText: 'GF-1234' });
  it('nur das genau passende Memo ist richtig, jede Abweichung ist falsch', () => {
    expect(matchesFilters(row({}, 'GF-1234'), f)).toBe(false);
    for (const wrong of ['gf-1234', 'GF-1243', 'GF-123', 'GF-12345', 'GF-1234 extra', ' x GF-1234', '']) {
      expect(matchesFilters(row({}, wrong), f)).toBe(true);
    }
  });
  it('unsichtbare Zeichen und Leerraum am Rand zaehlen nicht als Abweichung', () => {
    expect(matchesFilters(row({}, '\u200BGF-1234 '), f)).toBe(false);
  });
  it('mehrere erwartete Memos sind ODER: passt eines genau, ist das Memo richtig', () => {
    const two = build({ notExactMemosText: 'A1\nB2' });
    expect(matchesFilters(row({}, 'A1'), two)).toBe(false);
    expect(matchesFilters(row({}, 'B2'), two)).toBe(false);
    expect(matchesFilters(row({}, 'C3'), two)).toBe(true);
  });
  it('unterscheidet sich von Memo enthaelt nicht: Zusatztext bleibt dort ausgeschlossen, hier falsch', () => {
    const contains = build({ notMemosText: 'GF-1234' });
    expect(matchesFilters(row({}, 'GF-1234 extra'), contains)).toBe(false);
    expect(matchesFilters(row({}, 'GF-1234 extra'), f)).toBe(true);
  });
  it('wirkt zusammen mit Richtung Eingang und Empfaenger als UND', () => {
    const g = build({ notExactMemosText: 'GF-1234', direction: 'in' });
    expect(matchesFilters(row({ from: A, to: ME }, 'x'), g)).toBe(true);
    expect(matchesFilters(row({ from: ME, to: A }, 'x'), g)).toBe(false);
  });
});

describe('parseRecipient', () => {
  it('erkennt G, M, Secret Key und Unsinn, ohne den Secret Key preiszugeben', () => {
    const secret = Keypair.random().secret();
    expect(parseRecipient(` ${A} `)).toEqual({ kind: 'G', value: A });
    expect(parseRecipient(M1)).toEqual({ kind: 'M', value: M1 });
    expect(parseRecipient(secret)).toEqual({ error: 'recipientSecretKey' });
    expect(parseRecipient('hallo')).toEqual({ error: 'recipientInvalid', value: 'hallo' });
  });
});

describe('sortRows', () => {
  const r = (id, created_at, amount) => ({ id, created_at, stroops: amount == null ? null : parseStroops(amount) });
  const rows = [r('a', '2026-11-01', '5'), r('b', '2026-11-03', '20'), r('c', '2026-11-02', null), r('d', '2026-11-04', '1,5')];
  it('nach Datum auf- und absteigend', () => {
    expect(sortRows(rows, { key: 'created_at', dir: 'desc' }).map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(sortRows(rows, { key: 'created_at', dir: 'asc' }).map((x) => x.id)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('nach Betrag exakt, Zeilen ohne Betrag immer am Ende (Top-Liste)', () => {
    expect(sortRows(rows, { key: 'amount', dir: 'desc' }).map((x) => x.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(sortRows(rows, { key: 'amount', dir: 'asc' }).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('veraendert das Eingabe-Array nicht', () => {
    const copy = rows.map((x) => x.id);
    sortRows(rows, { key: 'amount', dir: 'desc' });
    expect(rows.map((x) => x.id)).toEqual(copy);
  });
});

const WIDE = { fromISO: '2026-10-01T00:00:00Z', toISO: '2026-12-01T00:00:00Z' };

describe('loadOperations', () => {
  it('begrenzt auf das Zeitfenster (von inklusive, bis exklusiv) und liest ueber Seitengrenzen', async () => {
    const server = fakeServer({ ops: [[op(6), op(5)], [op(4), op(3)], [op(2), op(1)]] });
    const res = await loadOperations({ server, accountId: ME, fromISO: '2026-11-03T00:00:00Z', toISO: '2026-11-06T00:00:00Z' });
    expect(res.rows.map((r) => r.id)).toEqual(['5', '4', '3']);
    expect(res.incomplete).toBe(false);
  });
  it('liefert alle suchbaren Zeilen mit dem Memo ihrer Transaktion, andere Operationstypen fehlen', async () => {
    const txs = [[{ hash: 'h2', created_at: '2026-11-02T00:00:00Z', memo: 'Abo' }, { hash: 'h1', created_at: '2026-11-01T00:00:00Z', memo: 'x' }]];
    const server = fakeServer({ ops: [[op(2), { id: '9', type: 'change_trust', created_at: '2026-11-02T00:00:00Z', transaction_hash: 'h9' }, op(1)]], txs });
    const res = await loadOperations({ server, accountId: ME, ...WIDE });
    expect(res.rows.map((r) => [r.id, r.memo])).toEqual([['2', 'Abo'], ['1', 'x']]);
    expect(res.memoIncomplete).toBe(false);
  });
  it('meldet die Treffermenge als unvollstaendig, wenn die Seitengrenze erreicht ist', async () => {
    const server = fakeServer({ ops: [[op(6), op(5)], [op(4), op(3)], [op(2), op(1)]] });
    const res = await loadOperations({ server, accountId: ME, ...WIDE, maxPages: 2 });
    expect(res.incomplete).toBe(true);
    expect(res.oldestLoaded).toBe('2026-11-03T00:00:00Z');
    expect(res.rows).toHaveLength(4);
  });
  it('meldet unvollstaendige Memos, wenn die Transaktionen die Ladegrenze erreichen', async () => {
    const tx = (n) => ({ hash: `h${n}`, created_at: `2026-11-0${n}T00:00:00Z`, memo: `m${n}` });
    const server = fakeServer({ ops: [[op(4), op(3)]], txs: [[tx(4)], [tx(3)], [tx(2)]] });
    const res = await loadOperations({ server, accountId: ME, ...WIDE, maxPages: 2 });
    expect(res.memoIncomplete).toBe(true);
  });
  it('bricht bei Abbruch mit der bekannten Abbruchmeldung ab', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const server = fakeServer({ ops: [[op(1)]] });
    await expect(loadOperations({ server, accountId: ME, signal: ctrl.signal })).rejects.toThrow(SEARCH_ABORT_MESSAGE);
  });
});
