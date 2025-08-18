// Speichert kleine UI-Settings (z. B. Cache-Switch) in localStorage.
import { useState, useEffect } from 'react';

export function useSettings() {
  const [useCache, setUseCache] = useState(() => localStorage.getItem('stm.useCache') === '1');
  const [prefetchDays, setPrefetchDays] = useState(() => Number(localStorage.getItem('stm.prefetchDays') || 90));
  useEffect(() => localStorage.setItem('stm.useCache', useCache ? '1' : '0'), [useCache]);
  useEffect(() => localStorage.setItem('stm.prefetchDays', String(prefetchDays)), [prefetchDays]);
  return { useCache, setUseCache, prefetchDays, setPrefetchDays };
}
