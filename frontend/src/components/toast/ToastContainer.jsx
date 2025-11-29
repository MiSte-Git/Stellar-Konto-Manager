import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export default function ToastContainer({ toasts, onClose }) {
  const { t } = useTranslation(['quiz']);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto max-w-md w-[90%] sm:w-auto px-3 py-2 rounded shadow text-sm font-medium border ${
            toast.type === 'success'
              ? 'bg-green-600 text-white border-green-700'
              : toast.type === 'error'
              ? 'bg-red-600 text-white border-red-700'
              : 'bg-gray-800 text-white border-gray-700'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span className="flex-1">{toast.content}</span>
            <button
              type="button"
              className="opacity-90 hover:opacity-100"
              onClick={() => onClose(toast.id)}
              aria-label={t('quiz:result.toast.close', 'Schließen')}
              title={t('quiz:result.toast.close', 'Schließen')}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}
