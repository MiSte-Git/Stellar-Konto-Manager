import React from 'react';
import { useTranslation } from 'react-i18next';
import MultisigPrepareDialog from '../MultisigPrepareDialog.jsx';
import { NOTE_ERROR, NOTE_NEUTRAL, NOTE_WARN } from './LiquidityDialogShell.jsx';

/** Hinweise zum Multisig-Job-Weg vor dem Erstellen sowie Fehler und Status danach. */
export function JobNotes({ hints = [], jobError, jobCreated }) {
  const { t } = useTranslation(['liquidity']);
  return (
    <>
      {hints.filter(Boolean).map((hint) => (
        <div key={hint} className={NOTE_WARN} data-testid="liquidity-job-hint">{hint}</div>
      ))}
      {jobError && <div className={NOTE_ERROR} role="alert" data-testid="liquidity-job-error">{jobError}</div>}
      {jobCreated && <div className={NOTE_NEUTRAL} role="status">{t('liquidity:job.created')}</div>}
    </>
  );
}

/** MultisigPrepareDialog mit der Zusammenfassung des erstellten Jobs (inkl. Job-ID). */
export function PreparedJobDialog({ job, onClose }) {
  const { t } = useTranslation(['liquidity', 'multisig']);
  if (!job) return null;
  return (
    <MultisigPrepareDialog
      open
      onClose={onClose}
      hash={job.hash}
      xdr={job.xdr}
      summary={{
        title: t('multisig:prepare.title'),
        subtitle: t('multisig:prepare.subtitle'),
        items: [...job.items, { label: t('liquidity:job.jobId'), value: job.id }],
      }}
    />
  );
}
