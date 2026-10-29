import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Dialog "Option waehlen" fuer Multisig-Konten: Multisig-Job erstellen
 * (Standard, empfohlen), alle Signaturen lokal eingeben oder XDR exportieren.
 * Aus SendPaymentPage herausgeloest; Markup und i18n-Keys sind unveraendert.
 * Der Erklaerdialog (Info-Button) gehoert zur Komponente.
 *
 * children: Zusammenfassung oberhalb der Optionen (z. B. Empfaenger, Betrag, Netz).
 * disabledOptions: Optionen, die nicht waehlbar sind.
 * proceedDisabled: "Weiter" gesperrt (z. B. waehrend einer Vorpruefung).
 */
export default function MultisigSigningOptions({
  open,
  choice,
  onChoiceChange,
  onProceed,
  onCancel,
  children,
  disabledOptions = [],
  proceedDisabled = false,
}) {
  const { t } = useTranslation(['multisig', 'common']);
  const [showInfo, setShowInfo] = useState(false);
  // Geschlossen: Erklaerdialog nicht beim naechsten Oeffnen wieder anzeigen.
  useEffect(() => {
    if (!open) setShowInfo(false);
  }, [open]);
  if (!open) return null;

  const options = [
    { key: 'job', label: t('multisig:confirm.options.job.title'), recommended: true },
    { key: 'local', label: t('multisig:confirm.options.local.title') },
    { key: 'xdr', label: t('multisig:confirm.options.xdr.title') },
  ];
  const cancel = () => {
    setShowInfo(false);
    onCancel();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
        <div className="bg-white dark:bg-gray-800 rounded-sm p-4 w-full max-w-md my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3 className="text-lg font-semibold">{t('multisig:confirm.options.selectTitle', 'Option wählen')}</h3>
            <button
              type="button"
              className="px-2 py-1 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={cancel}
              aria-label={t('common:option.cancel', 'Abbrechen')}
            >
              ×
            </button>
          </div>

          {children}

          <div className="space-y-2">
            {options.map((option) => {
              const disabled = disabledOptions.includes(option.key);
              return (
                <label
                  key={option.key}
                  className={`flex items-center gap-3 border rounded-sm p-3 transition ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-blue-400'} ${choice === option.key ? 'border-blue-500 ring-1 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-700'}`}
                >
                  <input
                    type="radio"
                    name="multisig-flow-choice"
                    value={option.key}
                    checked={choice === option.key}
                    disabled={disabled}
                    onChange={() => onChoiceChange(option.key)}
                    className="form-radio text-blue-600 h-4 w-4"
                  />
                  <div className="flex items-center justify-between gap-3 w-full">
                    <span className="font-semibold">{option.label}</span>
                    {option.recommended && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100">
                        {t('multisig:confirm.options.recommended')}
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex justify-end mt-2">
            <button
              type="button"
              className="text-sm text-blue-700 dark:text-blue-200 hover:underline"
              onClick={() => setShowInfo(true)}
            >
              {t('multisig:confirm.options.infoButton')}
            </button>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={cancel}
            >
              {t('common:option.cancel', 'Abbrechen')}
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-sm bg-blue-600 text-white disabled:opacity-50"
              disabled={proceedDisabled || disabledOptions.includes(choice)}
              onClick={() => {
                setShowInfo(false);
                onProceed();
              }}
            >
              {t('multisig:confirm.options.proceed')}
            </button>
          </div>
        </div>
      </div>

      {showInfo && <SigningOptionsInfo onClose={() => setShowInfo(false)} />}
    </>
  );
}

/** Erklaerdialog "Optionen erklaert" zu den drei Wegen. */
function SigningOptionsInfo({ onClose }) {
  const { t } = useTranslation(['multisig', 'common']);
  const sections = [
    {
      key: 'job',
      title: t('multisig:confirm.options.job.title'),
      desc: t('multisig:confirm.options.job.desc'),
      bullets: [
        t('multisig:confirm.options.job.infoBody.one'),
        t('multisig:confirm.options.job.infoBody.two'),
        t('multisig:confirm.options.job.infoBody.three'),
        t('multisig:confirm.options.job.infoBody.four'),
      ],
    },
    {
      key: 'local',
      title: t('multisig:confirm.options.local.title'),
      desc: t('multisig:confirm.options.local.desc'),
      bullets: [
        t('multisig:confirm.options.local.infoBody.one'),
        t('multisig:confirm.options.local.infoBody.two'),
        t('multisig:confirm.options.local.infoBody.three'),
      ],
    },
    {
      key: 'xdr',
      title: t('multisig:confirm.options.xdr.title'),
      desc: t('multisig:confirm.options.xdr.desc'),
      bullets: [
        t('multisig:confirm.options.xdr.infoBody.one'),
        t('multisig:confirm.options.xdr.infoBody.two'),
        t('multisig:confirm.options.xdr.infoBody.three'),
      ],
    },
  ];
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60 overflow-y-auto p-4">
      <div className="bg-white dark:bg-gray-800 rounded-sm p-4 w-full max-w-2xl my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-lg font-semibold">{t('multisig:confirm.options.infoDialog.title')}</h3>
          <button
            type="button"
            className="p-2 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            onClick={onClose}
            aria-label={t('common:close')}
          >
            ×
          </button>
        </div>

        <div className="space-y-3 text-sm">
          {sections.map((section) => (
            <div key={section.key} className="border rounded-sm p-3">
              <div className="font-semibold">{section.title}</div>
              <p className="text-gray-700 dark:text-gray-300 mt-1">{section.desc}</p>
              <ul className="list-disc ml-5 mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                {section.bullets.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded-sm border hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={onClose}
          >
            {t('common:close')}
          </button>
        </div>
      </div>
    </div>
  );
}
