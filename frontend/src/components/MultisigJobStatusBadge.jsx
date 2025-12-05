import React from 'react';
import { useTranslation } from 'react-i18next';

// Renders a badge for the multisig job status with translated label and color coding.
export default function MultisigJobStatusBadge({ status }) {
  const { t } = useTranslation('multisig');
  const map = {
    pending: { label: t('multisig:job.status.pending'), cls: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100' },
    partially_signed: { label: t('multisig:job.status.partiallySigned'), cls: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100' },
    ready_to_submit: { label: t('multisig:job.status.readyToSubmit'), cls: 'bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100' },
    submitted: { label: t('multisig:job.status.submitted'), cls: 'bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100' },
    failed: { label: t('multisig:job.status.failed'), cls: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100' },
  };
  const entry = map[status] || { label: t('multisig:job.status.unknown'), cls: 'bg-gray-300 text-gray-900 dark:bg-gray-600 dark:text-gray-100' };
  return <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${entry.cls}`}>{entry.label}</span>;
}
