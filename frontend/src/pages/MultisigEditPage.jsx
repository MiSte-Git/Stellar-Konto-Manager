import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SecretKeyModal from '../components/SecretKeyModal.jsx';
import { getHorizonServer } from '../utils/stellar/stellarUtils.js';
import { Keypair, Networks, Operation, TransactionBuilder, StrKey } from '@stellar/stellar-sdk';

const HORIZON_MAIN = 'https://horizon.stellar.org';
const HORIZON_TEST = 'https://horizon-testnet.stellar.org';

function NetworkSelector({ value, onChange }) {
  const { t } = useTranslation();
  const isTestnet = value === 'TESTNET';
  return (
    <div className={`flex items-center justify-between gap-4 mb-4 p-2 border rounded relative ${isTestnet ? 'border-yellow-500 ring-1 ring-yellow-400' : ''}`}>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">
          <input type="radio" name="network" value="PUBLIC" checked={value === 'PUBLIC'} onChange={() => { try { window.localStorage.setItem('STM_NETWORK','PUBLIC'); window.localStorage.removeItem('STM_HORIZON_URL'); } catch (e) { void e; } window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' })); window.dispatchEvent(new Event('stm-trigger-recheck')); onChange('PUBLIC'); }} />
          {t('network.mainnet')}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="network" value="TESTNET" checked={value === 'TESTNET'} onChange={() => { try { window.localStorage.setItem('STM_NETWORK','TESTNET'); window.localStorage.setItem('STM_HORIZON_URL','https://horizon-testnet.stellar.org'); } catch (e) { void e; } window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'TESTNET' })); window.dispatchEvent(new Event('stm-trigger-recheck')); onChange('TESTNET'); }} />
          {t('network.testnet')}
        </label>
      </div>
      {isTestnet && (
        <span className="inline-block bg-yellow-500 text-white text-xs font-semibold px-2 py-0.5 rounded">
          {t('badges.testnet')}
        </span>
      )}
    </div>
  );
}

