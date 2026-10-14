// Stellt den in AppLayout geladenen XLM-Kurs allen Seiten bereit,
// damit der Kurs nur einmal abgefragt wird.
import { createContext, useContext } from 'react';

export const XlmPriceContext = createContext(null);

/** Liefert die Daten aus useXlmPrice oder null ausserhalb der App-Shell. */
export function useXlmPriceData() {
  return useContext(XlmPriceContext);
}
