// SKM_VER:XlmByMemoPanel.jsx@2026-11-12
import React, { useState, useEffect, useRef, useCallback } from "react";
import { NETWORKS } from '../config/networks.js';
import { useTranslation } from "react-i18next";
import { getHorizonServer } from "../utils/stellar/stellarUtils";
import ProgressBar from "../components/ProgressBar.jsx";
import { formatElapsedMmSs } from '../utils/datetime';
import { buildDefaultFilename } from '../utils/filename';
import { csvLine } from '../utils/csvEscape.js';
import { withRetry } from "../utils/stellar/queryUtils";
import { loadOperations } from '../utils/stellar/transactionSearch.js';
import TransactionSearchSection from './TransactionSearchSection.jsx';

// Lokales Datum (YYYY-MM-DD) und lokale Uhrzeit (HH:MM oder HH:MM:SS, immer 24 Stunden).
// toISOString liefert das UTC-Datum und toLocaleTimeString je nach Sprache 12 Stunden mit
// AM/PM: Beides passte nicht zur Zeitzone local und schnitt nach Mitternacht (Ortszeit) die
// jüngsten Zahlungen aus dem Standard-Zeitraum.
const pad2 = (n) => String(n).padStart(2, '0');
function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function localTimeStr(d, withSeconds = false) {
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return withSeconds ? `${hm}:${pad2(d.getSeconds())}` : hm;
}

const ABORT_MESSAGE = 'submitTransaction.failed:cache.backfill.aborted';
const isAbortError = (e) => e?.message === ABORT_MESSAGE;


/**
 * Transaktionen durchsuchen: Zeitraum waehlen, die Operationen des geladenen Kontos einmal laden
 * und danach in TransactionSearchSection filtern. Ein Kontowechsel verwirft die geladene Liste.
 * Der Export aller Operationen (CSV) laeuft unabhaengig davon direkt gegen Horizon.
 */
