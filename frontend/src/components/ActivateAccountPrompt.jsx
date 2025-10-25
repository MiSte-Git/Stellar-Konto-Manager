import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * ActivateAccountPrompt reagiert auf CustomEvent 'stm:accountNotFound'
 * und zeigt ein Modal zum Aktivieren des Zielkontos.
 */
export default function ActivateAccountPrompt() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmFn, setConfirmFn] = useState(null);

  const handleEvent = (event) => {
    try {
      const { destination: dest, onConfirm } = event.detail || {};
      if (!dest || typeof onConfirm !== 'function') return;
      setDestination(String(dest));
      setConfirmFn(() => onConfirm);
      setOpen(true);
    } catch (error) {
      throw new Error('submitTransaction.failed:activation.event:' + (error?.message || 'unknown'));
    }
  };

  const handleClose = () => {
    setOpen(false);
    setBusy(false);
    setDestination('');
    setConfirmFn(null);
  };

  const handleConfirm = async () => {
    if (!confirmFn) return;
    try {
      setBusy(true);
      await confirmFn();
      handleClose();
    } catch (error) {
      setBusy(false);
      throw new Error('submitTransaction.failed:activation.create:' + (error?.message || 'unknown'));
    }
  };

  useEffect(() => {
    window.addEventListener('stm:accountNotFound', handleEvent);
    return () => window.removeEventListener('stm:accountNotFound', handleEvent);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative w-[min(92vw,520px)] max-h-[90vh] overflow-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-5">
        <h2 className="text-lg font-semibold mb-3">{t('activation.notFound.title')}</h2>
        <p className="text-sm mb-4">
          {t('activation.notFound.message', { address: destination })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={handleClose}
            disabled={busy}
            title={t('activation.actions.no')}
          >
            {t('activation.actions.no')}
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            onClick={handleConfirm}
            disabled={busy}
            title={t('activation.actions.yes')}
          >
            {busy ? t('activation.actions.processing') : t('activation.actions.yes')}
          </button>
        </div>
      </div>
    </div>
  );
}
