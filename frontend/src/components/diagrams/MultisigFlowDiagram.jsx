import React from 'react';
import { useTranslation } from 'react-i18next';

export default function MultisigFlowDiagram() {
  const { t } = useTranslation('learnMultisigDiagrams');
  const steps = [
    t('learnMultisigDiagrams:flow.step1'),
    t('learnMultisigDiagrams:flow.step2'),
    t('learnMultisigDiagrams:flow.step3'),
    t('learnMultisigDiagrams:flow.step4')
  ];

  return (
    <div className="w-full border rounded-lg p-4 bg-white dark:bg-gray-900 shadow-sm" aria-label={t('learnMultisigDiagrams:flow.ariaLabel')}>
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('learnMultisigDiagrams:flow.title')}</div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {steps.map((s, idx) => (
          <div key={idx} className="relative flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold">{idx + 1}</div>
            <div className="text-xs text-gray-800 dark:text-gray-200 leading-snug">{s}</div>
            {idx < steps.length - 1 && (
              <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-0.5 bg-indigo-400" aria-hidden="true"></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
