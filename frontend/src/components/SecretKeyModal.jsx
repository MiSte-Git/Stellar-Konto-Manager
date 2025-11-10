// src/components/SecretKeyModal.jsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateSecretKey } from '../utils/stellar/stellarUtils';
import { formatErrorForUi } from '../utils/formatErrorForUi.js';

function SecretKeyModal({ onConfirm, onCancel, errorMessage }) {
  const { t } = useTranslation();
  const [secretKey, setSecretKey] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [error, setError] = useState(errorMessage || '');

  React.useEffect(() => {
    setError(errorMessage || '');
  }, [errorMessage]);

  const handleConfirm = () => {
    if (!secretKey.trim()) {
      setError(t('secretKey.empty', 'Please enter your secret key'));
      return;
    }

    try {
      validateSecretKey(secretKey);
      setError('');
      onConfirm(secretKey, rememberSession); // Callback an Eltern-Komponente
    } catch (err) {
      setError(formatErrorForUi(t, err));
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 overflow-y-auto p-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-md my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
        <h2 className={`text-xl font-semibold mb-4 ${error ? 'text-red-700' : 'text-black dark:text-white'}`}>
          {t('secretKey.label', 'Secret key')}
        </h2>
        {error && (
          <div className="text-center text-xs text-red-700 mb-1">{error}</div>
        )}
        <input
          type={showSecret ? 'text' : 'password'}
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          placeholder={t('secretKey.placeholder', 'Enter your secret key')}
          className={`w-full px-4 py-2 border rounded mb-2 dark:bg-gray-700 dark:text-white ${error ? 'border-red-500 ring-1 ring-red-400' : ''}`}
        />
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input
            type="checkbox"
            checked={showSecret}
            onChange={() => setShowSecret(!showSecret)}
          />
          {t('trustline.showSecret', 'Show secret')}
        </label>
               <label className="flex items-center gap-2 mt-2 text-sm">
          <input
          type="checkbox"
            checked={rememberSession}
            onChange={() => setRememberSession(!rememberSession)}
          />
          {t('secretKey.remember.label', 'Remember for this session')}
        </label>
        <p className="text-xs text-gray-500 mt-1">{t('secretKey.remember.hint', 'Stored in memory until you close this tab. Never sent to a server.')}</p>

        {!error && secretKey && (
          <p className="text-green-600 text-sm mb-2">{t('secretKey.valid', 'Secret key looks valid')}</p>
        )}
        <p className="text-xs text-gray-500 mt-2">{t('secretKey.info', 'Enter your secret key only if you want to sign transactions. Without it, you can only view data.')}</p>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500"
          >
            {t('option.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t('publicKey.submit.button', 'Submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SecretKeyModal;
