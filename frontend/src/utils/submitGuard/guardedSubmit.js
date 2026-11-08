// Senden einer einzelnen Transaktion eines Kontos mit Schutz gegen Doppelzahlung, nach den
// Regeln der Sammelzahlung:
// 1. Exklusiv pro Netz ueber alle Tabs (gleicher Lock wie die Sammelzahlung).
// 2. Gesperrt, solange fuer das Konto ein unklarer Eintrag besteht (eigener oder einer der
//    Sammelzahlung), auch ein unlesbarer.
// 3. Offener Pin des Kontos (aus "Zahlung senden" oder der Sammelzahlung): Die neue
//    Transaktion nutzt genau diese Sequence; passt sie nicht mehr genau, wird nicht gesendet
//    und die fruehere Transaktion wieder als unklar gefuehrt (strenger Pfad).
// 4. Vor dem Submit wird der Eintrag als unklar geschrieben und zurueckgelesen. Bricht der
//    Tab danach ab, bleibt das Konto gesperrt, bis Horizon den Ausgang zeigt.
// 5. Eindeutig abgelehnt: vorherigen Stand wiederherstellen. Unklar: Eintrag mit Ursache.
//    Im Ledger (erfolgreich oder fehlgeschlagen): Sequence verbraucht, Pins mit ihr erledigt.
import { isStorageWritable } from '../batchPayment/batchPaymentStore.js';
import {
  AmbiguousSubmitResultError, SubmittedTransactionFailedError, submitTransactionSafely,
} from '../stellar/submitTransactionSafely.js';
import { txHashHex } from '../stellar/txHash.js';
import { withSendLock } from './sendLock.js';
import { classifySubmitCause, isBadSeqError } from './ambiguousResolve.js';
import {
  applyAccountPins, findAccountPins, findAccountSendBlock, forgetAmbiguous, forgetSignedTx, markPinRecheck,
  markSubmitting, pruneAccountEntries, readAccountEntry, releasePins, rememberAmbiguous, rememberDiagnostics,
  rememberSignedTx, writeAccountEntry,
} from './accountSendGuard.js';

/**
 * Nicht gesendet, weil der Schutz es verhindert. reason:
 * blocked (unklarer Eintrag), pinConsumed (Sequence eines offenen Pins passt nicht mehr,
 * fruehere Transaktion erneut unklar), badSeq (Netz lehnt die gepinnte Sequence ab, erneut
 * unklar), storageUnavailable, concurrent (anderer Tab), lockCancelled (Warten abgebrochen).
 */
export class SendBlockedError extends Error {
  constructor(reason) {
    super(`sendBlocked:${reason}`);
    this.name = 'SendBlockedError';
    this.reason = reason;
  }
}

// Fruehere, nicht ausgefuehrte Transaktion wieder als unklar fuehren (strenge Pruefung).
function asAmbiguous(entry, recheck) {
  return { ...entry, status: 'ambiguous', pin: false, recheck };
}

/**
 * buildTx({ adjustAccount }) baut und signiert die Transaktion ({ tx, ... }); adjustAccount
 * (oder null) muss auf das geladene Quellkonto angewendet werden, bevor gebaut wird.
 * entryData(built): weitere, oeffentliche Felder des Eintrags (origin, payment, summary).
 * Ergebnis { res, built, hash }. Wirft SendBlockedError, AmbiguousSubmitResultError oder
 * den Fehler des Submits.
 */
