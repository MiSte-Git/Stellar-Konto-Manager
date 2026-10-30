import { useCallback, useEffect, useRef, useState } from 'react';
import { parseAmountInput } from '../../liquidity/formatPoolAmount.js';
import { loadGroupfundPrefs, saveGroupfundPrefs, subscribeGroupfundPrefs } from '../../../utils/groupfundPrefs.js';
import { DEFAULT_BUFFER_XLM } from '../../../utils/stellar/groupfundRounds.js';

/** Gueltiger Puffer in Stroops; bei ungueltiger Eingabe der Standardwert. */
export function bufferStroopsOf(prefs) {
  return parseAmountInput(prefs.bufferXlm) ?? parseAmountInput(DEFAULT_BUFFER_XLM);
}

/**
 * Einstellungen je Konto und Netz, live zwischen allen Ansichten geteilt: Kopfbereich,
 * Karte und Groupfund-Seite rechnen so mit demselben Puffer und denselben Grenzen.
 * Fuer anderes Netz oder Konto die Komponente neu mounten (key).
 */
export default function useGroupfundPrefs(network, accountId) {
  const [prefs, setPrefs] = useState(() => loadGroupfundPrefs(network, accountId));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => subscribeGroupfundPrefs(network, accountId, setPrefs), [accountId, network]);
  const updatePrefs = useCallback((patch) => {
    saveGroupfundPrefs(network, accountId, { ...prefsRef.current, ...patch });
  }, [accountId, network]);
  return [prefs, updatePrefs];
}
