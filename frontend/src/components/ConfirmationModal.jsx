// src/components/ConfirmationModal.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';

function ConfirmationModal({
  confirmAction,
  setShowConfirm,
  setError,
  setSourceSecret,
  setShowSecretKey,
  setIsLoading,
  setResults,
  isLoading
}) {
  const { t } = useTranslation(['common', 'secretKey']);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h2 className="text-xl font-bold mb-4">{t('common:option.confirm.action.title', 'Confirm action')}</h2>
        <p className="mb-4">{t('common:option.confirm.action.text', 'Are you sure?')}</p>
        <div className="flex justify-end space-x-4">
          <button
            onClick={async () => {
              setIsLoading(true);
              try {
                await confirmAction();
                setShowConfirm(false);
              } catch (err) {
                setError(err.message);
              } finally {
                setIsLoading(false);
              }
            }}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
            disabled={isLoading}
          >
            {t('common:option.yes', 'Yes')}
          </button>
          <button
            onClick={() => {
              setShowConfirm(false);
              setResults([t('secretKey:cleared')]);
              setSourceSecret('');
              setShowSecretKey(false);
            }}
            className="bg-gray-300 px-4 py-2 rounded hover:bg-gray-400"
          >
            {t('common:option.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmationModal;
