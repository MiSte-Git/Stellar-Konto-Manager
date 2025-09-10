import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../utils/useSettings';
import { formatElapsedMmSs } from '../utils/datetime';

function SourceInput({ sourceInput, setSourceInput, onSubmit }) {
  const { t } = useTranslation();
  const [recentInputs, setRecentInputs] = useState([]);
  const handleChange = (e) => setSourceInput(e.target.value); // <--- hier!
  const handleClear = () => setSourceInput(''); // ❌ Eingabe löschen
  const { useCache, setUseCache, prefetchDays, setPrefetchDays } = useSettings();
  const [syncing, setSyncing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startedAt, setStartedAt] = useState(0);

  
  // Lausche auf Sync-Events und zeige Timer für das aktuell eingegebene Wallet
  useEffect(() => {
    const onSync = (e) => {
      const { accountId, phase, ts } = e.detail || {};
      if (!accountId || accountId !== sourceInput) return;
      if (phase === 'start') {
        setSyncing(true);
        setStartedAt(ts || Date.now());
        setElapsedMs(0);
      } else if (phase === 'progress') {
        setSyncing(true);
      } else if (phase === 'done') {
        setSyncing(false);
        setLastRefresh(new Date(ts || Date.now()).toISOString());
        setElapsedMs(0);
        setStartedAt(0);
      }
    };
    window.addEventListener('stm:cache-sync', onSync);
    return () => window.removeEventListener('stm:cache-sync', onSync);
  }, [sourceInput]);

  // Sekündlicher Tick, solange syncing=true
  useEffect(() => {
    if (!syncing || !startedAt) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [syncing, startedAt]);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4">
      <label htmlFor="source" className="block font-bold mb-1">
        {t('publicKey.label')}
      </label>

      {/* Eingabefeld mit Clear-Button */}
      <div className="relative">
        <input
          id="source"
          type="text"
          value={sourceInput}
          onChange={handleChange}
          placeholder={t('publicKey.placeholder')}
          className="w-full border border-gray-300 rounded p-2 pr-8"
        />

        {sourceInput && (
          <button
            type="button"
            onClick={handleClear}
            title={t('common.clear')}
            aria-label={t('common.clear')}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-300 hover:bg-red-500
               text-gray-600 hover:text-white text-xs flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>

      {/* Cache-Switch + Prefetch-Tage */}
      {/* <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useCache}
            onChange={(e) => setUseCache(e.target.checked)}
          />
          {t('settings.cache.label')}
        </label>
        <div className="text-xs text-gray-500">{t('settings.cache.help')}</div>
        {useCache && (
          <label className="flex items-center gap-2 text-xs">
            {t('settings.prefetchDays')}
            <input
              type="number"
              min={1}
              max={3650}
              value={prefetchDays}
              onChange={(e) => setPrefetchDays(Number(e.target.value) || 90)}
              className="w-20 px-2 py-1 rounded border"
            />
            <div className="text-[11px] text-gray-500">{t('settings.cache.prefetchHelp')}</div>
          </label>
        )}
      </div>
      */} 
      
      {useCache && syncing && (
        <div className="mt-1 text-xs text-blue-600">
          {t('progress.phase.sync')} • {t('progress.elapsed', { time: formatElapsedMmSs(elapsedMs) })}
        </div>
      )}
      {useCache && !syncing && lastRefresh && (
        <div className="mt-1 text-[11px] text-gray-500">
          {t('cache.lastRefresh', { ts: lastRefresh })}
        </div>
      )}

      <button
        type="submit"
        className="mt-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {t('publicKey.submit.button')}
      </button>
    </form>
  );
}

export default SourceInput;