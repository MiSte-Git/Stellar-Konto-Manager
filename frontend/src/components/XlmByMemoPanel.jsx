// STM_VER:XlmByMemoPanel.jsx@2025-09-10
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getHorizonServer } from "../utils/stellar/stellarUtils";
import ProgressBar from "../components/ProgressBar.jsx";
import { formatLocalDateTime, formatElapsedMmSs } from '../utils/datetime';
import { buildDefaultFilename } from '../utils/filename';
import { sumIncomingXLMByMemoNoCacheExact_Hybrid as sumIncomingXLMByMemoNoCacheExact } from "../utils/stellar/queryUtils";
import { getNewestCreatedAt } from '../utils/db/indexedDbClient';

// Erlaubte Payment-Operationen (Modulweit; stabil für Hooks)
const PAY_TYPES = new Set([
  'payment',
  'path_payment',
  'path_payment_strict_receive',
  'path_payment_strict_send',
]);

/**
 * Panel: Eingabe für Memo + optionales Zeitfenster und Anzeige der XLM-Summe.
 * - Alle sichtbaren Texte via t()
 * - Errors werden als i18n-Key angezeigt
 */
export default function XlmByMemoPanel({ publicKey, horizonUrl = "https://horizon.stellar.org" , onBack: ON_BACK }) {
  const { t } = useTranslation();
  void ON_BACK;
  const [memoQuery, setMemoQuery] = useState("");
  const [memoHistory, setMemoHistory] = useState([]);
  // Datum + Zeit getrennt, damit wir sauber TZ anwenden können
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState(() => {
    const now = new Date();
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
  const [lastPaymentISO, setLastPaymentISO] = useState(null);
  const rowsRef = useRef([]); // Trefferzeilen für Export „Treffer (Memo)“
  // Für Extra-Auswertung: Zahlungen mit falschem/leerem Memo
  const [wrongRows, setWrongRows] = useState([]);
  const [wrongLoading, setWrongLoading] = useState(false);
  // Neuer Bereich: Top 20-Eingänge (für dieses Memo)
  const [topRows, setTopRows] = useState([]);
  const [topLoading, setTopLoading] = useState(false);
  const [showTop, setShowTop] = useState(false);
  // Memo-Vergleich: entferne unsichtbare Zeichen + trim (Case-sensitiv wie in queryUtils.cleanMemo)
  const cleanMemo = useCallback((s) => String(s ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim(), []);
  const [showWrong, setShowWrong] = useState(false);
  const [wrongSummary, setWrongSummary] = useState({ count: 0, sum: 0, unique: 0 });
  // Sortierung für Tabellen
  const [wrongSort, setWrongSort] = useState({ key: 'created_at', dir: 'desc' });
  const [topSort, setTopSort] = useState({ key: 'amount', dir: 'desc' });

  // Horizon-Server (Projektvorgabe: immer Horizon)
  const server = getHorizonServer(horizonUrl);

  useEffect(() => {
    // Sekündlicher Heartbeat, solange wir "aktiv" sind
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

  // Setze Default-Zeitraum: gestern → heute
  useEffect(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setFromDate(yesterday);
    setToDate(today);
  }, []);

  // Load memo history from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('xlmByMemo.memoHistory');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setMemoHistory(arr.filter(x => typeof x === 'string'));
      }
    } catch { /* noop */ }
  }, []);

  function saveMemoToHistory(memo) {
    const m = String(memo || '').trim();
    if (!m) return;
    setMemoHistory(prev => {
      const next = [m, ...prev.filter(x => x !== m)].slice(0, 20);
      try { localStorage.setItem('xlmByMemo.memoHistory', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }

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
    return new Date().toISOString().slice(0, 10);
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

  // Hilfsfunktion: Sortierung
  const sortRows = useCallback((arr, sort) => {
    const { key, dir } = sort || {};
    const mul = dir === 'asc' ? 1 : -1;
    return [...(arr || [])].sort((a, b) => {
      const va = a?.[key];
      const vb = b?.[key];
      if (key === 'amount') {
        const na = parseFloat(va || '0');
        const nb = parseFloat(vb || '0');
        return (na - nb) * mul;
      }
      if (key === 'created_at') {
        // ISO-Strings sind lexikographisch vergleichbar
        if (va === vb) return 0;
        return (va > vb ? 1 : -1) * mul;
      }
      const sa = String(va ?? '');
      const sb = String(vb ?? '');
      return sa.localeCompare(sb) * mul;
    });
  }, []);

  const sortedWrongRows = useMemo(() => sortRows(wrongRows, wrongSort), [wrongRows, wrongSort, sortRows]);
  const sortedTopRows = useMemo(() => sortRows(topRows, topSort), [topRows, topSort, sortRows]);

  const handleWrongSort = useCallback((key) => {
    setWrongSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  }, []);
  const handleTopSort = useCallback((key) => {
    setTopSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  }, []);
  const sortArrow = useCallback((state, key) => (state.key === key ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ''), []);

  /**
   * Startet die Summierung mit optionalem Datum-Filter.
   * rowsRef.current wird dabei mit Trefferzeilen befüllt.
   */
  const handleCalculate = async () => {
    setIsLoading(true);
    setErrorKey("");
    setResult(null);
    setResultAmount(0);
    setLastPaymentISO(null);

    // store memo to history
    saveMemoToHistory(memoQuery);
    try {
      abortRef.current = new AbortController();
      startedAtRef.current = Date.now();

      // Zeitgrenzen (UTC, obere Grenze exklusiv)
      const fromISO = toUTCISO(fromDate, fromTime, tz, ROLE.FROM);
      const toISOExc = plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO));
      const windowMs = Math.max(0, new Date(toISOExc) - new Date(fromISO));
      const etaMs = Math.min(180000, Math.max(15000, Math.floor(windowMs / 20)));
      setProg(p => ({ ...p, phase: 'scan', progress: 0, etaMs, page: 0 }));
      const rangeInfo = { fromISO, toISO: toISOExc, memo: memoQuery };

      // Zeilenspeicher vor Lauf leeren
      rowsRef.current = [];

      // Live, Tx-First (bewährt, liefert sicher ein Ergebnis)
      const res = await sumIncomingXLMByMemoNoCacheExact({
        server,
        accountId: publicKey,
        memoQuery,
          fromISO,
          toISO: toISOExc,
        onProgress,
        collectRow: (r) => { rowsRef.current.push({ ...r, memo: String(r?.memo ?? r?.transaction_memo ?? '') }); },
        signal: abortRef.current.signal,
      });

      setResult({ total: res.amount, rangeInfo });
      setResultAmount(res.amount);

      const newestISO = await getNewestCreatedAt(publicKey);
      setLastPaymentISO(newestISO);
      setProg((p) => ({
        ...p,
        progress: 1,
        phase: 'finalize',
        etaMs: 0,
        durationMs: Date.now() - (startedAtRef.current || Date.now()),
        newestPaymentISO: newestISO,
        matches: res.hits,
        incomingOverview: res.incomingOverview || p.incomingOverview
      }));
    } catch (e) {
      setErrorKey(e?.message || 'error.xlmByMemo.paymentsFetch');
      const newestISO = await getNewestCreatedAt(publicKey);
      setLastPaymentISO(newestISO);
      setProg((p) => ({
        ...p,
        progress: 1,
        phase: 'finalize',
        etaMs: 0,
        durationMs: Date.now() - (startedAtRef.current || Date.now()),
        newestPaymentISO: newestISO,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // CSV Builder & Download
  function toCsv(rows, headersOpt) {
    const headers = (headersOpt && headersOpt.length)
      ? headersOpt
      : ['created_at','tx_hash','from','to','amount','asset_type','memo'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      const q = s.includes(';') || s.includes('"') || s.includes('\n');
      const d = s.replace(/"/g, '""');
      return q ? `"${d}"` : d;
    };
    const lines = [headers.join(';')];
    for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(';'));
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

  // Export 1: Treffer (exaktes Memo im Zeitraum) – wenn keine Trefferliste vorhanden ist,
  // werden nur die Treffer (mit passendem Memo) aus dem Cache gezogen. Exportiert wird aber immer die vorhandene Trefferliste unverändert.
  // Hinweis: Export der exakten Treffer ist derzeit nicht über einen Button erreichbar.

  // Export: Alle eingehenden nativen Payments im Zeitraum (inkl. memo) mit robustem Nachladen
  const handleExportCsv = useCallback(async () => {
    try {
      const fromISO = toUTCISO(fromDate, fromTime, tz, ROLE.FROM);
      const toISOExc = plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO));

      // Fortschritt initialisieren
      startedAtRef.current = Date.now();
      const windowMs = Math.max(0, new Date(toISOExc) - new Date(fromISO));
      const etaMs = Math.min(180000, Math.max(15000, Math.floor(windowMs / 20)));
      setProg(p => ({ ...p, phase: 'export', progress: 0, etaMs, page: 0 }));

      // Ungefilterter Export: alle Operations für den Account im Zeitraum
      let page = await server
        .operations()
        .forAccount(publicKey)
        .order('desc')
        .limit(200)
        .call();

      const rows = [];
      const pending = []; // fehlende Memos ggf. nachladen
      let stop = false;
      let pages = 0;

      const headers = [
        'created_at','tx_hash','op_id','type','dir','source','from','to','amount','asset_type','asset_code','asset_issuer','starting_balance','account','funder','into','claimable_balance_id','memo','memo_source'
      ];

      while (!stop) {
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
        page = await page.next();
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
        let pageTx = await server
          .transactions()
          .forAccount(publicKey)
          .order('desc')
          .limit(200)
          .call();
        let stopTx = false;
        while (!stopTx && need.size > 0) {
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
          pageTx = await pageTx.next();
        }
      }

      const csv = toCsv(rows, headers);
      const fn = buildDefaultFilename({ publicKey, menuLabel: t('xlmByMemo.title'), ext: 'csv' });
      downloadCsv(fn, csv);

      setProg(p => ({ ...p, phase: 'finalize', progress: 1, etaMs: 0 }));
    } catch (e) {
      void e;
      setErrorKey('exportCsv.failed');
      setProg(p => ({ ...p, phase: 'finalize', progress: 1, etaMs: 0 }));
    }
  }, [fromDate, fromTime, toDate, toTime, tz, publicKey, server, ROLE.FROM, ROLE.TO]);

  // Optional: Beide auf einmal exportieren

  // Scan: Eingehende native Zahlungen mit falschem/leerem Memo im Zeitraum
  const handleShowWrongMemos = useCallback(async () => {
    try {
      setWrongLoading(true);
      setProg(p => ({ ...p, phase: 'scan', progress: 0, page: 0 }));
      setShowWrong(false);
      setWrongRows([]);
      setWrongSummary({ count: 0, sum: 0, unique: 0 });

      const fromISO = toUTCISO(fromDate, fromTime, tz, ROLE.FROM);
      const toISOExc = plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO));
      const q = String(memoQuery || '');

      // 1) Transaktions-Memos im Zeitfenster vorab einsammeln (Hash -> Memo)
      const txMemo = new Map();
      let txPage = await server
        .transactions()
        .forAccount(publicKey)
        .order('desc')
        .limit(200)
        .call();
      let txStop = false;
      while (!txStop) {
        const trecs = txPage?.records || [];
        for (const tr of trecs) {
          const created = tr.created_at || '';
          if (toISOExc && created >= toISOExc) continue;
          if (fromISO && created < fromISO) { txStop = true; break; }
          txMemo.set(tr.hash, tr?.memo != null ? String(tr.memo) : '');
        }
        if (txStop || !txPage.next) break;
        txPage = await txPage.next();
      }

      // 2) Scan über payments; Memo aus txMemo-Map beziehen
      const rows = [];
      const uniq = new Set();
      const qClean = cleanMemo(q);

      let page = await server
        .payments()
        .forAccount(publicKey)
        .order('desc')
        .limit(200)
        .call();

      let stop = false;
      let pages = 0;
      while (!stop) {
        const recs = page?.records || [];
        for (const r of recs) {
          const created = r.created_at || '';
          if (toISOExc && created >= toISOExc) continue; // obere Grenze exklusiv
          if (fromISO && created < fromISO) { stop = true; break; }

          const t = String(r.type || '');
          let amountStr = '';
          let fromAddr = '';
          let toAddr = '';

          if (t === 'payment' || t.startsWith('path_payment')) {
            if ((r.asset_type || 'native') !== 'native') continue;
            if (r.to !== publicKey) continue;
            amountStr = r.amount || '0';
            fromAddr = r.from || '';
            toAddr = r.to || publicKey;
          } else if (t === 'create_account') {
            if (r.account !== publicKey) continue;
            amountStr = r.starting_balance || '0';
            fromAddr = r.funder || '';
            toAddr = r.account || publicKey;
          } else {
            continue;
          }

          const amt = parseFloat(amountStr);
          if (!Number.isFinite(amt) || amt <= 0) continue;

          const memoRaw = txMemo.get(r.transaction_hash) ?? '';
          const memoClean = cleanMemo(memoRaw);

          if (qClean && memoClean.includes(qClean)) continue; // korrektes Memo (Teilstring) → nicht in Liste

          rows.push({
            created_at: r.created_at,
            from: fromAddr,
            to: toAddr,
            amount: amountStr,
            memo: memoRaw,
            tx_hash: r.transaction_hash,
          });
          if (fromAddr) uniq.add(fromAddr);
        }
        if (stop || !page.next) break;
        pages += 1;
        if (pages % 3 === 0) setProg(p => ({ ...p, phase: 'scan', page: pages }));
        page = await page.next();
      }

      const sum = rows.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
      setWrongRows(rows);
      setWrongSummary({ count: rows.length, sum, unique: uniq.size });
      setShowWrong(true);
      setProg(p => ({ ...p, phase: 'finalize', progress: 1 }));
    } catch (e) {
      void e;
      setErrorKey('xlmByMemo.wrongMemos.failed');
    } finally {
      setWrongLoading(false);
    }
  }, [fromDate, fromTime, toDate, toTime, tz, memoQuery, publicKey, server, ROLE.FROM, ROLE.TO, cleanMemo]);

  // Scan: Top 20 eingehende nativen Zahlungen mit passendem Memo (Teilstring) im Zeitraum
  const handleShowTopLargest = useCallback(async () => {
   try {
   setTopLoading(true);
   setProg(p => ({ ...p, phase: 'scan', progress: 0, page: 0 }));
   setShowTop(false);
   setTopRows([]);

      const fromISO = toUTCISO(fromDate, fromTime, tz, ROLE.FROM);
      const toISOExc = plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO));
      const q = String(memoQuery || '');
      const qClean = cleanMemo(q);

      // 1) Transaktions-Memos im Zeitfenster einsammeln (Hash -> Memo)
      const txMemo = new Map();
      let txPage = await server
        .transactions()
        .forAccount(publicKey)
        .order('desc')
        .limit(200)
        .call();
      let txStop = false;
      while (!txStop) {
        const trecs = txPage?.records || [];
        for (const tr of trecs) {
          const created = tr.created_at || '';
          if (toISOExc && created >= toISOExc) continue;
          if (fromISO && created < fromISO) { txStop = true; break; }
          txMemo.set(tr.hash, tr?.memo != null ? String(tr.memo) : '');
        }
        if (txStop || !txPage.next) break;
        txPage = await txPage.next();
      }

      // 2) Zahlungen scannen, passende Memos sammeln
      let page = await server
        .payments()
        .forAccount(publicKey)
        .order('desc')
        .limit(200)
        .call();

      const rows = [];
      let stop = false;
      let pages = 0;
      while (!stop) {
        const recs = page?.records || [];
        for (const r of recs) {
          const created = r.created_at || '';
          if (toISOExc && created >= toISOExc) continue; // obere Grenze exklusiv
          if (fromISO && created < fromISO) { stop = true; break; }

          const t = String(r.type || '');
          let amountStr = '';
          let fromAddr = '';
          let toAddr = '';

          if (t === 'payment' || t.startsWith('path_payment')) {
            if ((r.asset_type || 'native') !== 'native') continue;
            if (r.to !== publicKey) continue;
            amountStr = r.amount || '0';
            fromAddr = r.from || '';
            toAddr = r.to || publicKey;
          } else if (t === 'create_account') {
            if (r.account !== publicKey) continue;
            amountStr = r.starting_balance || '0';
            fromAddr = r.funder || '';
            toAddr = r.account || publicKey;
          } else {
            continue;
          }

          const amt = parseFloat(amountStr);
          if (!Number.isFinite(amt) || amt <= 0) continue;

          const memoRaw = txMemo.get(r.transaction_hash) ?? '';
          const memoClean = cleanMemo(memoRaw);
          if (!qClean || !memoClean.includes(qClean)) continue; // nur passende Memos

          rows.push({
            created_at: r.created_at,
            from: fromAddr,
            to: toAddr,
            amount: amountStr,
            memo: memoRaw,
            tx_hash: r.transaction_hash,
          });
        }
        if (stop || !page.next) break;
        pages += 1;
        if (pages % 3 === 0) setProg(p => ({ ...p, phase: 'scan', page: pages }));
        page = await page.next();
      }

      // 3) Top 20 nach Betrag
      rows.sort((a, b) => (parseFloat(b.amount || '0') - parseFloat(a.amount || '0')));
      const top20 = rows.slice(0, 20);

      setTopRows(top20);
      setShowTop(true);
      setProg(p => ({ ...p, phase: 'finalize', progress: 1 }));
    } catch (e) {
      void e;
      setErrorKey('error.xlmByMemo.failedUnknown');
    } finally {
      setTopLoading(false);
    }
  }, [fromDate, fromTime, toDate, toTime, tz, memoQuery, publicKey, server, cleanMemo, ROLE.FROM, ROLE.TO]);

  // Bricht laufende Requests ab und beendet die UI sauber.
  // Sichtbarer Text kommt aus i18n (progress.canceled).
  const handleCancel = () => {
    try { abortRef.current?.abort(); } catch {void 0;}
    setIsLoading(false);
    setProg((p) => ({ ...p, phase: 'finalize', progress: 1, etaMs: 0 }));
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
            {t('xlmByMemo.summary.unique', { n: prog.incomingOverview?.uniqueAll ?? 0 })}
          </span>
        </div>
      )}

      {/* Memo mit History */}
      <label className="block text-sm mb-1">{t("xlmByMemo.memo.label")}</label>
      <input
        className="w-full border rounded p-2 mb-1"
        placeholder={t("xlmByMemo.memo.placeholder")}
        value={memoQuery}
        onChange={(e) => setMemoQuery(e.target.value)}
        list="memo-history"
      />
      <datalist id="memo-history">
        {memoHistory.map((m, i) => (
          <option key={i} value={m} />
        ))}
      </datalist>

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
          <option value="europe_zurich">{t("xlmByMemo.tz.europe_zurich")}</option>
          <option value="local">{t("xlmByMemo.tz.local")}</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">{t("xlmByMemo.tz.note")}</p>
        <div className="mt-1 text-xs text-gray-500">
          {t('xlmByMemo.tz.window', {
            from: fromDate ? toUTCISO(fromDate, fromTime, tz, ROLE.FROM) : '—',
            to: toDate ? plus1sIso(toUTCISO(toDate, toTime, tz, ROLE.TO)) : '—'
          })}
        </div>
      </div>


      <button
        className="mt-4 px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
        onClick={handleCalculate}
        disabled={isLoading || !memoQuery}
      >
        {isLoading ? t("xlmByMemo.action.loading") : t("xlmByMemo.action.calculate")}
      </button>

      {/* Export */}
      <div className="mt-2 flex items-start gap-3">
        <button onClick={handleExportCsv} className="btn btn-secondary">
          {t('xlmByMemo.export.csvAll')}
        </button>
        <button
          onClick={handleShowWrongMemos}
          className="px-2 py-1 text-sm rounded border bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50"
          disabled={wrongLoading || !memoQuery}
          title={t('xlmByMemo.wrongMemos.hint')}
        >
          {t('xlmByMemo.wrongMemos.button')}
        </button>
        {wrongLoading && <span className="text-xs opacity-80">{t('xlmByMemo.wrongMemos.scanning')}</span>}
        {/* Neuer Button: Top 20 Eingänge für dieses Memo */}
        <button
          onClick={handleShowTopLargest}
          className="px-2 py-1 text-sm rounded border bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
          disabled={topLoading || !memoQuery}
        >
          {t('xlmByMemo.topLargest.button')}
        </button>
        {topLoading && <span className="text-xs opacity-80">{t('xlmByMemo.topLargest.scanning')}</span>}
      </div>

      {/* Ergebnis: falsche/leer Memos */}
      {showWrong && (
        <div className="mt-3 border rounded p-2">
          <div className="text-sm font-medium mb-1">{t('xlmByMemo.wrongMemos.title')}</div>
          <div className="text-xs text-gray-600 mb-2">
            {t('xlmByMemo.wrongMemos.summary', { count: wrongSummary.count, sum: Number(wrongSummary.sum).toFixed(7), unique: wrongSummary.unique })}
          </div>
          <div className="overflow-auto max-h-64 text-xs">
            <div className="grid grid-cols-5 gap-2 font-semibold sticky top-0 bg-gray z-10 py-1">
              <div className="cursor-pointer select-none" onClick={() => handleWrongSort('created_at')}>{t('xlmByMemo.wrongMemos.columns.created_at')}{sortArrow(wrongSort,'created_at')}</div>
              <div className="cursor-pointer select-none" onClick={() => handleWrongSort('from')}>{t('xlmByMemo.wrongMemos.columns.from')}{sortArrow(wrongSort,'from')}</div>
              <div className="cursor-pointer select-none" onClick={() => handleWrongSort('amount')}>{t('xlmByMemo.wrongMemos.columns.amount')}{sortArrow(wrongSort,'amount')}</div>
              <div className="cursor-pointer select-none" onClick={() => handleWrongSort('memo')}>{t('xlmByMemo.wrongMemos.columns.memo')}{sortArrow(wrongSort,'memo')}</div>
              <div className="cursor-pointer select-none" onClick={() => handleWrongSort('tx_hash')}>{t('xlmByMemo.wrongMemos.columns.tx_hash')}{sortArrow(wrongSort,'tx_hash')}</div>
            </div>
            <div className="mt-1">
              {sortedWrongRows.map((r, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 py-0.5">
                  <div className="font-mono">{r.created_at}</div>
                  <div className="font-mono break-all">{r.from}</div>
                  <div className="font-mono">{r.amount}</div>
                  <div className="font-mono break-all">{r.memo || '(leer)'}</div>
                  <div className="font-mono break-all">{r.tx_hash}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="px-2 py-1 text-sm rounded border bg-gray-600 text-white hover:bg-gray-500"
              onClick={() => {
                const headers = ['created_at','from','to','amount','memo','tx_hash'];
                const csv = toCsv(wrongRows, headers);
                const fn = buildDefaultFilename({ publicKey, menuLabel: t('xlmByMemo.title'), ext: 'csv' });
                downloadCsv(fn, csv);
              }}
            >
              {t('xlmByMemo.wrongMemos.csv')}
            </button>
            <button
              className="px-2 py-1 text-sm rounded border"
              onClick={async () => {
                const header = `${t('xlmByMemo.wrongMemos.columns.created_at')}\t${t('xlmByMemo.wrongMemos.columns.from')}\t${t('xlmByMemo.wrongMemos.columns.amount')}\t${t('xlmByMemo.wrongMemos.columns.memo')}\t${t('xlmByMemo.wrongMemos.columns.tx_hash')}`;
                const lines = [header, ...wrongRows.map(r => `${r.created_at}\t${r.from}\t${r.amount}\t${r.memo || '(leer)'}\t${r.tx_hash}`)].join('\n');
                try { await navigator.clipboard.writeText(lines); } catch { /* noop */ }
              }}
            >
              {t('xlmByMemo.wrongMemos.clipboard')}
            </button>
          </div>
        </div>
      )}

      {/* Ergebnis: Top 20 Eingänge für dieses Memo */}
      {showTop && (
        <div className="mt-3 border rounded p-2">
          <div className="text-sm font-medium mb-1">{t('xlmByMemo.topLargest.title')}</div>
          <div className="overflow-auto max-h-64 text-xs">
            <div className="grid grid-cols-5 gap-2 font-semibold sticky top-0 bg-gray z-10 py-1">
              <div className="cursor-pointer select-none" onClick={() => handleTopSort('created_at')}>{t('xlmByMemo.wrongMemos.columns.created_at')}{sortArrow(topSort,'created_at')}</div>
              <div className="cursor-pointer select-none" onClick={() => handleTopSort('from')}>{t('xlmByMemo.wrongMemos.columns.from')}{sortArrow(topSort,'from')}</div>
              <div className="cursor-pointer select-none" onClick={() => handleTopSort('amount')}>{t('xlmByMemo.wrongMemos.columns.amount')}{sortArrow(topSort,'amount')}</div>
              <div className="cursor-pointer select-none" onClick={() => handleTopSort('memo')}>{t('xlmByMemo.wrongMemos.columns.memo')}{sortArrow(topSort,'memo')}</div>
              <div className="cursor-pointer select-none" onClick={() => handleTopSort('tx_hash')}>{t('xlmByMemo.wrongMemos.columns.tx_hash')}{sortArrow(topSort,'tx_hash')}</div>
            </div>
            <div className="mt-1">
              {sortedTopRows.map((r, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 py-0.5">
                  <div className="font-mono">{r.created_at}</div>
                  <div className="font-mono break-all">{r.from}</div>
                  <div className="font-mono">{r.amount}</div>
                  <div className="font-mono break-all">{r.memo || '(leer)'}</div>
                  <div className="font-mono break-all">{r.tx_hash}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="px-2 py-1 text-sm rounded border bg-gray-600 text-white hover:bg-gray-500"
              onClick={() => {
                const headers = ['created_at','from','to','amount','memo','tx_hash'];
                const csv = toCsv(sortedTopRows, headers);
                const fn = buildDefaultFilename({ publicKey, menuLabel: t('xlmByMemo.title'), ext: 'csv' });
                downloadCsv(fn, csv);
              }}
            >
              {t('xlmByMemo.topLargest.csv')}
            </button>
            <button
              className="px-2 py-1 text-sm rounded border"
              onClick={async () => {
                const header = `${t('xlmByMemo.wrongMemos.columns.created_at')}\t${t('xlmByMemo.wrongMemos.columns.from')}\t${t('xlmByMemo.wrongMemos.columns.amount')}\t${t('xlmByMemo.wrongMemos.columns.memo')}\t${t('xlmByMemo.wrongMemos.columns.tx_hash')}`;
                const lines = [header, ...sortedTopRows.map(r => `${r.created_at}\t${r.from}\t${r.amount}\t${r.memo || '(leer)'}\t${r.tx_hash}`)].join('\n');
                try { await navigator.clipboard.writeText(lines); } catch { /* noop */ }
              }}
            >
              {t('xlmByMemo.topLargest.clipboard')}
            </button>
          </div>
        </div>
      )}

      {errorKey && <div className="mt-3 text-red-600">{t(errorKey)}</div>}

    </div>
  );
}