export default function MultisigEditPage({ defaultPublicKey = '' }) {
  const { t } = useTranslation();

  const [network, setNetwork] = useState(() => {
    try { return (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC'; } catch { return 'PUBLIC'; }
  });
  const server = useMemo(() => getHorizonServer(network === 'TESTNET' ? HORIZON_TEST : HORIZON_MAIN), [network]);
  const passphrase = network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;

  // use global wallet (defaultPublicKey) from header; no local input
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // Account state
  const [masterWeight, setMasterWeight] = useState(1);
  const [signers, setSigners] = useState([]); // [{key, weight}], excludes master
  const [lowT, setLowT] = useState(1);
  const [medT, setMedT] = useState(2);
  const [highT, setHighT] = useState(2);

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
  async function loadAccount() {
    const pk = (defaultPublicKey || '').trim();
    if (!pk) return;
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const acct = await server.loadAccount(pk);
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
      setInfo(t('multisigEdit.loaded', { count: others.length }));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (defaultPublicKey) loadAccount();
  }, [defaultPublicKey, network]);

  // Sync local network radio with global header toggle
  useEffect(() => {
    const handler = (e) => {
      const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('STM_NETWORK') || 'PUBLIC');
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
  async function submitChanges(secret) {
    setShowSecretModal(false);
    const kp = Keypair.fromSecret(secret);
    const pk = (defaultPublicKey || '').trim();
    if (!pk) { setError(t('publicKey.invalid')); return; }
    // ok, self-signing if kp.publicKey() === pk; else allowed if weight sufficient
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const acct = await server.loadAccount(pk);
      const feeStats = await server.feeStats();
      const fee = String(Number(feeStats?.fee_charged?.mode || 100));

      // Current state
      const currentMaster = (acct.signers || []).find(s => s.key === pk)?.weight ?? 1;
      const currentMap = new Map();
      (acct.signers || []).forEach(s => { if (s.key !== pk && s.type && s.type.includes('ed25519')) currentMap.set(s.key, s.weight); });
      const plannedMap = new Map();
      (signers || []).forEach(s => { const k = (s.key || '').trim(); if (k && k.startsWith('G')) plannedMap.set(k, clampByte(s.weight)); });
      const plannedMaster = clampByte(masterWeight);
      const plannedThresholds = { low: clampByte(lowT), med: clampByte(medT), high: clampByte(highT) };

      // Validation: thresholds ≤ sumWeights
      const sumW = clampByte(plannedMaster) + Array.from(plannedMap.values()).reduce((a, b) => a + clampByte(b), 0);
      if (plannedThresholds.low > sumW || plannedThresholds.med > sumW || plannedThresholds.high > sumW) {
        throw new Error(t('multisigEdit.error.thresholdTooHigh'));
      }

      const txb = new TransactionBuilder(acct, { fee, networkPassphrase: passphrase });

      // 1) Relax thresholds first if needed
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

      // 2) Increase master weight early if raising
      if (plannedMaster > currentMaster) {
        txb.addOperation(Operation.setOptions({ masterWeight: plannedMaster }));
      }

      // 3) Add new signers or increase weights
      for (const [k, wPlanned] of plannedMap.entries()) {
        const wCur = currentMap.get(k) || 0;
        if (wPlanned > wCur) {
          txb.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: k, weight: wPlanned } }));
        }
      }

      // 4) Decrease weights / remove signers
      for (const [k, wCur] of currentMap.entries()) {
        const has = plannedMap.has(k);
        const wPlanned = plannedMap.get(k) || 0;
        if (!has || wPlanned < wCur) {
          // removal if !has (weight=0)
          txb.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: k, weight: has ? wPlanned : 0 } }));
        }
      }

      // 5) Lower master weight late if reducing
      if (plannedMaster < currentMaster) {
        txb.addOperation(Operation.setOptions({ masterWeight: plannedMaster }));
      }

      // 6) Raise thresholds last if needed
      if (plannedThresholds.low > relaxedLow || plannedThresholds.med > relaxedMed || plannedThresholds.high > relaxedHigh) {
        txb.addOperation(Operation.setOptions({
          lowThreshold: plannedThresholds.low,
          medThreshold: plannedThresholds.med,
          highThreshold: plannedThresholds.high,
        }));
      }

      const tx = txb.setTimeout(60).build();
      tx.sign(kp);
      const res = await server.submitTransaction(tx);
      setInfo(t('multisigEdit.saved', { hash: res?.hash || res?.id || '' }));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    const pk = (defaultPublicKey || '').trim();
    if (!StrKey.isValidEd25519PublicKey(pk)) {
      setError(t('publicKey.invalid'));
      return;
    }
    // validate signer keys (optional: allow empty rows)
    for (const s of signers) {
      const k = (s.key || '').trim();
      if (k && !StrKey.isValidEd25519PublicKey(k)) {
        setError(t('multisigEdit.validation.signerKeyInvalid'));
        return;
      }
    }
    setPendingAction('save');
    setShowSecretModal(true);
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-semibold">{t('multisigEdit.title')}</h2>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{t('multisigEdit.hint')}</p>

      <NetworkSelector value={network} onChange={setNetwork} />

      <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{t('multisigEdit.noteMaxSigners')}</p>

      <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
        <h3 className="font-semibold mb-2">{t('multisigEdit.currentConfig')}</h3>

        {/* Signers first */}
        <div className="mt-2">
          <h4 className="font-semibold mb-1">{t('multisigEdit.signers')}</h4>
          <div className="space-y-2">
            <div className="hidden sm:grid sm:grid-cols-5 text-xs text-gray-500 px-1">
              <div className="sm:col-span-4">{t('multisigEdit.signers')}</div>
              <div className="text-right pr-2">{t('multisigEdit.weight')}</div>
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
                    title={t('multisigCreate.tooltips.signerWeight')}
                  />
                  <button type="button" onClick={()=>removeSignerRow(i)} className="px-1.5 py-1 border rounded text-xs whitespace-nowrap hover:bg-gray-100 dark:hover:bg-gray-800">{t('option.delete')}</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addSignerRow} className="mt-2 px-2 py-1 border rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-800">{t('option.add')}</button>
        </div>

        {/* Master weight below signers */}
        <div className="mt-4 flex items-center gap-3">
          <label className="text-sm font-semibold inline-flex items-center gap-1">
            {t('multisigEdit.masterWeight')}
          </label>
          <input type="number" min={0} max={255} value={masterWeight} onChange={(e)=>setMasterWeight(clampByte(e.target.value))} className="border rounded px-2 py-1 text-sm w-20" />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-semibold mb-1">{t('multisigCreate.threshold')}</label>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <span>{t('multisigCreate.thresholdLow')} <span className="text-xs cursor-help" title={t('multisigCreate.tooltips.low')}>ⓘ</span></span>
              <input type="number" min={0} max={255} value={lowT} onChange={(e)=>setLowT(clampByte(e.target.value))} className={`border rounded px-2 py-1 w-16 ${thLowErr ? 'border-red-500' : ''}`} />
              <span className="text-xs text-gray-700 dark:text-gray-300">{t('multisigCreate.units.signatures')}</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <span>{t('multisigCreate.thresholdMed')} <span className="text-xs cursor-help" title={t('multisigCreate.tooltips.med')}>ⓘ</span></span>
              <input type="number" min={0} max={255} value={medT} onChange={(e)=>setMedT(clampByte(e.target.value))} className={`border rounded px-2 py-1 w-16 ${thMedErr ? 'border-red-500' : ''}`} />
              <span className="text-xs text-gray-700 dark:text-gray-300">{t('multisigCreate.units.signatures')}</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <span>{t('multisigCreate.thresholdHigh')} <span className="text-xs cursor-help" title={t('multisigCreate.tooltips.high')}>ⓘ</span></span>
              <input type="number" min={0} max={255} value={highT} onChange={(e)=>setHighT(clampByte(e.target.value))} className={`border rounded px-2 py-1 w-16 ${thHighErr ? 'border-red-500' : ''}`} />
              <span className="text-xs text-gray-700 dark:text-gray-300">{t('multisigCreate.units.signatures')}</span>
            </label>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t('multisigCreate.thresholdLevelsHint')} • {t('multisigCreate.thresholdSum', { sum: sumWeights })}</p>
          {(thLowErr || thMedErr || thHighErr) && (
            <p className="text-xs text-red-600 mt-1">{t('multisigCreate.thresholdTooHigh')}</p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={loading || thLowErr || thMedErr || thHighErr} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50">{t('multisigEdit.save')}</button>
        <button onClick={loadAccount} disabled={loading || !(defaultPublicKey||'').trim()} className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">{t('multisigEdit.reload')}</button>
      </div>

      {info && <p className="mt-3 text-sm text-green-700 dark:text-green-400">{info}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {showSecretModal && (
        <SecretKeyModal
          onConfirm={(sec)=>{ if (pendingAction==='save') submitChanges(sec); }}
          onCancel={()=>{ setShowSecretModal(false); setPendingAction(null); }}
        />
      )}
    </div>
  );
}