export async function guardedSubmit({
  network, account, server, networkPassphrase, buildTx, entryData = () => ({}), onWaiting, signal,
  submit = submitTransactionSafely,
}) {
  const source = String(account || '').trim();
  if (!isStorageWritable()) throw new SendBlockedError('storageUnavailable');
  try {
    return await withSendLock(network, async (lock) => {
      if (findAccountSendBlock(network, source)) throw new SendBlockedError('blocked');
      const before = readAccountEntry(network, source);
      const earlier = before?.status === 'notApplied' ? before : null;
      // Pins des Kontos aus beiden Sendewegen (gilt fuer das Konto, nicht fuer den Weg).
      const pins = findAccountPins(network, source);
      // Aufraeumen erst nach dem Lesen der Pins: Ein Pin, den dieses Senden noch braucht, wird
      // nie vorher entfernt (N1). Die Frist zaehlt ab Vergabe des Pins (settledAt).
      pruneAccountEntries(Date.now(), pins.filter((p) => p.store === 'account').map((p) => p.key));
      const ownPin = pins.find((p) => p.store === 'account') || null;
      let pinned = false;
      const adjustAccount = pins.length ? (loaded) => {
        const p = applyAccountPins({ loaded, source, pins });
        if (p.blocked) {
          // Die neue Transaktion koennte neben einer frueheren ausgefuehrt werden: nicht
          // senden, die frueheren erneut als unklar pruefen.
          p.blocked.forEach((pin) => markPinRecheck(network, source, pin, 'pinConsumed'));
          throw new SendBlockedError('pinConsumed');
        }
        pinned = true;
        return p.account;
      } : null;

      const built = await buildTx({ adjustAccount });
      const { tx } = built;
      if (String(tx.source) !== source) throw new Error('sourceMismatch');
      // Offener Pin, aber nicht angewendet: nie ohne Pin senden.
      if (pins.length && !pinned) throw new SendBlockedError('pinConsumed');
      const hash = txHashHex(tx);
      const maxTime = Number(tx.timeBounds?.maxTime);
      const seq = String(tx.sequence);
      // Unmittelbar vor dem Schreiben erneut pruefen.
      if (!lock.isHeld()) throw new SendBlockedError('concurrent');
      if (findAccountSendBlock(network, source)) throw new SendBlockedError('blocked');
      const prev = earlier ? [earlier.hash, ...(earlier.prev || [])] : undefined;
      const pending = { ...entryData(built), hash, at: Date.now(), status: 'ambiguous', maxTime, seq, source, prev };
      markSubmitting(network, source, hash, true);
      try {
        const written = writeAccountEntry(network, source, pending);
        const own = readAccountEntry(network, source)?.hash === hash;
        if (!written || !own) {
          if (own) writeAccountEntry(network, source, before);
          throw new SendBlockedError(written ? 'concurrent' : 'storageUnavailable');
        }
        rememberSignedTx(network, source, { hash, xdr: tx.toXDR(), networkPassphrase });
        const isOwn = () => readAccountEntry(network, source)?.hash === hash;
        try {
          const res = await submit(server, tx);
          if (isOwn()) writeAccountEntry(network, source, { ...pending, status: 'success', at: Date.now(), prev: undefined });
          // Sequence durch diese Transaktion verbraucht: Pins mit ihr sind erledigt.
          releasePins(network, source, seq);
          forgetSignedTx(network, source);
          return { res, built, hash };
        } catch (err) {
          if (err instanceof AmbiguousSubmitResultError) {
            const entry = { ...pending, cause: classifySubmitCause(err.cause) };
            if (isOwn()) writeAccountEntry(network, source, entry);
            rememberAmbiguous(network, source, entry);
            rememberDiagnostics(network, source, hash, err.diagnostics);
            throw err;
          }
          forgetSignedTx(network, source);
          forgetAmbiguous(network, source, hash);
          if (pinned && isBadSeqError(err)) {
            // Das Netz lehnt die gepinnte Sequence ab: vermutlich hat eine fruehere
            // Transaktion sie verbraucht. Wieder unklar, Horizon klaert.
            if (isOwn()) writeAccountEntry(network, source, ownPin ? asAmbiguous(earlier, 'badSeq') : before);
            if (ownPin) rememberAmbiguous(network, source, asAmbiguous(earlier, 'badSeq'));
            pins.filter((p) => p.store !== 'account').forEach((p) => markPinRecheck(network, source, p, 'badSeq'));
            throw new SendBlockedError('badSeq');
          }
          if (isOwn()) writeAccountEntry(network, source, before);
          // Im Ledger fehlgeschlagen: Sequence verbraucht, Pins mit ihr sind erledigt.
          if (err instanceof SubmittedTransactionFailedError) releasePins(network, source, seq);
          throw err;
        }
      } finally {
        markSubmitting(network, source, hash, false);
      }
    }, { signal, onWaiting });
  } catch (err) {
    if (err?.name === 'AbortError') throw new SendBlockedError('lockCancelled');
    throw err;
  }
}
