import { liquidityPoolsPath } from '../../utils/basePath.js';
import { isValidPoolId } from '../../utils/stellar/liquidityPools.js';

/**
 * Oeffnet die Liquidity-Pool-Ansicht (optional mit Pool-ID als Query-Param).
 * Laeuft ueber pushState + popstate, damit main.jsx die Ansicht wie bei
 * Vor/Zurueck aus der URL uebernimmt.
 */
export function openLiquidityPoolsView(poolId) {
  try {
    window.history.pushState({}, '', liquidityPoolsPath(poolId));
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}

/** Pool-ID aus ?pool=..., nur wenn gueltig (64 Hex); sonst ''. */
export function readPoolIdFromSearch(search) {
  try {
    const qs = typeof search === 'string' ? search : (typeof window !== 'undefined' ? window.location.search : '');
    const value = String(new URLSearchParams(qs).get('pool') || '').trim().toLowerCase();
    return isValidPoolId(value) ? value : '';
  } catch {
    return '';
  }
}