export default function XlmByMemoPanel({ publicKey, horizonUrl = NETWORKS.PUBLIC.horizonUrl }) {
  const { t } = useTranslation(['xlmByMemo', 'common']);
  // Datum + Zeit getrennt, damit wir sauber TZ anwenden koennen
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState(() => localTimeStr(new Date()));
  // Zeitzone: 'local' | 'utc' | 'cst' | 'cdt' | 'europe_zurich'
  const [tz, setTz] = useState("local");

  const [isLoading, setIsLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [errorKey, setErrorKey] = useState("");
  const [loaded, setLoaded] = useState(null);
  const ROLE = { FROM: 'from', TO: 'to' };
  const [prog, setProg] = useState({ progress: null, phase: 'idle', page: 0, etaMs: 0 });
  const abortRef = useRef(null);
  const heartbeatRef = useRef(null);
  const startedAtRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Horizon-Server (Projektvorgabe: immer Horizon)
  const server = getHorizonServer(horizonUrl);

  useEffect(() => {
    // Sekuendlicher Heartbeat, solange wir "aktiv" sind
    if (prog.phase !== 'idle' && prog.phase !== 'finalize') {
      if (!heartbeatRef.current) {
        heartbeatRef.current = setInterval(() => {
          setProg(p => {
            if (p.phase === 'idle' || p.phase === 'finalize') return p;
            const elapsed = Date.now() - (startedAtRef.current || Date.now());
            const total = (p.etaMs || 0) + elapsed;
            const soft = total > 0 ? Math.min(0.98, elapsed / total) : p.progress ?? 0;
            return { ...p, progress: Number.isFinite(soft) ? soft : p.progress };
          });
          setElapsedMs(Date.now() - (startedAtRef.current || Date.now()));
        }, 1000);
      }
    } else if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    return () => { if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; } };
  }, [prog.phase]);

  // Standard-Zeitraum: gestern bis heute
  useEffect(() => {
    const now = new Date();
    setFromDate(localDateStr(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
    setToDate(localDateStr(now));
  }, []);

  // Kontowechsel: laufende Abfrage abbrechen und die geladene Liste verwerfen
  const firstAccountRef = useRef(publicKey);
  useEffect(() => {
    if (firstAccountRef.current === publicKey) return;
    firstAccountRef.current = publicKey;
    try { abortRef.current?.abort(); } catch { void 0; }
    setLoaded(null);
    setErrorKey('');
    setIsLoading(false);
    setExportLoading(false);
    setProg({ progress: null, phase: 'idle', page: 0, etaMs: 0 });
  }, [publicKey]);

  /**
   * Konvertiert Date+Time + gewählte TZ in eine UTC-ISO-Zeit (String).
   * - Ohne externe Libs; TZ erfolgt über festen Offset.
   * - CST = UTC-6, CDT = UTC-5, UTC = 0, Local = Browser-Offset.
   */
  function toUTCISO(dateStr, timeStr, tzMode, role /* 'from' | 'to' */) {
    if (!dateStr) return undefined;

    let t = timeStr || (role === 'from' ? '00:00:00' : '23:59:59');
    if (/^\d{2}:\d{2}$/.test(t)) t = `${t}:00`;

    const [hh, mm, ss] = t.split(':').map((x) => parseInt(x, 10));
    const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));

    if (tzMode === 'local') {
      const local = new Date(y, m - 1, d, hh, mm, ss || 0);
      return local.toISOString();
    }

    const asUTCms = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
    let offsetMin = 0;
    if (tzMode === 'utc') {
      offsetMin = 0;
    } else if (tzMode === 'cst') {
      offsetMin = -6 * 60;
    } else if (tzMode === 'cdt') {
      offsetMin = -5 * 60;
    } else if (tzMode === 'europe_zurich') {
      function lastSunday(year, monthIndex) {
        const last = new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0));
        const day = last.getUTCDay();
        const diff = day; // days since Sunday
        return new Date(Date.UTC(year, monthIndex + 1, 0 - diff, 0, 0, 0));
      }
      const lsMar = lastSunday(y, 2);   // March
      const lsOct = lastSunday(y, 9);   // October
      const dstStartUTC = new Date(lsMar.getTime() + 1 * 60 * 60 * 1000); // 01:00Z
      const dstEndUTC   = new Date(lsOct.getTime() + 1 * 60 * 60 * 1000); // 01:00Z
      // Assume CET (+1h) first to map wall-time to a UTC guess for boundary comparison
      const guessUTCfromCET = new Date(asUTCms - 60 * 60 * 1000);
      const inDST = (guessUTCfromCET >= dstStartUTC) && (guessUTCfromCET < dstEndUTC);
      offsetMin = inDST ? +120 : +60;
    }

    return new Date(asUTCms - offsetMin * 60 * 1000).toISOString();
  }

  /** Lokale Jetzt-Werte für <input type="date"> und <input type="time"> */
  function nowDateForInput() {
    return localDateStr(new Date());
  }
  function nowTimeForInput() {
    return localTimeStr(new Date(), true);
  }

  /**
   * Setzt das "bis"-Feld auf die aktuelle lokale DAtum und Zeit.
   */
  function handleSetToNow() {
    setToDate(nowDateForInput());
    setToTime(nowTimeForInput());
  }

  /** +1 Sekunde, um obere Grenze exklusiv zu machen */
  function plus1sIso(iso) {
    return new Date(new Date(iso).getTime() + 1000).toISOString();
  }

  const onProgress = useCallback((info = {}) => { setProg((p) => ({ ...p, ...info })); }, []);

  const windowIso = () => {
    const fromISO = toUTCISO(fromDate, fromTime, tz, ROLE.FROM);
    const toISOExc = toDate ? plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO)) : undefined;
    return { fromISO, toISOExc };
  };
  const estimateEtaMs = (fromISO, toISOExc) => {
    const windowMs = Math.max(0, (toISOExc ? new Date(toISOExc) : new Date()) - (fromISO ? new Date(fromISO) : new Date(0)));
    return Math.min(180000, Math.max(15000, Math.floor(windowMs / 20)));
  };

  /** Laedt die Operationen des Kontos im Zeitraum einmal; gefiltert wird danach im Browser. */
  const handleLoad = async () => {
    setIsLoading(true);
    setErrorKey('');
    setLoaded(null);
    try {
      abortRef.current = new AbortController();
      startedAtRef.current = Date.now();
      const { fromISO, toISOExc } = windowIso();
      setProg({ phase: 'scan', progress: 0, etaMs: estimateEtaMs(fromISO, toISOExc), page: 0 });
      const res = await loadOperations({
        server, accountId: publicKey, fromISO, toISO: toISOExc, onProgress, signal: abortRef.current.signal,
      });
      setLoaded(res);
    } catch (e) {
      // Abbruch durch den Nutzer ist kein Fehler
      setErrorKey(isAbortError(e) ? '' : 'xlmByMemo:load.failed');
    } finally {
      setIsLoading(false);
      setProg((p) => ({ ...p, phase: 'finalize', progress: 1, etaMs: 0 }));
    }
  };

  // CSV Builder & Download
  function toCsv(rows, headersOpt) {
    const headers = (headersOpt && headersOpt.length)
      ? headersOpt
      : ['created_at','tx_hash','from','to','amount','asset_type','memo'];
    // Memos bestimmt der Absender: csvLine schuetzt gegen Formeln (=, +, -, @) und kaputte Zellen.
    const lines = [csvLine(headers, ';')];
    for (const r of rows) lines.push(csvLine(headers.map((h) => r[h]), ';'));
    return '\uFEFF' + lines.join('\n'); // BOM für Excel
  }
  function downloadCsv(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const click = () => {
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
    if (document.readyState === 'complete') {
      click();
    } else {
      window.requestAnimationFrame(click);
    }
  }

  // Export: Alle eingehenden nativen Payments im Zeitraum (inkl. memo) mit robustem Nachladen
  const handleExportCsv = useCallback(async () => {
    setExportLoading(true);
    try {
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;
      const fromISO = toUTCISO(fromDate, fromTime, tz, ROLE.FROM);
      const toISOExc = plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO));

      // Fortschritt initialisieren
      startedAtRef.current = Date.now();
      const windowMs = Math.max(0, new Date(toISOExc) - new Date(fromISO));
      const etaMs = Math.min(180000, Math.max(15000, Math.floor(windowMs / 20)));
      setProg(p => ({ ...p, phase: 'export', progress: 0, etaMs, page: 0 }));

      // Ungefilterter Export: alle Operations für den Account im Zeitraum
      let page = await withRetry(() => server
        .operations()
        .forAccount(publicKey)
        .order('desc')
        .limit(200)
        .call());

      const rows = [];
      const pending = []; // fehlende Memos ggf. nachladen
      let stop = false;
      let pages = 0;

      const headers = [
        'created_at','tx_hash','op_id','type','dir','source','from','to','amount','asset_type','asset_code','asset_issuer','starting_balance','account','funder','into','claimable_balance_id','memo','memo_source'
      ];

      while (!stop) {
        if (signal.aborted) throw new Error(ABORT_MESSAGE);
        const recs = page?.records || [];
        for (const r of recs) {
          const created = r.created_at || r?.transaction?.created_at || '';
          if (toISOExc && created >= toISOExc) continue;   // obere Grenze exklusiv
          if (fromISO && created < fromISO) { stop = true; break; }

          const memoTx = r?.transaction?.memo;
          const memoOp = r?.memo;
          const memoRaw = String((memoTx != null ? memoTx : (memoOp != null ? memoOp : '')));
          const memo_source = memoTx != null ? 'tx' : (memoOp != null ? 'op' : '');

          // Richtung heuristisch bestimmen (bezogen auf publicKey)
          let dir = '';
          const t = String(r.type || '');
          if ((t === 'payment' || t.startsWith('path_payment')) && (r.from || r.to)) {
            if (r.to === publicKey) dir = 'in';
            else if (r.from === publicKey) dir = 'out';
          } else if (t === 'create_account') {
            if (r.account === publicKey) dir = 'in';
            else if (r.funder === publicKey) dir = 'out';
          } else if (t === 'account_merge') {
            if (r.into === publicKey) dir = 'in';
            else if (r.account === publicKey) dir = 'out';
          } else if (t === 'claim_claimable_balance') {
            if ((r.account || r.claimant) === publicKey) dir = 'in';
          } else if (t === 'change_trust' || t === 'set_options' || t === 'manage_data') {
            dir = 'self';
          }



          const row = {
            created_at: r.created_at,
            tx_hash: r.transaction_hash || '',
            op_id: r.id || '',
            type: t,
            dir,
            source: r.source_account || '',
            from: r.from || r.sponsor || '',
            to: r.to || r.into || r.account || '',
            amount: r.amount || r.starting_balance || r.buy_amount || r.sell_amount || '',
            asset_type: r.asset_type || r.buying_asset_type || r.selling_asset_type || '',
            asset_code: r.asset_code || r.buying_asset_code || r.selling_asset_code || '',
            asset_issuer: r.asset_issuer || r.buying_asset_issuer || r.selling_asset_issuer || '',
            starting_balance: r.starting_balance || '',
            account: r.account || '',
            funder: r.funder || '',
            into: r.into || '',
            claimable_balance_id: r.balance_id || r.claimable_balance_id || '',
            memo: memoRaw,
            memo_source,
          };

          const rowIndex = rows.length;
          rows.push(row);
          if (!memoRaw && r.transaction_hash) {
            pending.push({ tx_hash: r.transaction_hash, rowIndex });
          }
        }
        if (stop || !page.next) break;
        pages += 1;
        if (pages % 5 === 0) setProg(p => ({ ...p, phase: 'export', page: pages }));
        page = await withRetry(() => page.next());
      }

      // Fehlende Memos nachladen: effizient über /transactions Feed innerhalb des Fensters
      if (pending.length) {
        const need = new Set(pending.map(p => p.tx_hash).filter(Boolean));
        const byHash = new Map(); // tx_hash -> array of rowIndex
        for (const p of pending) {
          if (!p.tx_hash) continue;
          if (!byHash.has(p.tx_hash)) byHash.set(p.tx_hash, []);
          byHash.get(p.tx_hash).push(p.rowIndex);
        }
        let pageTx = await withRetry(() => server
          .transactions()
          .forAccount(publicKey)
          .order('desc')
          .limit(200)
          .call());
        let stopTx = false;
        while (!stopTx && need.size > 0) {
          if (signal.aborted) throw new Error(ABORT_MESSAGE);
          const trecs = pageTx?.records || [];
          for (const tr of trecs) {
            const created = tr.created_at || '';
            if (toISOExc && created >= toISOExc) continue;
            if (fromISO && created < fromISO) { stopTx = true; break; }
            const h = tr.hash;
            if (need.has(h)) {
              const m = tr?.memo != null ? String(tr.memo) : '';
              if (byHash.has(h)) {
                for (const rowIndex of byHash.get(h)) rows[rowIndex].memo = m;
              }
              need.delete(h);
            }
          }
          if (stopTx || !pageTx.next) break;
          pageTx = await withRetry(() => pageTx.next());
        }
      }

      const csv = toCsv(rows, headers);
      const fn = buildDefaultFilename({ publicKey, menuLabel: t('xlmByMemo:title'), ext: 'csv' });
      downloadCsv(fn, csv);

      setProg(p => ({ ...p, phase: 'finalize', progress: 1, etaMs: 0 }));
    } catch (e) {
      setErrorKey(isAbortError(e) ? '' : 'exportCsv.failed');
      setProg(p => ({ ...p, phase: 'finalize', progress: 1, etaMs: 0 }));
    } finally {
      setExportLoading(false);
    }
  }, [fromDate, fromTime, toDate, toTime, tz, publicKey, server, ROLE.FROM, ROLE.TO, t]);

  // Bricht laufende Requests ab und beendet die UI sauber.
  const handleCancel = () => {
    try { abortRef.current?.abort(); } catch { void 0; }
    setIsLoading(false);
    setExportLoading(false);
    setProg((p) => ({ ...p, phase: 'finalize', progress: 1, etaMs: 0 }));
    startedAtRef.current = 0;
  };

  const downloadSearchCsv = (rows, headers) => {
    const fn = buildDefaultFilename({ publicKey, menuLabel: t('xlmByMemo:title'), ext: 'csv' });
    downloadCsv(fn, toCsv(rows, headers));
  };

  // Laden und Export schliessen sich gegenseitig aus (gemeinsame Fortschrittsanzeige und Abbruch).
  const isBusy = isLoading || exportLoading;
  const running = prog.phase !== 'idle' && prog.phase !== 'finalize';
  const rangeText = `${fromDate || '…'} ${fromTime} – ${toDate || '…'} ${toTime} · ${t(`xlmByMemo:tz.${tz}`)}`;

  return (
    <div className="p-4 rounded-xl border">
      <div className="flex flex-wrap items-start gap-2">
        <details className="flex-1 min-w-[16rem] border rounded-sm">
          <summary className="cursor-pointer p-2 text-sm">
            <span className="text-gray-500">{t('xlmByMemo:window.label')} </span>{rangeText}
          </summary>
          <div className="p-3 border-t">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">{t("xlmByMemo:date.from")}</label>
                <input type="date" className="w-full border rounded-sm p-2" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                <input type="time" step="1" className="mt-2 w-full border rounded-sm p-2" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1">{t("xlmByMemo:date.to")}</label>
                <input type="date" className="w-full border rounded-sm p-2" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                <input type="time" step="1" className="mt-2 w-full border rounded-sm p-2" value={toTime} onChange={(e) => setToTime(e.target.value)} />
                <div className="text-right">
                  <button
                    type="button"
                    onClick={handleSetToNow}
                    className="px-2 py-1 text-sm rounded-sm border bg-gray-600 hover:bg-gray-500 mt-1"
                    title={t('xlmByMemo:time.setToNowHint')}
                  >
                    {t('xlmByMemo:time.setToNow')}
                  </button>
                </div>
              </div>
            </div>
            <label className="block text-sm mt-3 mb-1" htmlFor="xlm-tz">{t("xlmByMemo:tz.label")}</label>
            <select id="xlm-tz" className="w-full border rounded-sm p-2" value={tz} onChange={(e) => setTz(e.target.value)}>
              <option value="cst">{t("xlmByMemo:tz.cst")}</option>
              <option value="cdt">{t("xlmByMemo:tz.cdt")}</option>
              <option value="utc">{t("xlmByMemo:tz.utc")}</option>
              <option value="europe_zurich">{t("xlmByMemo:tz.europe_zurich")}</option>
              <option value="local">{t("xlmByMemo:tz.local")}</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">{t("xlmByMemo:tz.note")}</p>
            <div className="mt-1 text-xs text-gray-500">
              {t('xlmByMemo:tz.window', {
                from: fromDate ? toUTCISO(fromDate, fromTime, tz, ROLE.FROM) : '—',
                to: toDate ? plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO)) : '—',
              })}
            </div>
          </div>
        </details>
        <button
          className="px-4 py-2 rounded-sm bg-blue-600 text-white disabled:opacity-50"
          onClick={handleLoad}
          disabled={isBusy}
        >
          {isLoading ? t('xlmByMemo:load.loading') : (loaded ? t('xlmByMemo:load.reload') : t('xlmByMemo:load.button'))}
        </button>
        <button onClick={handleExportCsv} className="btn btn-secondary disabled:opacity-50" disabled={isBusy}>
          {t('xlmByMemo:export.csvAll')}
        </button>
      </div>

      {running && (
        <div className="mt-3 max-w-sm">
          <ProgressBar {...prog} />
          <div className="text-xs text-gray-500 mt-1">
            {t('common:progress.elapsed', { time: formatElapsedMmSs(elapsedMs) })}
          </div>
          <button className="text-sm px-2 py-1 rounded-sm bg-gray-500 text-white mt-2" onClick={handleCancel}>
            {t('common:progress.cancel')}
          </button>
        </div>
      )}

      {loaded ? (
        <TransactionSearchSection
          rows={loaded.rows}
          incomplete={loaded.incomplete}
          memoIncomplete={loaded.memoIncomplete}
          oldestLoaded={loaded.oldestLoaded}
          busy={isBusy}
          onDownloadCsv={downloadSearchCsv}
        />
      ) : (
        !running && <p className="mt-4 text-sm text-gray-500">{t('xlmByMemo:load.hint')}</p>
      )}

      {errorKey && <div className="mt-3 text-red-600" role="alert">{t(errorKey)}</div>}
    </div>
  );
}
