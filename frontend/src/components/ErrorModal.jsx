import React from 'react';
import { useTranslation } from 'react-i18next';

function ErrorModal({ message, onClose }) {
  const { t } = useTranslation();

  if (!message) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-4">
          ❌ {t('error.transaction.title')}
        </h2>
        <p className="text-sm text-gray-800 dark:text-gray-200 mb-6 whitespace-pre-line">
          {message}
        </p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500"
          >
            {t('option.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorModal;
