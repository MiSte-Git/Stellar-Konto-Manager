import { useCallback, useEffect, useRef, useState } from 'react';
import { passphraseFor } from '../../../config/networks.js';
import { getHorizonServerForNetwork } from '../../../utils/stellar/stellarUtils.js';
import { assertFlowNetwork } from '../../../utils/globalNetwork.js';
import { resolveFeePerOp } from '../../../utils/stellar/fees.js';
import { AmbiguousSubmitResultError } from '../../../utils/stellar/submitTransactionSafely.js';
import { assertHorizonNetwork } from '../../../utils/multisig/jobRevocation.js';
import { getRequiredThreshold } from '../../../utils/getRequiredThreshold.js';
import { finishUnsignedTx } from '../../../utils/multisig/unsignedTx.js';
import useTradingSubmit from '../../trading/hooks/useTradingSubmit.js';
import { describeLiquidityError, loadFreshState, signAndSubmit } from '../liquiditySubmit.js';

/**
 * Gemeinsamer Ablauf fuer Einzahlen und Abheben:
 * - beim Oeffnen Konto, Pool und Fee frisch laden (data)
 * - begin(payload, work) oeffnet ueber useTradingSubmit das SecretKeyModal
 * - nach der Eingabe der Keys: Doppelklick-Schutz (inFlightRef), Netzpruefung
 *   (assertHorizonNetwork), dann work(server, collected, alive, send). work
 *   liefert { changed: noticeKey, fresh } (Werte haben sich geaendert, neu
 *   bestaetigen) oder { hash } (gesendet). Gesendet wird nur ueber send(tx);
 *   ein zweiter send-Aufruf im selben Ablauf wirft liquidity.alreadySent,
 *   bevor etwas signiert oder gesendet wird.
 * - AmbiguousSubmitResultError wie im Trading: Modal schliessen, Hash zeigen,
 *   nicht erneut senden.
 * Wird der Dialog geschlossen (z. B. Konto- oder Netzwechsel), verwirft alive()
 * alle weiteren Schritte vor dem Senden. Lief der Submit schon, geht das
 * Ergebnis an onBackgroundResult ({ type: 'success'|'ambiguous', hash } bzw.
 * { type: 'error', message }, jeweils mit network und publicKey des Absendens),
 * damit die Seite es anzeigen kann.
 *
 * begin(payload, work, { local, onBackToSelection }): local = Multisig-Option
 * "Alle Signaturen lokal eingeben" (SecretKeyModal wie in SendPayment im
 * Kontext 'local', mit Rueckweg zur Optionsauswahl).
 *
 * prepareJob(work) und exportXdr(work) sind die Wege ohne SecretKeyModal:
 * gleicher Doppelklick-Schutz und dieselbe Netzpruefung, dann work(server, alive)
 * mit { changed, fresh } oder { tx, items } (unsignierte Transaktion und Zeilen
 * fuer die Zusammenfassung).
 * - prepareJob legt per createMultisigJobFromXdr einen Job an. Danach sperrt
 *   jobCreated weitere Jobs in diesem Dialog. Wird der Dialog vor dem Erstellen
 *   abgebaut, wird verworfen; war der Job schon angelegt, geht
 *   { type: 'jobCreated', jobId, hash } an onBackgroundResult.
 * - exportXdr legt keinen Job an und sendet nichts; XDR und Hash landen in
 *   exportedXdr. Keine Sperre danach, nur kein paralleler Aufbau.
 */
export default function useLiquidityAction({ publicKey, network, poolId, operationType, t, onDone, onBackgroundResult }) {
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
  // Optionen des laufenden SecretKeyModal-Ablaufs: { local, onBackToSelection }
  const [signingMode, setSigningMode] = useState({ local: false, onBackToSelection: null });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
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

  const closeModal = useCallback(() => {
    setShowSecretModal(false);
    setPendingAction(null);
  }, [setShowSecretModal, setPendingAction]);

  const begin = useCallback((payload, work, { local = false, onBackToSelection = null } = {}) => {
    setModalError('');
    setNotice('');
    setSigningMode({ local, onBackToSelection });
    beginAction(operationType, payload, async (collected) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setProcessing(true);
      setModalError('');
      let sent = false;
      const reportInBackground = (res) => {
        if (sent) onBackgroundResultRef.current?.({ ...res, network, publicKey });
      };
      try {
        const server = getHorizonServerForNetwork(network);
        await assertHorizonNetwork(server, passphraseFor(network));
        const send = (tx) => {
          if (sent) throw new Error('submitTransaction.failed:liquidity.alreadySent');
          // work() hat frisch geladen (await): gilt das Netz des Ablaufs noch?
          assertFlowNetwork(network);
          sent = true;
          return signAndSubmit(server, tx, collected);
        };
        const outcome = await work(server, collected, alive, send);
        if (!outcome) return;
        if (!mountedRef.current) {
          if (!outcome.changed) reportInBackground({ type: 'success', hash: outcome.hash || '' });
          return;
        }
        closeModal();
        if (outcome.changed) {
          setData((d) => ({ ...d, account: outcome.fresh.account, pool: outcome.fresh.pool }));
          setNotice(outcome.changed);
          return;
        }
        setResult({ hash: outcome.hash || '' });
        onDoneRef.current?.();
      } catch (err) {
        if (!mountedRef.current) {
          reportInBackground(err instanceof AmbiguousSubmitResultError
            ? { type: 'ambiguous', hash: err.hash || '' }
            : { type: 'error', message: describeLiquidityError(t, err) });
          return;
        }
        if (err instanceof AmbiguousSubmitResultError) {
          closeModal();
          setResult({ ambiguousHash: err.hash || '' });
          onDoneRef.current?.();
          return;
        }
        setModalError(describeLiquidityError(t, err));
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setProcessing(false);
      }
    });
  }, [alive, beginAction, closeModal, network, operationType, publicKey, t]);

  // Gemeinsamer Ablauf fuer Job und XDR-Export (unsignierte Transaktion).
  const prepareUnsigned = useCallback(async (work, mode) => {
    if (inFlightRef.current || (mode === 'job' && jobCreatedRef.current)) return;
    inFlightRef.current = true;
    setProcessing(true);
    setJobError('');
    setNotice('');
    try {
      const server = getHorizonServerForNetwork(network);
      await assertHorizonNetwork(server, passphraseFor(network));
      const outcome = await work(server, alive);
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
      if (mountedRef.current) setJobError(describeLiquidityError(t, err));
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setProcessing(false);
    }
  }, [alive, network, publicKey, t]);
  const prepareJob = useCallback((work) => prepareUnsigned(work, 'job'), [prepareUnsigned]);
  const exportXdr = useCallback((work) => prepareUnsigned(work, 'xdr'), [prepareUnsigned]);
  const clearExportedXdr = useCallback(() => setExportedXdr(null), []);

  const modalProps = {
    onConfirm: (collected) => pendingAction?.execute?.(collected),
    onCancel: () => {
      closeModal();
      setModalError('');
    },
    errorMessage: modalError,
    isProcessing: processing,
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
    data, reload, begin, showSecretModal, modalProps, result, notice, setNotice, processing,
    prepareJob, jobError, preparedJob, jobCreated, exportXdr, exportedXdr, clearExportedXdr,
  };
}
