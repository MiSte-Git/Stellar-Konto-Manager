import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseBatchCsv } from '../../utils/batchPayment/batchCsvImport.js';
import { MAX_ROWS, normalizeAmount } from '../../utils/batchPayment/batchPaymentStore.js';

// Gleiche Eingabe (nicht das aufgeloeste Ziel): nur fuer den Hinweis in der Vorschau. Der Schutz gegen doppelte
// Zahlungen bleibt die Pruefung (Fingerprint nach Aufloesen), Review CI-11.
const dupKey = (row) => [row.source, row.dest, row.assetKey, normalizeAmount(row.amount) || row.amount, row.memoType, String(row.memoVal || '').trim()].join('|');

/**
 * CSV-Import fuer die Sammelzahlung: Datei waehlen, Vorschau mit Fehlerliste, dann an die Liste anhaengen oder sie
 * ersetzen. Nur lokale Pruefung; gesendet wird erst nach dem normalen Pruefen. Die Datei verlaesst den Browser nicht.
 * existingRows: nicht leere Zeilen der Liste. onApply(rows, mode) mit mode 'append' oder 'replace'. disabled sperrt
 * auch die Knoepfe einer offenen Vorschau (z. B. waehrend Pruefen, Review CI-9).
 */
export default function BatchCsvImport({ existingRows, disabled, onApply, btnCls, primaryBtnCls }) {
  const existingCount = existingRows.length;
  const { t } = useTranslation(['batchPayment']);
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setPreview({ name: file.name.slice(0, 80), result: parseBatchCsv(bytes) });
    } catch {
      setPreview({ name: file.name.slice(0, 80), result: { ok: false, error: { code: 'importReadFailed' } } });
    }
  };

  const errText = (code, params) => t(`batchPayment:errors.${code}`, params || {});
  const r = preview?.result;
  const validCount = r?.ok ? r.rows.length : 0;
  const appendCap = Math.max(0, MAX_ROWS - existingCount);
  const firstCut = (cap) => (r?.ok && r.rows.length > cap ? r.rows[cap].line : null);
  const duplicates = (() => {
    if (!r?.ok) return 0;
    const seen = new Set(existingRows.map(dupKey));
    let n = 0;
    for (const x of r.rows) {
      const k = dupKey(x.row);
      if (seen.has(k)) n += 1; else seen.add(k);
    }
    return n;
  })();
  const apply = (mode) => {
    if (disabled) return;
    const cap = mode === 'append' ? appendCap : MAX_ROWS;
    onApply(r.rows.slice(0, cap).map((x) => x.row), mode);
    setPreview(null);
  };

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} data-testid="batch-csv-input" />
      {!preview && (
        <button type="button" className={btnCls} onClick={() => inputRef.current?.click()} disabled={disabled} data-testid="batch-csv-open">
          {t('batchPayment:import.button')}
        </button>
      )}
      {preview && (
        <div className="space-y-2 rounded-sm border border-gray-300 p-3 text-sm dark:border-gray-600" data-testid="batch-csv-preview">
          <div className="font-semibold">{t('batchPayment:import.title', { name: preview.name })}</div>
          {!r.ok && (
            <div className="text-red-600" role="alert" data-testid="batch-csv-file-error">
              {errText(r.error.code, {
                line: r.error.line,
                columns: r.error.missing
                  ? r.error.missing.map((m) => t(`batchPayment:import.column.${m}`)).join(', ')
                  : (r.error.columns || []).join(', '),
              })}
            </div>
          )}
          {r.ok && (
            <>
              <div data-testid="batch-csv-summary">{t('batchPayment:import.summary', { valid: validCount, invalid: r.errors.length })}</div>
              {r.noAssetColumn && validCount > 0 && (
                <div className="text-xs font-semibold text-amber-700 dark:text-amber-300" data-testid="batch-csv-no-asset">{t('batchPayment:import.noAssetColumn')}</div>
              )}
              {duplicates > 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-300" data-testid="batch-csv-duplicates">{t('batchPayment:import.duplicates', { count: duplicates })}</div>
              )}
              {r.errors.length > 0 && (
                <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-xs text-red-600" data-testid="batch-csv-errors">
                  {r.errors.map((e) => <li key={`${e.line}-${e.code}`}>{t('batchPayment:import.lineError', { line: e.line, message: errText(e.code, { cells: e.cells, width: e.width }) })}</li>)}
                </ul>
              )}
              {validCount > appendCap && (
                <div className="text-xs text-amber-700 dark:text-amber-300" data-testid="batch-csv-cap">
                  {t('batchPayment:import.capHint', { max: MAX_ROWS, append: appendCap, appendLine: firstCut(appendCap) })}
                  {firstCut(MAX_ROWS) !== null && ` ${t('batchPayment:import.capHintReplace', { line: firstCut(MAX_ROWS) })}`}
                </div>
              )}
              <div className="text-xs text-gray-600 dark:text-gray-300">{t('batchPayment:import.checkHint')}</div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {r.ok && validCount > 0 && (
              <>
                <button type="button" className={primaryBtnCls} onClick={() => apply('append')} disabled={disabled || appendCap === 0} data-testid="batch-csv-append">
                  {t('batchPayment:import.append', { count: Math.min(validCount, appendCap) })}
                </button>
                <button type="button" className={btnCls} onClick={() => apply('replace')} disabled={disabled} data-testid="batch-csv-replace">
                  {t('batchPayment:import.replace', { count: Math.min(validCount, MAX_ROWS) })}
                </button>
              </>
            )}
            <button type="button" className={btnCls} onClick={() => setPreview(null)}>{t('batchPayment:import.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
