import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { horizonUrlFor, passphraseFor } from '../config/networks.js';
import { useTranslation } from 'react-i18next';
import { getPendingMultisigJob, mergeSignedXdr, getMultisigJobChallenge, signMultisigJobChallenge, getMultisigJobAccessToken, declineMultisigJob } from '../utils/multisigApi.js';
import MultisigJobStatusBadge from '../components/MultisigJobStatusBadge.jsx';
import { Keypair, extractBaseAddress } from '@stellar/stellar-sdk';
import { SESSION_LOCKED_EVENT, getSessionSecret, rememberSessionSecrets } from '../utils/sessionSecrets.js';
import { takeMultisigJobToken } from '../components/multisig/multisigNavigation.js';
import { describeOperations, findOperationWarnings, formatAsset } from '../utils/multisig/describeOperations.js';
import OperationBlocks from '../components/multisig/OperationBlocks.jsx';
import TransactionFacts from '../components/multisig/TransactionFacts.jsx';
import { describeTransaction } from '../utils/multisig/describeTransaction.js';
import SecretKeyModal from '../components/SecretKeyModal.jsx';
import { getHorizonServer } from '../utils/stellar/stellarUtils.js';
import { resolveFeePerOp } from '../utils/stellar/fees.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../utils/stellar/submitTransactionSafely.js';
import { getRequiredThreshold } from '../utils/getRequiredThreshold.js';
import { formatErrorForUi } from '../utils/formatErrorForUi.js';
import { accountSequenceOf, assertHorizonNetwork, buildJobRevocationTx, checkRevocationSequence, collectEffectiveSigners, getJobSequenceInfo, parseJobNetwork } from '../utils/multisig/jobRevocation.js';
import { decodeJobTransaction, verifyJobTransaction } from '../utils/multisig/verifyJobTransaction.js';
import { txHashHex } from '../utils/stellar/txHash.js';
import { evaluateLiquidityOperation, exactDepositPrices, hasLiquidityPoolOps, resolveLiquidityPoolInfo } from '../utils/multisig/liquidityPoolInfo.js';
import { jobSubmitResultCodes, liquidityErrorKeyFromResultCodes } from '../utils/stellar/liquidityErrors.js';
import { formatPoolAmount, formatPrice } from '../components/liquidity/formatPoolAmount.js';

const FAILED_PREFIX = 'submitTransaction.failed:';

// Zeitlimit fuer Challenge, Token und Ablehnen: ein haengender Server soll die Ansicht
// nicht dauerhaft blockieren.
function withTimeout(promise, ms = 20000) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

// Sperren den Widerruf. account_mismatch fehlt bewusst: Der Widerruf wirkt immer auf die Quelle
// laut XDR, also auf das Konto, gegen das die Transaktion wirklich laeuft.
const REVOKE_BLOCKING_ISSUES = {
  undecodable: 'multisig:detail.revoke.noTxData',
  network_unknown: 'multisig:detail.revoke.networkUnknown',
  missing_job_data: 'multisig:detail.revoke.missingJobData',
  hash_mismatch: 'multisig:detail.revoke.hashMismatch',
};

const INTEGRITY_ISSUE_TEXTS = {
  undecodable: 'multisig:detail.integrity.undecodable',
  network_unknown: 'multisig:detail.integrity.networkUnknown',
  missing_job_data: 'multisig:detail.integrity.missingJobData',
  hash_mismatch: 'multisig:detail.integrity.hashMismatch',
  account_mismatch: 'multisig:detail.integrity.accountMismatch',
};

// Grund aus submittedResult.error: PHP liefert einen String, Node die Horizon-Antwort.
function submitReasonText(submittedResult) {
  const err = submittedResult?.error;
  if (!err) return '';
  if (typeof err === 'string') return err;
  return String(err.title || err.detail || err.message || 'submit_failed');
}

