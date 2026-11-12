import { useCallback, useEffect, useRef, useState } from 'react';
import { passphraseFor } from '../../../config/networks.js';
import { getHorizonServerForNetwork } from '../../../utils/stellar/stellarUtils.js';
import { assertHorizonNetwork } from '../../../utils/multisig/jobRevocation.js';
import { assertTxMatchesFlow, finishUnsignedTx } from '../../../utils/multisig/unsignedTx.js';
import { assertFlowNetwork } from '../../../utils/globalNetwork.js';
import { getMultisigTxTimeout } from '../../../utils/getMultisigTxTimeout.js';
import { getRequiredThreshold } from '../../../utils/getRequiredThreshold.js';
import { needsMultipleSignatures } from '../../../utils/stellar/isMultisigAccount.js';
import { useSettings } from '../../../utils/useSettings.js';
import { formatErrorForUi } from '../../../utils/formatErrorForUi.js';
import { findSessionSigner } from '../../../utils/sessionSigner.js';
import { getUsableSignerKeys } from '../../../utils/sessionSecrets.js';
import { SendBlockedError, guardedUnsignedBuild } from '../../../utils/submitGuard/guardedSubmit.js';

// Aktionen des Trading und ihre Operationen (Namen wie im SDK). changeTrust,
// pathPaymentStrictSend und manageSellOffer sind laut Protokoll Medium-Operationen;
// getRequiredThreshold liefert fuer alle drei med_threshold (bei 0 low, dann high).
export const TRADING_OPERATION_TYPES = Object.freeze({
  trustline: ['changeTrust'],
  swap: ['pathPaymentStrictSend'],
  trustlineSwap: ['changeTrust', 'pathPaymentStrictSend'],
  offer: ['manageSellOffer'],
  cancelOffer: ['manageSellOffer'],
});

/** Gewicht fuer eine Liste von Operationstypen (Maximum ueber die Operationen). */
export function requiredWeightForOperations(operationTypes, thresholds) {
  const ops = Array.isArray(operationTypes) && operationTypes.length ? operationTypes : ['changeTrust'];
  return Math.max(...ops.map((op) => getRequiredThreshold(op, thresholds || null)));
}

/** Gewicht, das eine Trading-Aktion braucht (Maximum ueber ihre Operationen). */
export function requiredWeightFor(type, thresholds) {
  return requiredWeightForOperations(TRADING_OPERATION_TYPES[type], thresholds);
}

// Swap als Job bewusst gesperrt, siehe docs/adr/0011-kein-swap-als-multisig-job.md.
// Bis alle signiert haben, aendert sich der Kurs; die Mindestmenge (destMin) im XDR schuetzt
// vor einem schlechteren Kurs, der Job scheitert dann aber. XDR-Export bleibt erlaubt.
export const JOB_DISABLED_TYPES = Object.freeze(['swap', 'trustlineSwap']);

// Fehler, wenn Netz oder Konto nicht mehr zur bestaetigten Aktion passen.
export const FLOW_CONTEXT_CHANGED = 'trading:assetSearch.multisig.contextChanged';

/**
 * Multisig-Ablauf fuer das Trading wie bei Zahlung senden und Liquidity Pools (ADR 0007):
 * start(action) signiert direkt (SecretKeyModal wie bisher), wenn ein einzelner Signer die
 * Schwelle allein erreicht. Sonst oeffnet es die Auswahl Job, alle Signaturen lokal oder XDR.
 *
 * action: { type, network, accountId, payload, execute(collected), prepare({ server, flow,
 * deferred, timeoutSeconds }), rows (Zusammenfassung in der Auswahl), items(tx)
 * (Zusammenfassung im Ergebnis) }. network und accountId sind die Werte bei der Bestaetigung;
 * Job, XDR und der lokale Weg nehmen beide nur aus der Aktion, nie aus dem Hook-Zustand.
 * prepare baut die Transaktion frisch aus Konto und Sequence des Ablaufnetzes.
 *
 * Job und XDR: Server mit explizitem Netz, Netzpruefung (assertHorizonNetwork), Fee fuer
 * spaeteres Einreichen (deferred) und Gueltigkeit aus den Einstellungen wie in Liquidity Pools,
 * dann finishUnsignedTx (keine lokale Signatur).
 */
