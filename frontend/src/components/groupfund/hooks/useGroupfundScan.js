import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { horizonUrlFor } from '../../../config/networks.js';
import { getHorizonServer } from '../../../utils/stellar/stellarUtils.js';
import { minimumReserveStroops } from '../../../utils/stellar/liquidityChecks.js';
import { analyzeRounds } from '../../../utils/stellar/groupfundRounds.js';
import { advanceScan, createScanState, loadScanAccount } from '../../../utils/stellar/groupfundScan.js';

// Scan-Stand je Netz und Konto, nur im Speicher dieses Tabs (keine IndexedDB).
const sessions = new Map();
const summaries = new Map();
const sessionKey = (network, accountId) => `${network}:${accountId}`;

/** Letzte Rundensumme dieser Sitzung fuer die Kachel; loest selbst keinen Scan aus. */
export function getGroupfundSummary(network, accountId) {
  return summaries.get(sessionKey(network, accountId)) || null;
}

export function setGroupfundSummary(network, accountId, summary) {
  summaries.set(sessionKey(network, accountId), summary);
}

/** Fuer Tests. */
export function clearGroupfundSessions() {
  sessions.clear();
  summaries.clear();
}

function sessionFor(network, accountId) {
  const key = sessionKey(network, accountId);
  if (!sessions.has(key)) sessions.set(key, { scan: createScanState(accountId), wantedRounds: 1 });
  return sessions.get(key);
}

const isSatisfied = (analysis, target) => (target.fromISO
  ? !!analysis.coveredAt && analysis.coveredAt < target.fromISO
  : analysis.boundaries.length >= target.rounds);

/**
 * Fuehrt den Scan und wertet ihn aus. Der Scan haengt nicht vom Kennzeichen ab: Ein
 * anderes Memo oder Korrekturen an den Grenzen brauchen keine neuen Horizon-Abrufe,
 * solange die gewaehlte Runde abgedeckt ist.
 */
export default function useGroupfundScan({ accountId, network, bufferStroops, dismissed, manual }) {
  const server = useMemo(() => getHorizonServer(horizonUrlFor(network)), [network]);
  const sessionRef = useRef(sessionFor(network, accountId));
  const [version, bump] = useReducer((v) => v + 1, 0);
  const [status, setStatus] = useState(sessionRef.current.scan.account ? 'done' : 'idle');
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  // Ein Datumsbereich ist der Fallback ohne Reset: danach nicht weiter nach Grenzen suchen.
  const rangeActiveRef = useRef(false);

  const analyze = useCallback(() => {
    const { scan } = sessionRef.current;
    if (!scan.account) return null;
    return analyzeRounds({
      ...scan,
      reserveStroops: minimumReserveStroops(scan.account),
      bufferStroops,
      dismissed,
      manual,
    });
  }, [bufferStroops, dismissed, manual]);

  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version meldet Aenderungen am mutierten Scan-Stand
  const analysis = useMemo(() => analyze(), [analyze, version]);

  const run = useCallback(async (target) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    // Status nur aus dem aktuellen, nicht abgebrochenen Lauf.
    const isActive = () => abortRef.current === controller && !signal.aborted;
    const { scan } = sessionRef.current;
    setStatus('scanning');
    setError('');
    try {
      if (!scan.account) {
        await loadScanAccount(scan, server, signal);
        bump();
      }
      let more = true;
      while (more) {
        if (signal.aborted) throw Object.assign(new Error('groupfund.aborted'), { isAborted: true });
        if (isSatisfied(analyzeRef.current(), target)) break;
        more = await advanceScan(scan, server, signal);
        bump();
      }
      if (isActive()) setStatus('done');
    } catch (e) {
      if (abortRef.current !== controller) return;
      if (e?.isAborted || signal.aborted) {
        setStatus('aborted');
      } else {
        setError(String(e?.message || 'unknown'));
        setStatus('error');
      }
    }
  }, [server]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback((target = {}) => {
    const session = sessionRef.current;
    rangeActiveRef.current = !!target.fromISO;
    if (target.rounds) session.wantedRounds = Math.max(session.wantedRounds, target.rounds);
    return run(target.fromISO ? target : { rounds: session.wantedRounds });
  }, [run]);

  // Sofort als abgebrochen zeigen; die noch laufende Antwort wird verworfen.
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus('aborted');
  }, []);

  const refresh = useCallback(() => {
    const { wantedRounds } = sessionRef.current;
    sessions.delete(sessionKey(network, accountId));
    sessionRef.current = sessionFor(network, accountId);
    sessionRef.current.wantedRounds = wantedRounds;
    bump();
    return run({ rounds: wantedRounds });
  }, [accountId, network, run]);

  // Korrekturen koennen eine Grenze entfernen: Dann fehlt der gewuenschten Runde der Start.
  useEffect(() => {
    if (status !== 'done' || !analysis || analysis.complete || rangeActiveRef.current) return;
    if (analysis.boundaries.length < sessionRef.current.wantedRounds) void start();
  }, [analysis, status, start]);

  const { scan } = sessionRef.current;
  return {
    status,
    error,
    analysis,
    payments: scan.payments,
    effects: scan.effects,
    currentStroops: scan.currentStroops,
    scannedAt: scan.scannedAt,
    pages: scan.pages,
    start,
    cancel,
    refresh,
  };
}
