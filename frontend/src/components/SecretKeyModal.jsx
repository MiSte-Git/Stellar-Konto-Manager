// src/components/SecretKeyModal.jsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateSecretKey } from '../services/stellarUtils';

function SecretKeyModal({ onConfirm, onCancel, errorMessage }) {
  const { t } = useTranslation();
  const [secretKey, setSecretKey] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState(errorMessage || '');

  const handleConfirm = () => {
    if (!secretKey.trim()) {
      setError(t('secretKey.empty'));
      return;
    }

    try {
      validateSecretKey(secretKey);
      setError('');
      onConfirm(secretKey); // Callback an Eltern-Komponente
    } catch (err) {
      setError(t(err.message));
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4 text-black dark:text-white">
          {t('secretKey.label')}
        </h2>
        <input
          type={showSecret ? "text" : "password"}
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          placeholder={t('secretKey.placeholder')}
          className="w-full px-4 py-2 border rounded mb-2 dark:bg-gray-700 dark:text-white"
        />
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input
            type="checkbox"
            checked={showSecret}
            onChange={() => setShowSecret(!showSecret)}
          />
          {t('trustline.showSecret')}
        </label>

        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
        {!error && secretKey && (
          <p className="text-green-600 text-sm mb-2">{t('secretKey.valid')}</p>
        )}
        <p className="text-xs text-gray-500 mt-2">{t('secretKey.info')}</p>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500"
          >
            {t('option.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t('publicKey.submit.button')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SecretKeyModal;
