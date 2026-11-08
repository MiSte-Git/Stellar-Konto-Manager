import { useCallback, useEffect, useRef, useState } from 'react';
import { passphraseFor } from '../../../config/networks.js';
import { getHorizonServerForNetwork } from '../../../utils/stellar/stellarUtils.js';
import { assertFlowNetwork } from '../../../utils/globalNetwork.js';
import { resolveFeePerOp } from '../../../utils/stellar/fees.js';
import { AmbiguousSubmitResultError } from '../../../utils/stellar/submitTransactionSafely.js';
import { signTransactionWithCollectedSigners } from '../../../utils/stellar/tradingTransactions.js';
import { guardedSubmit, guardedUnsignedBuild, SendBlockedError } from '../../../utils/submitGuard/guardedSubmit.js';
import { useSharedSendBlock } from '../../../utils/submitGuard/useAccountSendBlock.js';
import { LOAD_IN_LOCK_TIMEOUT_MS } from '../../../utils/submitGuard/loadTimeout.js';
import { assertHorizonNetwork } from '../../../utils/multisig/jobRevocation.js';
import { getRequiredThreshold } from '../../../utils/getRequiredThreshold.js';
import { finishUnsignedTx } from '../../../utils/multisig/unsignedTx.js';
import useTradingSubmit from '../../trading/hooks/useTradingSubmit.js';
import { describeLiquidityError, loadFreshState } from '../liquiditySubmit.js';

// work() hat keine Transaktion zu senden (Dialog abgebaut) bzw. die Werte haben sich geaendert.
class WorkAbandoned extends Error {}
class WorkChanged extends Error {
  constructor(outcome) {
    super('liquidity.changed');
    this.outcome = outcome;
  }
}

const BLOCKED = 'common:payment.send.ambiguousResult.blockedReason';
const UNSIGNED_BLOCKED = 'common:payment.send.ambiguousResult.unsignedBlockedReason';
// Gruende, bei denen der Statuskasten den Ausweg zeigt: Dialog schliessen statt Fehler im Modal.
const CLOSE_ON = ['blocked', 'pinConsumed', 'badSeq', 'lockCancelled'];

/**
 * Gemeinsamer Ablauf fuer Einzahlen und Abheben, mit dem Sendeschutz wie im Trading:
 * - beim Oeffnen Konto, Pool und Fee frisch laden (data)
 * - begin(payload, work, { actionText }) oeffnet ueber useTradingSubmit das SecretKeyModal
 * - nach der Eingabe der Keys: Doppelklick-Schutz (inFlightRef), Netzpruefung
 *   (assertHorizonNetwork), dann guardedSubmit: exklusiv pro Netz, gesperrt bei unklarem Eintrag
 *   des Kontos (aus jedem Sendeweg), Eintrag vor dem Submit, Pin der Sequence nach "nicht
 *   ausgefuehrt". work(server, collected, alive, adjustAccount) laeuft im Lock und liefert
 *   { changed: noticeKey, fresh } (Werte haben sich geaendert, neu bestaetigen), null (Dialog
 *   abgebaut) oder { tx } (unsignierte Transaktion, gebaut mit dem Konto aus
 *   fresh.buildAccount bzw. adjustedAccount(.., adjustAccount)). Signiert und gesendet wird
 *   hier, genau eine Transaktion je Ablauf. Der Eintrag (origin 'liquidity') bleibt nach einem
 *   unklaren Ausgang stehen, bis Horizon den Ausgang zeigt: kein Neuversuch ohne Beleg.
 * - AmbiguousSubmitResultError: Modal schliessen, Hash zeigen, Sperre sichtbar (guard), nicht
 *   erneut senden. SendBlockedError: Hinweis, nichts gesendet.
 * Wird der Dialog geschlossen (z. B. Konto- oder Netzwechsel), verwirft alive()
 * alle weiteren Schritte vor dem Senden. Lief der Submit schon, geht das
 * Ergebnis an onBackgroundResult ({ type: 'success'|'ambiguous', hash } bzw.
 * { type: 'error', message }, jeweils mit network und publicKey des Absendens),
 * damit die Seite es anzeigen kann.
 *
 * begin(payload, work, { local, onBackToSelection, actionText }): local = Multisig-Option
 * "Alle Signaturen lokal eingeben" (SecretKeyModal wie in SendPayment im Kontext 'local',
 * mit Rueckweg zur Optionsauswahl). actionText: Text fuer die Anzeige des Eintrags.
 *
 * prepareJob(work) und exportXdr(work) sind die Wege ohne SecretKeyModal:
 * gleicher Doppelklick-Schutz und dieselbe Netzpruefung, dann guardedUnsignedBuild (Sperre und
 * Pin wie beim Senden, unter dem Sende-Lock) mit work(server, alive, adjustAccount):
 * { changed, fresh } oder { tx, items } (unsignierte Transaktion und Zeilen fuer die
 * Zusammenfassung).
 * - prepareJob legt per createMultisigJobFromXdr einen Job an. Danach sperrt
 *   jobCreated weitere Jobs in diesem Dialog. Wird der Dialog vor dem Erstellen
 *   abgebaut, wird verworfen; war der Job schon angelegt, geht
 *   { type: 'jobCreated', jobId, hash } an onBackgroundResult.
 * - exportXdr legt keinen Job an und sendet nichts; XDR und Hash landen in
 *   exportedXdr. Keine Sperre danach, nur kein paralleler Aufbau.
 *
 * Warten am Sende-Lock (anderer Tab sendet): lockWaiting zeigt es an, cancelWaiting (und
 * "Abbrechen" im SecretKeyModal, modalProps.onCancel) beendet es; danach wird nichts gesendet
 * (SendBlockedError 'lockCancelled'). Ein Abbruch, der erst waehrend des Ladens im Lock kommt,
 * wirkt ebenfalls vor dem Eintrag. Laden und Bauen im Lock haben ein Zeitlimit
 * (LOAD_IN_LOCK_TIMEOUT_MS, danach nichts gesendet), der POST nicht.
 *
 * sendGuard (optional): Sperre der Seite (useAccountSendBlock), geteilt mit dem Dialog; ohne sie
 * fuehrt der Hook eine eigene. guard/blocked im Ergebnis.
 */
