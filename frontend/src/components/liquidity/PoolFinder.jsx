import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Asset } from '@stellar/stellar-sdk';
import { assetFromSearchResult } from '../trading/assetSearchUtils.js';
import useAssetPickerSearch from '../trading/hooks/useAssetPickerSearch.js';
import PoolAssetInput from './PoolAssetInput.jsx';
import PoolFacts from './PoolFacts.jsx';

const NOTICE = 'rounded-sm border px-3 py-2 text-xs';
const NEUTRAL = `${NOTICE} border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200`;
const ERROR = `${NOTICE} border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200`;

// Vergleichswert einer Paar-Seite: XLM, gewaehltes Token oder leer.
const sideKey = (kind, picker) => {
  if (kind === 'native') return 'native';
  return picker.selected ? `${picker.selected.assetCode}:${picker.selected.assetIssuer}` : '';
};

/**
 * Bereich "Pool finden": Asset-Paar (XLM oder Token je Seite) oder Pool-ID.
 * Der Lookup-Zustand (usePoolLookup) liegt in der Seite, damit auch die
 * Positionsliste und der Query-Param ?pool= hier einen Pool anzeigen koennen.
 */
export default function PoolFinder({
  network,
  lookup,
  mode,
  onModeChange,
  poolIdInput,
  onPoolIdInputChange,
  onLookupId,
  onLookupPair,
  lastLookupMode,
  firstAsset,
  hasAccount = false,
  onDeposit,
}) {
  const { t } = useTranslation(['liquidity', 'trading', 'common']);
  const [kindFirst, setKindFirst] = useState('native');
  const [kindSecond, setKindSecond] = useState('token');
  const [pairError, setPairError] = useState('');
  const pickerFirst = useAssetPickerSearch({ network, t });
  const pickerSecond = useAssetPickerSearch({ network, t });

  // Jede Aenderung am Asset-Paar macht einen alten Paar-Fehler hinfaellig:
  // Art (XLM/Token), Suche gestartet, Token gewaehlt oder abgewaehlt, je Seite.
  useEffect(() => {
    setPairError('');
  }, [kindFirst, kindSecond, pickerFirst.selected, pickerSecond.selected]);

  // Aendert sich im Modus Asset-Paar das Paar, gehoert der angezeigte Pool nicht
  // mehr dazu: Fakten und Einzahlen verschwinden, laufende Antworten verfallen.
  const pairKey = `${sideKey(kindFirst, pickerFirst)}|${sideKey(kindSecond, pickerSecond)}`;
  const lastPairKey = useRef(pairKey);
  const { reset: resetLookup } = lookup;
  useEffect(() => {
    if (lastPairKey.current === pairKey) return;
    lastPairKey.current = pairKey;
    if (mode === 'pair') resetLookup();
  }, [pairKey, mode, resetLookup]);

  const withPairReset = (picker) => ({
    ...picker,
    search: () => {
      setPairError('');
      return picker.search();
    },
  });

  // Moduswechsel: Fehler und Ergebnis des anderen Modus verwerfen.
  const changeMode = (value) => {
    if (value !== mode) {
      setPairError('');
      lookup.reset();
    }
    onModeChange(value);
  };

  const resolveSide = (kind, picker) => {
    if (kind === 'native') return Asset.native();
    return picker.selected ? assetFromSearchResult(picker.selected) : null;
  };

  const handlePairSubmit = () => {
    const a = resolveSide(kindFirst, pickerFirst);
    const b = resolveSide(kindSecond, pickerSecond);
    if (!a || !b) {
      setPairError(t('liquidity:finder.selectBoth'));
      return;
    }
    if (a.equals(b)) {
      setPairError(t('liquidity:finder.sameAsset'));
      return;
    }
    setPairError('');
    onLookupPair(a, b);
  };

  const retry = () => (lastLookupMode === 'id' ? onLookupId() : handlePairSubmit());

  return (
    <section className="rounded-sm border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40" data-testid="pool-finder">
      <h2 className="mb-1 text-lg font-semibold">{t('liquidity:finder.title')}</h2>
      <p className="mb-3 text-xs text-gray-600 dark:text-gray-300">{t('liquidity:finder.noAccountNeeded')}</p>
      <div className="mb-3 flex gap-2" role="tablist">
        {['pair', 'id'].map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => changeMode(value)}
            className={`rounded-sm border px-3 py-1.5 text-xs font-semibold ${
              mode === value
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {t(`liquidity:finder.mode.${value}`)}
          </button>
        ))}
      </div>

      {mode === 'pair' ? (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <PoolAssetInput name="pool-asset-first" label={t('liquidity:finder.assetFirst')} kind={kindFirst} onKindChange={setKindFirst} picker={withPairReset(pickerFirst)} />
            <PoolAssetInput name="pool-asset-second" label={t('liquidity:finder.assetSecond')} kind={kindSecond} onKindChange={setKindSecond} picker={withPairReset(pickerSecond)} />
          </div>
          {pairError && <div className={ERROR}>{pairError}</div>}
          <button
            type="button"
            onClick={handlePairSubmit}
            disabled={lookup.status === 'loading'}
            className="rounded-sm bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t('liquidity:finder.submit')}
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            onLookupId();
          }}
        >
          <label className="block w-full text-xs">
            <span className="mb-1 block font-semibold">{t('liquidity:finder.poolIdLabel')}</span>
            <input
              value={poolIdInput}
              onChange={(event) => onPoolIdInputChange(event.target.value)}
              className="w-full rounded-sm border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            disabled={lookup.status === 'loading'}
            className="rounded-sm bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t('liquidity:finder.submit')}
          </button>
        </form>
      )}

      <div className="mt-3" aria-live="polite">
        {lookup.status === 'loading' && <div className={NEUTRAL}>{t('liquidity:finder.loading')}</div>}
        {lookup.status === 'notFound' && (
          <div className={NEUTRAL} data-testid="pool-not-found">
            {lastLookupMode === 'id' ? t('liquidity:finder.notFoundId') : t('liquidity:finder.notFoundPair')}
          </div>
        )}
        {lookup.status === 'error' && lookup.error === 'emptyPoolId' && <div className={ERROR}>{t('liquidity:finder.emptyPoolId')}</div>}
        {lookup.status === 'error' && lookup.error === 'invalidPoolId' && <div className={ERROR}>{t('liquidity:finder.invalidPoolId')}</div>}
        {lookup.status === 'error' && lookup.error === 'sameAsset' && <div className={ERROR}>{t('liquidity:finder.sameAsset')}</div>}
        {lookup.status === 'error' && lookup.error === 'loadFailed' && (
          <div className={ERROR}>
            {t('liquidity:finder.loadFailed')}{' '}
            <button type="button" onClick={retry} className="underline hover:no-underline">{t('liquidity:finder.retry')}</button>
          </div>
        )}
        {lookup.status === 'found' && lookup.pool && (
          <PoolFacts pool={lookup.pool} firstAsset={firstAsset} network={network} hasAccount={hasAccount} onDeposit={onDeposit} />
        )}
      </div>
    </section>
  );
}
