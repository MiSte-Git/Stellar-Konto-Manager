import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import SecretKeyModal from '../components/SecretKeyModal.jsx';
import MultiSigHelpDialog from '../components/multisig/MultiSigHelpDialog.jsx';
import MultisigPrepareDialog from '../components/MultisigPrepareDialog.jsx';
import { getHorizonServer } from '../utils/stellar/stellarUtils.js';
import { getRequiredThreshold } from '../utils/getRequiredThreshold.js';
import { validateMultisigConfig } from '../utils/validateMultisigConfig.js';
import { Keypair, Networks, Operation, TransactionBuilder, StrKey } from '@stellar/stellar-sdk';
import { apiUrl } from '../utils/apiBase.js';
import { createPendingMultisigJob } from '../utils/multisigApi.js';

const HORIZON_MAIN = 'https://horizon.stellar.org';
const HORIZON_TEST = 'https://horizon-testnet.stellar.org';

function NetworkSelector({ value, onChange }) {
  const { t } = useTranslation(['network', 'common', 'publicKey', 'createAccount']);
  const isTestnet = value === 'TESTNET';
  return (
    <div className={`flex items-center justify-between gap-4 mb-4 p-2 border rounded relative ${isTestnet ? 'border-yellow-500 ring-1 ring-yellow-400' : ''}`}>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
        <input type="radio" name="network" value="PUBLIC" checked={value === 'PUBLIC'} onChange={() => { try { window.localStorage.setItem('SKM_NETWORK','PUBLIC'); window.localStorage.removeItem('SKM_HORIZON_URL'); } catch (e) { void e; } window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' })); window.dispatchEvent(new Event('stm-trigger-recheck')); onChange('PUBLIC'); }} />
          {t('network:mainnet')}
        </label>
        <label className="flex items-center gap-2">
        <input type="radio" name="network" value="TESTNET" checked={value === 'TESTNET'} onChange={() => { try { window.localStorage.setItem('SKM_NETWORK','TESTNET'); window.localStorage.setItem('SKM_HORIZON_URL','https://horizon-testnet.stellar.org'); } catch (e) { void e; } window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'TESTNET' })); window.dispatchEvent(new Event('stm-trigger-recheck')); onChange('TESTNET'); }} />
          {t('network:testnet')}
        </label>
      </div>
      {isTestnet && (
        <span className="inline-block bg-yellow-500 text-white text-xs font-semibold px-2 py-0.5 rounded">
          {t('common:badges.testnet')}
        </span>
      )}
    </div>
  );
}