function MultisigJobDetail({ jobId, accessToken, onBack, currentPublicKey }) {
  const { t, i18n } = useTranslation(['multisig', 'common']);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [importXdr, setImportXdr] = useState('');
  const [importing, setImporting] = useState(false);
  const [showSecretPrompt, setShowSecretPrompt] = useState(false);
  const [secretInput, setSecretInput] = useState('');
  // P2.3 Widerruf: revokePrep haelt die bestaetigten Eckdaten (Konto, Job-Sequence, Threshold)
  const [revokePrep, setRevokePrep] = useState(null);
  const [showRevokeSecretModal, setShowRevokeSecretModal] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [revokedHash, setRevokedHash] = useState('');
  const revokeInFlightRef = useRef(false);

  // A job's access token may arrive as a prop (read by main.jsx) or as a
  // ?token= query parameter, which takeMultisigJobToken moves into memory and
  // removes from the address bar. The job list no longer hands out tokens at all (anyone who knew the public accountId could otherwise
  // read every pending job's token straight from the list) - if neither is
  // present, resolveToken() fetches it on demand, verified server-side against
  // currentPublicKey being an active signer of the job's account. Cached in a
  // ref (not state) since it never affects what's rendered by itself.
  const fetchedTokenRef = useRef(null); // { key: 'jobId:konto', token }
  // Laufende Token-Abfrage je Job und Konto: Parallele Aufrufe (z. B. doppelter Effekt im
  // StrictMode) holen nur eine Challenge, sonst verbraucht die eine die andere
  // (challenge_missing_or_expired).
  const tokenPromiseRef = useRef(null); // { key, promise }
  // Erhoeht bei Job- oder Kontowechsel: Antworten aelterer Aufrufe werden verworfen.
  const scopeRef = useRef(0);
  const tokenKey = `${jobId}:${currentPublicKey || ''}`;
  // Ohne Token und ohne gemerktes Secret gibt der Signer hier seinen Secret Key ein (Job oeffnen).
  // Ohne "merken" bleibt der Keypair nur in diesem Ref, damit "Jetzt signieren" danach nicht
  // erneut fragt. Verworfen nach jedem Signierversuch, bei Sperre (Integritaet, eigenes Konto),
  // beim Sperren der Session, bei Job- oder Kontowechsel und beim Aushaengen.
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [unlockInput, setUnlockInput] = useState('');
  const [unlockRemember, setUnlockRemember] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [hasUnlockedKey, setHasUnlockedKey] = useState(false);
  const unlockedKeypairRef = useRef(null);
  const forgetUnlockedKey = useCallback(() => {
    unlockedKeypairRef.current = null;
    setHasUnlockedKey(false);
  }, []);
  useEffect(() => {
    scopeRef.current += 1;
    unlockedKeypairRef.current = null;
    setHasUnlockedKey(false);
    fetchedTokenRef.current = null;
    setJob(null);
    setNeedsUnlock(false);
    setUnlockInput('');
    setUnlockError('');
    setUnlocking(false);
    return () => { unlockedKeypairRef.current = null; };
  }, [jobId, currentPublicKey]);
  useEffect(() => {
    window.addEventListener(SESSION_LOCKED_EVENT, forgetUnlockedKey);
    return () => window.removeEventListener(SESSION_LOCKED_EVENT, forgetUnlockedKey);
  }, [forgetUnlockedKey]);

  // Fehler beim Zugriff auf den Job (Challenge, Token, Abruf) als lesbarer Text.
  const accessErrorText = useCallback((e) => {
    const code = String(e?.message || '');
    if (e?.status === 403 || code === 'forbidden') return t('multisig:detail.notASigner', 'Dieses Konto ist kein aktiver Signer dieses Auftrags.');
    if (e?.status === 404 || code === 'not_found') return t('multisig:detail.access.notFound', 'Diesen Job gibt es nicht mehr. Abgeschlossene Jobs werden nach 30 Tagen gelöscht.');
    if (code === 'challenge_missing_or_expired') return t('multisig:detail.access.challengeExpired', 'Die Anmeldung am Job ist abgelaufen oder wurde schon verwendet. Bitte erneut versuchen.');
    if (code === 'invalid_signature') return t('multisig:detail.access.invalidSignature', 'Die Signatur der Anmeldung wurde abgelehnt. Bitte erneut versuchen.');
    if (code === 'already_signed') return t('multisig:detail.decline.alreadySigned', 'Du hast bereits signiert und kannst nicht mehr ablehnen.');
    if (['rejected', 'submitted_success', 'submitted_failed', 'expired', 'obsolete_seq'].includes(code)) {
      return t('multisig:detail.access.finalState', { status: t(`multisig:list.status.${code}`, code), defaultValue: 'Der Job ist bereits abgeschlossen ({{status}}).' });
    }
    if (code === 'timeout') return t('multisig:detail.access.timeout', 'Der Server antwortet nicht. Bitte später erneut versuchen.');
    return t('multisig:detail.access.failed', { code: code || '-', defaultValue: 'Der Job konnte nicht geladen werden ({{code}}). Bitte Verbindung prüfen und erneut versuchen.' });
  }, [t]);

  // Challenge holen, lokal signieren, gegen das Token tauschen. Mit Zeitlimit, damit ein
  // haengender Server die Ansicht nicht dauerhaft blockiert.
  // Challenge holen und lokal signieren: Besitznachweis fuer Token und Ablehnen.
  const signFreshChallenge = useCallback(async (secret, purpose = '') => {
    const { challenge } = await withTimeout(getMultisigJobChallenge(jobId, currentPublicKey));
    return signMultisigJobChallenge(secret, challenge, purpose);
  }, [jobId, currentPublicKey]);
  const requestToken = useCallback(async (secret) => (
    withTimeout(getMultisigJobAccessToken(jobId, currentPublicKey, await signFreshChallenge(secret)))
  ), [jobId, currentPublicKey, signFreshChallenge]);

  // Token aus Prop, URL/Speicher, schon geholt oder per Challenge mit gemerktem Secret.
  const resolveToken = useCallback(async () => {
    const known = takeMultisigJobToken(jobId);
    if (accessToken) return accessToken;
    if (known) return known;
    if (fetchedTokenRef.current?.key === tokenKey) return fetchedTokenRef.current.token;
    if (!currentPublicKey) {
      throw Object.assign(new Error('multisig:detail.noAccessToken'), { code: 'no_public_key' });
    }
    if (tokenPromiseRef.current?.key === tokenKey) return tokenPromiseRef.current.promise;
    const promise = (async () => {
      const secret = await getSessionSecret(currentPublicKey, currentPublicKey);
      if (!secret) {
        throw Object.assign(new Error('multisig:detail.noLocalSecretForToken'), { code: 'no_local_secret' });
      }
      const token = await requestToken(secret);
      fetchedTokenRef.current = { key: tokenKey, token };
      return token;
    })();
    tokenPromiseRef.current = { key: tokenKey, promise };
    try {
      return await promise;
    } finally {
      if (tokenPromiseRef.current?.promise === promise) tokenPromiseRef.current = null;
    }
  }, [accessToken, jobId, currentPublicKey, tokenKey, requestToken]);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    const scope = scopeRef.current;
    const stale = () => scope !== scopeRef.current;
    setLoading(true);
    setError('');
    let token = null;
    try {
      token = await resolveToken();
      const data = await getPendingMultisigJob(jobId, token);
      if (stale()) return;
      setJob(data);
      setInfo('');
      setNeedsUnlock(false);
    } catch (e) {
      if (stale()) return;
      const fetchedTokenFailed = !!token && fetchedTokenRef.current?.token === token;
      if (e?.code === 'no_public_key') {
        setError(t('multisig:detail.noAccessToken', 'Kein Zugriffstoken verfügbar. Bitte zuerst das Konto laden, das Signer dieses Auftrags ist.'));
      } else if (e?.code === 'no_local_secret') {
        // Kein Fehler, sondern der normale Weg fuer einen weiteren Signer: Secret abfragen.
        setNeedsUnlock(true);
      } else if (fetchedTokenFailed && e?.status === 403) {
        // Geholtes Token abgelehnt: verwerfen und erneut anmelden lassen, statt bei jedem
        // Neuladen am selben Token zu scheitern.
        fetchedTokenRef.current = null;
        forgetUnlockedKey();
        setUnlockError(t('multisig:detail.access.tokenRejected', 'Der Zugriff wurde abgelehnt. Bitte den Secret Key erneut eingeben.'));
        setNeedsUnlock(true);
      } else {
        setError(accessErrorText(e));
      }
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [jobId, resolveToken, t, accessErrorText, forgetUnlockedKey]);

  useEffect(() => {
    void fetchJob();
  }, [fetchJob]);

  // Job mit eingegebenem Secret oeffnen: Challenge lokal signieren, Token holen, Job laden.
  // Der Key muss zum geladenen Konto gehoeren; ob es Signer des Jobs ist, prueft der Server.
  const unlockWithSecret = useCallback(async () => {
    if (unlocking) return;
    setUnlockError('');
    let kp;
    try {
      kp = Keypair.fromSecret(unlockInput.trim());
    } catch {
      setUnlockError(t('multisig:detail.unlock.invalid', 'Ungültiger Secret Key.'));
      return;
    }
    if (kp.publicKey() !== currentPublicKey) {
      setUnlockError(t('multisig:detail.unlock.wrongKey', { account: currentPublicKey, defaultValue: 'Dieser Secret Key gehört nicht zum geladenen Konto {{account}}.' }));
      return;
    }
    const scope = scopeRef.current;
    const key = tokenKey;
    setUnlocking(true);
    try {
      const token = await requestToken(kp.secret());
      if (scope !== scopeRef.current) return;
      fetchedTokenRef.current = { key, token };
      let remembered = false;
      if (unlockRemember) {
        try { remembered = !!(await rememberSessionSecrets(currentPublicKey, [{ keypair: kp }])); } catch { remembered = false; }
      }
      if (scope !== scopeRef.current) return;
      if (!remembered) {
        unlockedKeypairRef.current = kp;
        setHasUnlockedKey(true);
      }
      setUnlockInput('');
      setNeedsUnlock(false);
      await fetchJob();
      if (unlockRemember && !remembered && scope === scopeRef.current) {
        setInfo(t('multisig:detail.unlock.rememberFailed', 'Der Key konnte nicht in der Session gemerkt werden. Er bleibt nur in dieser Ansicht.'));
      }
    } catch (e) {
      if (scope === scopeRef.current) setUnlockError(accessErrorText(e));
    } finally {
      if (scope === scopeRef.current) setUnlocking(false);
    }
  }, [unlocking, unlockInput, unlockRemember, currentPublicKey, tokenKey, requestToken, fetchJob, accessErrorText, t]);

  const collectedSet = useMemo(() => new Set((job?.collectedSigners || []).map((s) => s.publicKey)), [job]);
  const shortPk = useCallback((pk) => {
    const val = pk || '';
    if (val.length <= 16) return val || t('multisig:list.signer.unknown', 'Signer');
    return `${val.slice(0, 8)}…${val.slice(-8)}`;
  }, [t]);

  const canCurrentSign = useMemo(() => {
    if (!currentPublicKey) return false;
    return !!(job?.signers || []).find((s) => (s.publicKey || '') === currentPublicKey && Number(s.weight || 0) > 0);
  }, [job, currentPublicKey]);
  const signingComplete = useMemo(() => {
    const req = Number(job?.requiredWeight || 0);
    const have = Number(job?.collectedWeight || 0);
    return req > 0 && have >= req;
  }, [job]);
  const submitError = submitReasonText(job?.submittedResult);
  const submitResultCodes = jobSubmitResultCodes(job?.submittedResult);
  const isFinalState = useMemo(() => {
    const s = String(job?.status || '').toLowerCase();
    return ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected'].includes(s);
  }, [job]);
  const declinedSet = useMemo(() => new Set((job?.declinedSigners || []).map((d) => d?.publicKey).filter(Boolean)), [job]);
  const declinedByMe = !!currentPublicKey && declinedSet.has(currentPublicKey);
  // Ablehnen ist immer gefahrlos (es signiert nichts) und deshalb auch bei Warnungen und
  // Sperren moeglich, nur nicht nach der eigenen Signatur oder im Endzustand.
  const canDecline = canCurrentSign && !isFinalState && !collectedSet.has(currentPublicKey) && !declinedByMe;

  // G5 stage 2: decoded client-side purely for display, so a signer can see
  // what they're actually being asked to sign (operations, validity window)
  // before doing so - the job list previously showed only hash/account/
  // network. Decoding failures (malformed/missing XDR) degrade to an empty
  // operations list and an unbounded validity display rather than breaking
  // the page.
  const decodedTx = useMemo(() => (job ? decodeJobTransaction(job) : null), [job]);

  const jobCheck = useMemo(() => verifyJobTransaction(job, decodedTx), [job, decodedTx]);
  const txSourceAccountId = jobCheck.sourceAccountId;
  const decodedOps = useMemo(() => (decodedTx ? (decodedTx.innerTransaction || decodedTx).operations : []), [decodedTx]);
  const hasPoolOps = useMemo(() => hasLiquidityPoolOps(decodedOps), [decodedOps]);
  // Pool-Assets und aktueller Pool-Stand fuer LP-Operationen (nur Anzeige):
  // undefined = noch nicht geladen, {} = nichts bekannt.
  const [poolInfo, setPoolInfo] = useState(undefined);
  const operationBlocks = useMemo(
    () => (decodedTx ? describeOperations(decodedOps, t, txSourceAccountId, { poolInfo, locale: i18n.language }) : []),
    [decodedTx, decodedOps, t, txSourceAccountId, poolInfo, i18n.language]
  );
  const operationWarnings = useMemo(
    () => (decodedTx ? findOperationWarnings((decodedTx.innerTransaction || decodedTx).operations, txSourceAccountId) : { unknownTypes: [], pathPaymentToOther: false, foreignOpSources: [] }),
    [decodedTx, txSourceAccountId]
  );
  // Memo, Fee, Zeitfenster und weitere Preconditions (H1), nur Anzeige plus Bestaetigungspflicht
  // fuer Preconditions, die SKM selbst nie setzt.
  const txDetails = useMemo(
    () => (decodedTx ? describeTransaction(decodedTx, t, { locale: i18n.language }) : null),
    [decodedTx, t, i18n.language]
  );
  const unusualPreconditions = txDetails?.unusualPreconditions || [];
  // Unbekannte Operationen und fremde Quellkonten: Signieren erst nach ausdruecklicher
  // Bestaetigung. Bewusst zwei getrennte Bestaetigungen: Sie gelten verschiedenen Risiken
  // (nicht lesbare Wirkung gegen Autorisierung fuer ein anderes Konto), keine deckt die andere ab.
  // Eine Bestaetigung gilt nur fuer den Job und den aus dem XDR berechneten Hash, fuer die sie
  // gegeben wurde: Job-ID, weil zwei Jobs dasselbe XDR haben koennen. Signaturen aendern den Hash
  // nicht, Neuladen und Merge lassen sie also stehen. Ohne Hash ist nichts bestaetigt.
  const confirmationKey = useMemo(() => {
    if (!decodedTx) return null;
    try {
      return `${jobId}:${txHashHex(decodedTx)}`;
    } catch {
      return null;
    }
  }, [decodedTx, jobId]);
  const [confirmedFor, setConfirmedFor] = useState({});
  const setConfirmed = (kind, checked) => setConfirmedFor((prev) => ({ ...prev, [kind]: checked ? confirmationKey : null }));
  const unknownOpsConfirmed = !!confirmationKey && confirmedFor.unknownOps === confirmationKey;
  const foreignSourcesConfirmed = !!confirmationKey && confirmedFor.foreignSources === confirmationKey;
  const preconditionsConfirmed = !!confirmationKey && confirmedFor.preconditions === confirmationKey;
  // Passt die Transaktion nicht zum Job, gibt es bewusst keine Bestaetigung: Das ist kein
  // abwaegbares Risiko, sondern die Aussage des Servers ist falsch.
  const integrityBlocked = !!job && !isFinalState && !jobCheck.ok;
  const revokeAccountMismatch = jobCheck.issues.find((i) => i.code === 'account_mismatch');
  const visibleIssues = isFinalState ? jobCheck.issues.filter((i) => i.code !== 'undecodable') : jobCheck.issues;
  // F2: Fuehrt eine Operation das aktuelle Konto aus, wuerde die Signatur genau diese Operation
  // fuer das eigene Konto autorisieren (K1 ueber op.source). SKM baut solche Jobs nie, darum
  // hart gesperrt, ohne Bestaetigung.
  const ownAccountAsOpSource = useMemo(() => {
    if (!currentPublicKey) return '';
    let base = currentPublicKey;
    try { base = extractBaseAddress(currentPublicKey); } catch { /* bleibt wie angegeben */ }
    return operationWarnings.foreignOpSources.includes(base) ? base : '';
  }, [currentPublicKey, operationWarnings]);
  const ownAccountBlocked = !!job && !isFinalState && !!ownAccountAsOpSource;
  const signingBlocked = integrityBlocked
    || ownAccountBlocked
    || (operationWarnings.unknownTypes.length > 0 && !unknownOpsConfirmed)
    || (operationWarnings.foreignOpSources.length > 0 && !foreignSourcesConfirmed)
    || (unusualPreconditions.length > 0 && !preconditionsConfirmed);
  // Importierte Signaturen zaehlen wie eigene: der Merge kann den Job einreichen.
  const importBlocked = signingBlocked && !isFinalState;
  // Harte Sperren: einen nur im Speicher gehaltenen Key nicht laenger aufheben.
  useEffect(() => {
    if (integrityBlocked || ownAccountBlocked) forgetUnlockedKey();
  }, [integrityBlocked, ownAccountBlocked, forgetUnlockedKey]);

  // Deliberately NOT a new lifecycle computation (G5 stage 1's
  // computeMultisigLifecycleStatus() already runs server-side on every GET -
  // see summarizeJob()/annotateJobsLifecycleStatus()) - this only interprets
  // the already-recomputed job.status the backend just sent.
  const sequenceLooksAlive = useMemo(() => {
    const s = String(job?.status || '').toLowerCase();
    return s !== 'expired' && s !== 'obsolete_seq';
  }, [job]);

  const jobNetwork = parseJobNetwork(job?.network);

  // Pool-Daten nur neu laden, wenn sich die Transaktion selbst aendert: der Hash
  // haengt nicht an den Signaturen, ein Signatur-Update laedt Horizon also nicht neu.
  const poolOpsKey = useMemo(() => {
    if (!hasPoolOps || !decodedTx) return '';
    try {
      return txHashHex(decodedTx);
    } catch {
      return '';
    }
  }, [decodedTx, hasPoolOps]);
  const decodedOpsRef = useRef(decodedOps);
  decodedOpsRef.current = decodedOps;

  useEffect(() => {
    setPoolInfo(undefined);
    if (!poolOpsKey) return undefined;
    // Unbekanntes Job-Netz: nichts laden, Fallback (Asset A/B mit Hinweis) zeigen.
    if (!jobNetwork) {
      setPoolInfo({});
      return undefined;
    }
    let cancelled = false;
    resolveLiquidityPoolInfo({ operations: decodedOpsRef.current, server: getHorizonServer(horizonUrlFor(jobNetwork)) })
      .then((info) => { if (!cancelled) setPoolInfo(info); })
      .catch(() => { if (!cancelled) setPoolInfo({}); });
    return () => { cancelled = true; };
  }, [poolOpsKey, jobNetwork]);

  // Aktueller Stand je LP-Operation gegen den Pool laut Horizon, neutral formuliert.
  const poolStateLines = useMemo(() => {
    if (!hasPoolOps || !poolInfo) return [];
    const prices = exactDepositPrices(decodedTx);
    // Gleiche Beschriftung wie in describeOperations: Tokens immer mit Issuer, auch ein Token "XLM".
    const label = formatAsset;
    return decodedOps.flatMap((op, index) => {
      if (op?.type !== 'liquidityPoolDeposit' && op?.type !== 'liquidityPoolWithdraw') return [];
      const info = poolInfo[op.liquidityPoolId];
      const state = info?.pool ? evaluateLiquidityOperation(op, info.pool, prices[index]) : null;
      if (!state) {
        const pool = String(op.liquidityPoolId || '');
        return [t('multisig:detail.liquidityState.unavailable', { pool: pool.length > 16 ? `${pool.slice(0, 8)}…${pool.slice(-8)}` : pool })];
      }
      const pair = `${label(info.assetA)}/${label(info.assetB)}`;
      if (state.kind === 'deposit') {
        return [t(state.withinBounds ? 'multisig:detail.liquidityState.depositInside' : 'multisig:detail.liquidityState.depositOutside', {
          pair,
          price: formatPrice(state.currentPrice, i18n.language),
        })];
      }
      return [t(state.meetsMinimum ? 'multisig:detail.liquidityState.withdrawOk' : 'multisig:detail.liquidityState.withdrawBelow', {
        pair,
        assetA: label(info.assetA),
        assetB: label(info.assetB),
        amountA: formatPoolAmount(state.amountA, i18n.language),
        amountB: formatPoolAmount(state.amountB, i18n.language),
      })];
    });
  }, [decodedOps, decodedTx, hasPoolOps, i18n.language, poolInfo, t]);

  // LP-Op-Codes beim Absenden wie im direkten Weg uebersetzen (liquidityErrors.js).
  const liquiditySubmitText = useCallback((submittedResult) => {
    if (!hasPoolOps) return '';
    const key = liquidityErrorKeyFromResultCodes(jobSubmitResultCodes(submittedResult), decodedOps);
    if (!key) return '';
    const detail = key.slice(FAILED_PREFIX.length);
    return t(`errors:submitTransaction.failed.${detail}`, detail);
  }, [decodedOps, hasPoolOps, t]);

  // Wechselt der Job (Neuladen, Signatur), gilt eine offene Bestaetigung nicht mehr.
  useEffect(() => {
    if (!revokePrep) return;
    const sameJob = revokePrep.jobHash === (job?.txHash || null) && revokePrep.network === parseJobNetwork(job?.network);
    if (sameJob) return;
    setRevokePrep(null);
    setShowRevokeSecretModal(false);
  }, [job, revokePrep]);

  const describeRevokeError = useCallback((e) => {
    if (e instanceof AmbiguousSubmitResultError) {
      return t('multisig:detail.revoke.ambiguous', { hash: e.hash });
    }
    const codes = e?.response?.data?.extras?.result_codes;
    if (e?.code === 'network_mismatch') return t('multisig:detail.revoke.networkMismatch');
    if (codes) return t('multisig:detail.revoke.failed', { reason: JSON.stringify(codes) });
    return t('multisig:detail.revoke.failed', { reason: formatErrorForUi(t, e) });
  }, [t]);

  // Schritt 1: Konto laden, pruefen ob der Job noch lebt, Bestaetigung anzeigen.
  const startRevoke = useCallback(async () => {
    setRevokeError('');
    setError('');
    // Server-Daten nicht blind vertrauen: Netzwerk muss bekannt sein, das XDR muss zum
    // gespeicherten Hash passen (der Hash haengt am Netzwerk).
    const blocking = jobCheck.issues.find((i) => REVOKE_BLOCKING_ISSUES[i.code]);
    if (blocking) {
      setRevokeError(t(REVOKE_BLOCKING_ISSUES[blocking.code]));
      return;
    }
    const seqInfo = getJobSequenceInfo(decodedTx);
    const networkPassphrase = passphraseFor(jobNetwork);
    const horizonUrl = horizonUrlFor(jobNetwork);
    try {
      setRevoking(true);
      const account = await getHorizonServer(horizonUrl).loadAccount(seqInfo.sourceAccountId);
      const seqCheck = checkRevocationSequence(accountSequenceOf(account), seqInfo.sequence);
      if (seqCheck === 'consumed') {
        setInfo(t('multisig:detail.revoke.alreadyDead'));
        return;
      }
      if (seqCheck !== 'ok') {
        setRevokeError(t(seqCheck === 'too_far' ? 'multisig:detail.revoke.sequenceTooFar' : 'multisig:detail.revoke.sequenceInvalid'));
        return;
      }
      const thresholds = account?.thresholds;
      if (!thresholds || !Number.isFinite(Number(thresholds.low_threshold))) {
        setRevokeError(t('multisig:detail.revoke.noThresholds'));
        return;
      }
      // Alles, was signiert wird, ist ab hier eingefroren und genau so in der Bestaetigung sichtbar.
      setRevokePrep({
        ...seqInfo,
        account,
        network: jobNetwork,
        networkPassphrase,
        horizonUrl,
        jobHash: job?.txHash || null,
        requiredThreshold: getRequiredThreshold('bumpSequence', thresholds),
      });
    } catch (e) {
      setRevokeError(describeRevokeError(e));
    } finally {
      setRevoking(false);
    }
  }, [decodedTx, describeRevokeError, job, jobCheck, jobNetwork, t]);

  // Schritt 2: mit den im SecretKeyModal gesammelten Signern signieren und senden.
  // Die Secrets bleiben im Speicher dieses Aufrufs, sie werden weder gespeichert noch
  // an das Backend geschickt - nur die signierte Transaktion geht an Horizon.
  const executeRevoke = useCallback(async (collected) => {
    if (!revokePrep || revokeInFlightRef.current) return;
    revokeInFlightRef.current = true;
    try {
      setRevoking(true);
      setRevokeError('');
      const server = getHorizonServer(revokePrep.horizonUrl);
      await assertHorizonNetwork(server, revokePrep.networkPassphrase);
      // Frisch laden: Sequence und Signer koennen sich seit der Bestaetigung geaendert haben.
      const account = await server.loadAccount(revokePrep.sourceAccountId);
      const seqCheck = checkRevocationSequence(accountSequenceOf(account), revokePrep.sequence);
      if (seqCheck !== 'ok') {
        setShowRevokeSecretModal(false);
        setRevokePrep(null);
        if (seqCheck === 'consumed') setInfo(t('multisig:detail.revoke.alreadyDead'));
        else setRevokeError(t(seqCheck === 'too_far' ? 'multisig:detail.revoke.sequenceTooFar' : 'multisig:detail.revoke.sequenceInvalid'));
        return;
      }
      const required = getRequiredThreshold('bumpSequence', account?.thresholds);
      const { signers, weight } = collectEffectiveSigners(collected, account?.signers);
      if (!signers.length || weight < required) {
        setRevokeError(t('multisig:detail.revoke.insufficientWeight', { required }));
        return;
      }
      const fee = await resolveFeePerOp(server);
      const tx = buildJobRevocationTx({
        account,
        jobSequence: revokePrep.sequence,
        fee,
        networkPassphrase: revokePrep.networkPassphrase,
      });
      signers.forEach((s) => tx.sign(s.keypair));
      const res = await submitTransactionSafely(server, tx);
      const hash = res?.hash || res?.id || txHashHex(tx);
      setRevokedHash(hash);
      setShowRevokeSecretModal(false);
      setRevokePrep(null);
      await fetchJob();
      setInfo(t('multisig:detail.revoke.success', { hash }));
    } catch (e) {
      console.error('[SKM] multisig job revocation failed', e);
      setRevokeError(describeRevokeError(e));
    } finally {
      revokeInFlightRef.current = false;
      setRevoking(false);
    }
  }, [describeRevokeError, fetchJob, revokePrep, t]);

  const handleMerge = useCallback(async () => {
    if (!jobId || !importXdr.trim() || importBlocked) return;
    setImporting(true);
    setError('');
    try {
      const token = await resolveToken();
      const data = await mergeSignedXdr({ jobId, signedXdr: importXdr.trim(), accessToken: token });
      setJob(data);
      setImportXdr('');
      setInfo(t('multisig:detail.signedXdr.success.body', { status: data?.status || '' }));
    } catch (e) {
      const raw = e?.message || 'merge_failed';
      if (e?.code === 'no_public_key') {
        setError(t('multisig:detail.noAccessToken', 'Kein Zugriffstoken verfügbar. Bitte zuerst das Konto laden, das Signer dieses Auftrags ist.'));
      } else if (e?.code === 'no_local_secret') {
        setError(t('multisig:detail.noLocalSecretForToken', 'Kein Zugriffstoken verfügbar: Es bleibt nur bis zum Neuladen der Seite erhalten, und für dieses Konto ist in diesem Browser kein Secret gespeichert. Bitte den Job-Link mit Zugriffstoken erneut öffnen oder das Konto einmal mit "Secret merken" laden.'));
      } else if (e?.status === 403) {
        setError(t('multisig:detail.notASigner', 'Dieses Konto ist kein aktiver Signer dieses Auftrags.'));
      } else if (raw === 'mismatched_hash') {
        setError(t('multisig:errors.mismatchedHash'));
      } else if (raw === 'account_mismatch') {
        setError(t('multisig:errors.accountMismatch'));
      } else if (raw === 'signers_unavailable') {
        setError(t('multisig:errors.signersUnavailable'));
      } else {
        setError(raw);
      }
    } finally {
      setImporting(false);
    }
  }, [importXdr, importBlocked, jobId, resolveToken, t]);

  const signWithSecret = useCallback(async (secret) => {
    if (!job || signingBlocked) return;
    if (!canCurrentSign) {
      setError(t('multisig:detail.signatures.missing', 'fehlt'));
      return;
    }
    try {
      setLoading(true);
      // Frisch dekodiert: tx.sign() veraendert das Objekt, decodedTx dient der Anzeige.
      const tx = decodeJobTransaction(job);
      if (!verifyJobTransaction(job, tx).ok) {
        setError(t('multisig:detail.integrity.title'));
        return;
      }
      const kp = Keypair.fromSecret(secret);
      // F2 auch fuer jeden anderen eingegebenen Key: Gehoert er zu einem Konto, das eine
      // Operation ausfuehrt, wuerde die Signatur diese Operation autorisieren.
      const txSource = verifyJobTransaction(job, tx).sourceAccountId;
      const opSources = findOperationWarnings((tx.innerTransaction || tx).operations, txSource).foreignOpSources;
      if (opSources.includes(kp.publicKey())) {
        setError(t('multisig:detail.operations.keyIsOpSource', {
          account: kp.publicKey(),
          defaultValue: 'Nicht signiert: Der eingegebene Key gehört zum Konto {{account}}, das in diesem Job selbst eine Operation ausführt. Deine Signatur würde diese Operation für dieses Konto autorisieren.',
        }));
        return;
      }
      tx.sign(kp);
      const signerMeta = (job.signers || []).map((s) => ({
        publicKey: s.publicKey,
        weight: Number(s.weight || 0),
      })).filter((s) => s.publicKey && s.weight > 0);
      const clientCollected = [{
        publicKey: kp.publicKey(),
        weight: signerMeta.find((s) => s.publicKey === kp.publicKey())?.weight ?? 0,
      }];
      const token = await resolveToken();
      const merged = await mergeSignedXdr({
        jobId,
        signedXdr: tx.toXDR(),
        clientCollected,
        signers: signerMeta,
        accessToken: token,
      });
      setJob(merged);
      const st = merged?.status || 'pending_signatures';
      setInfo(t('multisig:detail.signatures.signedLocalStatus', { status: t(`multisig:list.status.${st}`, st) }));
      const submitErr = submitReasonText(merged?.submittedResult);
      if (submitErr) {
        const lpText = liquiditySubmitText(merged?.submittedResult);
        setError(`${t('multisig:detail.submitFailed', { reason: submitErr })}${lpText ? ` ${lpText}` : ''}`);
      } else {
        setError('');
      }
      setShowSecretPrompt(false);
      setSecretInput('');
      forgetUnlockedKey();
    } catch (e) {
      if (e?.code === 'no_public_key') {
        setError(t('multisig:detail.noAccessToken', 'Kein Zugriffstoken verfügbar. Bitte zuerst das Konto laden, das Signer dieses Auftrags ist.'));
      } else if (e?.code === 'no_local_secret') {
        setError(t('multisig:detail.noLocalSecretForToken', 'Kein Zugriffstoken verfügbar: Es bleibt nur bis zum Neuladen der Seite erhalten, und für dieses Konto ist in diesem Browser kein Secret gespeichert. Bitte den Job-Link mit Zugriffstoken erneut öffnen oder das Konto einmal mit "Secret merken" laden.'));
      } else if (e?.status === 403) {
        setError(t('multisig:detail.notASigner', 'Dieses Konto ist kein aktiver Signer dieses Auftrags.'));
      } else if (String(e?.message || '') === 'signers_unavailable') {
        setError(t('multisig:errors.signersUnavailable'));
      } else if (String(e?.message || '') === 'account_mismatch') {
        setError(t('multisig:errors.accountMismatch'));
      } else {
        setError(String(e?.message || 'multisig.jobs.merge_failed'));
      }
    } finally {
      setLoading(false);
    }
  }, [job, jobId, canCurrentSign, signingBlocked, t, resolveToken, liquiditySubmitText, forgetUnlockedKey]);

  const handleSignWithSession = useCallback(async () => {
    if (!job || signingBlocked) return;
    if (!canCurrentSign) {
      setError(t('multisig:detail.signatures.missing', 'fehlt'));
      return;
    }
    const stored = await getSessionSecret(job?.accountId || '', currentPublicKey);
    const secret = stored || unlockedKeypairRef.current?.secret() || '';
    if (!secret) {
      setError(t('multisig:detail.signatures.noSessionSecret', 'Kein Secret Key im Browser gespeichert. Bitte Secret eingeben oder signiertes XDR importieren.'));
      setShowSecretPrompt(true);
      return;
    }
    try {
      await signWithSecret(secret);
    } finally {
      // Der eingegebene Key gilt fuer genau einen Signierversuch, ob erfolgreich oder nicht.
      if (!stored) forgetUnlockedKey();
    }
  }, [job, canCurrentSign, currentPublicKey, signingBlocked, t, signWithSecret, forgetUnlockedKey]);

  // Ablehnen: Besitznachweis per signierter Challenge, Key aus der Session, aus dem Oeffnen
  // (nur im Speicher) oder hier eingegeben. Signiert keine Transaktion.
  const [showDecline, setShowDecline] = useState(false);
  const [declineInput, setDeclineInput] = useState('');
  const [declineNeedsKey, setDeclineNeedsKey] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState('');
  // Sofortige Sperre gegen Doppelklick: der State greift erst nach dem naechsten Render.
  const declineInFlightRef = useRef(false);
  useEffect(() => {
    setShowDecline(false);
    setDeclineInput('');
    setDeclineError('');
    setDeclining(false);
  }, [jobId, currentPublicKey]);

  const openDecline = useCallback(async () => {
    setDeclineError('');
    setDeclineInput('');
    const stored = await getSessionSecret(job?.accountId || '', currentPublicKey);
    setDeclineNeedsKey(!stored && !unlockedKeypairRef.current);
    setShowDecline(true);
  }, [job, currentPublicKey]);

  // Bewusst ohne useCallback: liest bei jedem Klick den aktuellen Stand (Key-Eingabe, Job).
  const handleDecline = async () => {
    if (declineInFlightRef.current || declining || !canDecline) return;
    declineInFlightRef.current = true;
    try {
      await runDecline();
    } finally {
      declineInFlightRef.current = false;
    }
  };

  const runDecline = async () => {
    setDeclineError('');
    const stored = await getSessionSecret(job?.accountId || '', currentPublicKey);
    const secret = stored || unlockedKeypairRef.current?.secret() || declineInput.trim();
    let kp;
    try {
      kp = Keypair.fromSecret(secret);
    } catch {
      setDeclineError(t('multisig:detail.unlock.invalid', 'Ungültiger Secret Key.'));
      return;
    }
    if (kp.publicKey() !== currentPublicKey) {
      setDeclineError(t('multisig:detail.unlock.wrongKey', { account: currentPublicKey, defaultValue: 'Dieser Secret Key gehört nicht zum geladenen Konto {{account}}.' }));
      return;
    }
    const scope = scopeRef.current;
    setDeclining(true);
    try {
      const signature = await signFreshChallenge(kp.secret(), 'decline');
      const result = await withTimeout(declineMultisigJob(jobId, currentPublicKey, signature));
      if (scope !== scopeRef.current) return;
      if (!stored) forgetUnlockedKey();
      setShowDecline(false);
      setDeclineInput('');
      await fetchJob();
      if (scope === scopeRef.current) {
        setInfo(result?.status === 'rejected'
          ? t('multisig:detail.decline.doneRejected', 'Abgelehnt. Ohne dich reicht das Gewicht nicht mehr, der Job ist damit abgelehnt und nimmt keine Signaturen mehr an.')
          : t('multisig:detail.decline.done', 'Abgelehnt. Die anderen Signer sehen deine Ablehnung.'));
      }
    } catch (e) {
      if (scope === scopeRef.current) setDeclineError(accessErrorText(e));
    } finally {
      if (scope === scopeRef.current) setDeclining(false);
    }
  };

  if (!jobId) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('multisig:detail.title', 'Pending Multisig Job')}</h1>
          {job?.status && <MultisigJobStatusBadge status={job.status} />}
        </div>
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              className="text-sm px-3 py-1 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => {
                try { onBack(); } catch { /* noop */ }
              }}
            >
              {t('common:option.back', 'Zurück')}
            </button>
          )}
          {/* Neu laden nur, solange sich am Job noch etwas aendern kann (andere Signer). */}
          {!isFinalState && (
            <button
              type="button"
              className="text-sm px-3 py-1 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={fetchJob}
              disabled={loading}
            >
              {t('common:refresh', 'Refresh')}
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {needsUnlock && !job && (
        <div className="border border-amber-500 rounded-sm p-3 space-y-3 bg-amber-50 dark:bg-amber-900/40 shadow-xs" data-testid="job-unlock">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {t('multisig:detail.unlock.title', 'Secret Key eingeben, um den Job zu öffnen')}
          </div>
          <div className="text-xs text-gray-700 dark:text-gray-300 break-words">
            {t('multisig:detail.unlock.hint', {
              account: currentPublicKey,
              defaultValue: 'Der Zugriff auf diesen Job ist in diesem Browser nicht gespeichert (z. B. nach dem Neuladen oder auf einem anderen Gerät). Gib den Secret Key von {{account}} ein. SKM signiert damit lokal eine einmalige Anfrage, der Server prüft, ob das Konto Signer des Jobs ist. Der Key verlässt den Browser nicht. Danach siehst du die Transaktion und signierst sie mit einem Klick, der Key wird nicht erneut abgefragt.',
            })}
          </div>
          <form
            className="space-y-2"
            onSubmit={(e) => { e.preventDefault(); void unlockWithSecret(); }}
          >
            <input
              type="password"
              value={unlockInput}
              onChange={(e) => setUnlockInput(e.target.value)}
              aria-label={t('multisig:detail.unlock.label', 'Secret Key')}
              className="w-full border-2 border-amber-500 rounded-sm px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              placeholder={t('secretKey:placeholder', 'Secret Key eingeben')}
              autoComplete="off"
              spellCheck="false"
            />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={unlockRemember} onChange={(e) => setUnlockRemember(e.target.checked)} />
              {t('multisig:detail.unlock.remember', 'In dieser Session merken (verschlüsselt, gelöscht nach Sperren, Inaktivität oder Neuladen)')}
            </label>
            {unlockError && <div className="text-xs text-red-600" role="alert">{unlockError}</div>}
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-3 py-1 rounded-sm bg-blue-600 text-white hover:bg-blue-700 text-sm disabled:opacity-50"
                disabled={unlocking || !unlockInput.trim()}
              >
                {unlocking ? t('common:common.loading') : t('multisig:detail.unlock.submit', 'Job öffnen und prüfen')}
              </button>
            </div>
          </form>
        </div>
      )}
      {info && <div className="text-sm text-green-700 dark:text-green-400">{info}</div>}
      {loading && <div className="text-sm text-gray-600">{t('common:common.loading')}</div>}

      {job && (
        <div className="space-y-3">
          {visibleIssues.length > 0 && (
            <div role="alert" className="space-y-2 rounded-sm border border-red-400 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100" data-testid="job-integrity-block">
              <p className="font-semibold">{t('multisig:detail.integrity.title')}</p>
              {visibleIssues.map((issue) => (
                <div key={issue.code} className="space-y-1 text-xs">
                  <p>{t(INTEGRITY_ISSUE_TEXTS[issue.code], { network: issue.actual })}</p>
                  {issue.code === 'account_mismatch' && (
                    <dl className="font-mono break-all">
                      <dt className="font-sans font-medium">{t('multisig:detail.integrity.jobAccount')}</dt>
                      <dd>{issue.expected}</dd>
                      <dt className="font-sans font-medium">{t('multisig:detail.integrity.txSource')}</dt>
                      <dd>{issue.actual}</dd>
                    </dl>
                  )}
                  {issue.code === 'hash_mismatch' && (
                    <dl className="font-mono break-all">
                      <dt className="font-sans font-medium">{t('multisig:detail.integrity.jobHash')}</dt>
                      <dd>{issue.expected}</dd>
                      <dt className="font-sans font-medium">{t('multisig:detail.integrity.txHash')}</dt>
                      <dd>{issue.actual}</dd>
                    </dl>
                  )}
                </div>
              ))}
              {!isFinalState && visibleIssues.every((i) => !REVOKE_BLOCKING_ISSUES[i.code]) && (
                <p className="text-xs">{t('multisig:detail.integrity.revokeHint')}</p>
              )}
            </div>
          )}
          <div className="border rounded-sm p-3 text-sm">
            <div className="font-mono break-all text-xs text-gray-600 dark:text-gray-300">ID: {job.id}</div>
            <div className="flex flex-wrap gap-3 mt-2">
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.network', 'Netzwerk')}: {job.network}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('publicKey:source', 'Quelle')}: <span className="font-mono break-all" data-testid="job-source">{jobCheck.sourceAccountId || t('multisig:detail.sourceUnknown')}</span></span>
              {jobCheck.muxedSource && (
                <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.sourceMuxed')}: <span className="font-mono break-all" data-testid="job-source-muxed">{jobCheck.muxedSource}</span></span>
              )}
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:prepare.hashLabel')}: <span className="font-mono break-all">{job.txHash}</span></span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.statusLabel', 'Status')}: {t(`multisig:list.status.${job.status}`, job.status)}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('common:createdAt', 'Angelegt')}: {job.createdAt}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('common:createdBy', 'Erstellt von')}: {job.createdBy || '-'}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.updatedAt', 'Aktualisiert am')}: {job.updatedAt || '-'}</span>
            </div>
            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200 space-y-1">
              <div className="font-semibold">{t('multisig:detail.signatures.title', 'Signaturen')}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('multisig:detail.signatures.progress', {
                  collected: job.collectedWeight ?? 0,
                  required: job.requiredWeight ?? 0,
                })}
              </div>
              <div className="flex flex-wrap gap-1">
                {(job?.signers || []).map((s) => {
                  const pk = s.publicKey || '';
                  const signed = collectedSet.has(pk);
                  const declined = !signed && declinedSet.has(pk);
                  const tone = signed
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                    : declined
                      ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100';
                  return (
                    <span
                      key={pk || Math.random()}
                      className={`px-2 py-0.5 rounded-sm text-xs ${tone}`}
                      title={pk}
                      data-testid={declined ? 'job-signer-declined' : undefined}
                    >
                      {shortPk(pk)}
                      {' '}
                      {signed
                        ? t('multisig:detail.signatures.signed', 'unterzeichnet')
                        : declined
                          ? t('multisig:detail.signatures.declined', 'abgelehnt')
                          : t('multisig:detail.signatures.missing', 'fehlt')}
                    </span>
                  );
                })}
              </div>
            </div>
            {job.status && (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                {t(`multisig:job.statusHelp.${job.status}`, t('multisig:job.statusHelp.unknown'))}
              </div>
            )}
          </div>

          <div className="border rounded-sm p-3 space-y-2 text-sm">
            <div className="font-semibold">{t('multisig:detail.transparency.title', 'Transaktionsdetails')}</div>
            {txDetails && (
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                  {t('multisig:detail.tx.title', 'Transaktion')}
                </div>
                <TransactionFacts details={txDetails} title={t('multisig:detail.tx.title', 'Transaktion')} />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  {t('multisig:detail.tx.feeHint', 'Die Fee ist ein Höchstgebot. Ohne Netzlast wird nur die Basisgebühr berechnet, bei Netzlast bis zu diesem Betrag.')}
                </p>
                {txDetails.warnings.length > 0 && (
                  <ul role="alert" className="mt-2 list-disc space-y-0.5 rounded-sm bg-amber-50 p-2 pl-6 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100" data-testid="job-tx-warnings">
                    {txDetails.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                )}
                {unusualPreconditions.length > 0 && (
                  <div role="alert" className="mt-2 space-y-1 rounded-sm border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100" data-testid="job-tx-preconditions">
                    <p className="font-medium">
                      {t('multisig:detail.tx.warnPreconditions', {
                        list: unusualPreconditions.map((key) => t(`multisig:detail.tx.preconditionNames.${key}`, { defaultValue: key })).join(', '),
                        defaultValue: 'Diese Transaktion hat Bedingungen, die SKM selbst nie setzt: {{list}}. Sie bestimmen, ab wann oder unter welchen Umständen die Transaktion gültig ist; ein Extra Signer verlangt zusätzlich die Signatur eines weiteren Schlüssels. Prüfe die gelb markierten Zeilen, bevor du signierst.',
                      })}
                    </p>
                    {!isFinalState && !integrityBlocked && (
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={preconditionsConfirmed} onChange={(e) => setConfirmed('preconditions', e.target.checked)} />
                        {t('multisig:detail.tx.confirmPreconditions', 'Ich habe die zusätzlichen Bedingungen geprüft und möchte trotzdem signieren.')}
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
            <div>
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                {t('multisig:detail.operations.title', 'Transaktionsoperationen')}
              </div>
              {operationBlocks.length > 0 ? (
                <OperationBlocks blocks={operationBlocks} />
              ) : (
                <div className="text-gray-600 dark:text-gray-300">
                  {t('multisig:detail.operations.none', 'Keine Operationen erkennbar (XDR konnte nicht dekodiert werden).')}
                </div>
              )}
              {hasPoolOps && (
                <div className="mt-2 rounded-sm bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-900/50 dark:text-gray-200" data-testid="job-pool-state">
                  <div className="font-semibold">{t('multisig:detail.liquidityState.title')}</div>
                  {poolInfo === undefined ? (
                    <div>{t('multisig:detail.liquidityState.loading')}</div>
                  ) : (
                    <ul className="list-disc list-inside space-y-0.5">
                      {poolStateLines.map((line, idx) => <li key={idx}>{line}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {operationWarnings.pathPaymentToOther && (
                <p role="alert" className="mt-2 rounded-sm bg-amber-50 p-2 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                  {t('multisig:detail.operations.warnPathPaymentToOther')}
                </p>
              )}
              {operationWarnings.foreignOpSources.length > 0 && (
                <div role="alert" className="mt-2 space-y-1 rounded-sm border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100" data-testid="job-foreign-sources">
                  <p className="font-medium">{t('multisig:detail.operations.warnForeignSources', 'Achtung: Mindestens eine Operation hat ein anderes Quellkonto als die Transaktion. Für sie zählen die Signer und Thresholds des jeweiligen Kontos, nicht nur die des Job-Kontos; die angezeigte Signaturanzahl berücksichtigt das nicht. Gehört einer deiner Keys zu diesem Konto, autorisiert deine Signatur auch diese Operation. Prüfe die Adressen, bevor du signierst:')}</p>
                  <ul className="list-disc pl-4 font-mono">
                    {operationWarnings.foreignOpSources.map((account) => (
                      <li key={account} className="break-all">
                        {account}
                        {account === ownAccountAsOpSource && <span className="font-sans font-semibold"> ({t('multisig:detail.operations.ownAccountMarker', 'dein aktuelles Konto')})</span>}
                      </li>
                    ))}
                  </ul>
                  {ownAccountAsOpSource && (
                    <p className="font-semibold" data-testid="job-own-account-source">
                      {t('multisig:detail.operations.ownAccountAsSource', {
                        account: ownAccountAsOpSource,
                        defaultValue: 'Gesperrt: Eine Operation wird von deinem aktuellen Konto {{account}} ausgeführt, nicht vom Job-Konto. Deine Signatur würde sie für dein Konto autorisieren, zum Beispiel eine Zahlung aus deinem Guthaben. SKM baut solche Jobs nie selbst, darum sind Signieren und Import hier gesperrt.',
                      })}
                    </p>
                  )}
                  {!isFinalState && !integrityBlocked && !ownAccountAsOpSource && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={foreignSourcesConfirmed} onChange={(e) => setConfirmed('foreignSources', e.target.checked)} />
                      {t('multisig:detail.operations.confirmForeignSources', 'Ich habe die fremden Quellkonten geprüft und möchte trotzdem signieren.')}
                    </label>
                  )}
                </div>
              )}
              {operationWarnings.unknownTypes.length > 0 && (
                <div role="alert" className="mt-2 space-y-1 rounded-sm border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100">
                  <p className="font-medium">{t('multisig:detail.operations.warnUnknown', { types: operationWarnings.unknownTypes.join(', ') })}</p>
                  {!isFinalState && !integrityBlocked && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={unknownOpsConfirmed} onChange={(e) => setConfirmed('unknownOps', e.target.checked)} />
                      {t('multisig:detail.operations.confirmUnknown')}
                    </label>
                  )}
                </div>
              )}
            </div>
            {/* Nach dem Einreichen ist die Sequence verbraucht, der Status oben sagt dann alles. */}
            {!String(job.status || '').startsWith('submitted_') && (
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div>
                <span className="text-gray-600 dark:text-gray-300">{t('multisig:detail.sequenceStatus.label', 'Sequenz-Status')}: </span>
                <span className={`font-medium ${sequenceLooksAlive ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {sequenceLooksAlive
                    ? t('multisig:detail.sequenceStatus.valid', 'aktuell gültig')
                    : t('multisig:detail.sequenceStatus.dead', 'nicht mehr einlösbar')}
                </span>
              </div>
            </div>
            )}
          </div>

          {Array.isArray(job.changes) && job.changes.length > 0 && (
            <div className="border rounded-sm p-3">
              <div className="font-semibold mb-2">{t('multisig:detail.changes.title')}</div>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-800 dark:text-gray-200">
                {job.changes.map((c, idx) => {
                  if (c.type === 'set_signer') return <li key={idx}>{t('multisig:detail.changes.addSigner', { account: c.accountId || c.account || '', weight: c.weight ?? c.value ?? 0 })}</li>;
                  if (c.type === 'remove_signer') return <li key={idx}>{t('multisig:detail.changes.removeSigner', { account: c.accountId || c.account || '' })}</li>;
                  if (c.type === 'set_threshold' || c.type === 'set_thresholds') return <li key={idx}>{t('multisig:detail.changes.setThresholds', { low: c.low ?? c.lowThreshold ?? c.thresholds?.low ?? '-', med: c.med ?? c.medThreshold ?? c.thresholds?.med ?? '-', high: c.high ?? c.highThreshold ?? c.thresholds?.high ?? '-' })}</li>;
                  return <li key={idx}>{c.type}</li>;
                })}
              </ul>
            </div>
          )}

          {canCurrentSign && !isFinalState && (
            <div className="flex items-center justify-between gap-3 border rounded-sm p-3">
              <div className="text-sm font-semibold">
                {t('multisig:detail.secretPrompt.signNow', 'Jetzt signieren')}
                {hasUnlockedKey && (
                  <div className="text-xs font-normal text-gray-600 dark:text-gray-300" data-testid="job-key-ready">
                    {t('multisig:detail.unlock.keyReady', 'Der eingegebene Key wird verwendet, keine weitere Abfrage.')}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded-sm border border-green-200 text-green-700 dark:text-green-200 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900"
                onClick={handleSignWithSession}
                disabled={loading || signingComplete || signingBlocked}
              >
                {t('multisig:detail.secretPrompt.signNow', 'Jetzt signieren')}
              </button>
            </div>
          )}

          {showSecretPrompt && canCurrentSign && !isFinalState && (
            <div className="border border-amber-500 rounded-sm p-3 space-y-3 bg-amber-50 dark:bg-amber-900/40 shadow-xs">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                {t('multisig:detail.secretPrompt.title', 'Secret eingeben, um zu signieren')}
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-300">
                {t('multisig:detail.secretPrompt.hint', { account: currentPublicKey })}
              </div>
              <input
                type="password"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                className="w-full border-2 border-amber-500 rounded-sm px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                placeholder={t('secretKey:placeholder', 'Secret Key eingeben')}
                autoComplete="off"
                spellCheck="false"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                  onClick={() => { setShowSecretPrompt(false); setSecretInput(''); }}
                  disabled={loading}
                >
                  {t('common:option.cancel', 'Abbrechen')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded-sm bg-green-600 text-white hover:bg-green-700 text-sm disabled:opacity-50"
                  onClick={() => signWithSecret(secretInput.trim())}
                  disabled={loading || !secretInput.trim() || signingBlocked}
                >
                  {t('multisig:detail.secretPrompt.signNow', 'Jetzt signieren')}
                </button>
              </div>
            </div>
          )}
          {canCurrentSign && !isFinalState && declinedByMe && (
            <div className="border border-red-300 dark:border-red-700 rounded-sm p-3 text-sm text-red-800 dark:text-red-200" data-testid="job-declined-by-me">
              {t('multisig:detail.decline.declinedByMe', 'Du hast diesen Job abgelehnt. Signierst du doch noch, wird die Ablehnung entfernt.')}
            </div>
          )}
          {canDecline && !showDecline && (
            <div className="flex items-center justify-between gap-3 border rounded-sm p-3">
              <div className="text-sm">{t('multisig:detail.decline.prompt', 'Diesen Job nicht signieren?')}</div>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded-sm border border-red-300 text-red-700 dark:text-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900"
                onClick={() => { void openDecline(); }}
                disabled={loading}
              >
                {t('multisig:detail.decline.button', 'Ablehnen')}
              </button>
            </div>
          )}
          {canDecline && showDecline && (
            <form
              className="border border-red-300 dark:border-red-700 rounded-sm p-3 space-y-2 bg-red-50 dark:bg-red-900/30"
              data-testid="job-decline"
              onSubmit={(e) => { e.preventDefault(); void handleDecline(); }}
            >
              <div className="text-sm font-semibold text-red-900 dark:text-red-100">{t('multisig:detail.decline.title', 'Job ablehnen')}</div>
              <p className="text-xs text-gray-700 dark:text-gray-300">
                {t('multisig:detail.decline.hint', 'Die anderen Signer sehen deine Ablehnung. Reicht das Gewicht ohne dich nicht mehr, wird der Job abgelehnt und nimmt keine Signaturen mehr an. Auf dem Netz wird die Transaktion dadurch nicht ungültig: Wer sie bereits woanders signiert hat, könnte sie mit genug Signaturen trotzdem einreichen. Endgültig stoppt sie nur ein Widerruf (unten).')}
              </p>
              {declineNeedsKey && (
                <input
                  type="password"
                  value={declineInput}
                  onChange={(e) => setDeclineInput(e.target.value)}
                  aria-label={t('multisig:detail.decline.keyLabel', 'Secret Key zum Ablehnen')}
                  className="w-full border-2 border-red-400 rounded-sm px-3 py-2 text-sm bg-white dark:bg-gray-800"
                  placeholder={t('secretKey:placeholder', 'Secret Key eingeben')}
                  autoComplete="off"
                  spellCheck="false"
                />
              )}
              {declineError && <div className="text-xs text-red-700 dark:text-red-300" role="alert">{declineError}</div>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded-sm border text-sm"
                  onClick={() => { setShowDecline(false); setDeclineInput(''); setDeclineError(''); }}
                  disabled={declining}
                >
                  {t('common:option.cancel', 'Abbrechen')}
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded-sm bg-red-600 text-white text-sm disabled:opacity-50"
                  disabled={declining || (declineNeedsKey && !declineInput.trim())}
                >
                  {declining ? t('common:common.loading') : t('multisig:detail.decline.confirm', 'Job ablehnen')}
                </button>
              </div>
            </form>
          )}
          {canCurrentSign && !isFinalState && sequenceLooksAlive && !revokedHash && decodedTx && (
            <div className="border border-red-300 dark:border-red-700 rounded-sm p-3 space-y-2">
              <div className="text-sm font-semibold">{t('multisig:detail.revoke.title')}</div>
              <p className="text-xs text-gray-700 dark:text-gray-300">{t('multisig:detail.revoke.description')}</p>
              {!revokePrep ? (
                <button
                  type="button"
                  className="text-xs px-3 py-1 rounded-sm border border-red-300 text-red-700 dark:text-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900 disabled:opacity-50"
                  onClick={startRevoke}
                  disabled={revoking || loading}
                >
                  {revoking ? t('common:common.loading') : t('multisig:detail.revoke.button')}
                </button>
              ) : (
                <div role="alertdialog" aria-label={t('multisig:detail.revoke.confirmTitle')} className="space-y-2 bg-red-50 dark:bg-red-900/30 rounded-sm p-2">
                  <div className="text-sm font-semibold text-red-900 dark:text-red-100">{t('multisig:detail.revoke.confirmTitle')}</div>
                  <p className="text-xs text-gray-800 dark:text-gray-200 break-all">
                    {t('multisig:detail.revoke.confirmText', {
                      account: revokePrep.sourceAccountId,
                      network: revokePrep.network === 'testnet' ? 'Testnet' : 'Mainnet',
                      sequence: revokePrep.sequence,
                    })}
                  </p>
                  {revokeAccountMismatch && (
                    <p className="text-xs font-medium text-red-800 dark:text-red-200 break-all" data-testid="revoke-account-mismatch">
                      {t('multisig:detail.revoke.differentAccount', { jobAccount: revokeAccountMismatch.expected, account: revokePrep.sourceAccountId })}
                    </p>
                  )}
                  <p className="text-xs font-medium text-red-800 dark:text-red-200">{t('multisig:detail.revoke.sideEffect')}</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300">
                    {t('multisig:detail.revoke.thresholdInfo', { required: revokePrep.requiredThreshold })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="px-3 py-1 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                      onClick={() => { setRevokePrep(null); setRevokeError(''); }}
                      disabled={revoking}
                    >
                      {t('common:option.cancel', 'Abbrechen')}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1 rounded-sm bg-red-600 text-white hover:bg-red-700 text-sm disabled:opacity-50"
                      onClick={() => { setRevokeError(''); setShowRevokeSecretModal(true); }}
                      disabled={revoking}
                    >
                      {t('multisig:detail.revoke.continue')}
                    </button>
                  </div>
                </div>
              )}
              {revokeError && !showRevokeSecretModal && (
                <p role="alert" className="text-xs text-red-700 dark:text-red-300">{revokeError}</p>
              )}
            </div>
          )}
          {showRevokeSecretModal && revokePrep && (
            <SecretKeyModal
              onConfirm={(collected) => { void executeRevoke(collected); }}
              onCancel={() => { setShowRevokeSecretModal(false); setRevokeError(''); }}
              errorMessage={revokeError}
              thresholds={revokePrep.account?.thresholds}
              signers={revokePrep.account?.signers || []}
              operationType="bumpSequence"
              requiredThreshold={revokePrep.requiredThreshold}
              isProcessing={revoking}
              account={revokePrep.account}
              allowRememberSession={false}
            />
          )}
          {submitError && (
            <div className="border border-red-400 bg-red-50 dark:bg-red-900/30 text-xs text-red-800 dark:text-red-200 rounded-sm p-2 space-y-1">
              <div>{t('multisig:detail.submitFailed', { reason: submitError })}</div>
              {liquiditySubmitText(job.submittedResult) && (
                <div data-testid="job-submit-liquidity-error">{liquiditySubmitText(job.submittedResult)}</div>
              )}
              {submitResultCodes && (
                <div className="font-mono break-all">
                  {JSON.stringify(submitResultCodes)}
                </div>
              )}
              {!submitResultCodes && (
                <div className="text-gray-700 dark:text-gray-300">
                  {t('multisig:detail.submitNoExtras', 'Keine weiteren Fehlerdetails verfügbar.')}
                </div>
              )}
            </div>
          )}

          <div className="border rounded-sm p-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-sm">{t('multisig:detail.xdr.title')}</h2>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-sm border border-blue-200 text-blue-700 dark:text-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(job.txXdrCurrent || job.txXdr || '');
                    setInfo(t('multisig:detail.xdr.copy.success'));
                  } catch {
                    setError(t('multisig:detail.xdr.copy.error'));
                  }
                }}
              >
                {t('multisig:detail.xdr.copy')}
              </button>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">{t('multisig:detail.xdr.hint')}</p>
            <textarea className="w-full h-32 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded-sm px-2 py-1" readOnly value={job.txXdrCurrent || job.txXdr || ''} />
          </div>

          <div className="border rounded-sm p-3 space-y-2">
            <div>
              <h3 className="font-semibold text-sm">{t('multisig:detail.signedXdr.title')}</h3>
              <p className="text-xs text-gray-700 dark:text-gray-300">{t('multisig:detail.signedXdr.hint')}</p>
            </div>
            <textarea
              className="w-full h-24 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded-sm px-2 py-1"
              placeholder={t('multisig:detail.signedXdr.label')}
              value={importXdr}
              onChange={(e) => setImportXdr(e.target.value)}
            />
            <button
              type="button"
              className="px-4 py-2 rounded-sm bg-blue-600 text-white disabled:opacity-50"
              onClick={handleMerge}
              disabled={importing || !importXdr.trim() || importBlocked}
            >
              {importing ? t('common:common.loading') : t('multisig:detail.signedXdr.submit')}
            </button>
            {importBlocked && (
              <p className="text-xs text-red-800 dark:text-red-200" data-testid="job-import-blocked">
                {integrityBlocked
                  ? t('multisig:detail.signedXdr.blockedIntegrityHint')
                  : ownAccountBlocked
                  ? t('multisig:detail.signedXdr.blockedOwnAccountHint', 'Import gesperrt, weil eine Operation von deinem aktuellen Konto ausgeführt wird.')
                  : t('multisig:detail.signedXdr.blockedHint', 'Zuerst die Warnungen bei den Transaktionsoperationen oben bestätigen.')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MultisigJobDetail;
