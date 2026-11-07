// Gemeinsamer Bestaetigungsdialog (Ersatz fuer window.confirm). Anders als window.confirm
// kann ihn der Browser nicht unterdruecken (dann lieferte confirm dauerhaft false).
// Aufbau: X oben rechts, Aktionen unten rechts, Escape und X brechen ab.
//
//   const { confirm, dialog } = useConfirmDialog();   // aus ./useConfirmDialog.jsx
//   if (!(await confirm({ message: '...' }))) return;   // dialog irgendwo im JSX rendern
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger = false, onConfirm, onCancel }) {
  const { t } = useTranslation(['common']);
  const confirmRef = useRef(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" data-testid="confirm-dialog">
      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800">
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('common:close')}
          className="absolute right-3 top-3 rounded-sm px-2 text-xl leading-none text-gray-500 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
          data-testid="confirm-dialog-x"
        >
          ×
        </button>
        <h2 id="confirm-dialog-title" className="mb-3 pr-8 text-lg font-semibold">{title || t('common:option.confirm.action.title')}</h2>
        <p className="mb-5 whitespace-pre-line text-sm">{message}</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-sm bg-gray-300 px-4 py-2 text-sm hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500" data-testid="confirm-dialog-cancel">
            {cancelLabel || t('common:option.cancel')}
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            className={`rounded-sm px-4 py-2 text-sm text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
            data-testid="confirm-dialog-ok"
          >
            {confirmLabel || t('common:option.yes')}
          </button>
        </div>
      </div>
    </div>
  );
}
