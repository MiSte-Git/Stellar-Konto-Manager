import { useCallback, useEffect, useRef, useState } from 'react';
import { horizonUrlFor, passphraseFor } from '../../../config/networks.js';
import { getHorizonServer } from '../../../utils/stellar/stellarUtils.js';
import { resolveFeePerOp } from '../../../utils/stellar/fees.js';
import { AmbiguousSubmitResultError } from '../../../utils/stellar/submitTransactionSafely.js';
import { assertHorizonNetwork } from '../../../utils/multisig/jobRevocation.js';
import { getRequiredThreshold } from '../../../utils/getRequiredThreshold.js';
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

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const alive = useCallback(() => mountedRef.current, []);

  const reload = useCallback(async () => {
    setData((d) => ({ ...d, loading: true, error: '' }));
    try {
      const server = getHorizonServer(horizonUrlFor(network));
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

  const begin = useCallback((payload, work) => {
    setModalError('');
    setNotice('');
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
        const server = getHorizonServer(horizonUrlFor(network));
        await assertHorizonNetwork(server, passphraseFor(network));
        const send = (tx) => {
          if (sent) throw new Error('submitTransaction.failed:liquidity.alreadySent');
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
  };

  return { data, reload, begin, showSecretModal, modalProps, result, notice, setNotice, processing };
}
