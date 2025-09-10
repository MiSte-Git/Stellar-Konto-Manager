// STM_VER:XlmByMemoPanel.jsx@2025-09-10
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getHorizonServer, sumIncomingXLMByMemo } from "../utils/stellar/stellarUtils";
import ProgressBar from "../components/ProgressBar.jsx";
import { formatLocalDateTime, formatElapsedMmSs } from '../utils/datetime';
import { ensureCoverage, refreshSinceCursor, initCursorIfMissing } from "../utils/stellar/syncUtils";
import { diagnoseIncomingByMemoNoCache, sumIncomingXLMByMemoNoCacheExact } from "../utils/stellar/queryUtils";
import { useSettings } from '../utils/useSettings';
import { getNewestCreatedAt, rehydrateEmptyMemos, backfillMemoNorm } from '../utils/db/indexedDbClient';


/**
 * Panel: Eingabe für Memo + optionales Zeitfenster und Anzeige der XLM-Summe.
 * - Alle sichtbaren Texte via t()
 * - Errors werden als i18n-Key angezeigt
 */
export default function XlmByMemoPanel({ publicKey, horizonUrl = "https://horizon.stellar.org" , onBack }) {
  const { t } = useTranslation();
  const [memoQuery, setMemoQuery] = useState("");
  // Datum + Zeit getrennt, damit wir sauber TZ anwenden können
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState(() => {
    const now = new Date();
    // Formatieren in HH:MM (lokale Zeit)
    return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });
  // Zeitzone: 'local' | 'utc' | 'cst' | 'cdt'
  const [tz, setTz] = useState("local");
  const [isLoading, setIsLoading] = useState(false);
  const [, setResult] = useState(null);
  const [errorKey, setErrorKey] = useState("");
  const ROLE = { FROM: 'from', TO: 'to' };
  const [prog, setProg] = useState({ progress: null, phase: 'idle', page: 0, etaMs: 0, oldest: '' });
  const abortRef = useRef(null);
  const heartbeatRef = useRef(null);
  const startedAtRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [resultAmount, setResultAmount] = useState(null);
  const { useCache, prefetchDays } = useSettings();
  const [lastPaymentISO, setLastPaymentISO] = useState(null);


  // Horizon-Server (Projektvorgabe: immer Horizon)
  const server = getHorizonServer(horizonUrl);

  useEffect(() => {
    // Sekündlicher Heartbeat, solange wir "aktiv" sind
    if (prog.phase !== 'idle' && prog.phase !== 'finalize') {
      if (!heartbeatRef.current) {
        heartbeatRef.current = setInterval(() => {
          setProg(p => {
            if (p.phase === 'idle' || p.phase === 'finalize') return p;
            // „weiche“ Fortschrittsbewegung anhand ETA
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

  // Setze Default-Zeitraum: gestern → heute
  useEffect(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setFromDate(yesterday);
    setToDate(today);
  }, []);

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
      // Wichtig: als *lokale* Zeit dieses Datums erzeugen (berücksichtigt DST korrekt)
      const local = new Date(y, m - 1, d, hh, mm, ss || 0);
      return local.toISOString(); // => UTC-ISO
    }

    // Für feste Offsets (UTC/CST/CDT) von einer "UTC-Schablone" aus rechnen
    const asUTCms = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
    let offsetMin = 0;
    if (tzMode === 'utc') offsetMin = 0;
    else if (tzMode === 'cst') offsetMin = -6 * 60; // UTC-6
    else if (tzMode === 'cdt') offsetMin = -5 * 60; // UTC-5

    // Eingabe war "in tzMode" → UTC = Eingabe - Offset
    return new Date(asUTCms - offsetMin * 60 * 1000).toISOString();
  }

  /** Lokale Jetzt-Werte für <input type="date"> und <input type="time"> */
  function nowDateForInput() {
    return new Date().toISOString().slice(0, 10); // konsistent zu deinem Default
  }
  function nowTimeForInput() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /**
   * Setzt das "bis"-Feld auf die aktuelle lokale DAtum und Zeit.
   */
  function handleSetToNow() {
    setToDate(nowDateForInput());
    setToTime(nowTimeForInput());
  }

    /** Baut UTC-ISO aus lokaler Eingabe "YYYY-MM-DD" + "HH:mm:ss" */
  function toUtcIso(dateStr, timeStr) {
    const [y,m,d] = dateStr.split('-').map(Number);
    const [hh,mm,ss] = (timeStr || '00:00:00').split(':').map(Number);
    const dt = new Date(Date.UTC(y, (m-1), d, hh, mm, ss || 0));
    return dt.toISOString(); // ...Z
  }
  /** +1 Sekunde, um obere Grenze exklusiv zu machen */
  function plus1sIso(iso) {
    return new Date(new Date(iso).getTime() + 1000).toISOString();
  }

  // Vereinheitlicht Progress-Updates und merged nested Felder korrekt.
  const onProgress = useCallback((info = {}) => {
    setProg((p) => ({
      ...p,
      ...info,
      incomingOverview: {
        ...(p.incomingOverview || {}),
        ...(info.incomingOverview || {}),
      },
    }));
  }, []);

  /**
   * Startet die Summierung mit optionalem Datum-Filter.
   */
  const handleCalculate = async () => {
  setIsLoading(true);
  setErrorKey("");
  setResult(null);
  setResultAmount(0);        // ← hier Betrag auf 0 setzen
  setLastPaymentISO(null);   // optional: „Letzte Zahlung“ zurücksetzen

  console.log('[STM]', 'XlmByMemoPanel.jsx@2025-09-10');

  try {
    abortRef.current = new AbortController();
    startedAtRef.current = Date.now();

    // 1) Einheitliche Zeitgrenzen (UTC, obere Grenze exklusiv)
    const fromISO = toUTCISO(fromDate, fromTime, tz, ROLE.FROM);
    const toISOExc = plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO));
    // Optional: nur manuell aktivieren, sonst SLOW
    // if (import.meta.env.DEV && false) { /* Diagnose deaktiviert */ }
    const windowMs = Math.max(0, new Date(toISOExc) - new Date(fromISO));
    const etaMs = Math.min(180000, Math.max(15000, Math.floor(windowMs / 20)));
    setProg(p => ({ ...p, phase: 'scan', progress: 0, etaMs, page: 0 }));
    const rangeInfo = { fromISO, toISO: toISOExc, memo: memoQuery };

    // 2) Summierung je nach Modus
    // Immer Live: schnell und korrekt über Horizon
    const res = await sumIncomingXLMByMemoNoCacheExact({
      server,
      accountId: publicKey,
      memoQuery,
      fromISO,
      toISO: toISOExc,
      onProgress,
      signal: abortRef.current.signal,
    });
    console.log('[STM] path=live-payments join=transactions');
    console.time('[STM] NoCacheExact');
    // DEV-Diagnose **deaktiviert**: vermeidet zweiten, teuren Live-Scan
    // if (import.meta.env.DEV && false) { /* optional manuell aktivierbar */ }

    console.log('[XlmByMemo] amount =', res.amount);
    setResult({ total: res.amount, rangeInfo });
    setResultAmount(res.amount);

    const durationMs = Date.now() - (startedAtRef.current || Date.now());
    const newestISO = await getNewestCreatedAt(publicKey);
    setLastPaymentISO(newestISO);
    
    setProg((p) => ({
      ...p,
      progress: 1,
      phase: "finalize",
      etaMs: 0,
      durationMs,
      newestPaymentISO: newestISO
    }));
  } catch (e) {
    // Einheitlicher, übersetzbarer Fehler-Key
    setErrorKey(e?.message || "error.xlmByMemo.paymentsFetch");
    const durationMs = Date.now() - (startedAtRef.current || Date.now());
    const newestISO = await getNewestCreatedAt(publicKey);
    setLastPaymentISO(newestISO);
    setProg((p) => ({
      ...p,
      progress: 1,
      phase: "finalize",
      etaMs: 0,
      durationMs,                 // für UI
      newestPaymentISO: newestISO // für UI
    }));
    console.timeEnd('[STM] NoCacheExact');
  } finally {
    setIsLoading(false);
  }
};


  // Bricht laufende Requests ab und beendet die UI sauber.
  // Sichtbarer Text kommt aus i18n (progress.canceled).
  const handleCancel = () => {
    try { abortRef.current?.abort(); } catch {void 0;}
    setIsLoading(false);
    setProg((p) => ({ ...p, phase: 'finalize', progress: 1, etaMs: 0 }));
    // Optional: Laufzeit zurücksetzen
    startedAtRef.current = 0;
  };

  return (
    <div className="p-4 rounded-xl border">
      {/* Kopf: 3-Spalten-Grid */}
      <div className="grid grid-cols-3 items-start mb-2">
        {/* Links: Titel */}
        <div className="col-span-1">
          <h3 className="font-semibold">{t('xlmByMemo.title')}</h3>
        </div>

        {/* Mitte: Progressbar (zentriert), Summe drunter, Abbrechen drunter */}
        <div className="col-span-1 flex flex-col items-center">
          <div className="w-full max-w-[260px]">
            <ProgressBar {...prog} />
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {t('progress.elapsed', { time: formatElapsedMmSs(elapsedMs) })}
          </div>
          {prog.phase === 'finalize' && lastPaymentISO && (
            <div className="text-xs mt-1 opacity-80">
              {t('cache.lastPaymentAt', { val: formatLocalDateTime(lastPaymentISO) })}
            </div>
          )}

          {prog.phase === 'finalize' && (
            <div className="text-xs mt-1 opacity-80">
              {t('progress.done')}
            </div>
          )}

          {/* Summe unter der Progressbar */}
          {typeof resultAmount === 'number' && (
            <div className="text-sm font-medium mt-1">
              {t('xlmByMemo.result.value', { amount: resultAmount.toFixed(7) })}
            </div>
          )}

          {/* Abbrechen-Button unter der Progressbar */}
          {prog.phase !== 'idle' && prog.phase !== 'finalize' && (
            <button
              className="text-sm px-2 py-1 rounded bg-gray-500 text-white mt-2"
              onClick={handleCancel}
              disabled={prog.phase === 'finalize'}
            >
              {t('progress.cancel')}
            </button>
          )}
        </div>

        {/* Rechts: (frei) */}
        <div className="col-span-1" />
      </div>

      {/* Zusatzinfos unter dem Titel */}
      {/*(prog.firstMatchAt || prog.oldestMatchInRangeAt || prog.memoStats || prog.typeStats) && typeof prog.opsTotal === 'number' && (
           <div className="text-xs text-gray-500 mb-2 text-center">
            {t('progress.counts', { ops: prog.opsTotal ?? 0, matches: prog.matches ?? 0 })}
            {firstMatchLocal && <> • {t('progress.firstMatchAt', { date: firstMatchLocal })}</>}
            {oldestMatchLocal && <> • {t('progress.oldestMatchInRangeAt', { date: oldestMatchLocal })}</>}
            {prog.memoStats && (
              <> • {t('xlmByMemo.debug.memo', { any: prog.memoStats.any ?? 0, exact: prog.memoStats.exact ?? 0 })}
              </>
            )}
            {prog.typeStats && (
              <> • {t('xlmByMemo.debug.types', {
                  pay: prog.typeStats.payment ?? 0,
                  path: prog.typeStats.path ?? 0,
                  create: prog.typeStats.create ?? 0,
                  other: prog.typeStats.other ?? 0
              })}
              </>
            )}
            {prog.incomingStats && (
              <> • {t('xlmByMemo.debug.incoming', {
                  toMe: prog.incomingStats.toMe ?? 0,
                  createToMe: prog.incomingStats.createToMe ?? 0,
                  nativeInToMe: prog.incomingStats.native ?? 0
              })}
              </>
            )}
            {prog.incomingOverview && (
              <> • {t('xlmByMemo.debug.incomingOverview', {
                  total: prog.incomingOverview.total ?? 0,
                  unique: prog.incomingOverview.unique ?? 0
              })}</>
            )}
        </div>
      )*/}

      {/* Kompakte Summary */}
      {prog.phase === 'finalize' && (
        <div className="text-gray-500 mb-2 text-sm text-center">
          <span className="inline-block mx-2">
            {t('xlmByMemo.summary.correctCount', { n: prog.matches ?? 0 })}
          </span>
          <span className="inline-block mx-2">
            {t('xlmByMemo.summary.otherCount', { n: Math.max(0, (prog.incomingOverview?.total ?? 0) - (prog.matches ?? 0)) })}
          </span>
          <span className="inline-block mx-2">
            {t('xlmByMemo.summary.uniqueWallets', { n: prog.incomingOverview?.unique ?? 0 })}
          </span>
        </div>
      )}

      {/* Vergleich: alle Eingänge ohne Memo-Filter */}
      {prog.phase === 'finalize' && prog.incomingOverview && (
        <div className="mt-1 text-sm text-center opacity-90">
          <span className="inline-block mx-2">
            {t('xlmByMemo.summary.label')}
          </span>
          <span className="inline-block mx-2">
            {t('xlmByMemo.summary.count', { n: prog.incomingOverview.total ?? 0 })}
          </span>
          <span className="inline-block mx-2">
            {t('xlmByMemo.summary.amount', {
              amount: (prog.incomingOverview.totalAmount ?? 0).toFixed(7)
            })}
          </span>
          <span className="inline-block mx-2">
            {t('xlmByMemo.summary.unique', { n: prog.incomingOverview.uniqueAll ?? 0 })}
          </span>
        </div>
      )}

      {/* Memo */}
      <label className="block text-sm mb-1">{t("xlmByMemo.memo.label")}</label>
      <input
        className="w-full border rounded p-2 mb-3"
        placeholder={t("xlmByMemo.memo.placeholder")}
        value={memoQuery}
        onChange={(e) => setMemoQuery(e.target.value)}
      />

      {/* Datum & Zeit (optional) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm mb-1">{t("xlmByMemo.date.from")}</label>
          <input
            type="date"
            className="w-full border rounded p-2"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <input
            type="time"
            step="1"
            className="mt-2 w-full border rounded p-2"
            value={fromTime}
            onChange={(e) => setFromTime(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm mb-1">{t("xlmByMemo.date.to")}</label>
          <input
            type="date"
            className="w-full border rounded p-2"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
          <input
            type="time"
            step="1"
            className="mt-2 w-full border rounded p-2"
            value={toTime}
            onChange={(e) => setToTime(e.target.value)}
          />
          <div className="text-right">
            <button
              type="button"
              onClick={handleSetToNow}
              className="ml-2 px-2 py-1 text-sm rounded border bg-gray-600 hover:bg-gray-500 mt-1"
              title={t('xlmByMemo.time.setToNowHint')}
            >
              {t('xlmByMemo.time.setToNow')}
            </button>
          </div>       
        </div>
      </div>

      {/* Zeitzone */}
      <div className="mt-3">
        <label className="block text-sm mb-1">{t("xlmByMemo.tz.label")}</label>
        <select
          className="w-full border rounded p-2"
          value={tz}
          onChange={(e) => setTz(e.target.value)}
        >
          <option value="cst">{t("xlmByMemo.tz.cst")}</option>
          <option value="cdt">{t("xlmByMemo.tz.cdt")}</option>
          <option value="utc">{t("xlmByMemo.tz.utc")}</option>
          <option value="local">{t("xlmByMemo.tz.local")}</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">{t("xlmByMemo.tz.note")}</p>
      </div>

      <button
        className="mt-4 px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
        onClick={handleCalculate}
        disabled={isLoading || !memoQuery}
      >
        {isLoading ? t("xlmByMemo.action.loading") : t("xlmByMemo.action.calculate")}
      </button>

      {errorKey && <div className="mt-3 text-red-600">{t(errorKey)}</div>}

      <button
        className="mt-6 px-4 py-2 rounded bg-gray-500 text-white hover:bg-gray-600"
        onClick={() => onBack && onBack()}
        disabled={!onBack}
      >
        {t("navigation.backToMainMenu")}
      </button>
    </div>
  );
}

