// Export der Groupfund-Ansicht. Betraege als String mit 7 Nachkommastellen, nie als Float.
// Die Feldnamen sind ein stabiles Datenformat und werden nicht uebersetzt.
import { csvEscape } from '../csvEscape.js';
import { fromStroops } from './liquidityPools.js';

const CSV_DELIMITER = ';';
const AMOUNT_RE = /^-?\d+\.\d{7}$/;

const HISTORY_START = 'history_start';
const OPEN_END = 'open_end';
const DATE_RANGE = 'date_range';

// Explizite Werte statt leerer Felder: Leer waere nicht von "fehlt" zu unterscheiden.
function roundStartOf(round) {
  if (round?.id === 'range') return { txHash: DATE_RANGE, time: round.fromISO || HISTORY_START, source: DATE_RANGE };
  if (!round?.start) return { txHash: HISTORY_START, time: HISTORY_START, source: HISTORY_START };
  return { txHash: round.start.txHash, time: round.start.createdAt, source: round.start.source };
}

function roundEndOf(round) {
  if (round?.id === 'range') return { txHash: DATE_RANGE, time: round.toISO || OPEN_END, source: DATE_RANGE };
  if (!round?.end) return { txHash: OPEN_END, time: OPEN_END, source: OPEN_END };
  return { txHash: round.end.txHash, time: round.end.createdAt, source: round.end.source };
}

/**
 * Exportdaten einer Runde. JSON ist das massgebliche Format fuer die Weiterverarbeitung.
 * @param {{ network: string, accountId: string, identifier: {mode:string,id?:string,memo?:string},
 *   round: object, rows: object[], directory: Map<string, object>, bufferStroops: bigint,
 *   coverage: { complete: boolean, coveredAt: string, scannedAt: string }, generatedAt: string }} input
 */
export function buildGroupfundExport({ network, accountId, identifier, round, rows, directory, bufferStroops, coverage, generatedAt }) {
  const list = rows || [];
  return {
    meta: {
      network,
      account: accountId,
      identifierMode: identifier?.mode || '',
      identifier: identifier?.mode === 'memo' ? (identifier.memo || '') : (identifier?.id || ''),
      roundStart: roundStartOf(round),
      roundEnd: roundEndOf(round),
      bufferXlm: fromStroops(bufferStroops ?? 0n),
      coverage: {
        historyComplete: !!coverage?.complete,
        coveredAt: coverage?.complete ? HISTORY_START : (coverage?.coveredAt || ''),
        scannedAt: coverage?.scannedAt || '',
      },
      amountUnknown: list.some((row) => row.amountUnknown),
      boundaryHasIncoming: !!(round?.start?.hasIncoming || round?.end?.hasIncoming),
      generatedAt,
    },
    rows: list.map((row) => {
      const entry = directory?.get(row.sender);
      return {
        sender: row.sender,
        assetCode: row.asset.code,
        assetIssuer: row.asset.issuer,
        gross: fromStroops(row.gross),
        refunds: fromStroops(row.refunds),
        net: fromStroops(row.net),
        unmarkedOut: fromStroops(row.unmarkedOut),
        count: row.count,
        amountUnknown: !!row.amountUnknown,
        txHashes: row.txHashes,
        directoryStatus: entry?.status || 'notChecked',
        directoryTags: entry?.tags || [],
      };
    }),
  };
}

export function groupfundExportToJson(data) {
  return JSON.stringify(data, null, 2);
}

// Betraege stammen aus fromStroops. Ein negatives Netto bleibt eine Zahl; csvEscape
// wuerde es mit ' als Text markieren, und dieses Format kann keine Formel enthalten.
function cell(value) {
  const text = String(value ?? '');
  return AMOUNT_RE.test(text) ? text : csvEscape(text, CSV_DELIMITER);
}

const COLUMNS = ['sender', 'asset_code', 'asset_issuer', 'gross', 'refunds', 'net', 'unmarked_out', 'count', 'amount_unknown', 'tx_hashes', 'directory_status', 'directory_tags'];

export function groupfundExportToCsv({ meta, rows }) {
  const header = [
    ['network', meta.network],
    ['account', meta.account],
    ['identifier_mode', meta.identifierMode],
    ['identifier', meta.identifier],
    ['round_start_tx', meta.roundStart.txHash],
    ['round_start_time', meta.roundStart.time],
    ['round_start_source', meta.roundStart.source],
    ['round_end_tx', meta.roundEnd.txHash],
    ['round_end_time', meta.roundEnd.time],
    ['round_end_source', meta.roundEnd.source],
    ['buffer_xlm', meta.bufferXlm],
    ['coverage_history_complete', meta.coverage.historyComplete],
    ['coverage_covered_at', meta.coverage.coveredAt],
    ['scanned_at', meta.coverage.scannedAt],
    ['amount_unknown', meta.amountUnknown],
    ['boundary_has_incoming', meta.boundaryHasIncoming],
    ['generated_at', meta.generatedAt],
  ];
  const lines = header.map((pair) => pair.map(cell).join(CSV_DELIMITER));
  lines.push('', COLUMNS.join(CSV_DELIMITER));
  rows.forEach((row) => {
    lines.push([
      row.sender, row.assetCode, row.assetIssuer, row.gross, row.refunds, row.net, row.unmarkedOut,
      row.count, row.amountUnknown, row.txHashes.join(' '), row.directoryStatus, row.directoryTags.join(' '),
    ].map(cell).join(CSV_DELIMITER));
  });
  return '\uFEFF' + lines.join('\n'); // BOM fuer Excel
}

export function downloadTextFile(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
