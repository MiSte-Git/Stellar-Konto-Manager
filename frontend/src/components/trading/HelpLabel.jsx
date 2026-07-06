import React from 'react';
import { useTranslation } from 'react-i18next';

// Small "label + (?) tooltip" primitive used across every AssetSearch section
// (results table, trustline, swap, market data, limit orders, token facts).
// Extracted from AssetSearch.jsx's inline renderHelpLabel() (step 2 of the
// file-split) without any behavior change - same markup, same t(helpKey) lookup.
export default function HelpLabel({ label, helpKey }) {
  const { t } = useTranslation(['trading', 'common']);
  const help = t(helpKey);
  return (
    <span className="inline-flex items-center gap-1" title={help}>
      <span>{label}</span>
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-bold text-gray-600 dark:border-gray-600 dark:text-gray-200"
        aria-label={help}
      >
        ?
      </span>
    </span>
  );
}
