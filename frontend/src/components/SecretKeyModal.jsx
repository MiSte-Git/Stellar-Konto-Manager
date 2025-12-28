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
  requiredThreshold = 0,
  isProcessing = false,
  deleteProgress = null,
  account = null,
  initialCollectAllSignaturesLocally = false,
  onBackToSelection = null,
}) {
  const { t } = useTranslation(['secretKey', 'trustline', 'common', 'publicKey']);
  const [secretInputs, setSecretInputs] = useState(['']);
  const [showSecret, setShowSecret] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [error, setError] = useState(errorMessage || '');
  const [collectAllSignaturesLocally, setCollectAllSignaturesLocally] = useState(initialCollectAllSignaturesLocally); // Ermöglicht optional, alle Multisig-Signaturen lokal zu sammeln.
  const [showInfo, setShowInfo] = useState(false);
  const accountData = useMemo(() => {
    if (account?.signers || account?.thresholds) return account;
    if (Array.isArray(signers) || thresholds) return { signers, thresholds };
    return null;
  }, [account, signers, thresholds]);
  const allSigners = useMemo(() => {
    const src = Array.isArray(accountData?.signers) ? accountData.signers : signers;
    return Array.isArray(src) ? [...src] : [];
  }, [accountData, signers]);
  // Sorts signers with master first, then active (weight>0), then deactivated (weight<=0).
  const sortedSigners = useMemo(() => {
    const masterKey = accountData?.account_id || accountData?.id || accountData?.accountId || '';
    const normalized = allSigners
      .map((s) => ({
        publicKey: s.public_key || s.key || s.publicKey,
        weight: Number(s.weight || 0),
        isMaster: masterKey && (s.public_key === masterKey || s.key === masterKey || s.publicKey === masterKey),
      }))
      .filter((s) => !!s.publicKey);
    const masterList = normalized.filter((s) => s.isMaster);
    const active = normalized.filter((s) => !s.isMaster && (s.weight || 0) > 0).sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const disabled = normalized.filter((s) => (s.weight || 0) <= 0 && !s.isMaster);
    return [...masterList, ...active, ...disabled];
  }, [accountData, allSigners]);
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

  const isMultisigAccount = useMemo(() => {
    const signerCount = Array.isArray(accountData?.signers) ? accountData.signers.length : 0;
    const medThreshold = Number(accountData?.thresholds?.med_threshold ?? 0);
    return signerCount > 1 || medThreshold > 0;
  }, [accountData]);

  const showBackToSelection = useMemo(() => {
    return isMultisigAccount === true && typeof onBackToSelection === 'function';
  }, [isMultisigAccount, onBackToSelection]);

  const masterWeight = useMemo(() => {
    const master = sortedSigners.find((s) => s.isMaster);
    return Number(master?.weight || 0);
  }, [sortedSigners]);

  const thresholdLevel = useMemo(() => {
    if (operationType === 'payment') return 'med';
    if (operationType === 'setOptions') return 'high';
    if (operationType === 'changeTrust') return 'med';
    return 'med';
  }, [operationType]);

  useEffect(() => {
    setSecretInputs((prev) => {
      if (prev.length >= minSignerCount) return prev;
      return [...prev, ...Array.from({ length: minSignerCount - prev.length }, () => '')];
    });
  }, [minSignerCount]);

  React.useEffect(() => {
    setError(errorMessage || '');
  }, [errorMessage]);

  React.useEffect(() => {
    setCollectAllSignaturesLocally(initialCollectAllSignaturesLocally);
  }, [initialCollectAllSignaturesLocally]);

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
      onConfirm(collected, rememberSession, { collectAllSignaturesLocally }); // Callback an Eltern-Komponente
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
        {isProcessing && (
          <div className="mb-3 text-sm text-blue-700 dark:text-blue-300">
            {t('common:main.processing')}
          </div>
        )}
        {error && (
          <div className="text-center text-xs text-red-700 mb-2">{error}</div>
        )}

        {isMultisigAccount && (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              className="text-sm text-blue-700 dark:text-blue-300 hover:underline"
              onClick={() => setShowInfo((v) => !v)}
            >
              {showInfo ? t('secretKey:hideMultisigInfo') : t('secretKey:showMultisigInfo')}
            </button>
          </div>
        )}
        {isMultisigAccount && showInfo && (
          <>
            <div className="mb-3 rounded border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100 space-y-2">
              <div className="font-semibold">{t('secretKey:localFlow.title')}</div>
              <p className="text-xs mt-0.5">{t('secretKey:localFlow.body')}</p>
              <ul className="list-disc ml-4 space-y-1 text-xs mt-1">
                <li>{t('secretKey:localFlow.stepAllKeys')}</li>
                <li>{t('secretKey:localFlow.stepSend')}</li>
              </ul>
              <p className="text-[11px] mt-1 text-amber-700 dark:text-amber-300">{t('secretKey:multisigOptions.localAll.warning')}</p>
              <p className="text-[11px] text-gray-700 dark:text-gray-300">{t('secretKey:multisigInfo.masterExplanation')}</p>
            </div>
            <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
              <div className="flex flex-col gap-1 mb-2 text-gray-800 dark:text-gray-200">
                <div>{t('secretKey:multisigInfo.summary.multi')}</div>
                <div>{t('secretKey:multisigInfo.requiredThreshold', { level: thresholdLevel, value: requiredThreshold || 0 })}</div>
                <div>{t(`secretKey:operations.${operationType || 'unknown'}`, operationType || '')}</div>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <span className="flex items-center gap-1">
                  <span className="font-semibold">{t('secretKey:multisigInfo.thresholdLabel')}:</span>
                  <span>{requiredThreshold || 'n/a'}</span>
                </span>
                <span className="flex items-center gap-1" title={t('secretKey:multisigInfo.masterHint')}>
                  <span className="font-semibold">{t('secretKey:multisigInfo.masterWeightLabel')}:</span>
                  <span>{Number.isFinite(masterWeight) ? masterWeight : 'n/a'}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold">{t('secretKey:multisigInfo.currentWeightLabel')}:</span>
                  <span>{effectiveSigners.length ? currentWeight : 'n/a'}</span>
                </span>
                {operationType && (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900 dark:text-blue-100 text-[11px] uppercase tracking-wide">
                    {t(`secretKey:operations.${operationType || 'unknown'}`, operationType || '')}
                  </span>
                )}
              </div>
              {sortedSigners.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-600 dark:text-gray-300 mb-1">{t('secretKey:multisigInfo.signers')}:</div>
                  <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                    {sortedSigners.map((s, idx) => (
                      <div key={idx} className="flex justify-between text-[11px]">
                        <span className="font-mono break-all">
                          {s.publicKey}
                          {s.isMaster ? ` (${t('secretKey:multisigInfo.master')})` : ''}
                          {!s.isMaster && s.weight <= 0 ? ` (${t('secretKey:multisigInfo.signerDisabled')})` : ''}
                        </span>
                        <span className="ml-2">{s.weight ?? 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

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
        {isMultisigAccount && (
          <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {t('secretKey:multipleSignersThresholdInfo', { threshold: requiredThreshold || 0, requiredSigners: minSignerCount })}
          </div>
        )}
        {isMultisigAccount && (
          <div className="mt-3 border rounded p-3 bg-gray-50 dark:bg-gray-900">
            <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
              <input
                type="checkbox"
                checked={collectAllSignaturesLocally}
                onChange={(e) => setCollectAllSignaturesLocally(e.target.checked)}
                className="mt-1"
              />
              <span className="space-y-1">
                <span className="font-semibold">{t('secretKey:multisigOptions.localAll.title')}</span>
                <span className="text-xs text-gray-700 dark:text-gray-300">
                  {t('secretKey:multisigOptions.localAll.checkboxLabel')}
                </span>
              </span>
            </label>
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              {t('secretKey:multisigOptions.localAll.warning')}
            </p>
          </div>
        )}

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
          {showBackToSelection && (
            <button
              onClick={onBackToSelection}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            >
              {t('common:option.back', 'Zurück')}
            </button>
          )}
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
