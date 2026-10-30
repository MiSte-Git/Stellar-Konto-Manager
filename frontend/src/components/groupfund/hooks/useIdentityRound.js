import { useEffect, useMemo } from 'react';
import { aggregateRound } from '../../../utils/stellar/groupfundAggregate.js';
import { extractMuxedIdFromAddress } from '../../../utils/stellar/stellarUtils.js';
import { SCAN_STATUS } from './groupfundScanStore.js';
import useGroupfundPrefs, { bufferStroopsOf } from './useGroupfundPrefs.js';
import useGroupfundScan from './useGroupfundScan.js';

// Der Autoscan soll die Hauptansicht nicht mit langen Abrufen belasten; weiter geht es
// auf der Groupfund-Seite. 200 Datensaetze je Seite, also bis zu 2000 je Feed.
export const AUTOSCAN_MAX_PAGES_PER_FEED = 10;
const AUTOSCAN_TARGET = { rounds: 1, maxPagesPerFeed: AUTOSCAN_MAX_PAGES_PER_FEED };

export function muxedIdOf(address) {
  if (!address) return '';
  try {
    return extractMuxedIdFromAddress(address);
  } catch {
    return '';
  }
}

/**
 * Aktuelle Runde der geladenen M-Adresse fuer Kopfbereich und Karte. Startet den
 * gemeinsamen Scan selbst, begrenzt und nur einmal je Sitzung. Fehler bleiben im
 * Status: Der G-Saldo der Ansichten haengt nicht davon ab.
 */
export default function useIdentityRound({ publicKey, muxedAddress, network, accountMissing = false }) {
  const muxedId = muxedIdOf(muxedAddress);
  const [prefs] = useGroupfundPrefs(network, publicKey);
  const dismissed = useMemo(() => prefs.dismissed.map((b) => b.opId), [prefs.dismissed]);
  const scan = useGroupfundScan({
    accountId: publicKey, network, bufferStroops: bufferStroopsOf(prefs), dismissed, manual: prefs.manual, autoExtend: false,
  });
  const { analysis, payments, effects, pages, status, startIfIdle } = scan;

  useEffect(() => {
    if (publicKey && muxedId && !accountMissing) void startIfIdle(AUTOSCAN_TARGET);
  }, [accountMissing, muxedId, publicKey, startIfIdle]);

  const round = analysis?.rounds[0] || null;
  // Vor der ersten Seite gibt es noch keine Aussage, auch nicht "mindestens 0".
  const loaded = pages > 0;
  const result = useMemo(() => {
    if (!round || !muxedId || !loaded) return null;
    return aggregateRound({ payments, effects, accountId: publicKey, identifier: { mode: 'muxed', id: muxedId }, round });
    // payments/effects werden beim Scan fortgeschrieben; analysis aendert sich mit jeder Seite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, loaded, muxedId, publicKey, round]);

  const totals = result?.totals || [];
  return {
    status,
    scanning: status === SCAN_STATUS.SCANNING,
    failed: status === SCAN_STATUS.ERROR,
    unavailable: status === SCAN_STATUS.ERROR || accountMissing || scan.accountMissing,
    limited: status === SCAN_STATUS.LIMITED,
    round,
    result,
    native: totals.find((total) => total.asset.isNative) || null,
    others: totals.filter((total) => !total.asset.isNative),
    // Ohne vollstaendige Runde ist jede Summe nur eine Untergrenze.
    isPartial: (total) => !round?.complete || !!total?.amountUnknown,
    refresh: () => scan.refresh({ maxPagesPerFeed: AUTOSCAN_MAX_PAGES_PER_FEED }),
  };
}
