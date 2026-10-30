import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { horizonUrlFor } from '../../../config/networks.js';
import { getHorizonServer } from '../../../utils/stellar/stellarUtils.js';
import { minimumReserveStroops } from '../../../utils/stellar/liquidityChecks.js';
import { analyzeRounds } from '../../../utils/stellar/groupfundRounds.js';
import {
  SCAN_STATUS, cancelScan, getScanEntry, refreshScan, startScan, startScanIfIdle, subscribeScanEntry,
} from './groupfundScanStore.js';

export { clearGroupfundSessions } from './groupfundScanStore.js';

/**
 * Sicht auf den gemeinsamen Scan und seine Auswertung. Der Scan haengt nicht vom Kennzeichen
 * ab: Ein anderes Memo, eine andere M-Adresse oder Korrekturen an den Grenzen brauchen keine
 * neuen Horizon-Abrufe, solange die gewaehlte Runde abgedeckt ist.
 * autoExtend: laedt nach, wenn eine Korrektur der gewuenschten Runde den Start nimmt.
 */
export default function useGroupfundScan({ accountId, network, bufferStroops, dismissed, manual, autoExtend = true }) {
  const server = useMemo(() => getHorizonServer(horizonUrlFor(network)), [network]);
  const entry = getScanEntry(network, accountId);
  const subscribe = useCallback((listener) => subscribeScanEntry(entry, listener), [entry]);
  const version = useSyncExternalStore(subscribe, () => entry.version);

  const analyze = useCallback(() => {
    const { scan } = entry;
    if (!scan.account) return null;
    return analyzeRounds({
      ...scan,
      reserveStroops: minimumReserveStroops(scan.account),
      bufferStroops,
      dismissed,
      manual,
    });
  }, [bufferStroops, dismissed, entry, manual]);

  const analyzeRef = useRef(analyze);
  analyzeRef.current = analyze;
  const currentAnalysis = useCallback(() => analyzeRef.current(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version meldet Aenderungen am mutierten Scan-Stand
  const analysis = useMemo(() => analyze(), [analyze, version]);

  const start = useCallback((target = {}) => startScan(entry, server, target, currentAnalysis), [currentAnalysis, entry, server]);
  const startIfIdle = useCallback((target = {}) => startScanIfIdle(entry, server, target, currentAnalysis), [currentAnalysis, entry, server]);
  const cancel = useCallback(() => cancelScan(entry), [entry]);
  const refresh = useCallback((options) => refreshScan(entry, server, options, currentAnalysis), [currentAnalysis, entry, server]);

  const { status } = entry;
  useEffect(() => {
    if (!autoExtend || status !== SCAN_STATUS.DONE || !analysis || analysis.complete || entry.rangeActive) return;
    if (analysis.boundaries.length < entry.wantedRounds) void start();
  }, [analysis, autoExtend, entry, start, status]);

  const { scan, error } = entry;
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
    startIfIdle,
    cancel,
    refresh,
  };
}
