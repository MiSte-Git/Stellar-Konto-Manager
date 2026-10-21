import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getPendingMultisigJob, mergeSignedXdr, getMultisigJobChallenge, signMultisigJobChallenge, getMultisigJobAccessToken } from '../utils/multisigApi.js';
import MultisigJobStatusBadge from '../components/MultisigJobStatusBadge.jsx';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { getSessionSecret } from '../utils/sessionSecrets.js';
import { getMultisigJobToken } from '../utils/basePath.js';
import { describeOperations, findOperationWarnings } from '../utils/multisig/describeOperations.js';
import { formatValidUntil } from '../utils/multisig/formatValidUntil.js';
import SecretKeyModal from '../components/SecretKeyModal.jsx';
import { getHorizonServer } from '../utils/stellar/stellarUtils.js';
import { resolveFeePerOp } from '../utils/stellar/fees.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../utils/stellar/submitTransactionSafely.js';
import { getRequiredThreshold } from '../utils/getRequiredThreshold.js';
import { formatErrorForUi } from '../utils/formatErrorForUi.js';
import { accountSequenceOf, assertHorizonNetwork, buildJobRevocationTx, checkRevocationSequence, collectEffectiveSigners, getJobSequenceInfo, parseJobNetwork } from '../utils/multisig/jobRevocation.js';
import { txHashHex } from '../utils/stellar/txHash.js';

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

  // A job's access token may arrive as a prop (bookmarked/shared link handled
  // by App.jsx) or as a ?token= query parameter. The job list no longer hands
  // out tokens at all (anyone who knew the public accountId could otherwise
  // read every pending job's token straight from the list) - if neither is
  // present, resolveToken() fetches it on demand, verified server-side against
  // currentPublicKey being an active signer of the job's account. Cached in a
  // ref (not state) since it never affects what's rendered by itself.
  const fetchedTokenRef = useRef(null);

  // Fetching a token from scratch (no prop/URL token yet) now requires proving
  // possession of currentPublicKey's private key (H1 fix): get a one-time
  // challenge, sign it locally, then redeem it for the token. This only works
  // if a session secret for currentPublicKey is already remembered in this
  // browser (the self-bucket lookup below matches how SendPaymentPage/
  // MultisigEditPage store it after "remember for this session") - if none is
  // stored, there is no secret to sign with yet, so this surfaces a distinct
  // error instead of silently failing the signature check server-side.
  const resolveToken = useCallback(async () => {
    if (accessToken) return accessToken;
    const fromUrl = getMultisigJobToken();
    if (fromUrl) return fromUrl;
    if (fetchedTokenRef.current) return fetchedTokenRef.current;
    if (!currentPublicKey) {
      throw Object.assign(new Error('multisig:detail.noAccessToken'), { code: 'no_public_key' });
    }
    const secret = await getSessionSecret(currentPublicKey, currentPublicKey);
    if (!secret) {
      throw Object.assign(new Error('multisig:detail.noLocalSecretForToken'), { code: 'no_local_secret' });
    }
    const { challenge } = await getMultisigJobChallenge(jobId, currentPublicKey);
    const signature = signMultisigJobChallenge(secret, challenge);
    const token = await getMultisigJobAccessToken(jobId, currentPublicKey, signature);
    fetchedTokenRef.current = token;
    return token;
  }, [accessToken, jobId, currentPublicKey]);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError('');
    try {
      const token = await resolveToken();
      const data = await getPendingMultisigJob(jobId, token);
      setJob(data);
      setInfo('');
    } catch (e) {
      if (e?.code === 'no_public_key') {
        setError(t('multisig:detail.noAccessToken', 'Kein Zugriffstoken verfügbar. Bitte zuerst das Konto laden, das Signer dieses Auftrags ist.'));
      } else if (e?.code === 'no_local_secret') {
        setError(t('multisig:detail.noLocalSecretForToken', 'Kein gespeichertes Secret für dieses Konto in diesem Browser. Bitte über einen geteilten Link mit Zugriffstoken öffnen, oder das Konto einmal mit "Secret merken" laden.'));
      } else if (e?.status === 403) {
        setError(t('multisig:detail.notASigner', 'Dieses Konto ist kein aktiver Signer dieses Auftrags.'));
      } else {
        setError(e?.message || 'fetch_failed');
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, resolveToken, t]);

  useEffect(() => {
    void fetchJob();
  }, [fetchJob]);

  const handleMerge = useCallback(async () => {
    if (!jobId || !importXdr.trim()) return;
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
        setError(t('multisig:detail.noLocalSecretForToken', 'Kein gespeichertes Secret für dieses Konto in diesem Browser. Bitte über einen geteilten Link mit Zugriffstoken öffnen, oder das Konto einmal mit "Secret merken" laden.'));
      } else if (e?.status === 403) {
        setError(t('multisig:detail.notASigner', 'Dieses Konto ist kein aktiver Signer dieses Auftrags.'));
      } else if (raw === 'mismatched_hash') {
        setError(t('multisig:errors.mismatchedHash'));
      } else if (raw === 'signers_unavailable') {
        setError(t('multisig:errors.signersUnavailable'));
      } else {
        setError(raw);
      }
    } finally {
      setImporting(false);
    }
  }, [importXdr, jobId, resolveToken, t]);

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
  const submitError = job?.submittedResult?.error;
  const submitExtras = job?.submittedResult?.detail?.extras;
  const isFinalState = useMemo(() => {
    const s = String(job?.status || '').toLowerCase();
    return ['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq'].includes(s);
  }, [job]);

  // G5 stage 2: decoded client-side purely for display, so a signer can see
  // what they're actually being asked to sign (operations, validity window)
  // before doing so - the job list previously showed only hash/account/
  // network. Decoding failures (malformed/missing XDR) degrade to an empty
  // operations list and an unbounded validity display rather than breaking
  // the page.
  const decodedTx = useMemo(() => {
    if (!job) return null;
    try {
      const netPass = (job.network === 'testnet' || job.network === 'TESTNET') ? Networks.TESTNET : Networks.PUBLIC;
      return TransactionBuilder.fromXDR(job.txXdrCurrent || job.txXdrOriginal || job.txXdr || '', netPass);
    } catch {
      return null;
    }
  }, [job]);

  const txSourceAccountId = useMemo(() => getJobSequenceInfo(decodedTx)?.sourceAccountId || '', [decodedTx]);
  const operationLines = useMemo(
    () => (decodedTx ? describeOperations((decodedTx.innerTransaction || decodedTx).operations, t, txSourceAccountId) : []),
    [decodedTx, t, txSourceAccountId]
  );
  const operationWarnings = useMemo(
    () => (decodedTx ? findOperationWarnings((decodedTx.innerTransaction || decodedTx).operations, txSourceAccountId) : { unknownTypes: [], pathPaymentToOther: false }),
    [decodedTx, txSourceAccountId]
  );
  // Unbekannte Operationen: Signieren erst nach ausdruecklicher Bestaetigung.
  const [unknownOpsConfirmed, setUnknownOpsConfirmed] = useState(false);
  useEffect(() => { setUnknownOpsConfirmed(false); }, [decodedTx]);
  const signingBlockedByUnknownOps = operationWarnings.unknownTypes.length > 0 && !unknownOpsConfirmed;

  const validUntilLabel = useMemo(
    () => formatValidUntil(decodedTx?.timeBounds?.maxTime, i18n.language, t),
    [decodedTx, i18n.language, t]
  );

  // Deliberately NOT a new lifecycle computation (G5 stage 1's
  // computeMultisigLifecycleStatus() already runs server-side on every GET -
  // see summarizeJob()/annotateJobsLifecycleStatus()) - this only interprets
  // the already-recomputed job.status the backend just sent.
  const sequenceLooksAlive = useMemo(() => {
    const s = String(job?.status || '').toLowerCase();
    return s !== 'expired' && s !== 'obsolete_seq';
  }, [job]);

  const jobNetwork = parseJobNetwork(job?.network);
  const jobIsTestnet = jobNetwork === 'testnet';

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
    const seqInfo = getJobSequenceInfo(decodedTx);
    if (!seqInfo) {
      setRevokeError(t('multisig:detail.revoke.noTxData'));
      return;
    }
    // Server-Daten nicht blind vertrauen: Netzwerk muss bekannt sein, das XDR muss zum
    // gespeicherten Hash passen (der Hash haengt am Netzwerk) und zum Konto des Jobs.
    if (!jobNetwork) {
      setRevokeError(t('multisig:detail.revoke.networkUnknown'));
      return;
    }
    if (!job?.txHash || !job?.accountId) {
      setRevokeError(t('multisig:detail.revoke.missingJobData'));
      return;
    }
    if (txHashHex(decodedTx) !== String(job.txHash).toLowerCase()) {
      setRevokeError(t('multisig:detail.revoke.hashMismatch'));
      return;
    }
    if (job.accountId !== seqInfo.sourceAccountId) {
      setRevokeError(t('multisig:detail.revoke.accountMismatch'));
      return;
    }
    const networkPassphrase = jobIsTestnet ? Networks.TESTNET : Networks.PUBLIC;
    const horizonUrl = jobIsTestnet ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org';
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
  }, [decodedTx, describeRevokeError, job, jobIsTestnet, jobNetwork, t]);

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

  const signWithSecret = useCallback(async (secret) => {
    if (!job || signingBlockedByUnknownOps) return;
    if (!canCurrentSign) {
      setError(t('multisig:detail.signatures.missing', 'fehlt'));
      return;
    }
    try {
      setLoading(true);
      const netPass = (job.network === 'testnet' || job.network === 'TESTNET') ? Networks.TESTNET : Networks.PUBLIC;
      const tx = TransactionBuilder.fromXDR(job.txXdrCurrent || job.txXdrOriginal || job.txXdr || '', netPass);
      const kp = Keypair.fromSecret(secret);
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
      setInfo(t('multisig:detail.signatures.signedLocalStatus', { status: st }));
      const submitErr = merged?.submittedResult?.error;
      if (submitErr) {
        setError(t('multisig:detail.submitFailed', { reason: submitErr }));
      } else {
        setError('');
      }
      setShowSecretPrompt(false);
      setSecretInput('');
    } catch (e) {
      if (e?.code === 'no_public_key') {
        setError(t('multisig:detail.noAccessToken', 'Kein Zugriffstoken verfügbar. Bitte zuerst das Konto laden, das Signer dieses Auftrags ist.'));
      } else if (e?.code === 'no_local_secret') {
        setError(t('multisig:detail.noLocalSecretForToken', 'Kein gespeichertes Secret für dieses Konto in diesem Browser. Bitte über einen geteilten Link mit Zugriffstoken öffnen, oder das Konto einmal mit "Secret merken" laden.'));
      } else if (e?.status === 403) {
        setError(t('multisig:detail.notASigner', 'Dieses Konto ist kein aktiver Signer dieses Auftrags.'));
      } else if (String(e?.message || '') === 'signers_unavailable') {
        setError(t('multisig:errors.signersUnavailable'));
      } else {
        setError(String(e?.message || 'multisig.jobs.merge_failed'));
      }
    } finally {
      setLoading(false);
    }
  }, [job, jobId, canCurrentSign, signingBlockedByUnknownOps, t, resolveToken]);

  const handleSignWithSession = useCallback(async () => {
    if (!job || signingBlockedByUnknownOps) return;
    if (!canCurrentSign) {
      setError(t('multisig:detail.signatures.missing', 'fehlt'));
      return;
    }
    const secret = await getSessionSecret(job?.accountId || '', currentPublicKey);
    if (!secret) {
      setError(t('multisig:detail.signatures.noSessionSecret', 'Kein Secret Key im Browser gespeichert. Bitte Secret eingeben oder signiertes XDR importieren.'));
      setShowSecretPrompt(true);
      return;
    }
    await signWithSecret(secret);
  }, [job, canCurrentSign, currentPublicKey, signingBlockedByUnknownOps, t, signWithSecret]);

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
              className="text-sm px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => {
                try { onBack(); } catch { /* noop */ }
              }}
            >
              {t('common:option.back', 'Zurück')}
            </button>
          )}
          <button
            type="button"
            className="text-sm px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={fetchJob}
            disabled={loading}
          >
            {t('common:refresh', 'Refresh')}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {info && <div className="text-sm text-green-700 dark:text-green-400">{info}</div>}
      {loading && <div className="text-sm text-gray-600">{t('common:common.loading')}</div>}

      {job && (
        <div className="space-y-3">
          <div className="border rounded p-3 text-sm">
            <div className="font-mono break-all text-xs text-gray-600 dark:text-gray-300">ID: {job.id}</div>
            <div className="flex flex-wrap gap-3 mt-2">
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.network', 'Netzwerk')}: {job.network}</span>
              <span className="text-gray-700 dark:text-gray-200">{t('publicKey:source', 'Quelle')}: <span className="font-mono break-all">{job.accountId}</span></span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:prepare.hashLabel')}: <span className="font-mono break-all">{job.txHash}</span></span>
              <span className="text-gray-700 dark:text-gray-200">{t('multisig:detail.statusLabel', 'Status')}: {job.status}</span>
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
                  return (
                    <span
                      key={pk || Math.random()}
                      className={`px-2 py-0.5 rounded text-xs ${signed ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'}`}
                      title={pk}
                    >
                      {shortPk(pk)}
                      {' '}
                      {signed ? t('multisig:detail.signatures.signed', 'unterzeichnet') : t('multisig:detail.signatures.missing', 'fehlt')}
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

          <div className="border rounded p-3 space-y-2 text-sm">
            <div className="font-semibold">{t('multisig:detail.transparency.title', 'Transaktionsdetails')}</div>
            <div>
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                {t('multisig:detail.operations.title', 'Transaktionsoperationen')}
              </div>
              {operationLines.length > 0 ? (
                <ul className="list-disc list-inside space-y-0.5 text-gray-800 dark:text-gray-100">
                  {operationLines.map((line, idx) => <li key={idx}>{line}</li>)}
                </ul>
              ) : (
                <div className="text-gray-600 dark:text-gray-300">
                  {t('multisig:detail.operations.none', 'Keine Operationen erkennbar (XDR konnte nicht dekodiert werden).')}
                </div>
              )}
              {operationWarnings.pathPaymentToOther && (
                <p role="alert" className="mt-2 rounded bg-amber-50 p-2 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                  {t('multisig:detail.operations.warnPathPaymentToOther')}
                </p>
              )}
              {operationWarnings.unknownTypes.length > 0 && (
                <div role="alert" className="mt-2 space-y-1 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100">
                  <p className="font-medium">{t('multisig:detail.operations.warnUnknown', { types: operationWarnings.unknownTypes.join(', ') })}</p>
                  {canCurrentSign && !isFinalState && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={unknownOpsConfirmed} onChange={(e) => setUnknownOpsConfirmed(e.target.checked)} />
                      {t('multisig:detail.operations.confirmUnknown')}
                    </label>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div>
                <span className="text-gray-600 dark:text-gray-300">{t('multisig:detail.validUntil.label', 'Gültig bis')}: </span>
                <span className="font-medium text-gray-900 dark:text-gray-100">{validUntilLabel}</span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-300">{t('multisig:detail.sequenceStatus.label', 'Sequenz-Status')}: </span>
                <span className={`font-medium ${sequenceLooksAlive ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {sequenceLooksAlive
                    ? t('multisig:detail.sequenceStatus.valid', 'aktuell gültig')
                    : t('multisig:detail.sequenceStatus.dead', 'nicht mehr einlösbar')}
                </span>
              </div>
            </div>
          </div>

          {Array.isArray(job.changes) && job.changes.length > 0 && (
            <div className="border rounded p-3">
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
            <div className="flex items-center justify-between gap-3 border rounded p-3">
              <div className="text-sm font-semibold">{t('multisig:detail.secretPrompt.signNow', 'Jetzt signieren')}</div>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded border border-green-200 text-green-700 dark:text-green-200 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900"
                onClick={handleSignWithSession}
                disabled={loading || signingComplete || signingBlockedByUnknownOps}
              >
                {t('multisig:detail.secretPrompt.signNow', 'Jetzt signieren')}
              </button>
            </div>
          )}

          {showSecretPrompt && canCurrentSign && !isFinalState && (
            <div className="border border-amber-500 rounded p-3 space-y-3 bg-amber-50 dark:bg-amber-900/40 shadow-sm">
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
                className="w-full border-2 border-amber-500 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder={t('secretKey:placeholder', 'Secret Key eingeben')}
                autoComplete="off"
                spellCheck="false"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                  onClick={() => { setShowSecretPrompt(false); setSecretInput(''); }}
                  disabled={loading}
                >
                  {t('common:option.cancel', 'Abbrechen')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 text-sm disabled:opacity-50"
                  onClick={() => signWithSecret(secretInput.trim())}
                  disabled={loading || !secretInput.trim() || signingBlockedByUnknownOps}
                >
                  {t('multisig:detail.secretPrompt.signNow', 'Jetzt signieren')}
                </button>
              </div>
            </div>
          )}
          {canCurrentSign && !isFinalState && sequenceLooksAlive && !revokedHash && decodedTx && (
            <div className="border border-red-300 dark:border-red-700 rounded p-3 space-y-2">
              <div className="text-sm font-semibold">{t('multisig:detail.revoke.title')}</div>
              <p className="text-xs text-gray-700 dark:text-gray-300">{t('multisig:detail.revoke.description')}</p>
              {!revokePrep ? (
                <button
                  type="button"
                  className="text-xs px-3 py-1 rounded border border-red-300 text-red-700 dark:text-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900 disabled:opacity-50"
                  onClick={startRevoke}
                  disabled={revoking || loading}
                >
                  {revoking ? t('common:common.loading') : t('multisig:detail.revoke.button')}
                </button>
              ) : (
                <div role="alertdialog" aria-label={t('multisig:detail.revoke.confirmTitle')} className="space-y-2 bg-red-50 dark:bg-red-900/30 rounded p-2">
                  <div className="text-sm font-semibold text-red-900 dark:text-red-100">{t('multisig:detail.revoke.confirmTitle')}</div>
                  <p className="text-xs text-gray-800 dark:text-gray-200 break-all">
                    {t('multisig:detail.revoke.confirmText', {
                      account: revokePrep.sourceAccountId,
                      network: revokePrep.network === 'testnet' ? 'Testnet' : 'Mainnet',
                      sequence: revokePrep.sequence,
                    })}
                  </p>
                  <p className="text-xs font-medium text-red-800 dark:text-red-200">{t('multisig:detail.revoke.sideEffect')}</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300">
                    {t('multisig:detail.revoke.thresholdInfo', { required: revokePrep.requiredThreshold })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                      onClick={() => { setRevokePrep(null); setRevokeError(''); }}
                      disabled={revoking}
                    >
                      {t('common:option.cancel', 'Abbrechen')}
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 text-sm disabled:opacity-50"
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
            <div className="border border-red-400 bg-red-50 dark:bg-red-900/30 text-xs text-red-800 dark:text-red-200 rounded p-2 space-y-1">
              <div>{t('multisig:detail.submitFailed', { reason: submitError })}</div>
              {submitExtras && submitExtras.result_codes && (
                <div className="font-mono break-all">
                  {JSON.stringify(submitExtras.result_codes)}
                </div>
              )}
              {!submitExtras && (
                <div className="text-gray-700 dark:text-gray-300">
                  {t('multisig:detail.submitNoExtras', 'Keine weiteren Fehlerdetails verfügbar.')}
                </div>
              )}
            </div>
          )}

          <div className="border rounded p-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-sm">{t('multisig:detail.xdr.title')}</h2>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 dark:text-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900"
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
            <textarea className="w-full h-32 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1" readOnly value={job.txXdrCurrent || job.txXdr || ''} />
          </div>

          <div className="border rounded p-3 space-y-2">
            <div>
              <h3 className="font-semibold text-sm">{t('multisig:detail.signedXdr.title')}</h3>
              <p className="text-xs text-gray-700 dark:text-gray-300">{t('multisig:detail.signedXdr.hint')}</p>
            </div>
            <textarea
              className="w-full h-24 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1"
              placeholder={t('multisig:detail.signedXdr.label')}
              value={importXdr}
              onChange={(e) => setImportXdr(e.target.value)}
            />
            <button
              type="button"
              className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
              onClick={handleMerge}
              disabled={importing || !importXdr.trim()}
            >
              {importing ? t('common:common.loading') : t('multisig:detail.signedXdr.submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MultisigJobDetail;
