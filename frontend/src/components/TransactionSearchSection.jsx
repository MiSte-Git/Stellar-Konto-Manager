import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDateTime } from '../utils/datetime';
import { memoLooksLikeUrl, sanitizeMemo } from '../utils/stellar/activity.js';
import { UrlBadge } from './wallet/ActivityWarnings.jsx';
import {
  SEARCH_ABORT_MESSAGE, assetLabel, buildSearchFilters, searchOperations, sumByAsset,
} from '../utils/stellar/transactionSearch.js';

const MAX_SHOWN = 500;
const CSV_HEADERS = ['created_at', 'tx_hash', 'op_id', 'type', 'dir', 'from', 'to', 'amount', 'asset_code', 'asset_issuer', 'memo'];

// Memos stammen von Absendern: nur bereinigt als Text zeigen, Webadressen markieren.
function MemoCell({ memo }) {
  const shown = sanitizeMemo(memo);
  return (
    <div className="font-mono break-all">
      {shown || '–'}
      {memoLooksLikeUrl(shown) && <div><UrlBadge /></div>}
    </div>
  );
}

function csvRowOf(r) {
  const [code, issuer] = r.assetKey === 'native' ? ['XLM', ''] : r.assetKey.split(':');
  return {
    created_at: r.created_at, tx_hash: r.tx_hash, op_id: r.id, type: r.type, dir: r.dir,
    from: r.from, to: r.to, amount: r.amount, asset_code: r.amount ? code : '', asset_issuer: r.amount ? issuer : '', memo: r.memo,
  };
}

/**
 * Filtersuche ueber Ein- und Ausgaenge des Kontos im Zeitraum des Panels.
 * Panel liefert Zeitfenster, Lauf-Steuerung (Fortschritt, Abbruch, Sperre) und den CSV-Download.
 * Props:
 *  - getWindow(): { fromISO, toISO } im Panel gewaehlt (toISO exklusiv)
 *  - beginRun(): startet Fortschritt/Sperre und gibt das AbortSignal zurueck
 *  - endRun(): beendet den Lauf
 *  - onDownloadCsv(rows, headers)
 */
