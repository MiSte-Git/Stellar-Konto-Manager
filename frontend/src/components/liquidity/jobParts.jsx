import React from 'react';
import { useTranslation } from 'react-i18next';
import MultisigSigningOptions from '../multisig/MultisigSigningOptions.jsx';
import MultisigResultDialog from '../multisig/MultisigResultDialog.jsx';
import { openMultisigJob } from '../multisig/multisigNavigation.js';
import { computeJobSigningState } from '../../utils/multisig/jobSigningState.js';
import { getRequiredThreshold } from '../../utils/getRequiredThreshold.js';
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
 * mit kurzer Zusammenfassung; rows wie FactList ([label, value, opts?]). notes: Hinweise
 * unter der Zusammenfassung (z. B. warum eine Option gesperrt ist). Auch im Trading genutzt.
 */
export function LiquiditySigningOptions({ open, choice, onChoiceChange, onProceed, onCancel, rows, disabledOptions, notes = [] }) {
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
        {notes.filter(Boolean).map((note) => (
          <div key={note} className={`${NOTE_WARN} mt-2`} data-testid="signing-options-note">{note}</div>
        ))}
      </div>
    </MultisigSigningOptions>
  );
}

/**
 * Ergebnis eines Multisig-Jobs bzw. XDR-Exports im gemeinsamen
 * MultisigResultDialog. result.items: { label, value, hint?, wrap?, note? } als
 * LP-Zusammenfassung (children); note-Eintraege erscheinen als Text unter der Liste.
 * Beim Job kommen Signaturstand (Konto-Signer, benoetigtes Gewicht) und
 * "Zum Job" dazu. result.operationTypes (optional): Operationen der Transaktion fuer die
 * Schwelle, wenn das Backend kein requiredWeight liefert; sonst gilt operationType.
 */
export function LiquidityResultDialog({ type, result, account, operationType, onClose }) {
  if (!result) return null;
  const rows = result.items.filter((item) => !item.note);
  const notes = result.items.filter((item) => item.note);
  // Schwelle aus den tatsaechlichen Operationen (result.operationTypes, z. B. im Trading),
  // sonst aus operationType. Maximum ueber alle Operationen der Transaktion.
  const ops = Array.isArray(result.operationTypes) && result.operationTypes.length ? result.operationTypes : [operationType];
  const thresholdForOps = Math.max(...ops.map((op) => getRequiredThreshold(op, account?.thresholds || {})));
  const signing = type === 'job'
    ? computeJobSigningState({
      accountSigners: account?.signers || [],
      requiredWeight: result.requiredWeight || thresholdForOps,
      collectedSigners: result.collectedSigners || [],
    })
    : null;
  return (
    <MultisigResultDialog
      type={type}
      jobId={type === 'job' ? result.id : undefined}
      hash={result.hash}
      xdr={result.xdr}
      validUntil={result.validUntil}
      signing={signing}
      onClose={onClose}
      onOpenJob={type === 'job' && result.id ? () => {
        onClose();
        openMultisigJob(result.id, result.accessToken);
      } : undefined}
    >
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
    </MultisigResultDialog>
  );
}
