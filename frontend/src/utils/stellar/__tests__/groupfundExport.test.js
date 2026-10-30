import { describe, expect, it } from 'vitest';
import { buildGroupfundExport, groupfundExportToCsv, groupfundExportToJson } from '../groupfundExport.js';
import { toStroops } from '../liquidityPools.js';
import { G, ISSUER, SENDER_A } from './groupfundFixtures.js';

const row = (overrides = {}) => ({
  sender: SENDER_A,
  asset: { code: 'USD', issuer: ISSUER, isNative: false },
  gross: toStroops('10'),
  refunds: toStroops('12.5'),
  net: toStroops('10') - toStroops('12.5'),
  unmarkedOut: toStroops('0.0000001'),
  count: 2,
  txHashes: ['aa', 'bb'],
  ...overrides,
});
const round = { id: 'x', start: { txHash: 'starttx', createdAt: '2026-10-01T00:00:00Z', source: 'manual' }, end: null };
const data = (overrides = {}) => buildGroupfundExport({
  network: 'PUBLIC', accountId: G, identifier: { mode: 'muxed', id: '42' }, round, rows: [row()],
  directory: new Map([[SENDER_A, { status: 'listed', tags: ['exchange'] }]]), bufferStroops: toStroops('5'),
  coverage: { complete: false, coveredAt: '2026-09-30T00:00:00Z', scannedAt: '2026-10-30T00:00:00Z' }, generatedAt: '2026-10-30T00:00:00.000Z', ...overrides,
});

describe('Groupfund-Export', () => {
  it('fuehrt die Kopfdaten und Grenzen', () => {
    expect(data().meta).toMatchObject({
      network: 'PUBLIC', account: G, identifierMode: 'muxed', identifier: '42',
      roundStart: { txHash: 'starttx', time: '2026-10-01T00:00:00Z', source: 'manual' },
      roundEnd: { txHash: 'open_end', time: 'open_end', source: 'open_end' },
      bufferXlm: '5.0000000',
      coverage: { historyComplete: false, coveredAt: '2026-09-30T00:00:00Z', scannedAt: '2026-10-30T00:00:00Z' },
      amountUnknown: false,
      boundaryHasIncoming: false,
    });
  });

  it('setzt boundary_has_incoming fuer Start- und Endgrenze', () => {
    const start = { ...round.start, hasIncoming: true };
    expect(data({ round: { ...round, start } }).meta.boundaryHasIncoming).toBe(true);
    const end = { txHash: 'e', createdAt: 't', source: 'detected', hasIncoming: true };
    expect(groupfundExportToCsv(data({ round: { ...round, end } }))).toContain('boundary_has_incoming;true\n');
    expect(groupfundExportToCsv(data())).toContain('boundary_has_incoming;false\n');
  });

  it('schreibt history_start und open_end statt leerer Grenzen', () => {
    const meta = data({ round: { id: 'all', start: null, end: null }, coverage: { complete: true, coveredAt: '', scannedAt: 's' } }).meta;
    expect(meta.roundStart).toEqual({ txHash: 'history_start', time: 'history_start', source: 'history_start' });
    expect(meta.roundEnd.time).toBe('open_end');
    expect(meta.coverage).toEqual({ historyComplete: true, coveredAt: 'history_start', scannedAt: 's' });
  });

  it('nennt die Quelle der Endgrenze einer frueheren Runde', () => {
    const meta = data({ round: { ...round, end: { txHash: 'endtx', createdAt: 't', source: 'detected' } } }).meta;
    expect(meta.roundEnd).toEqual({ txHash: 'endtx', time: 't', source: 'detected' });
  });

  it('setzt amount_unknown je Zeile und in den Kopfdaten', () => {
    const exported = data({ rows: [row({ amountUnknown: true }), row()] });
    expect(exported.meta.amountUnknown).toBe(true);
    expect(exported.rows.map((r) => r.amountUnknown)).toEqual([true, false]);
    const csv = groupfundExportToCsv(exported);
    expect(csv).toContain('amount_unknown;true\n');
    expect(csv).toContain(';2;true;aa bb;');
  });

  it('gibt Betraege als String mit 7 Nachkommastellen aus', () => {
    const parsed = JSON.parse(groupfundExportToJson(data()));
    expect(parsed.rows[0]).toMatchObject({ gross: '10.0000000', refunds: '12.5000000', net: '-2.5000000', unmarkedOut: '0.0000001', count: 2 });
    expect(typeof parsed.rows[0].gross).toBe('string');
  });

  it('nennt den Directory-Stand je Zeile', () => {
    expect(data().rows[0]).toMatchObject({ directoryStatus: 'listed', directoryTags: ['exchange'] });
    expect(data({ directory: new Map() }).rows[0]).toMatchObject({ directoryStatus: 'notChecked', directoryTags: [] });
  });

  it('nimmt beim Datumsbereich die Zeiten als Grenzen', () => {
    expect(data({ round: { id: 'range', fromISO: 'a', toISO: 'b' } }).meta).toMatchObject({ roundStart: { time: 'a', source: 'date_range' }, roundEnd: { time: 'b' } });
    expect(data({ round: { id: 'range', fromISO: 'a', toISO: '' } }).meta.roundEnd.time).toBe('open_end');
  });

  it('schreibt CSV mit BOM, Kopfdaten, Spalten und negativem Netto als Zahl', () => {
    const csv = groupfundExportToCsv(data());
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    const lines = csv.slice(1).split('\n');
    expect(lines[0]).toBe('network;PUBLIC');
    expect(lines).toContain('round_start_tx;starttx');
    expect(lines).toContain('round_start_source;manual');
    expect(lines).toContain('round_end_time;open_end');
    expect(lines).toContain('buffer_xlm;5.0000000');
    expect(lines).toContain('coverage_history_complete;false');
    expect(lines).toContain('sender;asset_code;asset_issuer;gross;refunds;net;unmarked_out;count;amount_unknown;tx_hashes;directory_status;directory_tags');
    expect(lines[lines.length - 1]).toBe(`${SENDER_A};USD;${ISSUER};10.0000000;12.5000000;-2.5000000;0.0000001;2;false;aa bb;listed;exchange`);
  });

  it.each([
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\t=1', "'\t=1"],
    ['\r=1', `"'\r=1"`],
    ['a;b', '"a;b"'],
  ])('entschaerft ein Memo %j', (memo, expected) => {
    const csv = groupfundExportToCsv(data({ identifier: { mode: 'memo', memo } }));
    expect(csv).toContain(`identifier;${expected}\n`);
  });

  it('laesst nur eigene Betragswerte ungeschuetzt, nicht aehnliche Memos mit Formel', () => {
    expect(groupfundExportToCsv(data({ identifier: { mode: 'memo', memo: '-1.0000000' } }))).toContain('identifier;-1.0000000\n');
    expect(groupfundExportToCsv(data({ identifier: { mode: 'memo', memo: '-1.0000000+1' } }))).toContain("identifier;'-1.0000000+1\n");
  });
});
