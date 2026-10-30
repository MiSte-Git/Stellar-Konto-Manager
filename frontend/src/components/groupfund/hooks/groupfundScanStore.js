import { advanceScan, createScanState, isFeedLimitReached, loadScanAccount } from '../../../utils/stellar/groupfundScan.js';

// Gemeinsamer Scan-Stand je Netz und G-Konto, nur im Speicher dieses Tabs. Der Scan haengt
// nicht vom Kennzeichen ab: Alle M-Adressen eines Kontos teilen ihn, erst die Auswertung
// filtert. Kopfbereich, Karte und Groupfund-Seite loesen so zusammen nur einen Scan aus.
const entries = new Map();

export const SCAN_STATUS = Object.freeze({
  IDLE: 'idle', SCANNING: 'scanning', DONE: 'done', LIMITED: 'limited', ABORTED: 'aborted', ERROR: 'error',
});

export function getScanEntry(network, accountId) {
  const key = `${network}:${accountId}`;
  if (!entries.has(key)) {
    entries.set(key, {
      scan: createScanState(accountId),
      wantedRounds: 1,
      rangeActive: false,
      status: SCAN_STATUS.IDLE,
      error: '',
      controller: null,
      version: 0,
      listeners: new Set(),
    });
  }
  return entries.get(key);
}

/** Fuer Tests. */
export function clearGroupfundSessions() {
  entries.forEach((entry) => entry.controller?.abort());
  entries.clear();
}

function notify(entry) {
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
}

function setState(entry, patch) {
  Object.assign(entry, patch);
  notify(entry);
}

/**
 * Meldet eine Komponente an. Geht die letzte, endet ein laufender Scan; das faengt auch den
 * Wechsel von Netz oder G-Konto ab. Die Pruefung laeuft verzoegert, damit ein Wechsel zwischen
 * zwei Ansichten mit demselben Stand den Scan nicht abbricht.
 */
export function subscribeScanEntry(entry, listener) {
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    setTimeout(() => {
      if (entry.listeners.size > 0 || entry.status !== SCAN_STATUS.SCANNING) return;
      entry.controller?.abort();
      entry.controller = null;
      setState(entry, { status: SCAN_STATUS.IDLE });
    }, 0);
  };
}

const isSatisfied = (analysis, target) => (target.fromISO
  ? !!analysis.coveredAt && analysis.coveredAt < target.fromISO
  : analysis.boundaries.length >= target.rounds);

async function runScan(entry, server, target, analyze) {
  entry.controller?.abort();
  const controller = new AbortController();
  entry.controller = controller;
  const { signal } = controller;
  // Status nur aus dem aktuellen, nicht abgebrochenen Lauf.
  const isCurrent = () => entry.controller === controller;
  const { scan } = entry;
  setState(entry, { status: SCAN_STATUS.SCANNING, error: '' });
  try {
    if (!scan.account) {
      await loadScanAccount(scan, server, signal);
      notify(entry);
    }
    let more = true;
    let limited = false;
    while (more) {
      if (signal.aborted) throw Object.assign(new Error('groupfund.aborted'), { isAborted: true });
      if (isSatisfied(analyze(), target)) break;
      if (target.maxPagesPerFeed && isFeedLimitReached(scan, target.maxPagesPerFeed)) {
        limited = true;
        break;
      }
      more = await advanceScan(scan, server, signal);
      notify(entry);
    }
    if (isCurrent() && !signal.aborted) setState(entry, { status: limited ? SCAN_STATUS.LIMITED : SCAN_STATUS.DONE });
  } catch (e) {
    if (!isCurrent()) return;
    if (e?.isAborted || signal.aborted) setState(entry, { status: SCAN_STATUS.ABORTED });
    else setState(entry, { status: SCAN_STATUS.ERROR, error: String(e?.message || 'unknown') });
  }
}

export function startScan(entry, server, target, analyze) {
  entry.rangeActive = !!target.fromISO;
  if (target.rounds) entry.wantedRounds = Math.max(entry.wantedRounds, target.rounds);
  const { maxPagesPerFeed } = target;
  return runScan(entry, server, target.fromISO ? target : { rounds: entry.wantedRounds, maxPagesPerFeed }, analyze);
}

/** Startet nur, wenn noch kein Lauf begonnen hat; mehrere Ansichten duerfen das gleichzeitig tun. */
export function startScanIfIdle(entry, server, target, analyze) {
  return entry.status === SCAN_STATUS.IDLE ? startScan(entry, server, target, analyze) : Promise.resolve();
}

/** Sofort als abgebrochen zeigen; die noch laufende Antwort wird verworfen. */
export function cancelScan(entry) {
  entry.controller?.abort();
  setState(entry, { status: SCAN_STATUS.ABORTED });
}

/** Verwirft den Stand und scannt neu. Die gewuenschte Rundenzahl bleibt. */
export function refreshScan(entry, server, { maxPagesPerFeed } = {}, analyze = () => null) {
  entry.controller?.abort();
  entry.scan = createScanState(entry.scan.accountId);
  entry.rangeActive = false;
  notify(entry);
  return runScan(entry, server, { rounds: entry.wantedRounds, maxPagesPerFeed }, analyze);
}
