// src/components/SecretKeyModal.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Keypair } from '@stellar/stellar-sdk';
import { validateSecretKey } from '../utils/stellar/stellarUtils';
import { formatErrorForUi } from '../utils/formatErrorForUi.js';

function SecretKeyModal({
  onConfirm,
  onCancel,
  errorMessage,
  thresholds = null,
  signers = [],
  operationType = '',
  requiredThreshold = 0
}) {
  const { t } = useTranslation(['secretKey', 'trustline', 'common', 'publicKey']);
  const [secretInputs, setSecretInputs] = useState(['']);
  const [showSecret, setShowSecret] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [error, setError] = useState(errorMessage || '');
  const allSigners = useMemo(() => (Array.isArray(signers) ? [...signers] : []), [signers]);
  const effectiveSigners = useMemo(
    () => allSigners
      .filter(s => !!(s?.public_key || s?.key))
      .map((s) => ({ public_key: s.public_key || s.key, weight: Number(s.weight || 0) }))
      .filter((s) => (s.weight || 0) > 0)
      .sort((a, b) => (b.weight || 0) - (a.weight || 0)),
    [allSigners]
  );
  const minSignerCount = useMemo(() => {
    if (!requiredThreshold || !effectiveSigners.length) return 1;
    let sum = 0;
    let count = 0;
    for (const s of effectiveSigners) {
      sum += Number(s.weight || 0);
      count += 1;
      if (sum >= requiredThreshold) break;
    }
    return Math.max(1, count || 1);
  }, [requiredThreshold, effectiveSigners]);

  useEffect(() => {
    setSecretInputs((prev) => {
      if (prev.length >= minSignerCount) return prev;
      return [...prev, ...Array.from({ length: minSignerCount - prev.length }, () => '')];
    });
  }, [minSignerCount]);

  React.useEffect(() => {
    setError(errorMessage || '');
  }, [errorMessage]);

  const handleConfirm = () => {
    try {
      const collected = [];
      for (const raw of secretInputs) {
        const sec = (raw || '').trim();
        if (!sec) continue;
        try {
          validateSecretKey(sec);
        } catch (err) {
          throw new Error('submitTransaction.failed:' + 'multisig.invalidSecret');
        }
        let kp;
        try {
          kp = Keypair.fromSecret(sec);
        } catch {
          throw new Error('submitTransaction.failed:' + 'multisig.invalidSecret');
        }
        const pub = kp.publicKey();
        if (effectiveSigners.length > 0) {
          const signerMatch = effectiveSigners.find((s) => s.public_key === pub);
          if (!signerMatch) {
            throw new Error('submitTransaction.failed:' + 'multisig.notASigner');
          }
          if ((signerMatch.weight || 0) <= 0) {
            throw new Error('submitTransaction.failed:' + 'multisig.zeroWeightSigner');
          }
          collected.push({ publicKey: pub, weight: signerMatch.weight || 0, keypair: kp });
        } else {
          // Single-Sig/Legacy-Fall: keine effektiven Signer bekannt, nur Syntax prüfen
          collected.push({ publicKey: pub, weight: 0, keypair: kp });
        }
      }
      if (!collected.length) {
        throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
      }
      setError('');
      onConfirm(collected, rememberSession); // Callback an Eltern-Komponente
    } catch (err) {
      setError(formatErrorForUi(t, err));
    }
  };

  const currentWeight = useMemo(() => {
    if (!effectiveSigners.length) return 0;
    let sum = 0;
    for (const raw of secretInputs) {
      const sec = (raw || '').trim();
      if (!sec) continue;
      try {
        const kp = Keypair.fromSecret(sec);
        const pub = kp.publicKey();
        const signerMatch = effectiveSigners.find((s) => s.public_key === pub);
        if (signerMatch) sum += Number(signerMatch.weight || 0);
      } catch { /* ignore invalid while typing */ }
    }
    return sum;
  }, [secretInputs, effectiveSigners]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 overflow-y-auto p-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-lg my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
        <h2 className={`text-xl font-semibold mb-4 ${error ? 'text-red-700' : 'text-black dark:text-white'}`}>
          {t('secretKey:label', 'Secret key')}
        </h2>
        {error && (
          <div className="text-center text-xs text-red-700 mb-2">{error}</div>
        )}

        <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap gap-2">
            <span className="font-semibold">{t('common:threshold', 'Threshold')}:</span>
            <span>{requiredThreshold || 'n/a'}</span>
            <span className="font-semibold">{t('common:weight', 'Weight')}:</span>
            <span>{effectiveSigners.length ? currentWeight : 'n/a'}</span>
            {operationType && (
              <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900 dark:text-blue-100 text-[11px] uppercase tracking-wide">
                {operationType}
              </span>
            )}
          </div>
          {allSigners.length > 0 && (
            <div className="mt-2">
              <div className="text-gray-600 dark:text-gray-300 mb-1">{t('common:signers', 'Signers')}:</div>
              <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                {allSigners.map((s, idx) => (
                  <div key={idx} className="flex justify-between text-[11px]">
                    <span className="font-mono break-all">{s.public_key}</span>
                    <span className="ml-2">{s.weight ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {secretInputs.map((val, idx) => (
            <input
              key={idx}
              type={showSecret ? 'text' : 'password'}
              value={val}
              onChange={(e) => {
                const next = [...secretInputs];
                next[idx] = e.target.value;
                setSecretInputs(next);
              }}
              placeholder={t('secretKey:placeholder', 'Enter your secret key')}
              className={`w-full px-4 py-2 border rounded dark:bg-gray-700 dark:text-white ${error ? 'border-red-500 ring-1 ring-red-400' : ''}`}
            />
          ))}
        </div>
        <div className="mt-2">
          <button
            type="button"
            className="text-sm text-blue-700 dark:text-blue-300 hover:underline"
            onClick={() => setSecretInputs((prev) => [...prev, ''])}
          >
            {t('secretKey:addSigner', 'Weiteren Signer hinzufügen')}
          </button>
        </div>

        <label className="flex items-center gap-2 mt-3 text-sm">
          <input
            type="checkbox"
            checked={showSecret}
            onChange={() => setShowSecret(!showSecret)}
          />
          {t('trustline:showSecret', 'Show secret')}
        </label>
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input
            type="checkbox"
            checked={rememberSession}
            onChange={() => setRememberSession(!rememberSession)}
          />
          {t('secretKey:remember.label', 'Remember for this session')}
        </label>
        <p className="text-xs text-gray-500 mt-1">{t('secretKey:remember.hint', 'Stored in memory until you close this tab. Never sent to a server.')}</p>

        <p className="text-xs text-gray-500 mt-2">{t('secretKey:info', 'Enter your secret key only if you want to sign transactions. Without it, you can only view data.')}</p>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500"
          >
            {t('common:option.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t('publicKey:submit.button', 'Submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SecretKeyModal;
