// React-Hook fuer die Sperre pro Konto bei unklarem Sendestatus (siehe accountSendGuard.js).
//
// Liefert die aktuelle Sperre fuer Netz und Konto, prueft sie ueber Horizon (Button und
// automatisch zum Zeitpunkt aus maxTime plus Puffer, wie in der Sammelzahlung) und bietet
// "Erneut senden" mit genau derselben signierten Transaktion (gleicher Hash), solange sie
// in diesem Tab im Arbeitsspeicher liegt. Freigegeben wird nur ueber Horizon.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { getHorizonServerForNetwork } from '../stellar/stellarUtils.js';
import { AmbiguousSubmitResultError, submitTransactionSafely } from '../stellar/submitTransactionSafely.js';
import { txHashHex } from '../stellar/txHash.js';
import { BATCH_SENT_PREFIX } from '../batchPayment/batchPaymentStore.js';
import { describeSubmitError } from '../batchPayment/batchPaymentLogic.js';
import { withSendLock } from './sendLock.js';
import { AUTO_CHECK_MARGIN_MS } from './ambiguousDisplay.js';
import { AMBIGUOUS_LEDGER_BUFFER_SECONDS, ambiguousClearAt, classifySubmitCause } from './ambiguousResolve.js';
import {
  MAX_SEND_VALIDITY_SECONDS, PENDING_TX_PREFIX, UNREADABLE_SEEN_PREFIX, findAccountSendBlock, forgetSignedTx, readAccountEntry,
  recordUnreadableLedgerSeen, rememberDiagnostics, settleAccountBlock, signedTxFor, writeAccountEntry,
} from './accountSendGuard.js';


function blockIdOf(block, network, account) {
  if (!block) return '';
  return [network, account, block.kind, block.key || '', block.entry?.hash || '', block.entry?.seenAt || ''].join('|');
}

// Zeitpunkt der automatischen Pruefung (lokale Uhr, nur Anzeige und Ausloeser; entschieden
// wird ueber die Ledger-Zeit von Horizon).
function dueOf(block) {
  if (!block?.entry) return null;
  if (block.entry.unreadable) {
    return Number.isFinite(block.entry.seenAt)
      ? block.entry.seenAt + (MAX_SEND_VALIDITY_SECONDS + AMBIGUOUS_LEDGER_BUFFER_SECONDS) * 1000 + AUTO_CHECK_MARGIN_MS : null;
  }
  const clearAt = ambiguousClearAt(block.entry);
  return clearAt ? clearAt + AUTO_CHECK_MARGIN_MS : null;
}

/**
 * network, account: Netz und Quellkonto der Seite. Die Gueltigkeit unlesbarer Eintraege ist
 * fuer alle Sendewege gleich (MAX_SEND_VALIDITY_SECONDS).
 * onApplied({ network, account, block, hash }) / onNotApplied({ network, account, block, pinned }):
 * nach einer Klaerung ueber Horizon (auch wenn Netz oder Konto inzwischen gewechselt haben).
 */
