import React from 'react';
import { useTranslation } from 'react-i18next';

export default function MultisigSingleVsMultiDiagram() {
  const { t } = useTranslation('learnMultisigDiagrams');

  const card = (title, items, note) => (
    <div className="flex-1 min-w-[220px] border rounded-lg p-3 bg-white dark:bg-gray-900 shadow-sm">
      <div className="text-sm font-semibold mb-2 text-gray-900 dark:text-gray-100">{title}</div>
      <div className="space-y-2 text-sm text-gray-700 dark:text-gray-200">
        {items.map((it, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${it.color}`}></div>
            <div className="font-mono">{it.label}</div>
          </div>
        ))}
        {note && <div className="text-xs text-indigo-700 dark:text-indigo-300 font-semibold">{note}</div>}
      </div>
    </div>
  );

  return (
    <div className="w-full flex flex-col gap-3" aria-label={t('learnMultisigDiagrams:singleVsMulti.ariaLabel')}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {card(
          t('learnMultisigDiagrams:singleVsMulti.singleTitle'),
          [
            { label: t('learnMultisigDiagrams:singleVsMulti.account'), color: 'bg-blue-500' },
            { label: t('learnMultisigDiagrams:singleVsMulti.singleKey'), color: 'bg-green-500' },
          ],
          t('learnMultisigDiagrams:singleVsMulti.singleNote')
        )}
        {card(
          t('learnMultisigDiagrams:singleVsMulti.multiTitle'),
          [
            { label: t('learnMultisigDiagrams:singleVsMulti.account'), color: 'bg-blue-500' },
            { label: t('learnMultisigDiagrams:singleVsMulti.keyA'), color: 'bg-green-500' },
            { label: t('learnMultisigDiagrams:singleVsMulti.keyB'), color: 'bg-yellow-500' },
            { label: t('learnMultisigDiagrams:singleVsMulti.keyC'), color: 'bg-red-500' },
          ],
          t('learnMultisigDiagrams:singleVsMulti.multiNote')
        )}
      </div>
    </div>
  );
}
