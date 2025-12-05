import React from 'react';
import { useTranslation } from 'react-i18next';

export default function MultisigWeightsThresholdsDiagram() {
  const { t } = useTranslation('learnMultisigDiagrams');
  const signers = [
    { label: t('learnMultisigDiagrams:weights.sA'), weight: '3', color: 'bg-green-500' },
    { label: t('learnMultisigDiagrams:weights.sB'), weight: '2', color: 'bg-yellow-500' },
    { label: t('learnMultisigDiagrams:weights.sC'), weight: '1', color: 'bg-red-500' },
  ];
  const thresholds = [
    { label: t('learnMultisigDiagrams:weights.low'), value: '1', note: t('learnMultisigDiagrams:weights.lowNote') },
    { label: t('learnMultisigDiagrams:weights.med'), value: '3', note: t('learnMultisigDiagrams:weights.medNote') },
    { label: t('learnMultisigDiagrams:weights.high'), value: '5', note: t('learnMultisigDiagrams:weights.highNote') },
  ];

  return (
    <div className="w-full border rounded-lg p-4 bg-white dark:bg-gray-900 shadow-sm space-y-3" aria-label={t('learnMultisigDiagrams:weights.ariaLabel')}>
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('learnMultisigDiagrams:weights.title')}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          {signers.map((s, idx) => (
            <div key={idx} className="flex items-center justify-between border rounded px-3 py-2 bg-gray-50 dark:bg-gray-800">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${s.color}`} />
                <span className="font-mono text-sm text-gray-900 dark:text-gray-100">{s.label}</span>
              </div>
              <span className="text-xs text-gray-700 dark:text-gray-300">{t('learnMultisigDiagrams:weights.weight')} {s.weight}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {thresholds.map((th, idx) => (
            <div key={idx} className="border rounded px-3 py-2 bg-indigo-50 dark:bg-indigo-900/40">
              <div className="flex items-center justify-between text-sm font-semibold text-indigo-900 dark:text-indigo-100">
                <span>{th.label}</span>
                <span>{th.value}</span>
              </div>
              <div className="text-xs text-indigo-800 dark:text-indigo-200 mt-1">{th.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
