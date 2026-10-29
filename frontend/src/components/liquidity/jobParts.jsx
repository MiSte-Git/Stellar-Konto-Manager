import React from 'react';
import { useTranslation } from 'react-i18next';
import MultisigPrepareDialog from '../MultisigPrepareDialog.jsx';
import MultisigSigningOptions from '../multisig/MultisigSigningOptions.jsx';
import { FactList, FactRow, NOTE_ERROR, NOTE_NEUTRAL, NOTE_WARN } from './LiquidityDialogShell.jsx';

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

/**
 * Optionsdialog fuer Multisig-Konten (Job, alle Signaturen lokal, XDR exportieren)
 * mit kurzer Zusammenfassung; rows wie FactList ([label, value, opts?]).
 */
export function LiquiditySigningOptions({ open, choice, onChoiceChange, onProceed, onCancel, rows, disabledOptions }) {
  return (
    <MultisigSigningOptions
      open={open}
      choice={choice}
      onChoiceChange={onChoiceChange}
      onProceed={onProceed}
      onCancel={onCancel}
      disabledOptions={disabledOptions}
    >
      <div className="mb-4" data-testid="liquidity-signing-summary">
        <FactList rows={rows} />
      </div>
    </MultisigSigningOptions>
  );
}

/**
 * MultisigPrepareDialog mit der Zusammenfassung des erstellten Jobs (inkl. Job-ID)
 * bzw. des exportierten XDR (ohne Job-ID, kein Job angelegt).
 * job.items: { label, value, hint?, wrap?, note? }. Zeilen wie in den Dialogen
 * (Label links, Wert rechts); note-Eintraege erscheinen als Text unter der Liste.
 */
export function PreparedJobDialog({ job, onClose }) {
  const { t } = useTranslation(['liquidity', 'multisig']);
  if (!job) return null;
  const rows = job.id
    ? [...job.items.filter((item) => !item.note), { label: t('liquidity:job.jobId'), value: job.id, wrap: true }]
    : job.items.filter((item) => !item.note);
  const notes = job.items.filter((item) => item.note);
  return (
    <MultisigPrepareDialog
      open
      onClose={onClose}
      hash={job.hash}
      xdr={job.xdr}
      summary={{
        title: t('multisig:prepare.title'),
        subtitle: t('multisig:prepare.subtitle'),
        body: (
          <div className="space-y-2" data-testid="liquidity-job-summary">
            <dl className="text-xs">
              {rows.map((item, index) => (
                <FactRow key={`${index}-${item.label}`} label={item.label} hint={item.hint} value={item.value} wrap={item.wrap} />
              ))}
            </dl>
            {notes.map((item) => (
              <p key={item.label} className="text-xs">
                <span className="font-semibold">{item.label}:</span> {item.value}
              </p>
            ))}
          </div>
        ),
      }}
    />
  );
}
