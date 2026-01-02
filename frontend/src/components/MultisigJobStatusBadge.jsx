import React from 'react';
import { useTranslation } from 'react-i18next';

// Renders a badge for the multisig job status with translated label and color coding.
export default function MultisigJobStatusBadge({ status }) {
  const { t } = useTranslation('multisig');
  const normalized = String(status || '').toLowerCase();
  const label = t(`multisig:list.status.${normalized}`, t(`multisig:job.status.${normalized}`, t('multisig:job.status.unknown')));
  let cls = 'bg-gray-300 text-gray-900 dark:bg-gray-600 dark:text-gray-100';
  if (normalized === 'pending_signatures' || normalized === 'pending') cls = 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100';
  if (normalized === 'ready_to_submit' || normalized === 'partiallysigned' || normalized === 'partially_signed') cls = 'bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100';
  if (normalized === 'submitted_success' || normalized === 'submitted' || normalized === 'ready') cls = 'bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100';
  if (normalized === 'submitted_failed' || normalized === 'failed' || normalized === 'expired' || normalized === 'obsolete_seq') cls = 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100';

  const entry = { label, cls };
  return <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${entry.cls}`}>{entry.label}</span>;
}