export default function useTradingMultisig({ network, accountId, accountInfo, beginAction, closeSecretModal, onBlocked, t }) {
  const { multisigTimeoutSeconds } = useSettings();
  const [options, setOptions] = useState(null);
  const [choice, setChoice] = useState('job');
  // Aktion, die gerade im SecretKeyModal mit "Alle Signaturen lokal" laeuft
  const [localAction, setLocalAction] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [preparedJob, setPreparedJob] = useState(null);
  const [exportedXdr, setExportedXdr] = useState(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  // Aktueller Zustand des Hooks, nur zum Vergleich mit der Aktion (nie zum Bauen).
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  const currentRef = useRef({ network, accountId });
  currentRef.current = { network, accountId };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Netz oder Konto gewechselt, waehrend die Auswahl offen ist: Auswahl schliessen, Hinweis.
  useEffect(() => {
    if (options && (options.network !== network || options.accountId !== accountId)) {
      setOptions(null);
      setError(t(FLOW_CONTEXT_CHANGED));
    }
  }, [accountId, network, options, t]);

  const contextMatches = useCallback((action) => !!action?.network && !!action?.accountId
    && action.network === currentRef.current.network && action.accountId === currentRef.current.accountId, []);

  const openOptions = useCallback((action) => {
    setChoice(JOB_DISABLED_TYPES.includes(action.type) ? 'local' : 'job');
    setOptions(action);
  }, []);

  // Direkter Weg: Ein gemerkter Session-Key, der die Schwelle allein erreicht, signiert ohne
  // Key-Dialog (die Bestaetigung der Aktion ist schon erfolgt). Kein solcher Key: Dialog wie bisher.
  // Nur der direkte Weg: Auswahl, "Alle Signaturen lokal", Job und XDR bleiben wie sie sind.
  const startingRef = useRef(false);
  const start = useCallback((action) => {
    setError('');
    setLocalAction(null);
    const required = requiredWeightFor(action.type, accountInfo?.thresholds);
    if (needsMultipleSignatures(accountInfo, required)) {
      openOptions(action);
      return;
    }
    // Nichts gemerkt (synchron geprueft, ohne etwas zu entschluesseln): Dialog sofort wie bisher.
    if (!getUsableSignerKeys(action.accountId).length) {
      beginAction(action.type, action.payload, action.execute);
      return;
    }
    // Doppelklick waehrend der Key gelesen wird oder gesendet wird: ein zweiter Start zaehlt nicht.
    if (startingRef.current) return;
    startingRef.current = true;
    void (async () => {
      try {
        let signer = [];
        try {
          signer = await findSessionSigner({ accountId: action.accountId, signers: accountInfo?.signers, requiredWeight: required });
        } catch {
          signer = [];
        }
        if (!mountedRef.current) return;
        // Netz oder Konto wechselten, waehrend der Key gelesen wurde: nichts signieren.
        if (!contextMatches(action)) {
          setError(t(FLOW_CONTEXT_CHANGED));
          return;
        }
        if (signer.length) {
          await action.execute(signer);
          return;
        }
        beginAction(action.type, action.payload, action.execute);
      } catch (err) {
        if (mountedRef.current) setError(formatErrorForUi(t, err));
      } finally {
        startingRef.current = false;
      }
    })();
  }, [accountInfo, beginAction, contextMatches, openOptions, t]);

  // Job und XDR: Netz und Konto ausschliesslich aus der Aktion.
  const runUnsigned = useCallback(async (action, mode) => {
    if (inFlightRef.current) return;
    // Swap als Job bewusst gesperrt, siehe docs/adr/0011-kein-swap-als-multisig-job.md.
    if (mode === 'job' && JOB_DISABLED_TYPES.includes(action?.type)) {
      setError(t('trading:assetSearch.multisig.swapJobDisabled'));
      return;
    }
    if (!contextMatches(action)) {
      setError(t(FLOW_CONTEXT_CHANGED));
      return;
    }
    inFlightRef.current = true;
    setProcessing(true);
    setError('');
    try {
      const flow = { network: action.network, accountId: action.accountId };
      assertFlowNetwork(flow.network);
      const server = getHorizonServerForNetwork(flow.network);
      await assertHorizonNetwork(server, passphraseFor(flow.network));
      const timeoutSeconds = getMultisigTxTimeout({ immediateSubmit: false, multisigTimeoutSeconds });
      // Job und XDR werden spaeter eingereicht: schon beim Bauen dieselbe Sperre und derselbe Pin
      // wie beim direkten Senden (guardedUnsignedBuild).
      const { tx } = await guardedUnsignedBuild({
        network: flow.network,
        account: flow.accountId,
        build: ({ adjustAccount }) => action.prepare({ server, flow, deferred: true, timeoutSeconds, adjustAccount }),
      });
      if (!mountedRef.current) return;
      // Quelle und Netz der gebauten Transaktion gegen die Aktion, globales Netz unveraendert
      assertTxMatchesFlow(tx, flow);
      if (!contextMatches(action)) throw new Error(FLOW_CONTEXT_CHANGED);
      const items = action.items(tx);
      const done = await finishUnsignedTx({ mode, tx, network: flow.network, accountId: flow.accountId, items });
      if (!mountedRef.current) return;
      const result = { ...done, operationTypes: tx.operations.map((op) => op.type) };
      if (mode === 'xdr') setExportedXdr(result);
      else setPreparedJob(result);
    } catch (err) {
      if (err instanceof SendBlockedError) {
        // Der Kasten mit dem Status liest den Speicher neu (ein Pin kann wieder unklar sein).
        onBlockedRef.current?.();
        if (mountedRef.current) setError(t(`common:payment.send.ambiguousResult.unsignedBlockedReason.${err.reason}`));
      } else if (mountedRef.current) {
        setError(formatErrorForUi(t, err));
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setProcessing(false);
    }
  }, [contextMatches, multisigTimeoutSeconds, t]);

  const proceed = useCallback(() => {
    const action = options;
    if (!action) return;
    // Swap als Job bewusst gesperrt, siehe docs/adr/0011-kein-swap-als-multisig-job.md.
    // Vor dem Schliessen pruefen, damit die Auswahl offen bleibt.
    if (choice === 'job' && JOB_DISABLED_TYPES.includes(action.type)) return;
    if (!contextMatches(action)) {
      setOptions(null);
      setError(t(FLOW_CONTEXT_CHANGED));
      return;
    }
    setOptions(null);
    if (choice === 'local') {
      setLocalAction(action);
      beginAction(action.type, action.payload, action.execute);
      return;
    }
    void runUnsigned(action, choice === 'xdr' ? 'xdr' : 'job');
  }, [beginAction, choice, contextMatches, options, runUnsigned, t]);

  // Zusatz fuer SecretKeyModal im Weg "Alle Signaturen lokal" (wie SendPayment im Kontext 'local').
  const localModalProps = localAction ? {
    initialCollectAllSignaturesLocally: true,
    secretContext: 'local',
    allowedSigners: accountInfo?.signers || [],
    onBackToSelection: () => {
      closeSecretModal();
      const action = localAction;
      setLocalAction(null);
      openOptions(action);
    },
  } : {};

  return {
    start,
    options,
    choice,
    setChoice,
    proceed,
    // Fuer Tests und kuenftige Aufrufer: prueft Typ und Kontext selbst (nicht nur proceed).
    runUnsigned,
    cancelOptions: () => setOptions(null),
    jobDisabled: !!options && JOB_DISABLED_TYPES.includes(options.type),
    localModalProps,
    clearLocal: () => setLocalAction(null),
    processing,
    error,
    preparedJob,
    clearPreparedJob: () => setPreparedJob(null),
    exportedXdr,
    clearExportedXdr: () => setExportedXdr(null),
  };
}
