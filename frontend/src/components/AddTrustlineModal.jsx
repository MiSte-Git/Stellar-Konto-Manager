import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

function AddTrustlineModal({ onSubmit, onCancel }) {
  const { t } = useTranslation(['trustline', 'errors']);
  const [code, setCode] = useState('');
  const [issuer, setIssuer] = useState('');
  const [limit, setLimit] = useState('1000000');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const trimmedCode = String(code ?? '').trim();
    const trimmedIssuer = String(issuer ?? '').trim();
    const trimmedLimit = String(limit ?? '').trim();
    const limitNum = parseFloat(trimmedLimit);

    const codeOk = !!trimmedCode;
    const issuerOk = !!trimmedIssuer;
    const limitOk = Number.isFinite(limitNum) && limitNum > 0;

    if (import.meta.env.MODE !== 'production') {
      console.debug('[AddTrustline validate:minimal]', {
        code: trimmedCode,
        issuer: trimmedIssuer,
        limit: trimmedLimit,
        checks: { codeOk, issuerOk, limitOk },
        rawTypes: { code: typeof code, issuer: typeof issuer, limit: typeof limit }
      });
    }

    if (!codeOk || !issuerOk || !limitOk) {
      setError(t('errors:submitTransaction.failed.trustlines.invalidInput', 'Ungültige Eingabe'));
      return;
    }

    setError('');
    onSubmit({ code: trimmedCode, issuer: trimmedIssuer, limit: trimmedLimit });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 overflow-y-auto p-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-md my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4 text-black dark:text-white">{t('trustline:add.title')}</h3>
        {error && <div className="mb-2 text-xs text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1">{t('trustline:add.assetCodeLabel')}</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('trustline:add.assetCodePlaceholder')}
              className="w-full border rounded px-2 py-1"
            />
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t('trustline:add.assetCodeHelp')}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t('trustline:add.issuerLabel')}</label>
            <input
              type="text"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder={t('trustline:add.issuerPlaceholder')}
              className="w-full border rounded px-2 py-1"
            />
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t('trustline:add.issuerHelp')}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t('trustline:add.limitLabel')}</label>
            <input
              type="number"
              min="0"
              step="0.0000001"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder={t('trustline:add.limitPlaceholder')}
              className="w-full border rounded px-2 py-1"
            />
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t('trustline:add.limitHelp')}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500">
            {t('trustline:add.cancel')}
          </button>
          <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            {t('trustline:add.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddTrustlineModal;