export function useAccountSendBlock({ network, account, onApplied, onNotApplied }) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version liest den Speicher neu
  const block = useMemo(() => findAccountSendBlock(network, account), [network, account, version]);
  const blockId = blockIdOf(block, network, account);

  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; abortRef.current?.abort(); };
  }, []);
  const callbacksRef = useRef({ onApplied, onNotApplied });
  callbacksRef.current = { onApplied, onNotApplied };

  // Andere Tabs schreiben in den Speicher (storage-Event), die Sammelzahlung in diesem Tab
  // nicht: beim Fokus und auf Anfrage (bump) neu lesen.
  useEffect(() => {
    const onStorage = (e) => {
      const key = e?.key;
      if (key === null || key === undefined || String(key).startsWith(PENDING_TX_PREFIX) || String(key).startsWith(BATCH_SENT_PREFIX)
        || String(key).startsWith(UNREADABLE_SEEN_PREFIX)) bump();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', bump);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', bump);
    };
  }, [bump]);

  const [check, setCheck] = useState(null); // { id, state, at, clearAt? }
  const [notice, setNotice] = useState(null); // { network, account, kind, origin, hash, pinned }
  const [resend, setResend] = useState(null); // { id, busy, error, ambiguous }
  const checkingRef = useRef(new Set());

  const finish = useCallback((blk, net, acc, outcome, entry) => {
    const origin = blk.kind === 'batchUnreadable' ? 'batch' : blk.kind;
    if (outcome === 'success') {
      if (blk.kind === 'single') forgetSignedTx(net, acc);
      const hash = entry?.hash || blk.entry?.hash || '';
      if (mountedRef.current) setNotice({ network: net, account: acc, kind: 'applied', outcome, origin, unreadable: !!blk.entry?.unreadable, hash });
      callbacksRef.current.onApplied?.({ network: net, account: acc, block: blk, hash });
    } else {
      if (blk.kind === 'single') forgetSignedTx(net, acc);
      const pinned = !!entry?.pin;
      if (mountedRef.current) setNotice({ network: net, account: acc, kind: 'notApplied', outcome, origin, unreadable: !!blk.entry?.unreadable, hash: blk.entry?.hash || '', pinned });
      callbacksRef.current.onNotApplied?.({ network: net, account: acc, block: blk, pinned });
    }
  }, []);

  const checkNow = useCallback(async () => {
    const net = network;
    const acc = account;
    const blk = findAccountSendBlock(net, acc);
    if (!blk) { bump(); return; }
    const id = blockIdOf(blk, net, acc);
    if (checkingRef.current.has(id)) return;
    checkingRef.current.add(id);
    const at = Date.now();
    setCheck({ id, state: 'checking', at });
    let res;
    try {
      // Immer das Netz des Eintrags, nie das globale.
      const server = getHorizonServerForNetwork(blk.entry?.network || net);
      res = await settleAccountBlock({
        network: net, account: acc, block: blk, server,
      });
    } catch {
      res = { outcome: 'unknown' };
    } finally {
      checkingRef.current.delete(id);
    }
    const { outcome } = res;
    if (outcome === 'success' || outcome === 'failed' || outcome === 'expired') {
      finish(blk, net, acc, outcome, res.entry);
      if (mountedRef.current) setCheck(null);
    } else if (mountedRef.current) {
      setCheck(outcome ? { id, state: outcome === 'pending' ? 'pending' : 'unknown', at, clearAt: res.clearAt } : null);
    }
    if (mountedRef.current) bump();
  }, [account, bump, finish, network]);
  const checkRef = useRef(checkNow);
  checkRef.current = checkNow;

  // Einmal automatisch pruefen, sobald die Sperre laut maxTime geklaert werden kann
  // (sofort, wenn der Zeitpunkt schon vorbei ist, z.B. nach dem Neuladen).
  const due = dueOf(block);
  const autoDoneRef = useRef(new Set());
  useEffect(() => {
    if (!blockId || !due || autoDoneRef.current.has(blockId)) return undefined;
    const timer = setTimeout(() => {
      autoDoneRef.current.add(blockId);
      checkRef.current();
    }, Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [blockId, due]);

  // Unlesbarer Eintrag: beim ersten Erkennen auch die Ledger-Zeit festhalten (Horizon), damit
  // die zeitliche Freigabe nicht allein an der lokalen Uhr haengt.
  const ledgerSeenNeeded = !!block?.entry?.unreadable && !block.entry.ledgerSeenAt ? blockId : '';
  useEffect(() => {
    if (!ledgerSeenNeeded) return undefined;
    let cancelled = false;
    const blk = block;
    (async () => {
      try {
        const server = getHorizonServerForNetwork(network);
        const ledgers = await server.ledgers().order('desc').limit(1).call();
        const sec = Date.parse(ledgers?.records?.[0]?.closed_at) / 1000;
        if (!cancelled && Number.isFinite(sec) && recordUnreadableLedgerSeen(network, account, blk, sec) && mountedRef.current) bump();
      } catch { /* ohne Ledger-Zeit wie bisher, spaetestens die Pruefung haelt sie fest */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- einmal je unlesbarem Eintrag
  }, [ledgerSeenNeeded]);

  const signed = block?.kind === 'single' && !block.entry?.unreadable ? signedTxFor(network, account, block.entry.hash) : null;
  const resendAvailable = !!signed?.xdr && Number(block?.entry?.maxTime) * 1000 > Date.now();

  // Genau dieselbe signierte Transaktion noch einmal senden (gleicher Hash: das Netz fuehrt
  // sie hoechstens einmal aus). Keine neue Transaktion. Ohne Erfolg bleibt die Sperre.
  const resendNow = useCallback(async () => {
    const net = network;
    const acc = account;
    const blk = findAccountSendBlock(net, acc);
    if (blk?.kind !== 'single' || blk.entry?.unreadable) return;
    const mem = signedTxFor(net, acc, blk.entry.hash);
    if (!mem?.xdr) return;
    const id = blockIdOf(blk, net, acc);
    setResend({ id, busy: true, error: '', ambiguous: false });
    const controller = new AbortController();
    abortRef.current = controller;
    let outcome = '';
    let error = '';
    try {
      // Eintrag fehlt im Speicher: wiederherstellen, damit die Sperre auch in anderen Tabs gilt.
      if (blk.missing && !readAccountEntry(net, acc)) writeAccountEntry(net, acc, blk.entry);
      await withSendLock(net, async () => {
        const cur = readAccountEntry(net, acc);
        if (cur?.status !== 'ambiguous' || cur.hash !== mem.hash) { outcome = 'changed'; return; }
        const tx = TransactionBuilder.fromXDR(mem.xdr, mem.networkPassphrase);
        if (txHashHex(tx) !== mem.hash) { outcome = 'changed'; return; }
        try {
          // Dieselbe, schon geprueft gesendete Transaktion: keine neue Memo-Pruefung vor dem POST.
          await submitTransactionSafely(getHorizonServerForNetwork(net), tx, { skipMemoRequiredCheck: true });
          const now = readAccountEntry(net, acc);
          if (now?.hash === mem.hash && now.status === 'ambiguous') {
            writeAccountEntry(net, acc, { ...now, status: 'success', prev: undefined });
          }
          outcome = 'success';
        } catch (err) {
          if (err instanceof AmbiguousSubmitResultError) {
            const now = readAccountEntry(net, acc);
            if (now?.hash === mem.hash && now.status === 'ambiguous') writeAccountEntry(net, acc, { ...now, cause: classifySubmitCause(err.cause) });
            rememberDiagnostics(net, acc, mem.hash, err.diagnostics);
            outcome = 'ambiguous';
          } else {
            outcome = 'rejected';
            error = describeSubmitError(err);
          }
        }
      }, { signal: controller.signal });
    } catch (err) {
      outcome = 'rejected';
      error = err?.name === 'AbortError' ? '' : String(err?.message || err || '');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
    if (outcome === 'success') {
      finish(blk, net, acc, 'success', { hash: mem.hash });
      if (mountedRef.current) setResend(null);
    } else if (mountedRef.current) {
      setResend({ id, busy: false, error, ambiguous: outcome === 'ambiguous', rejected: outcome === 'rejected' });
    }
    if (mountedRef.current) bump();
    // Abgelehnt (z.B. tx_bad_seq, tx_too_late): sagt nichts Sicheres ueber die erste
    // Sendung. Status bleibt unklar und wird ueber Horizon geprueft.
    if (outcome === 'rejected' && mountedRef.current) checkRef.current();
  }, [account, bump, finish, network]);

  // Ergebnisse gehoeren zur angezeigten Sperre (Netz, Konto, Hash).
  const visibleCheck = check && check.id === blockId ? check : null;
  const visibleResend = resend && resend.id === blockId ? resend : null;
  const visibleNotice = notice && notice.network === network && notice.account === account ? notice : null;

  return {
    block,
    blockId,
    bump,
    check: visibleCheck,
    checkNow,
    diagnostics: signed?.diag || null,
    resendAvailable,
    resendMissing: !!block && block.kind === 'single' && !block.entry?.unreadable && !signed?.xdr,
    resend: visibleResend,
    resendNow,
    notice: visibleNotice,
    dismissNotice: () => setNotice(null),
  };
}

/**
 * Eine Sperre pro Seite: Eine Seite, die Dialoge mit Sendewegen oeffnet, haelt die Sperre
 * (useAccountSendBlock) und reicht sie als shared weiter; die Dialoge teilen sie dann, statt eine
 * zweite Instanz zu fuehren (zwei Instanzen wuerden dieselbe Sperre doppelt ueber Horizon pruefen).
 * Ohne shared (Dialog allein) fuehrt der Aufrufer eine eigene. Der Hook wird immer aufgerufen;
 * mit shared ist sein Konto leer, er sperrt und prueft dann nichts.
 */
export function useSharedSendBlock(shared, opts) {
  const own = useAccountSendBlock({ ...opts, account: shared ? '' : opts.account });
  return shared || own;
}
