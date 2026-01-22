import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../../utils/basePath.js';

function MultiSigHelpDialog({ isOpen, onClose }) {
  const { t } = useTranslation('glossary');

  if (!isOpen) return null;

  const toList = (text) => {
    const [intro, ...rest] = String(text || '').split('\n').filter(Boolean);
    return { intro, items: rest.map((line) => line.replace(/^-\s*/, '')) };
  };

  const weights = toList(t('multisig.help.setupWeights'));
  const thresholds = toList(t('multisig.help.setupThresholds'));

  const handleOverlayClick = () => {
    if (typeof onClose === 'function') onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className="relative w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {t('multisig.help.title')}
          </h2>
          <button
            type="button"
            onClick={handleOverlayClick}
            aria-label={t('multisig.help.closeLabel')}
            className="rounded p-1 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 text-sm text-gray-800 dark:text-gray-200">
          <p className="rounded-md bg-blue-50 p-3 text-blue-900 dark:bg-blue-950 dark:text-blue-100">
            {t('multisig.help.intro')}
          </p>

          <p className="rounded-md bg-orange-50 p-3 text-orange-900 dark:bg-orange-950 dark:text-orange-100">
            {t('multisig.help.problem')}
          </p>

          <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/80">
            <p className="mb-2 font-semibold">{t('multisig.help.setupTitle')}</p>
            <p className="text-gray-700 dark:text-gray-300">{weights.intro}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {weights.items.map((line, idx) => (
                <li key={idx} className="text-gray-800 dark:text-gray-200">{line}</li>
              ))}
            </ul>

            <p className="mt-3 text-gray-700 dark:text-gray-300">{thresholds.intro}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {thresholds.items.map((line, idx) => (
                <li key={idx} className="text-gray-800 dark:text-gray-200">{line}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <p>{t('multisig.help.behavior')}</p>
            <p>{t('multisig.help.removal')}</p>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{t('multisig.help.summary')}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`${buildPath('glossar')}#g-multisigCorporate`}
              className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300"
            >
              {t('multisig.help.glossaryLinkLabel')}
            </a>
            <button
              type="button"
              onClick={handleOverlayClick}
              className="rounded bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
            >
              {t('multisig.help.closeLabel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MultiSigHelpDialog;
