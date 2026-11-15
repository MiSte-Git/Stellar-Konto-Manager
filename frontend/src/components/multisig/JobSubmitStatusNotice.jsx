import React from 'react';
import { useTranslation } from 'react-i18next';

// R-2: Ausgang, wenn das Backend beim Anlegen oder Merge eines Jobs schon gesendet hat. Gemeinsam fuer
// MultisigResultDialog und MultisigPrepareDialog; Texte wie im Job-Detail. Fuer jeden anderen Status
// (pending_signatures, leer) nichts. Ob gesendet: isBackendSentStatus in utils/multisig/submitReason.js.

export default function JobSubmitStatusNotice({ jobStatus, submitReason = '' }) {
  const { t } = useTranslation(['multisig']);
  const status = String(jobStatus || '').toLowerCase();
  if (status === 'submitted_success') {
    return (
      <div className="border border-green-400 bg-green-50 dark:border-green-700 dark:bg-green-900/30 text-sm text-green-800 dark:text-green-100 rounded-sm p-3 mb-3" data-testid="multisig-result-submitted">
        {t('multisig:job.statusHelp.submitted_success')}
      </div>
    );
  }
  if (status === 'submitted_failed') {
    return (
      <div role="alert" className="border border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-900/30 text-sm text-red-800 dark:text-red-200 rounded-sm p-3 mb-3" data-testid="multisig-result-submit-failed">
        {submitReason ? t('multisig:detail.submitFailed', { reason: submitReason }) : t('multisig:job.statusHelp.submitted_failed')}
      </div>
    );
  }
  if (status === 'submit_unclear') {
    return (
      <div role="alert" className="border border-orange-400 bg-orange-50 dark:border-orange-700 dark:bg-orange-900/30 text-sm text-orange-900 dark:text-orange-100 rounded-sm p-3 mb-3 space-y-1" data-testid="multisig-result-submit-unclear">
        <div className="font-semibold">{t('multisig:detail.submitUnclear.title')}</div>
        <p className="text-xs">{t('multisig:detail.submitUnclear.body')}</p>
        {submitReason && (
          <p className="text-xs opacity-80 break-all">{t('multisig:detail.submitUnclear.reason', { reason: submitReason })}</p>
        )}
      </div>
    );
  }
  return null;
}
