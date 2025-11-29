import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import SecretKeyModal from '../components/SecretKeyModal.jsx';
import { getHorizonServer } from '../utils/stellar/stellarUtils.js';
import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Horizon
} from '@stellar/stellar-sdk';

const HORIZON_MAIN = 'https://horizon.stellar.org';
const HORIZON_TEST = 'https://horizon-testnet.stellar.org';

function NetworkSelector({ value, onChange }) {
  const { t } = useTranslation(['multisigCreate', 'network', 'common']);
  return (
    <div className="flex gap-4 mb-4">
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="network"
          value="PUBLIC"
          checked={value === 'PUBLIC'}
          onChange={() => onChange('PUBLIC')}
        />
        {t('network:mainnet')}
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="network"
          value="TESTNET"
          checked={value === 'TESTNET'}
          onChange={() => onChange('TESTNET')}
        />
        {t('network:testnet')}
      </label>
    </div>
  );
}

export default function MultisigCreatePage() {
  const { t } = useTranslation(['multisigCreate', 'network', 'common']);

  const [network, setNetwork] = useState(() => {
    try {
      return (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC';
    } catch {
      return 'PUBLIC';
    }
  });
  const [generated, setGenerated] = useState(null); // { pub, sec }
  const [signers, setSigners] = useState(['']);
  const [signerCount, setSignerCount] = useState(1);

  const [enableMultisig, setEnableMultisig] = useState(false);
  const [activateNow, setActivateNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [error, setError] = useState('');
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'activate' | 'createAll'
  const [baseReserve, setBaseReserve] = useState(null); // XLM per entry
  const [startingBalance, setStartingBalance] = useState('1');
  const [showInfo2, setShowInfo2] = useState(false);
  const [showKeyWarning, setShowKeyWarning] = useState(false);

  const server = useMemo(() => getHorizonServer(network === 'TESTNET' ? HORIZON_TEST : HORIZON_MAIN), [network]);
  const passphrase = network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;

  // Weights & thresholds
  const [masterWeight, setMasterWeight] = useState(1);
  const [signerWeights, setSignerWeights] = useState([1]); // aligned with signers
  const [lowT, setLowT] = useState(1);
  const [medT, setMedT] = useState(2);
  const [highT, setHighT] = useState(2);

  // Helper: clamp to byte range 0..255 and coerce to integer
  function clampByte(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(255, Math.trunc(v)));
  }
  function handleMasterWeightChange(val) {
    setMasterWeight(clampByte(val));
  }
  function handleThresholdChange(kind, val) {
    const v = clampByte(val);
    if (kind === 'low') setLowT(v);
    else if (kind === 'med') setMedT(v);
    else if (kind === 'high') setHighT(v);
  }

  const sumWeights = useMemo(() => {
    const mw = Math.max(0, Number(masterWeight) || 0);
    const sw = (signerWeights || []).reduce((a, b) => a + Math.max(0, Number(b) || 0), 0);
    return mw + sw;
  }, [masterWeight, signerWeights]);

  const thLowErr = lowT > sumWeights;
  const thMedErr = medT > sumWeights;
  const thHighErr = highT > sumWeights;

  // Sync with global network changes
  useEffect(() => {
    const handler = (e) => {
      try {
        const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('STM_NETWORK') || 'PUBLIC');
        setNetwork(v === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
      } catch { /* noop */ }
    };
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  // Sync signers length with selected count (and weights too)
  useEffect(() => {
    setSigners(prev => {
      const n = Math.max(0, Number(signerCount) || 0);
      if (prev.length === n) return prev;
      if (prev.length < n) return [...prev, ...Array.from({ length: n - prev.length }, () => '')];
      return prev.slice(0, n);
    });
    setSignerWeights(prev => {
      const n = Math.max(0, Number(signerCount) || 0);
      if (prev.length === n) return prev;
      if (prev.length < n) return [...prev, ...Array.from({ length: n - prev.length }, () => 1)];
      return prev.slice(0, n);
    });
  }, [signerCount]);

  function handleSignerChange(i, val) {
    const arr = [...signers];
    arr[i] = val.trim();
    setSigners(arr);
  }
  function handleSignerWeightChange(i, val) {
    const w = Math.max(0, Math.min(255, Number(val) || 0));
    const arr = [...signerWeights];
    arr[i] = w;
    setSignerWeights(arr);
  }

  function handleGenerate() {
    const kp = Keypair.random();
    setGenerated({ pub: kp.publicKey(), sec: kp.secret() });
    setResultMsg('');
    setError('');
  }

  async function friendbotActivate(pub) {
    const url = `https://friendbot.stellar.org?addr=${encodeURIComponent(pub)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Friendbot request failed');
    return r.json();
  }

  // Load base reserve from latest ledger (in XLM)
  async function fetchBaseReserveXLM() {
    try {
      const ledgers = await server.ledgers().order('desc').limit(1).call();
      const latest = ledgers.records?.[0];
      const stroops = Number(latest?.base_reserve_in_stroops || 5000000);
      return stroops / 10000000; // 10^7 stroops per XLM
    } catch {
      return 0.5; // fallback
    }
  }

  async function ensureAccountExists(pub, server) {
    try {
      await server.loadAccount(pub);
      return true;
    } catch {
      return false;
    }
  }

  async function getBaseFee(server) {
    try {
      const fs = await server.feeStats();
      return Number(fs?.fee_charged?.mode || 100);
    } catch {
      return 100;
    }
  }

  async function activateWithFunderSecret(funderSecret, destPub, startingBalanceXLM = '1') {
    const funder = Keypair.fromSecret(funderSecret);
    const funderPub = funder.publicKey();
    const account = await server.loadAccount(funderPub);
    const tx = new TransactionBuilder(account, {
      fee: String(await getBaseFee(server)),
      networkPassphrase: passphrase
    })
      .addOperation(
        Operation.createAccount({ destination: destPub, startingBalance: String(startingBalanceXLM || '1') })
      )
      .setTimeout(60)
      .build();
    tx.sign(funder);
    const res = await server.submitTransaction(tx);
    return res?.hash || res?.id || '';
  }

  async function setMultisigOnNewAccount(newSecret) {
    const newKp = Keypair.fromSecret(newSecret);
    const newPub = newKp.publicKey();

    // Filter gültige zusätzliche Signer (G...)
    const validSigners = (signers || [])
      .map((s) => s.trim())
      .filter((s) => s && s.startsWith('G') && s.length >= 10);

    if (validSigners.length === 0) {
      // Nichts zu tun
      return { hash: null, skipped: true };
    }

    const acct = await server.loadAccount(newPub);
    const txb = new TransactionBuilder(acct, {
      fee: String(await getBaseFee(server)),
      networkPassphrase: passphrase
    });

    // 1) Master-Weight & Schwellen setzen
    txb.addOperation(
      Operation.setOptions({
        masterWeight: Math.max(0, Math.min(255, Number(masterWeight) || 0)),
        lowThreshold: Math.max(0, Math.min(255, Number(lowT) || 0)),
        medThreshold: Math.max(0, Math.min(255, Number(medT) || 0)),
        highThreshold: Math.max(0, Math.min(255, Number(highT) || 0)),
      })
    );
    // 2) Zusätzliche Unterzeichner hinzufügen (jeweils mit Gewicht)
    validSigners.forEach((s, idx) => {
      const w = Math.max(0, Math.min(255, Number(signerWeights[idx]) || 0));
      txb.addOperation(
        Operation.setOptions({ signer: { ed25519PublicKey: s, weight: w } })
      );
    });

    const tx = txb.setTimeout(60).build();
    tx.sign(newKp);
    const res = await server.submitTransaction(tx);
    return { hash: res?.hash || res?.id || '' };
  }


  async function handleConfirmSecret(funderSecret) {
    setShowSecretModal(false);
    if (!pendingAction) return;
    const { type, destPub, startingBalance } = pendingAction;
    setPendingAction(null);

    try {
      setBusy(true);
      setError('');
      if (type === 'activate') {
        const hash = await activateWithFunderSecret(funderSecret, destPub, startingBalance || '1');
        setResultMsg(t('multisigCreate:activated', { hash }));
      } else if (type === 'createAll') {
        // 1) Aktivieren
        await activateWithFunderSecret(funderSecret, destPub, startingBalance || '1');
        // 2) Multisig setzen
        const setRes = await setMultisigOnNewAccount(generated.sec);
        setResultMsg(
          t('multisigCreate:createdAndConfigured', { hash: setRes.hash || '' })
        );
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAll() {
    if (!generated?.pub || !generated?.sec) {
      setError(t('multisigCreate:generateFirst'));
      return;
    }
    // Zeige erst Schlüssel-Sicherungs-Warnung
    setShowKeyWarning(true);
    return;
  }

  async function handleCreateAllAfterWarning() {
    setShowKeyWarning(false);
    // Warn-Confirm bei zu geringem Startguthaben im Mainnet
    if (network === 'PUBLIC' && activateNow) {
      const bal = parseFloat(startingBalance || '0');
      if (bal < requiredReserve) {
        const ok = window.confirm(t('multisigCreate:confirmLowBalance', { bal: bal.toFixed(7), req: requiredReserve.toFixed(7), count: Math.max(0, Number(signerCount)||0) }));
        if (!ok) return;
      }
    }
    setBusy(true);
    setResultMsg('');
    setError('');
    try {
      // 1) Aktivieren (optional)
      if (activateNow) {
        if (network === 'TESTNET') {
          await friendbotActivate(generated.pub);
        } else {
          // Mainnet → Secret vom Funder anfragen und danach fortsetzen
          setPendingAction({ type: 'createAll', destPub: generated.pub, startingBalance });
          setShowSecretModal(true);
          return; // Warten auf Modal
        }
      }

      // 2) Multisig setzen (falls Signer vorhanden)
      const setRes = await setMultisigOnNewAccount(generated.sec);
      if (setRes.skipped) {
        setResultMsg(t('multisigCreate:createdNoSigners'));
      } else {
        setResultMsg(t('multisigCreate:createdAndConfigured', { hash: setRes.hash || '' }));
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleActivateOnly() {
    if (!generated?.pub) {
      setError(t('multisigCreate:generateFirst'));
      return;
    }
    try {
      setBusy(true);
      setResultMsg('');
      setError('');
      const existed = await ensureAccountExists(generated.pub, server);
      if (existed) {
        setResultMsg(t('multisigCreate:alreadyActive'));
        return;
      }
      if (network === 'TESTNET') {
        await friendbotActivate(generated.pub);
        setResultMsg(t('multisigCreate:activatedTestnet'));
      } else {
        const bal = parseFloat(startingBalance || '0');
        if (bal < requiredReserve) {
          const ok = window.confirm(t('multisigCreate:confirmLowBalance', { bal: bal.toFixed(7), req: requiredReserve.toFixed(7), count: Math.max(0, Number(signerCount)||0) }));
          if (!ok) { setBusy(false); return; }
        }
        setPendingAction({ type: 'activate', destPub: generated.pub, startingBalance });
        setShowSecretModal(true);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // Anzahl bereits gültiger (eingegebener) Signer – aktuell nur für Validierungen verwendet
  // const validSignerCount = (signers || []).filter((s) => s && s.trim().startsWith('G')).length;


  // derive reserve numbers
  const requiredReserve = useMemo(() => {
    const base = Number(baseReserve || 0.5);
    const plannedSignerCount = enableMultisig ? Math.max(0, Number(signerCount) || 0) : 0;
    const min = base * (2 + plannedSignerCount);
    return Number.isFinite(min) ? min : 1;
  }, [baseReserve, enableMultisig, signerCount]);
  const recommended = useMemo(() => {
    // add small buffer (e.g., +0.5 XLM)
    return Math.max(requiredReserve + 0.5, 1);
  }, [requiredReserve]);

  return (
    <div className="max-w-3xl mx-auto p-4">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-semibold">{t('multisigCreate:title')}</h2>
      </div>

      {/* Info-Button ganz oben */}
      <div className="mb-4 text-center">
        <button type="button" onClick={()=>setShowInfo2(true)} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
          {t('multisigCreate:info.more')}
        </button>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{t('multisigCreate:hint')}</p>

      <NetworkSelector value={network} onChange={async (net) => {
        setNetwork(net);
        // Sync global state
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem('STM_NETWORK', net);
            window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: net }));
          }
        } catch { /* noop */ }
        const r = await fetchBaseReserveXLM();
        setBaseReserve(r);
        if (net === 'PUBLIC') {
          setStartingBalance(recommended.toFixed(7));
        } else {
          setStartingBalance('1');
        }
      }} />

      <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button onClick={handleGenerate} className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700" disabled={busy}>
            {t('multisigCreate:generateKeys')}
          </button>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enableMultisig} onChange={()=>setEnableMultisig(v=>!v)} />
            {t('multisigCreate:enableMultisig')}
          </label>
        </div>
        {generated && (
          <div className="space-y-2">
            <div>
              <label className="block text-sm font-semibold">Public Key</label>
              <div className="font-mono break-all text-sm">{generated.pub}</div>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate:instructions.public')}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold">Secret Key</label>
              <div className="font-mono break-all text-sm">{generated.sec}</div>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate:instructions.secret')}</p>
            </div>
          </div>
        )}
      </div>

      {enableMultisig && generated && (
        <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
          <h3 className="font-semibold mb-2">{t('multisigCreate:signersTitle')}</h3>
          <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 border rounded text-xs text-blue-900 dark:text-blue-200">
            <strong>{t('multisigCreate:bestPractices.title')}:</strong> {t('multisigCreate:bestPractices.text')}
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{t('multisigCreate:signersInfo')}</p>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-sm font-semibold">{t('multisigCreate:signersCount')}</label>
            <input
              type="number"
              min={1}
              max={20}
              value={signerCount}
              onChange={(e)=>setSignerCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              onBlur={(e)=>setSignerCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="border rounded px-2 py-1 text-sm w-24"
              title={t('multisigCreate:signersCountLimit')}
            />
            <span className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate:signersCountLimit')}</span>
          </div>
          <div className="space-y-2">
            {signers.map((s, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-5 items-center">
                <input
                  type="text"
                  value={s}
                  onChange={(e) => handleSignerChange(i, e.target.value)}
                  placeholder="G..."
                  className="sm:col-span-4 border rounded px-2 py-1 font-mono text-sm"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={signerWeights[i] ?? 1}
                    onChange={(e)=>handleSignerWeightChange(i, e.target.value)}
                    onBlur={(e)=>handleSignerWeightChange(i, e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-20"
                    title={t('multisigCreate:tooltips.signerWeight')}
                  />
                  <span className="text-xs text-gray-500">{t('multisigCreate:hints.byteRange')}</span>
                  <span className="text-xs cursor-help" title={t('multisigCreate:tooltips.signerWeight')}>ⓘ</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="text-sm font-semibold inline-flex items-center gap-1">
              Master-Gewicht
              <span className="text-xs text-gray-500">{t('multisigCreate:hints.byteRange')}</span>
              <span className="text-xs cursor-help" title={t('multisigCreate:tooltips.masterWeight')}>ⓘ</span>
            </label>
            <input
              type="number"
              min={0}
              max={255}
              value={masterWeight}
              onChange={(e)=>handleMasterWeightChange(e.target.value)}
              onBlur={(e)=>handleMasterWeightChange(e.target.value)}
              className="border rounded px-2 py-1 text-sm w-24"
              title={t('multisigCreate:hints.byteRange')}
            />
          </div>
          <div className="mt-4">
            <label className="block text-sm font-semibold mb-1">{t('multisigCreate:threshold')}</label>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <span>niedrig <span className="text-xs cursor-help" title={t('multisigCreate:tooltips.low')}>ⓘ</span></span>
                <input type="number" min={0} max={255} value={lowT} onChange={(e)=>handleThresholdChange('low', e.target.value)} onBlur={(e)=>handleThresholdChange('low', e.target.value)} className={`border rounded px-2 py-1 w-16 ${thLowErr ? 'border-red-500' : ''}`} title={t('multisigCreate:hints.byteRange')} />
                <span className="text-xs text-gray-700 dark:text-gray-300">{t('multisigCreate:units.signatures')}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <span>mittel <span className="text-xs cursor-help" title={t('multisigCreate:tooltips.med')}>ⓘ</span></span>
                <input type="number" min={0} max={255} value={medT} onChange={(e)=>handleThresholdChange('med', e.target.value)} onBlur={(e)=>handleThresholdChange('med', e.target.value)} className={`border rounded px-2 py-1 w-16 ${thMedErr ? 'border-red-500' : ''}`} title={t('multisigCreate:hints.byteRange')} />
                <span className="text-xs text-gray-700 dark:text-gray-300">{t('multisigCreate:units.signatures')}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <span>hoch <span className="text-xs cursor-help" title={t('multisigCreate:tooltips.high')}>ⓘ</span></span>
                <input type="number" min={0} max={255} value={highT} onChange={(e)=>handleThresholdChange('high', e.target.value)} onBlur={(e)=>handleThresholdChange('high', e.target.value)} className={`border rounded px-2 py-1 w-16 ${thHighErr ? 'border-red-500' : ''}`} title={t('multisigCreate:hints.byteRange')} />
                <span className="text-xs text-gray-700 dark:text-gray-300">{t('multisigCreate:units.signatures')}</span>
              </label>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t('multisigCreate:thresholdLevelsHint')} • {t('multisigCreate:thresholdSum', { sum: sumWeights })}</p>
            {(thLowErr || thMedErr || thHighErr) && (
              <p className="text-xs text-red-600 mt-1">{t('multisigCreate:thresholdTooHigh')}</p>
            )}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={activateNow} onChange={() => setActivateNow(!activateNow)} />
          <span>
            <span className="font-semibold">{t('multisigCreate:activateNow')}</span>
            <br />
            <span className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate:activateHint')}</span>
          </span>
        </label>
        {network === 'PUBLIC' && activateNow && (
          <>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold mb-1">{t('multisigCreate:startingBalance')}</label>
                <input
                  type="number"
                  step="0.0000001"
                  min="0"
                  value={startingBalance}
                  onChange={(e) => setStartingBalance(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                />
                {parseFloat(startingBalance || '0') < requiredReserve && (
                  <p className="text-xs text-red-600 mt-1">
                    {t('multisigCreate:balanceWarning', { req: requiredReserve.toFixed(7), count: Math.max(0, Number(signerCount)||0) })}
                  </p>
                )}
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-300">
                <div>{t('multisigCreate:reserve.base', { val: (baseReserve ?? 0.5).toFixed(7) })}</div>
                <div className={(parseFloat(startingBalance || '0') < requiredReserve) ? 'font-semibold text-red-700 dark:text-red-400' : 'font-semibold'}>{t('multisigCreate:reserve.required', { val: requiredReserve.toFixed(7) })}</div>
                <div>{t('multisigCreate:reserve.recommended', { val: recommended.toFixed(7) })}</div>
              </div>
            </div>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-2">
              {t('multisigCreate:mainnetActivateNote')}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={handleCreateAll} disabled={busy || (enableMultisig && (thLowErr || thMedErr || thHighErr))} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50">
          {t('multisigCreate:createButton')}
        </button>
        <button onClick={handleActivateOnly} disabled={busy} className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
          {t('multisigCreate:activateOnly')}
        </button>
      </div>

      {resultMsg && <p className="mt-4 text-green-700 dark:text-green-400 text-sm">{resultMsg}</p>}
      {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}

      {showSecretModal && (
        <SecretKeyModal
          onConfirm={handleConfirmSecret}
          onCancel={() => { setShowSecretModal(false); setPendingAction(null); }}
        />
      )}

      {showInfo2 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-6 max-w-3xl w-full mx-auto my-8">
            <h3 className="text-xl font-bold mb-4">{t('multisigCreate:info.title')}</h3>
            
            <div className="space-y-4 text-sm">
              {/* Geheimschlüssel sichern */}
              <div>
                <h4 className="font-bold mb-2">{t('multisigCreate:info.secureKeys.title')}</h4>
                <p className="whitespace-pre-line text-gray-700 dark:text-gray-300">{t('multisigCreate:info.secureKeys.text')}</p>
              </div>

              {/* Geheimschlüssel auf dieser Seite */}
              <div>
                <h4 className="font-bold mb-2">{t('multisigCreate:info.keysOnPage.title')}</h4>
                <p className="whitespace-pre-line text-gray-700 dark:text-gray-300">{t('multisigCreate:info.keysOnPage.text')}</p>
              </div>

              {/* Multisig */}
              <div>
                <h4 className="font-bold mb-2">{t('multisigCreate:info.multisigSection.title')}</h4>
                <p className="whitespace-pre-line text-gray-700 dark:text-gray-300">{t('multisigCreate:info.multisigSection.text')}</p>
              </div>
            </div>

            <div className="text-right mt-6">
              <button onClick={()=>{ setShowInfo2(false); }} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
                {t('common:close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showKeyWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-6 max-w-md w-full my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <h3 className="text-lg font-bold mb-3 text-red-600">{t('multisigCreate:keyWarning.title')}</h3>
            <div className="text-sm space-y-3 text-gray-700 dark:text-gray-300">
              <p>{t('multisigCreate:keyWarning.text1')}</p>
              <p className="font-semibold">{t('multisigCreate:keyWarning.text2')}</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>{t('multisigCreate:keyWarning.list1')}</li>
                <li>{t('multisigCreate:keyWarning.list2')}</li>
                <li>{t('multisigCreate:keyWarning.list3')}</li>
              </ul>
            </div>
            <div className="text-right mt-6">
              <button onClick={handleCreateAllAfterWarning} className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700">
                {t('multisigCreate:keyWarning.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
