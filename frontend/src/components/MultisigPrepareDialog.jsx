import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

function MultisigPrepareDialog({ open, onClose, hash, xdr, summary }) {
  const { t } = useTranslation(['multisig', 'common']);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(xdr || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('copy failed', e);
    }
  };

  const items = summary?.items || [];
  const title = summary?.title || t('multisig:prepare.title');
  const subtitle = summary?.subtitle || t('multisig:prepare.subtitle');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
      <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-2xl my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-gray-700 dark:text-gray-300">{subtitle}</p>
          </div>
          <button
            type="button"
            className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={onClose}
          >
            {t('common:option.cancel', 'Cancel')}
          </button>
        </div>

        {items.length > 0 && (
          <div className="border rounded p-3 mb-3 space-y-1">
            {items.map((item, idx) => (
              <div key={idx} className="text-sm flex flex-wrap gap-2">
                <span className="text-gray-600 dark:text-gray-400">{item.label}:</span>
                <span className="font-mono break-all">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className="border rounded p-3 mb-3">
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-1">{t('multisig:prepare.hashLabel')}</div>
          <div className="font-mono break-all text-xs bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded">{hash}</div>
        </div>

        <div className="border rounded p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-sm text-gray-700 dark:text-gray-300">{t('multisig:prepare.xdrLabel')}</div>
            <button
              type="button"
              className="px-3 py-1 rounded border border-blue-200 text-blue-700 dark:text-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900"
              onClick={handleCopy}
            >
              {copied ? t('multisig:prepare.copied', 'Kopiert') : t('multisig:prepare.copyXdrButton')}
            </button>
          </div>
          <textarea
            className="w-full h-32 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1"
            readOnly
            value={xdr || ''}
          />
        </div>

        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{t('multisig:prepare.notSentHint')}</p>
      </div>
    </div>
  );
}

export default MultisigPrepareDialog;
