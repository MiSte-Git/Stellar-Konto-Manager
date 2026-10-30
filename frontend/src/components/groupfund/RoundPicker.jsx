import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDateTime } from '../../utils/datetime';
import { toStroops } from '../../utils/stellar/liquidityPools.js';
import { formatAmountWithUnit } from '../liquidity/formatPoolAmount.js';
import { shortenKey } from '../trading/assetSearchUtils.js';

const FIELD = 'rounded-sm border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900';
const LINK = 'text-xs text-blue-700 underline hover:no-underline dark:text-blue-300';

// datetime-local -> UTC-ISO im Format von Horizon (ohne Millisekunden, sonst stimmt der Textvergleich nicht).
function toHorizonIso(local) {
  if (!local) return '';
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function roundLabel(round, index, t) {
  const from = round.start ? formatLocalDateTime(round.start.createdAt) : t('groupfund:rounds.historyStart');
  if (index === 0) return t('groupfund:rounds.current', { from });
  return t('groupfund:rounds.past', { from, to: formatLocalDateTime(round.end?.createdAt) });
}

// Betraege der Grenzen liegen als Text vor, der rekonstruierte Saldo kann leicht negativ sein.
function formatXlm(value, locale) {
  const negative = value.startsWith('-');
  const stroops = toStroops(negative ? value.slice(1) : value);
  return formatAmountWithUnit(negative ? -stroops : stroops, 'XLM', locale);
}

function BoundaryFacts({ boundary, locale, source, amountLabel }) {
  const { t } = useTranslation(['groupfund']);
  const xlm = (value) => (value ? formatXlm(value, locale) : t('groupfund:corrections.unknown'));
  return (
    <div className="min-w-0">
      <div>{formatLocalDateTime(boundary.createdAt)} → <span className="font-mono">{shortenKey(boundary.to)}</span></div>
      <div className="text-gray-600 dark:text-gray-300">
        {t('groupfund:corrections.outflow', { amount: amountLabel || xlm(boundary.outflow) })}
        {' · '}
        {t('groupfund:corrections.balanceAfter', { amount: xlm(boundary.balanceAfter) })}
        {source && ` · ${t(`groupfund:corrections.source.${source}`)}`}
      </div>
      {boundary.hasIncoming && <div className="text-amber-900 dark:text-amber-200" data-testid="groupfund-boundary-incoming">{t('groupfund:corrections.hasIncoming')}</div>}
    </div>
  );
}

/** Rundenauswahl, Datumsbereich und Korrektur der Grenzen. */
export default function RoundPicker({
  analysis, selectedId, onSelect, onLoadMore, busy, onApplyRange,
  bufferXlm, bufferValid, onBufferChange, dismissed, manual, onDismiss, onRestore, onSetBoundary, onRemoveManual, locale,
}) {
  const { t } = useTranslation(['groupfund']);
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');
  // Die aelteste Runde ohne Start ist erst waehlbar, wenn sie vollstaendig gescannt ist.
  const rounds = analysis.rounds.filter((round, index) => index === 0 || round.complete);
  const boundaryIds = new Set(analysis.boundaries.map((b) => b.opId));
  const candidates = analysis.candidates.filter((c) => !boundaryIds.has(c.opId));

  return (
    <section className="space-y-2 rounded-sm border border-gray-200 p-3 dark:border-gray-700" data-testid="groupfund-rounds">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 text-xs">
          <span className="mb-1 block font-semibold">{t('groupfund:rounds.label')}</span>
          <select className={`${FIELD} w-full`} value={selectedId} onChange={(e) => onSelect(e.target.value)}>
            {rounds.map((round, index) => <option key={round.id} value={index === 0 ? 'current' : round.id}>{roundLabel(round, index, t)}</option>)}
            <option value="range">{t('groupfund:rounds.range')}</option>
          </select>
        </label>
        {!analysis.complete && (
          <button type="button" onClick={onLoadMore} disabled={busy} className="rounded-sm border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800">
            {t('groupfund:rounds.loadMore')}
          </button>
        )}
      </div>

      {selectedId === 'range' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block font-semibold">{t('groupfund:rounds.from')}</span>
            <input type="datetime-local" className={FIELD} value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-semibold">{t('groupfund:rounds.to')}</span>
            <input type="datetime-local" className={FIELD} value={toLocal} onChange={(e) => setToLocal(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={!fromLocal || busy}
            onClick={() => onApplyRange({ fromISO: toHorizonIso(fromLocal), toISO: toHorizonIso(toLocal) })}
            className="rounded-sm bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t('groupfund:rounds.applyRange')}
          </button>
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer font-semibold">{t('groupfund:corrections.title')}</summary>
        <div className="mt-2 space-y-3">
          <div>
            <label className="block">
              <span className="mb-1 block font-semibold">{t('groupfund:corrections.buffer')}</span>
              <input className={`${FIELD} w-28`} inputMode="decimal" value={bufferXlm} onChange={(e) => onBufferChange(e.target.value)} />
            </label>
            <p className="mt-1 text-gray-600 dark:text-gray-300">{t('groupfund:corrections.bufferHint')}</p>
            {!bufferValid && <p className="mt-1 text-red-700 dark:text-red-300">{t('groupfund:corrections.bufferInvalid')}</p>}
          </div>

          <div>
            <div className="mb-1 font-semibold">{t('groupfund:corrections.boundaries')}</div>
            {analysis.boundaries.length === 0 && <p className="text-gray-600 dark:text-gray-300">{t('groupfund:corrections.noBoundaries')}</p>}
            <ul className="space-y-2">
              {analysis.boundaries.map((b) => (
                <li key={b.opId} className="flex flex-wrap items-start justify-between gap-2" data-testid="groupfund-boundary">
                  <BoundaryFacts boundary={b} locale={locale} source={b.source} />
                  <button type="button" className={LINK} onClick={() => (b.source === 'manual' ? onRemoveManual(b.opId) : onDismiss(b))}>
                    {t('groupfund:corrections.discard')}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {dismissed.length > 0 && (
            <div>
              <div className="mb-1 font-semibold">{t('groupfund:corrections.dismissed')}</div>
              <ul className="space-y-2">
                {dismissed.map((b) => (
                  <li key={b.opId} className="flex flex-wrap items-start justify-between gap-2" data-testid="groupfund-dismissed">
                    <BoundaryFacts boundary={b} locale={locale} />
                    <button type="button" className={LINK} onClick={() => onRestore(b.opId)}>{t('groupfund:corrections.restore')}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {candidates.length > 0 && (
            <div>
              <div className="mb-1 font-semibold">{t('groupfund:corrections.candidates')}</div>
              <ul className="max-h-60 space-y-2 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.opId} className="flex flex-wrap items-start justify-between gap-2" data-testid="groupfund-candidate">
                    <BoundaryFacts boundary={c} locale={locale} amountLabel={c.tokenAmount} />
                    <button type="button" className={LINK} onClick={() => onSetBoundary(c)}>{t('groupfund:corrections.setBoundary')}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {manual.length > 0 && <p className="text-gray-600 dark:text-gray-300">{t('groupfund:corrections.manualCount', { count: manual.length })}</p>}
        </div>
      </details>
    </section>
  );
}