export default function TransactionSearchSection({ publicKey, server, getWindow, beginRun, endRun, busy, onDownloadCsv, onProgress }) {
  const { t } = useTranslation(['xlmByMemo', 'common']);
  const [memosText, setMemosText] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [amountAsset, setAmountAsset] = useState('native');
  const [assetCode, setAssetCode] = useState('');
  const [assetIssuer, setAssetIssuer] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [direction, setDirection] = useState('all');
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState([]);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState(null);

  const sums = useMemo(() => (result ? sumByAsset(result.rows) : []), [result]);

  const handleSearch = async () => {
    setFailed(false);
    const built = buildSearchFilters({ memosText, recipientsText, amountAsset, assetCode, assetIssuer, amountMin, amountMax, direction });
    if (!built.ok) {
      // Ein eingefuegter Secret Key wird sofort aus dem Feld entfernt, er soll nicht stehen bleiben.
      if (built.errors.some((e) => e.key === 'recipientSecretKey')) setRecipientsText('');
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    setResult(null);
    setRunning(true);
    const signal = beginRun();
    try {
      const { fromISO, toISO } = getWindow();
      const res = await searchOperations({
        server, accountId: publicKey, filters: built.filters, fromISO, toISO, signal, onProgress,
      });
      setResult(res);
    } catch (e) {
      if (e?.message !== SEARCH_ABORT_MESSAGE) setFailed(true);
    } finally {
      setRunning(false);
      endRun();
    }
  };

  const dirLabel = (d) => (d ? t(`xlmByMemo:search.dir.${d}`) : '');
  const shown = result ? result.rows.slice(0, MAX_SHOWN) : [];
  const inputCls = 'w-full border rounded-sm p-2';

  return (
    <section className="mt-6 pt-4 border-t" aria-labelledby="tx-search-title">
      <h4 id="tx-search-title" className="font-semibold">{t('xlmByMemo:search.title')}</h4>
      <p className="text-xs text-gray-500 mb-3">{t('xlmByMemo:search.intro')}</p>

      <label className="block text-sm mb-1" htmlFor="tx-search-memos">{t('xlmByMemo:search.memos.label')}</label>
      <textarea
        id="tx-search-memos" rows={2} className={`${inputCls} font-mono`} value={memosText}
        onChange={(e) => setMemosText(e.target.value)} disabled={busy}
      />
      <p className="text-xs text-gray-500 mb-3">{t('xlmByMemo:search.memos.hint')}</p>

      <label className="block text-sm mb-1" htmlFor="tx-search-recipients">{t('xlmByMemo:search.recipients.label')}</label>
      <textarea
        id="tx-search-recipients" rows={2} className={`${inputCls} font-mono`} value={recipientsText}
        onChange={(e) => setRecipientsText(e.target.value)} disabled={busy} spellCheck={false}
      />
      <p className="text-xs text-gray-500 mb-3">{t('xlmByMemo:search.recipients.hint')}</p>

      <div className="text-sm mb-1">{t('xlmByMemo:search.amount.title')}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs mb-1" htmlFor="tx-search-min">{t('xlmByMemo:search.amount.from')}</label>
          <input id="tx-search-min" className={inputCls} inputMode="decimal" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} disabled={busy} />
        </div>
        <div>
          <label className="block text-xs mb-1" htmlFor="tx-search-max">{t('xlmByMemo:search.amount.to')}</label>
          <input id="tx-search-max" className={inputCls} inputMode="decimal" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} disabled={busy} />
        </div>
      </div>
      <div className="mt-2">
        <label className="block text-xs mb-1" htmlFor="tx-search-asset">{t('xlmByMemo:search.amount.asset')}</label>
        <select id="tx-search-asset" className={inputCls} value={amountAsset} onChange={(e) => setAmountAsset(e.target.value)} disabled={busy}>
          <option value="native">{t('xlmByMemo:search.amount.native')}</option>
          <option value="custom">{t('xlmByMemo:search.amount.custom')}</option>
        </select>
      </div>
      {amountAsset === 'custom' && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs mb-1" htmlFor="tx-search-code">{t('xlmByMemo:search.amount.code')}</label>
            <input id="tx-search-code" className={inputCls} value={assetCode} onChange={(e) => setAssetCode(e.target.value)} disabled={busy} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs mb-1" htmlFor="tx-search-issuer">{t('xlmByMemo:search.amount.issuer')}</label>
            <input id="tx-search-issuer" className={`${inputCls} font-mono`} value={assetIssuer} onChange={(e) => setAssetIssuer(e.target.value)} disabled={busy} spellCheck={false} />
          </div>
        </div>
      )}
      <p className="text-xs text-gray-500 mb-3">{t('xlmByMemo:search.amount.hint')}</p>

      <label className="block text-sm mb-1" htmlFor="tx-search-direction">{t('xlmByMemo:search.direction.label')}</label>
      <select id="tx-search-direction" className={inputCls} value={direction} onChange={(e) => setDirection(e.target.value)} disabled={busy}>
        <option value="all">{t('xlmByMemo:search.direction.all')}</option>
        <option value="in">{t('xlmByMemo:search.direction.in')}</option>
        <option value="out">{t('xlmByMemo:search.direction.out')}</option>
      </select>
      <p className="text-xs text-gray-500">{t('xlmByMemo:search.direction.hint')}</p>

      {errors.length > 0 && (
        <ul className="mt-3 text-red-600 text-sm list-disc pl-5" role="alert">
          {errors.map((e, i) => <li key={i}>{t(`xlmByMemo:search.errors.${e.key}`, e.params)}</li>)}
        </ul>
      )}

      <button
        className="mt-4 px-4 py-2 rounded-sm bg-blue-600 text-white disabled:opacity-50"
        onClick={handleSearch}
        disabled={busy}
      >
        {running ? t('xlmByMemo:search.searching') : t('xlmByMemo:search.button')}
      </button>

      {failed && <div className="mt-3 text-red-600" role="alert">{t('xlmByMemo:search.failed')}</div>}

      {result && (
        <div className="mt-4 border rounded-sm p-2">
          <div className="text-sm font-medium mb-1">{t('xlmByMemo:search.result.title', { count: result.rows.length })}</div>
          {result.incomplete && (
            <div className="text-xs text-amber-500 mb-2" role="status">
              {t('xlmByMemo:search.result.incomplete', { date: result.oldestLoaded ? formatLocalDateTime(result.oldestLoaded) : '–' })}
            </div>
          )}
          {result.memoIncomplete && (
            <div className="text-xs text-amber-500 mb-2" role="status">{t('xlmByMemo:search.result.memoIncomplete')}</div>
          )}
          {result.rows.length === 0 ? (
            <div className="text-sm text-gray-500">{t('xlmByMemo:search.result.none')}</div>
          ) : (
            <>
              {sums.length > 0 && (
                <div className="text-xs mb-2">
                  <span className="font-semibold">{t('xlmByMemo:search.result.sums')} </span>
                  {sums.map((s) => (
                    <span key={s.assetKey} className="inline-block mr-3">
                      {t('xlmByMemo:search.result.sumLine', { amount: s.amount, asset: s.label, count: s.count })}
                    </span>
                  ))}
                </div>
              )}
              <div className="overflow-auto max-h-96 text-xs">
                <div className="grid grid-cols-6 gap-2 font-semibold sticky top-0 bg-gray z-10 py-1">
                  <div>{t('xlmByMemo:search.columns.created_at')}</div>
                  <div>{t('xlmByMemo:search.columns.from')}</div>
                  <div>{t('xlmByMemo:search.columns.to')}</div>
                  <div>{t('xlmByMemo:search.columns.amount')}</div>
                  <div>{t('xlmByMemo:search.columns.memo')}</div>
                  <div>{t('xlmByMemo:search.columns.tx_hash')}</div>
                </div>
                {shown.map((r, i) => (
                  <div key={`${r.id}-${i}`} className="grid grid-cols-6 gap-2 py-0.5">
                    <div>
                      <div className="font-mono">{r.created_at}</div>
                      <div className="text-gray-500">{[dirLabel(r.dir), r.type].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="font-mono break-all">{r.from}</div>
                    <div className="font-mono break-all">{r.to}</div>
                    <div className="font-mono">{r.amount ? `${r.amount} ${assetLabel(r.assetKey)}` : '–'}</div>
                    <MemoCell memo={r.memo} />
                    <div className="font-mono break-all">{r.tx_hash}</div>
                  </div>
                ))}
              </div>
              {result.rows.length > MAX_SHOWN && (
                <div className="text-xs text-gray-500 mt-1">{t('xlmByMemo:search.result.capped', { shown: MAX_SHOWN, total: result.rows.length })}</div>
              )}
              <div className="mt-2">
                <button
                  className="px-2 py-1 text-sm rounded-sm border bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-50"
                  onClick={() => onDownloadCsv(result.rows.map(csvRowOf), CSV_HEADERS)}
                  disabled={busy}
                >
                  {t('xlmByMemo:search.result.csv')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