export default function MultisigEditPage({ defaultPublicKey = '' }) {
  const { t } = useTranslation(['network', 'common', 'publicKey', 'createAccount', 'multisigHelp', 'multisig']);

  const [network, setNetwork] = useState(() => {
  try { return (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC'; } catch { return 'PUBLIC'; }
  });
  const server = useMemo(() => getHorizonServer(network === 'TESTNET' ? HORIZON_TEST : HORIZON_MAIN), [network]);
  const passphrase = network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;

  // use global wallet (defaultPublicKey) from header; no local input
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [preparedTx, setPreparedTx] = useState(null);
  // Multisig mode controls UI; test keeps legacy direct-sign flow, prod prepares XDR/Pending Jobs in next steps.
  const [mode, setMode] = useState('test'); // 'test' | 'prod'
  const [pendingAction, setPendingAction] = useState(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [currentAccount, setCurrentAccount] = useState(null); // Snapshot der aktuellen Kettenwerte fürs Signieren

  // Account state
  const [masterWeight, setMasterWeight] = useState(1);
  const [signers, setSigners] = useState([]); // [{key, weight}], excludes master
  const [lowT, setLowT] = useState(1);
  const [medT, setMedT] = useState(2);
  const [highT, setHighT] = useState(2);
  const thresholdsForModal = useMemo(() => ({
    low_threshold: clampByte(lowT),
    med_threshold: clampByte(medT),
    high_threshold: clampByte(highT),
  }), [lowT, medT, highT]);
  const signersForModal = useMemo(() => {
    const pk = (defaultPublicKey || '').trim();
    const master = pk ? [{ public_key: pk, weight: clampByte(masterWeight) }] : [];
    const others = (signers || []).map((s) => ({
      public_key: (s.key || '').trim(),
      weight: clampByte(s.weight),
    })).filter((s) => !!s.public_key);
    return [...master, ...others];
  }, [defaultPublicKey, masterWeight, signers]);

  const getSessionSecret = useCallback((pk) => {
    if (!pk) return '';
    try {
      return window.sessionStorage?.getItem(`stm.session.secret.${pk}`) || '';
    } catch {
      return '';
    }
  }, []);
  const requiredThreshold = useMemo(
    () => getRequiredThreshold('setOptions', currentAccount?.thresholds || thresholdsForModal),
    [currentAccount, thresholdsForModal]
  );

  // Helper: clamp to 0..255 integer
  function clampByte(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(255, Math.trunc(v)));
  }

  const sumWeights = useMemo(() => {
    const sw = signers.reduce((acc, s) => acc + clampByte(s.weight || 0), 0) + clampByte(masterWeight);
    return sw;
  }, [signers, masterWeight]);

  const thLowErr = lowT > sumWeights;
  const thMedErr = medT > sumWeights;
  const thHighErr = highT > sumWeights;

  // Load account
  const loadAccount = useCallback(async () => {
    const pk = (defaultPublicKey || '').trim();
    if (!pk) return;
    setLoading(true);
    setError('');
    setInfo('');
    setCurrentAccount(null);
    try {
      const acct = await server.loadAccount(pk);
      setCurrentAccount(acct);
      const ms = (acct.signers || []).find(s => s.key === pk);
      const others = (acct.signers || []).filter(s => s.key !== pk && s.type && s.type.includes('ed25519'));
      setMasterWeight(clampByte(ms?.weight ?? 1));
      setSigners(others.map(s => ({ key: s.key, weight: clampByte(s.weight || 0) })));
      const fetchedLow = clampByte(acct.thresholds?.low_threshold ?? 1);
      const fetchedMed = clampByte(acct.thresholds?.med_threshold ?? 2);
      const fetchedHigh = clampByte(acct.thresholds?.high_threshold ?? 2);
      if (fetchedLow === 0 && fetchedMed === 0 && fetchedHigh === 0) {
        // Fallback auf 1/2/2 für neue Konten ohne gesetzte Schwellen
        setLowT(1);
        setMedT(2);
        setHighT(2);
      } else {
        setLowT(fetchedLow);
        setMedT(fetchedMed);
        setHighT(fetchedHigh);
      }
      setInfo(t('common:multisigEdit.loaded', { count: others.length }));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [defaultPublicKey, server, t]);

  useEffect(() => {
    if (defaultPublicKey) loadAccount();
  }, [defaultPublicKey, network, loadAccount]);

  // Sync local network radio with global header toggle
  useEffect(() => {
    const handler = (e) => {
      const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('SKM_NETWORK') || 'PUBLIC');
      setNetwork(v === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
    };
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  // Editing handlers
  function updateSignerKey(i, val) {
    const arr = [...signers];
    arr[i] = { ...arr[i], key: (val || '').trim() };
    setSigners(arr);
  }
  function updateSignerWeight(i, val) {
    const arr = [...signers];
    arr[i] = { ...arr[i], weight: clampByte(val) };
    setSigners(arr);
  }
  function addSignerRow() {
    setSigners(prev => [...prev, { key: '', weight: 1 }]);
  }
  function removeSignerRow(i) {
    setSigners(prev => prev.filter((_, idx) => idx !== i));
  }

  // Build and submit transaction
  async function buildSetOptionsTx(collectedSigners, { signTx = false, requireSigners = false } = {}) {
    const pk = (defaultPublicKey || '').trim();
    if (!pk) { throw new Error(t('publicKey:invalid')); }

    const acct = await server.loadAccount(pk);
    const required = getRequiredThreshold('setOptions', acct.thresholds) || clampByte(acct.thresholds?.high_threshold ?? highT);
    const current = Array.isArray(collectedSigners)
      ? collectedSigners.reduce((acc, s) => acc + clampByte(s?.weight || 0), 0)
      : 0;
    if (requireSigners && current <= 0) {
      throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
    }
    if (requireSigners && current < required) {
      throw new Error('submitTransaction.failed:' + 'multisig.insufficientWeight');
    }
    const feeStats = await server.feeStats();
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));

    const currentMaster = (acct.signers || []).find(s => s.key === pk)?.weight ?? 1;
    const currentMap = new Map();
    (acct.signers || []).forEach(s => { if (s.key !== pk && s.type && s.type.includes('ed25519')) currentMap.set(s.key, s.weight); });
    const plannedMap = new Map();
    (signers || []).forEach(s => { const k = (s.key || '').trim(); if (k && k.startsWith('G')) plannedMap.set(k, clampByte(s.weight)); });
    const plannedMaster = clampByte(masterWeight);
    const plannedThresholds = { low: clampByte(lowT), med: clampByte(medT), high: clampByte(highT) };

    const plannedSigners = [
      { key: pk, weight: plannedMaster },
      ...Array.from(plannedMap.entries()).map(([key, weight]) => ({ key, weight })),
    ];
    const sanity = validateMultisigConfig(plannedSigners, plannedThresholds);
    if (!sanity.valid) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('multisig invalid config', { reason: sanity.reason, thresholds: plannedThresholds, signers: plannedSigners });
      }
      throw new Error('submitTransaction.failed:' + 'multisig.invalidConfig');
    }

    const sumW = clampByte(plannedMaster) + Array.from(plannedMap.values()).reduce((a, b) => a + clampByte(b), 0);
    if (plannedThresholds.low > sumW || plannedThresholds.med > sumW || plannedThresholds.high > sumW) {
      throw new Error(t('common:multisigEdit.error.thresholdTooHigh'));
    }

    const txb = new TransactionBuilder(acct, { fee, networkPassphrase: passphrase });

    const curTh = acct.thresholds || { low_threshold: 1, med_threshold: 2, high_threshold: 2 };
    const relaxedLow = Math.min(curTh.low_threshold ?? 1, plannedThresholds.low);
    const relaxedMed = Math.min(curTh.med_threshold ?? 2, plannedThresholds.med);
    const relaxedHigh = Math.min(curTh.high_threshold ?? 2, plannedThresholds.high);
    if (relaxedLow < (curTh.low_threshold ?? 1) || relaxedMed < (curTh.med_threshold ?? 2) || relaxedHigh < (curTh.high_threshold ?? 2)) {
      txb.addOperation(Operation.setOptions({
        lowThreshold: relaxedLow,
        medThreshold: relaxedMed,
        highThreshold: relaxedHigh,
      }));
    }

    if (plannedMaster > currentMaster) {
      txb.addOperation(Operation.setOptions({ masterWeight: plannedMaster }));
    }

    for (const [k, wPlanned] of plannedMap.entries()) {
      const wCur = currentMap.get(k) || 0;
      if (wPlanned > wCur) {
        txb.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: k, weight: wPlanned } }));
      }
    }

    for (const [k, wCur] of currentMap.entries()) {
      const has = plannedMap.has(k);
      const wPlanned = plannedMap.get(k) || 0;
      if (!has || wPlanned < wCur) {
        txb.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: k, weight: has ? wPlanned : 0 } }));
      }
    }

    if (plannedMaster < currentMaster) {
      txb.addOperation(Operation.setOptions({ masterWeight: plannedMaster }));
    }

    if (plannedThresholds.low > relaxedLow || plannedThresholds.med > relaxedMed || plannedThresholds.high > relaxedHigh) {
      txb.addOperation(Operation.setOptions({
        lowThreshold: plannedThresholds.low,
        medThreshold: plannedThresholds.med,
        highThreshold: plannedThresholds.high,
      }));
    }

    const tx = txb.setTimeout(60).build();
    if (signTx && Array.isArray(collectedSigners)) {
      collectedSigners.forEach((s) => {
        try { tx.sign(s.keypair); } catch (e) { console.debug?.('sign failed', e); }
      });
      if (process.env.NODE_ENV !== 'production') {
        console.debug('multisig setOptions signing', {
          required,
          current,
          signers: (collectedSigners || []).map((s) => ({ publicKey: s.publicKey, weight: s.weight })),
        });
      }
    }
    return { tx, plannedThresholds, plannedMaster, plannedSigners };
  }

  async function submitChanges(collectedSigners) {
    setShowSecretModal(false);
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const planned = buildPlannedChanges();
      const { tx } = await buildSetOptionsTx(collectedSigners, { signTx: true, requireSigners: true });
      const res = await server.submitTransaction(tx);
      setInfo(t('common:multisigEdit.saved', { hash: res?.hash || res?.id || '' }));
      // Update local snapshot so new signers/weights are recognized for further actions
      const pk = (defaultPublicKey || '').trim();
      const updatedSigners = [
        { key: pk, weight: clampByte(masterWeight) },
        ...signers.map((s) => ({ key: (s.key || '').trim(), weight: clampByte(s.weight) })).filter((s) => s.key),
      ];
      setCurrentAccount({
        account_id: pk,
        signers: updatedSigners,
        thresholds: {
          low_threshold: clampByte(planned.thresholds.low),
          med_threshold: clampByte(planned.thresholds.med),
          high_threshold: clampByte(planned.thresholds.high),
        },
      });
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('tx_bad_auth')) {
        setError(t('errors:submitTransaction.failed.multisig.txBadAuth'));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    const pk = (defaultPublicKey || '').trim();
    if (!StrKey.isValidEd25519PublicKey(pk)) {
      setError(t('publicKey:invalid'));
      return;
    }
    // validate signer keys (optional: allow empty rows)
    for (const s of signers) {
      const k = (s.key || '').trim();
      if (k && !StrKey.isValidEd25519PublicKey(k)) {
        setError(t('common:multisigEdit.validation.signerKeyInvalid'));
        return;
      }
    }
    setPendingAction('save');
    setShowConfirmModal(true);
  }

  const handleConfirmTestMode = useCallback(() => {
    setShowConfirmModal(false);
    setShowSecretModal(true);
  }, []);

  const handlePrepareMultisig = useCallback(async () => {
    try {
      const { tx, plannedThresholds, plannedMaster, plannedSigners } = await buildSetOptionsTx(null, { signTx: false, requireSigners: false });
      const hashHex = tx.hash().toString('hex');
      let preparedTx = tx;
      const pk = (defaultPublicKey || '').trim();
      const initialCollected = [];
      const sessionSecret = getSessionSecret(pk);
      if (sessionSecret) {
        try {
          const kp = Keypair.fromSecret(sessionSecret);
          preparedTx.sign(kp);
          initialCollected.push({ publicKey: kp.publicKey(), weight: plannedMaster });
        } catch (e) {
          console.warn('Session secret sign failed', e);
        }
      }
      const xdr = preparedTx.toXDR();
      let job = null;
      try {
        const r = await fetch(apiUrl('multisig/jobs'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            network: network === 'TESTNET' ? 'testnet' : 'public',
            accountId: (defaultPublicKey || '').trim(),
            txXdr: xdr,
            signers: plannedSigners.map((s) => ({ publicKey: s.key, weight: s.weight })),
            requiredWeight: plannedThresholds?.med ?? null,
            clientCollected: initialCollected,
            createdBy: 'local',
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || 'multisig.jobs.create_failed');
        job = data;
      } catch (err) {
        setError(String(err?.message || err));
        return;
      }
      const jobId = job?.id || job?.jobId || '';
      const jobHash = job?.txHash || job?.tx_hash || hashHex;
      const jobXdr = job?.txXdrCurrent || job?.tx_xdr_current || xdr;
      if (!jobId) {
        setError(String('multisig.jobs.create_failed'));
        return;
      }

      setPreparedTx({
        id: jobId,
        hash: jobHash,
        xdr: jobXdr,
        summary: {
          title: t('multisig:prepare.title'),
          subtitle: t('multisig:prepare.subtitle'),
          items: [
            { label: t('common:account.source', 'Quelle'), value: (defaultPublicKey || '').trim() },
            { label: t('common:multisigEdit.masterWeight'), value: String(plannedMaster) },
            { label: t('createAccount:thresholdLow'), value: String(plannedThresholds.low) },
            { label: t('createAccount:thresholdMed'), value: String(plannedThresholds.med) },
            { label: t('createAccount:thresholdHigh'), value: String(plannedThresholds.high) },
            { label: t('common:signers', 'Signer'), value: String(plannedSigners.length) },
            { label: t('common:network', 'Netzwerk'), value: network },
            jobId ? { label: t('multisig:detail.idLabel', 'Job-ID'), value: jobId } : null,
          ].filter(Boolean),
        },
      });
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setShowConfirmModal(false);
    }
  }, [buildSetOptionsTx, defaultPublicKey, network, t]);

  const buildPlannedChanges = useCallback(() => {
    const pk = (defaultPublicKey || '').trim();
    const plannedMap = new Map();
    (signers || []).forEach(s => { const k = (s.key || '').trim(); if (k && k.startsWith('G')) plannedMap.set(k, clampByte(s.weight)); });
    const plannedThresholds = { low: clampByte(lowT), med: clampByte(medT), high: clampByte(highT) };
    const currentMaster = clampByte(masterWeight);
    const changes = [];
    changes.push({ type: 'set_threshold', thresholds: plannedThresholds });
    changes.push({ type: 'set_master_weight', weight: currentMaster });
    plannedMap.forEach((w, key) => {
      changes.push({ type: 'set_signer', accountId: key, weight: w });
    });
    return { accountId: pk, changes, thresholds: plannedThresholds, masterWeight: currentMaster };
  }, [defaultPublicKey, lowT, medT, highT, masterWeight, signers]);

  const handleCreateMultisigJob = useCallback(async () => {
    try {
      const planned = buildPlannedChanges();
      const payload = {
        accountId: planned.accountId,
        network: network === 'TESTNET' ? 'testnet' : 'public',
        changes: planned.changes,
      };
      const res = await createPendingMultisigJob(payload);
      setInfo(t('multisig:job.create.success.title') + ' ' + t('multisig:job.create.success.body', { id: res?.id || '' }));
    } catch (err) {
      setError(String(err?.message || err));
    }
  }, [buildPlannedChanges, network, t]);

  return (
    <div className="max-w-3xl mx-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-center gap-3 text-center">
        <h2 className="text-xl font-semibold">{t('common:multisigEdit.title')}</h2>
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          className="inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-800 transition hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
        >
          <span aria-hidden="true">ℹ️</span>
          <span>{t('multisigHelp:linkLabel')}</span>
        </button>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{t('common:multisigEdit.hint')}</p>

      <NetworkSelector value={network} onChange={setNetwork} />

      <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{t('common:multisigEdit.noteMaxSigners')}</p>

      <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
        <h3 className="font-semibold mb-2">{t('common:multisigEdit.currentConfig')}</h3>
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" name="ms-mode" value="test" checked={mode === 'test'} onChange={() => setMode('test')} />
            {t('multisig:mode.test.label')}
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" name="ms-mode" value="prod" checked={mode === 'prod'} onChange={() => setMode('prod')} />
            {t('multisig:mode.prod.label')}
          </label>
        </div>
        {mode === 'prod' && (
          <div className="mb-4 border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 rounded p-3">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">{t('multisig:mode.prod.banner.title')}</div>
            <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">{t('multisig:mode.prod.banner.body')}</p>
          </div>
        )}

        {/* Signers first */}
        <div className="mt-2">
          <h4 className="font-semibold mb-1">{t('common:multisigEdit.signers')}</h4>
          <div className="space-y-2">
            <div className="hidden sm:grid sm:grid-cols-5 text-xs text-gray-500 px-1">
              <div className="sm:col-span-4">{t('common:multisigEdit.signers')}</div>
              <div className="text-right pr-2">{t('common:multisigEdit.weight')}</div>
            </div>
            {signers.map((s, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-5 items-center">
                <input
                  type="text"
                  value={s.key}
                  onChange={(e)=>updateSignerKey(i, e.target.value)}
                  placeholder="G..."
                  className="sm:col-span-4 border rounded px-2 py-1 font-mono text-sm"
                />
                <div className="flex items-center gap-1 flex-wrap max-w-full">
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={s.weight}
                    onChange={(e)=>updateSignerWeight(i, e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-16"
                    title={t('createAccount:tooltips.signerWeight')}
                  />
                  <button type="button" onClick={()=>removeSignerRow(i)} className="px-1.5 py-1 border rounded text-xs whitespace-nowrap hover:bg-gray-100 dark:hover:bg-gray-800">{t('common:option.delete')}</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addSignerRow} className="mt-2 px-2 py-1 border rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-800">{t('common:option.add')}</button>
        </div>

        {/* Master weight below signers */}
        <div className="mt-4 flex items-center gap-3">
          <label className="text-sm font-semibold inline-flex items-center gap-1">
            {t('common:multisigEdit.masterWeight')}
          </label>
          <input type="number" min={0} max={255} value={masterWeight} onChange={(e)=>setMasterWeight(clampByte(e.target.value))} className="border rounded px-2 py-1 text-sm w-20" />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-semibold mb-1">{t('createAccount:threshold')}</label>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <span>{t('createAccount:thresholdLow')} <span className="text-xs cursor-help" title={t('createAccount:tooltips.low')}>ⓘ</span></span>
              <input type="number" min={0} max={255} value={lowT} onChange={(e)=>setLowT(clampByte(e.target.value))} className={`border rounded px-2 py-1 w-16 ${thLowErr ? 'border-red-500' : ''}`} />
              <span className="text-xs text-gray-700 dark:text-gray-300">{t('createAccount:units.signatures')}</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <span>{t('createAccount:thresholdMed')} <span className="text-xs cursor-help" title={t('createAccount:tooltips.med')}>ⓘ</span></span>
              <input type="number" min={0} max={255} value={medT} onChange={(e)=>setMedT(clampByte(e.target.value))} className={`border rounded px-2 py-1 w-16 ${thMedErr ? 'border-red-500' : ''}`} />
              <span className="text-xs text-gray-700 dark:text-gray-300">{t('createAccount:units.signatures')}</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <span>{t('createAccount:thresholdHigh')} <span className="text-xs cursor-help" title={t('createAccount:tooltips.high')}>ⓘ</span></span>
              <input type="number" min={0} max={255} value={highT} onChange={(e)=>setHighT(clampByte(e.target.value))} className={`border rounded px-2 py-1 w-16 ${thHighErr ? 'border-red-500' : ''}`} />
              <span className="text-xs text-gray-700 dark:text-gray-300">{t('createAccount:units.signatures')}</span>
            </label>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t('createAccount:thresholdLevelsHint')} • {t('createAccount:thresholdSum', { sum: sumWeights })}</p>
          {(thLowErr || thMedErr || thHighErr) && (
            <p className="text-xs text-red-600 mt-1">{t('createAccount:thresholdTooHigh')}</p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={loading || thLowErr || thMedErr || thHighErr} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50">{t('common:multisigEdit.save')}</button>
        <button onClick={loadAccount} disabled={loading || !(defaultPublicKey||'').trim()} className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">{t('common:multisigEdit.reload')}</button>
      </div>

      {info && <p className="mt-3 text-sm text-green-700 dark:text-green-400">{info}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-xl my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold">{t('common:option.confirm.action.title', 'Confirm action')}</h3>
              <button
                type="button"
                className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => { setShowConfirmModal(false); setPendingAction(null); }}
              >
                {t('common:option.cancel', 'Cancel')}
              </button>
            </div>
            <div className="text-sm space-y-1 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-gray-700 dark:text-gray-300">{t('common:multisigEdit.masterWeight')}</span>
                <span className="font-mono">{masterWeight}</span>
              </div>
              <div className="flex flex-wrap gap-3">
                <span className="text-gray-700 dark:text-gray-300">{t('createAccount:thresholdLow')}:</span>
                <span className="font-mono">{lowT}</span>
                <span className="text-gray-700 dark:text-gray-300">{t('createAccount:thresholdMed')}:</span>
                <span className="font-mono">{medT}</span>
                <span className="text-gray-700 dark:text-gray-300">{t('createAccount:thresholdHigh')}:</span>
                <span className="font-mono">{highT}</span>
              </div>
            </div>
              <div className="grid gap-3">
              <div className="border rounded p-3">
                <div className="font-semibold mb-1">{t('multisig:confirm.testModeTitle')}</div>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{t('multisig:confirm.testModeDescription')}</p>
                <button
                  type="button"
                  onClick={handleConfirmTestMode}
                  className="w-full px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={mode === 'prod'}
                >
                  {t('multisig:confirm.testModeButton')}
                </button>
                {mode === 'prod' && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t('multisig:mode.prod.banner.body')}</p>
                )}
              </div>
              <div className="border rounded p-3">
                <div className="font-semibold mb-1">
                  {mode === 'prod' ? t('multisig:actions.createMultisigJob') : t('multisig:confirm.prepareTitle')}
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                  {mode === 'prod' ? t('multisig:confirm.prepareDescription') : t('multisig:confirm.prepareDescription')}
                </p>
                <button
                  type="button"
                  onClick={mode === 'prod' ? handleCreateMultisigJob : handlePrepareMultisig}
                  className="w-full px-3 py-2 rounded border border-blue-200 text-blue-700 dark:text-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900"
                >
                  {mode === 'prod' ? t('multisig:actions.createMultisigJob') : t('multisig:confirm.prepareButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSecretModal && (
        <SecretKeyModal
          onConfirm={(collected)=>{ if (pendingAction==='save') submitChanges(collected); }}
          onCancel={()=>{ setShowSecretModal(false); setPendingAction(null); }}
          thresholds={currentAccount?.thresholds || thresholdsForModal}
          signers={currentAccount?.signers || signersForModal}
          operationType="setOptions"
          requiredThreshold={requiredThreshold}
          account={currentAccount || { signers: signersForModal, thresholds: thresholdsForModal }}
        />
      )}
      {preparedTx && (
        <MultisigPrepareDialog
          open={!!preparedTx}
          onClose={() => setPreparedTx(null)}
          hash={preparedTx.hash}
          xdr={preparedTx.xdr}
          summary={preparedTx.summary}
        />
      )}
      <MultiSigHelpDialog isOpen={isHelpOpen} onClose={()=>setIsHelpOpen(false)} />
    </div>
  );
}
