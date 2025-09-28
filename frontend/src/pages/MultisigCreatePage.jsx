import React, { useMemo, useState } from 'react';
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
        Mainnet
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="network"
          value="TESTNET"
          checked={value === 'TESTNET'}
          onChange={() => onChange('TESTNET')}
        />
        Testnet
      </label>
    </div>
  );
}

export default function MultisigCreatePage() {
  const { t } = useTranslation();

  const [network, setNetwork] = useState('TESTNET');
  const [generated, setGenerated] = useState(null); // { pub, sec }
  const [signers, setSigners] = useState(['']);
  const [threshold, setThreshold] = useState(2);
  const [activateNow, setActivateNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [error, setError] = useState('');
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // 'activate' | 'createAll'
  const [baseReserve, setBaseReserve] = useState(null); // XLM per entry
  const [startingBalance, setStartingBalance] = useState('1');

  const server = useMemo(() => getHorizonServer(network === 'TESTNET' ? HORIZON_TEST : HORIZON_MAIN), [network]);
  const passphrase = network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;

  function handleAddSignerField() {
    setSigners((prev) => [...prev, '']);
  }
  function handleSignerChange(i, val) {
    const arr = [...signers];
    arr[i] = val.trim();
    setSigners(arr);
  }
  function handleRemoveSigner(i) {
    setSigners((prev) => prev.filter((_, idx) => idx !== i));
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

    // 1) Zusätzliche Signer hinzufügen (Gewicht = 1)
    for (const s of validSigners) {
      txb.addOperation(
        Operation.setOptions({ signer: { ed25519PublicKey: s, weight: 1 } })
      );
    }
    // 2) Schwellenwerte setzen (alle gleich, z.B. 2)
    const req = Math.max(1, Math.min(validSigners.length + 1, Number(threshold) || 2));
    txb.addOperation(
      Operation.setOptions({
        masterWeight: 1, // Master weiterhin 1
        lowThreshold: req,
        medThreshold: req,
        highThreshold: req
      })
    );

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
        setResultMsg(t('multisigCreate.activated', { hash }));
      } else if (type === 'createAll') {
        // 1) Aktivieren
        await activateWithFunderSecret(funderSecret, destPub, startingBalance || '1');
        // 2) Multisig setzen
        const setRes = await setMultisigOnNewAccount(generated.sec);
        setResultMsg(
          t('multisigCreate.createdAndConfigured', { hash: setRes.hash || '' })
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
      setError(t('multisigCreate.generateFirst'));
      return;
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
        setResultMsg(t('multisigCreate.createdNoSigners'));
      } else {
        setResultMsg(t('multisigCreate.createdAndConfigured', { hash: setRes.hash || '' }));
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleActivateOnly() {
    if (!generated?.pub) {
      setError(t('multisigCreate.generateFirst'));
      return;
    }
    try {
      setBusy(true);
      setResultMsg('');
      setError('');
      const existed = await ensureAccountExists(generated.pub, server);
      if (existed) {
        setResultMsg(t('multisigCreate.alreadyActive'));
        return;
      }
      if (network === 'TESTNET') {
        await friendbotActivate(generated.pub);
        setResultMsg(t('multisigCreate.activatedTestnet'));
      } else {
        setPendingAction({ type: 'activate', destPub: generated.pub, startingBalance });
        setShowSecretModal(true);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const validSignerCount = (signers || []).filter((s) => s && s.trim().startsWith('G')).length;

  // derive reserve numbers
  const requiredReserve = useMemo(() => {
    const base = Number(baseReserve || 0.5);
    const subentries = validSignerCount; // new account: signers become subentries
    const min = base * (2 + subentries);
    return Number.isFinite(min) ? min : 1;
  }, [baseReserve, validSignerCount]);
  const recommended = useMemo(() => {
    // add small buffer (e.g., +0.5 XLM)
    return Math.max(requiredReserve + 0.5, 1);
  }, [requiredReserve]);

  return (
    <div className="max-w-3xl mx-auto p-4">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-semibold">{t('multisigCreate.title')}</h2>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{t('multisigCreate.hint')}</p>

      <NetworkSelector value={network} onChange={async (net) => { setNetwork(net); const r = await fetchBaseReserveXLM(); setBaseReserve(r); if (net==='PUBLIC') { setStartingBalance(recommended.toFixed(7)); } else { setStartingBalance('1'); } }} />

      <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
        <div className="flex gap-2 mb-2">
          <button onClick={handleGenerate} className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700" disabled={busy}>
            {t('multisigCreate.generateKeys')}
          </button>
        </div>
        {generated && (
          <div className="space-y-2">
            <div>
              <label className="block text-sm font-semibold">Public Key</label>
              <div className="font-mono break-all text-sm">{generated.pub}</div>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate.instructions.public')}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold">Secret Key</label>
              <div className="font-mono break-all text-sm">{generated.sec}</div>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate.instructions.secret')}</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
        <h3 className="font-semibold mb-2">{t('multisigCreate.signersTitle')}</h3>
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{t('multisigCreate.signersInfo')}</p>
        <div className="space-y-2">
          {signers.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={s}
                onChange={(e) => handleSignerChange(i, e.target.value)}
                placeholder="G..."
                className="w-full border rounded px-2 py-1 font-mono text-sm"
              />
              {signers.length > 1 && (
                <button onClick={() => handleRemoveSigner(i)} className="px-2 py-1 border rounded hover:bg-gray-100 dark:hover:bg-gray-800">{t('option.delete')}</button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2">
          <button onClick={handleAddSignerField} className="px-2 py-1 border rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            {t('multisigCreate.addSigner')}
          </button>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-semibold mb-1">{t('multisigCreate.threshold')}</label>
          <select
            className="border rounded px-2 py-1"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          >
            {Array.from({ length: Math.max(1, validSignerCount + 1) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={activateNow} onChange={() => setActivateNow(!activateNow)} />
          <span>
            <span className="font-semibold">{t('multisigCreate.activateNow')}</span>
            <br />
            <span className="text-xs text-gray-600 dark:text-gray-400">{t('multisigCreate.activateHint')}</span>
          </span>
        </label>
        {network === 'PUBLIC' && activateNow && (
          <>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold mb-1">{t('multisigCreate.startingBalance')}</label>
                <input
                  type="number"
                  step="0.0000001"
                  min="0"
                  value={startingBalance}
                  onChange={(e) => setStartingBalance(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                />
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-300">
                <div>{t('multisigCreate.reserve.base', { val: (baseReserve ?? 0.5).toFixed(7) })}</div>
                <div>{t('multisigCreate.reserve.required', { val: requiredReserve.toFixed(7) })}</div>
                <div>{t('multisigCreate.reserve.recommended', { val: recommended.toFixed(7) })}</div>
              </div>
            </div>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-2">
              {t('multisigCreate.mainnetActivateNote')}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={handleCreateAll} disabled={busy} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50">
          {t('multisigCreate.createButton')}
        </button>
        <button onClick={handleActivateOnly} disabled={busy} className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
          {t('multisigCreate.activateOnly')}
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
    </div>
  );
}