export default function useLiquidityAction({ publicKey, network, poolId, operationType, t, onDone, onBackgroundResult, sendGuard = null }) {
  const [data, setData] = useState({ loading: true, error: '', account: null, pool: null, feePerOp: '100' });
  const [processing, setProcessing] = useState(false);
  const [modalError, setModalError] = useState('');
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const { pendingAction, setPendingAction, showSecretModal, setShowSecretModal, beginAction } = useTradingSubmit();
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onBackgroundResultRef = useRef(onBackgroundResult);
  onBackgroundResultRef.current = onBackgroundResult;
  const [jobError, setJobError] = useState('');
  const [preparedJob, setPreparedJob] = useState(null);
  const [jobCreated, setJobCreated] = useState(false);
  const jobCreatedRef = useRef(false);
  const [exportedXdr, setExportedXdr] = useState(null);
  // Warten am Sende-Lock: Anzeige und Abbruch (ein Controller je Ablauf).
  const [lockWaiting, setLockWaiting] = useState(false);
  const lockAbortRef = useRef(null);
  const lockWaitingRef = useRef(false);
  const setWaiting = useCallback((on) => {
    lockWaitingRef.current = on;
    if (mountedRef.current) setLockWaiting(on);
  }, []);
  const cancelWaiting = useCallback(() => { lockAbortRef.current?.abort(); }, []);
  // Optionen des laufenden SecretKeyModal-Ablaufs: { local, onBackToSelection }
  const [signingMode, setSigningMode] = useState({ local: false, onBackToSelection: null });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Wartet der Ablauf noch auf den Lock, ist niemand mehr da, der das Ergebnis sieht: abbrechen.
      if (lockWaitingRef.current) lockAbortRef.current?.abort();
    };
  }, []);
  const alive = useCallback(() => mountedRef.current, []);

  const reload = useCallback(async () => {
    setData((d) => ({ ...d, loading: true, error: '' }));
    try {
      // Server mit explizitem Netz, wie die Passphrase (passphraseFor(network)).
      const server = getHorizonServerForNetwork(network);
      const [fresh, feePerOp] = await Promise.all([loadFreshState(server, publicKey, poolId), resolveFeePerOp(server)]);
      if (!mountedRef.current) return;
      setData({ loading: false, error: '', account: fresh.account, pool: fresh.pool, feePerOp });
    } catch (err) {
      if (mountedRef.current) setData((d) => ({ ...d, loading: false, error: describeLiquidityError(t, err) }));
    }
  }, [publicKey, network, poolId, t]);

  useEffect(() => { reload(); }, [reload]);

  // Sperre pro Konto (unklarer Sendestatus), geteilt mit der Seite oder eigene.
  const guard = useSharedSendBlock(sendGuard, {
    network,
    account: publicKey,
    onApplied: () => { onDoneRef.current?.(); },
  });
  // Faellt die Sperre (ueber Horizon geklaert), Konto und Pool des Dialogs neu laden.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const wasBlockedRef = useRef(false);
  const isBlocked = !!guard.block;
  useEffect(() => {
    if (wasBlockedRef.current && !isBlocked) reloadRef.current();
    wasBlockedRef.current = isBlocked;
  }, [isBlocked]);
  const guardRef = useRef(guard);
  guardRef.current = guard;

  const closeModal = useCallback(() => {
    setShowSecretModal(false);
    setPendingAction(null);
  }, [setShowSecretModal, setPendingAction]);

  const begin = useCallback((payload, work, { local = false, onBackToSelection = null, actionText = '' } = {}) => {
    setModalError('');
    setNotice('');
    setSigningMode({ local, onBackToSelection });
    beginAction(operationType, payload, async (collected) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setProcessing(true);
      setModalError('');
      let sent = false;
      const controller = new AbortController();
      lockAbortRef.current = controller;
      const reportInBackground = (res) => {
        if (sent) onBackgroundResultRef.current?.({ ...res, network, publicKey });
      };
      try {
        const server = getHorizonServerForNetwork(network);
        const networkPassphrase = passphraseFor(network);
        await assertHorizonNetwork(server, networkPassphrase);
        const { res } = await guardedSubmit({
          network,
          account: publicKey,
          server,
          networkPassphrase,
          // Liquidity-Operationen haben kein Zahlungsziel: keine Memo-Pruefung (SEP-29).
          skipMemoRequiredCheck: true,
          signal: controller.signal,
          onWaiting: () => setWaiting(true),
          buildTimeoutMs: LOAD_IN_LOCK_TIMEOUT_MS,
          buildTx: async ({ adjustAccount }) => {
            setWaiting(false);
            // work() laedt frisch und baut im Lock, mit der gepinnten Sequence (adjustAccount).
            const outcome = await work(server, collected, alive, adjustAccount);
            if (!outcome) throw new WorkAbandoned();
            if (outcome.changed) throw new WorkChanged(outcome);
            // work() hat geladen (await): gilt das Netz des Ablaufs noch?
            assertFlowNetwork(network);
            sent = true;
            return { tx: signTransactionWithCollectedSigners(outcome.tx, collected) };
          },
          entryData: () => ({ origin: 'liquidity', summary: { action: actionText } }),
        });
        const outcomeHash = res?.hash || res?.id || '';
        guardRef.current?.bump?.();
        if (!mountedRef.current) {
          reportInBackground({ type: 'success', hash: outcomeHash });
          return;
        }
        closeModal();
        setResult({ hash: outcomeHash });
        onDoneRef.current?.();
      } catch (err) {
        if (err instanceof WorkAbandoned) return;
        guardRef.current?.bump?.();
        if (err instanceof WorkChanged) {
          if (!mountedRef.current) return;
          closeModal();
          setData((d) => ({ ...d, account: err.outcome.fresh.account, pool: err.outcome.fresh.pool }));
          setNotice(err.outcome.changed);
          return;
        }
        if (!mountedRef.current) {
          reportInBackground(err instanceof AmbiguousSubmitResultError
            ? { type: 'ambiguous', hash: err.hash || '' }
            : { type: 'error', message: err instanceof SendBlockedError ? t(`${BLOCKED}.${err.reason}`) : describeLiquidityError(t, err) });
          return;
        }
        if (err instanceof AmbiguousSubmitResultError) {
          closeModal();
          setResult({ ambiguousHash: err.hash || '' });
          onDoneRef.current?.();
          return;
        }
        if (err instanceof SendBlockedError) {
          const text = t(`${BLOCKED}.${err.reason}`);
          // Gesperrt: Der Statuskasten zeigt den Ausweg, das Modal schliesst.
          if (CLOSE_ON.includes(err.reason)) {
            closeModal();
            setNotice(text);
          } else {
            setModalError(text);
          }
          return;
        }
        setModalError(describeLiquidityError(t, err));
      } finally {
        if (lockAbortRef.current === controller) lockAbortRef.current = null;
        setWaiting(false);
        inFlightRef.current = false;
        if (mountedRef.current) setProcessing(false);
      }
    });
  }, [alive, beginAction, closeModal, network, operationType, publicKey, setWaiting, t]);

  // Gemeinsamer Ablauf fuer Job und XDR-Export (unsignierte Transaktion).
  const prepareUnsigned = useCallback(async (work, mode) => {
    if (inFlightRef.current || (mode === 'job' && jobCreatedRef.current)) return;
    inFlightRef.current = true;
    setProcessing(true);
    setJobError('');
    setNotice('');
    const controller = new AbortController();
    lockAbortRef.current = controller;
    try {
      const server = getHorizonServerForNetwork(network);
      await assertHorizonNetwork(server, passphraseFor(network));
      // Sperre und Pin gelten schon beim Bauen: spaeter eingereicht, konkurriert die Transaktion
      // sonst mit einer unklaren oder gepinnten des Kontos (guardedUnsignedBuild).
      const outcome = await guardedUnsignedBuild({
        network,
        account: publicKey,
        signal: controller.signal,
        onWaiting: () => setWaiting(true),
        buildTimeoutMs: LOAD_IN_LOCK_TIMEOUT_MS,
        build: ({ adjustAccount }) => {
          setWaiting(false);
          return work(server, alive, adjustAccount);
        },
      });
      if (!outcome || !mountedRef.current) return;
      if (outcome.changed) {
        setData((d) => ({ ...d, account: outcome.fresh.account, pool: outcome.fresh.pool }));
        setNotice(outcome.changed);
        return;
      }
      // finishUnsignedTx prueft vorher das Netz des Ablaufs (kein Job aus einem verlassenen Netz).
      const done = await finishUnsignedTx({ mode, tx: outcome.tx, network, accountId: publicKey, items: outcome.items || [] });
      if (mode === 'xdr') {
        setExportedXdr(done);
        return;
      }
      jobCreatedRef.current = true;
      if (!mountedRef.current) {
        onBackgroundResultRef.current?.({ type: 'jobCreated', jobId: done.id, hash: done.hash, network, publicKey });
        return;
      }
      setJobCreated(true);
      setPreparedJob(done);
    } catch (err) {
      if (err instanceof SendBlockedError) {
        // Der Kasten mit dem Status liest den Speicher neu (ein Pin kann wieder unklar sein).
        guardRef.current?.bump?.();
        if (mountedRef.current) setJobError(t(`${UNSIGNED_BLOCKED}.${err.reason}`));
      } else if (mountedRef.current) {
        setJobError(describeLiquidityError(t, err));
      }
    } finally {
      if (lockAbortRef.current === controller) lockAbortRef.current = null;
      setWaiting(false);
      inFlightRef.current = false;
      if (mountedRef.current) setProcessing(false);
    }
  }, [alive, network, publicKey, setWaiting, t]);
  const prepareJob = useCallback((work) => prepareUnsigned(work, 'job'), [prepareUnsigned]);
  const exportXdr = useCallback((work) => prepareUnsigned(work, 'xdr'), [prepareUnsigned]);
  const clearExportedXdr = useCallback(() => setExportedXdr(null), []);

  const modalProps = {
    onConfirm: (collected) => pendingAction?.execute?.(collected),
    onCancel: () => {
      // Beendet das Warten am Lock; ein schon laufendes Senden (POST) laesst sich nicht abbrechen.
      cancelWaiting();
      closeModal();
      setModalError('');
    },
    errorMessage: modalError,
    isProcessing: processing,
    waitingForLock: lockWaiting,
    thresholds: data.account?.thresholds || null,
    signers: data.account?.signers || [],
    account: data.account,
    operationType,
    requiredThreshold: getRequiredThreshold(operationType, data.account?.thresholds || {}),
    // Multisig-Option "Alle Signaturen lokal eingeben": wie SendPayment im Kontext 'local'.
    ...(signingMode.local ? {
      initialCollectAllSignaturesLocally: true,
      secretContext: 'local',
      allowedSigners: data.account?.signers || [],
      onBackToSelection: signingMode.onBackToSelection ? () => {
        closeModal();
        setModalError('');
        signingMode.onBackToSelection();
      } : null,
    } : {}),
  };

  return {
    data, reload, begin, guard, blocked: !!guard.block, lockWaiting, cancelWaiting, showSecretModal, modalProps, result, notice, setNotice, processing,
    prepareJob, jobError, preparedJob, jobCreated, exportXdr, exportedXdr, clearExportedXdr,
  };
}
