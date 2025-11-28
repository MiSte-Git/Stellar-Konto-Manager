// ProgressBar.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Zeigt eine Fortschrittsleiste mit Status-Text & optionaler ETA.
 * @param {number} progress 0..1 (oder null für indeterminate)
 * @param {string} phase z.B. 'scan' | 'pageDone' | 'chunkDone'
 * @param {number} page aktuelle Seite (optional)
 * @param {number} etaMs Restzeit in ms (optional)
 * @param {number} elapsedMs Vergangene Zeit in ms (optional)
 */
export default function ProgressBar({ progress, phase, page, etaMs, oldest, elapsedMs }) {
  const { t } = useTranslation();
  const pct = typeof progress === 'number' ? Math.round(progress * 100) : null;
  const etaText = (etaMs && etaMs > 0) ? t('common:progress.eta', { minutes: Math.ceil(etaMs/60000) }) : '';
  const elapsedText = (elapsedMs && elapsedMs > 0) ? t('common:progress.elapsed', { time: `${Math.ceil(elapsedMs/1000)}s` }) : '';
  const oldestText = oldest ? t('common:progress.oldest', { date: oldest }) : '';
  return (
    <div className="mt-2">
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <i
          className="block h-full bg-blue-500 transition-all"
          style={{ width: pct != null ? `${pct}%` : '33%', animation: pct==null ? 'pulse 1.6s infinite' : 'none' }}
        />
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {t(`progress.phase.${phase}`, { page })}
        {etaText && ` • ${etaText}`}
        {elapsedText && ` • ${elapsedText}`}
        {oldestText && ` • ${oldestText}`}
      </div>
    </div>
  );
}
