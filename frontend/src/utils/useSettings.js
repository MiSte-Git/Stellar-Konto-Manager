// Speichert kleine UI-Settings (z. B. Cache-Switch) in localStorage.
import { useState, useEffect } from 'react';

export function useSettings() {
  const [useCache, setUseCache] = useState(() => localStorage.getItem('stm.useCache') === '1');
  const [prefetchDays, setPrefetchDays] = useState(() => Number(localStorage.getItem('stm.prefetchDays') || 90));
  const [decimalsMode, setDecimalsMode] = useState(() => localStorage.getItem('stm.decimalsMode') || 'auto'); // 'auto' | '0'..'7'
  const [fullHorizonUrl, setFullHorizonUrl] = useState(() => localStorage.getItem('stm.horizonFullUrl') || '');
  const [autoUseFullHorizon, setAutoUseFullHorizon] = useState(() => localStorage.getItem('stm.autoFullHorizon') === '1');

  useEffect(() => localStorage.setItem('stm.useCache', useCache ? '1' : '0'), [useCache]);
  useEffect(() => localStorage.setItem('stm.prefetchDays', String(prefetchDays)), [prefetchDays]);
  useEffect(() => localStorage.setItem('stm.decimalsMode', String(decimalsMode)), [decimalsMode]);
  useEffect(() => localStorage.setItem('stm.horizonFullUrl', String(fullHorizonUrl || '')), [fullHorizonUrl]);
  useEffect(() => localStorage.setItem('stm.autoFullHorizon', autoUseFullHorizon ? '1' : '0'), [autoUseFullHorizon]);

  return {
    useCache, setUseCache,
    prefetchDays, setPrefetchDays,
    decimalsMode, setDecimalsMode,
    fullHorizonUrl, setFullHorizonUrl,
    autoUseFullHorizon, setAutoUseFullHorizon,
  };
}
