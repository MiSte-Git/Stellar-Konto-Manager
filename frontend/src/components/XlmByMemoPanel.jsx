// components/XlmByMemoPanel.jsx
import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getHorizonServer, sumIncomingXLMByMemo } from "../utils/stellarUtils";
import ProgressBar from "../components/ProgressBar.jsx";
import { formatLocalDateTime, formatElapsedMmSs, elapsedMinutesRounded } from '../utils/datetime';

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
  const [result, setResult] = useState(null);
  const [errorKey, setErrorKey] = useState("");
  const ROLE = { FROM: 'from', TO: 'to' };
  const [prog, setProg] = useState({ progress: null, phase: 'idle', page: 0, etaMs: 0, oldest: '' });
  const abortRef = useRef(null);
  const heartbeatRef = useRef(null);
  const startedAtRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [resultAmount, setResultAmount] = useState(null);
  const firstMatchLocal = prog.firstMatchAt ? formatLocalDateTime(prog.firstMatchAt) : null;
  const oldestMatchLocal = prog.oldestMatchInRangeAt ? formatLocalDateTime(prog.oldestMatchInRangeAt) : null;


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

  /**
   * Startet die Summierung mit optionalem Datum-Filter.
   */
  const handleCalculate = async () => {
    setIsLoading(true);
    setErrorKey("");
    setResult(null);

    try {
      abortRef.current = new AbortController();
      startedAtRef.current = Date.now();
      const fromISO = toUTCISO(fromDate, fromTime, tz, ROLE.FROM);
      const toISO   = toUTCISO(toDate,   toTime,   tz, ROLE.TO);
      const rangeInfo = {
        fromLocal: `${fromDate || "-"} ${fromTime || ""} ${tz.toUpperCase()}`,
        toLocal: `${toDate || "-"} ${toTime || ""} ${tz.toUpperCase()}`,
      };
      const onProgress = (info) => setProg((p) => ({ ...p, ...info }));
      setProg({ progress: 0, phase: 'scan', page: 1, etaMs: 0, oldest: '' });
      const total = await sumIncomingXLMByMemo({
        server,
        accountId: publicKey,
        memoQuery,
        fromISO,
        toISO,
        onProgress,
        signal: abortRef.current.signal
      });
      setResult(total, rangeInfo);
      setResultAmount(total);
      setProg((p) => ({ ...p, progress: 1, phase: 'finalize', etaMs: 0 }));
    } catch (e) {
      setErrorKey(e.message || "xlmByMemo.failed:unknown");
      setErrorKey(e.message || "error.xlmByMemo.paymentsFetch");
      setProg({ progress: null, phase: 'idle', page: 0, etaMs: 0, oldest: '' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => abortRef.current?.abort();

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

          {/* Summe unter der Progressbar */}
          {typeof resultAmount === 'number' && (
            <div className="text-sm font-medium mt-1">
              {t('xlmByMemo.result.value', { amount: resultAmount.toFixed(7) })}
            </div>
          )}

          {/* Abbrechen-Button unter der Progressbar */}
          {prog.phase !== 'idle' && (
            <button
              className="text-sm px-2 py-1 rounded bg-gray-500 text-white mt-2"
              onClick={handleCancel}
            >
              {t('progress.cancel')}
            </button>
          )}
        </div>

        {/* Rechts: (frei) */}
        <div className="col-span-1" />
      </div>

      {/* Zusatzinfos unter dem Titel */}
      {(prog.firstMatchAt || prog.oldestMatchInRangeAt) && (
        <div className="text-xs text-gray-500 mb-2 text-center">
          {oldestMatchLocal && t('progress.oldestMatchInRangeAt', { date: oldestMatchLocal })}{' '}
          {firstMatchLocal && '• '}{firstMatchLocal && t('progress.firstMatchAt', { date: firstMatchLocal })}
          {' • '}{t('progress.counts', { ops: prog.opsTotal, matches: prog.matches })}
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
