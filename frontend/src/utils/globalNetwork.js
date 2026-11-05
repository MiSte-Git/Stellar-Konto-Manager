// Globales Netz (Mainnet/Testnet): ein Weg zum Setzen und einer zum Lesen.
//
// Setzen: setGlobalNetwork() schreibt SKM_NETWORK und SKM_HORIZON_URL und meldet
// den Wechsel per Event stm-network-changed. Genutzt von der Testnet-Checkbox im
// Wallet-Kopf (main.jsx) und vom Netzschalter auf "Neues Konto erstellen".
// Lesen: useGlobalNetwork() folgt jedem Wechsel, egal von wo (Event, anderer Tab).
// Die Netz-Anzeige in der Kopfleiste nutzt denselben Hook, damit Anzeige und
// Schalter einer Seite nie verschieden sind.
import { useCallback, useEffect, useState } from 'react';
import { NETWORKS, isNetworkEnabled, normalizeNetworkId, readStoredNetworkId } from '../config/networks.js';

export const NETWORK_CHANGED_EVENT = 'stm-network-changed';

/** Setzt das globale Netz. Unbekannte oder deaktivierte Werte ergeben PUBLIC. */
export function setGlobalNetwork(raw) {
  const id = isNetworkEnabled(raw) ? normalizeNetworkId(raw) : 'PUBLIC';
  if (typeof window === 'undefined') return id;
  try {
    const ls = window.localStorage;
    if (ls) {
      ls.setItem('SKM_NETWORK', id);
      if (id === 'TESTNET') ls.setItem('SKM_HORIZON_URL', NETWORKS.TESTNET.horizonUrl);
      else ls.removeItem('SKM_HORIZON_URL');
    }
  } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent(NETWORK_CHANGED_EVENT, { detail: id }));
  return id;
}

/** Netz aus einem stm-network-changed-Event, sonst aus SKM_NETWORK. */
export function networkFromEvent(e) {
  const detail = typeof e?.detail === 'string' ? e.detail : '';
  return isNetworkEnabled(detail) ? normalizeNetworkId(detail) : readStoredNetworkId();
}

/** Aktuelles globales Netz plus Setter (setGlobalNetwork). */
export function useGlobalNetwork() {
  const [network, setNetwork] = useState(() => readStoredNetworkId());
  useEffect(() => {
    const onChange = (e) => setNetwork(networkFromEvent(e));
    const onStorage = (e) => {
      if (e && e.key !== null && e.key !== undefined && e.key !== 'SKM_NETWORK') return;
      setNetwork(readStoredNetworkId());
    };
    window.addEventListener(NETWORK_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    // Wechsel zwischen erstem Render und Effekt nicht verpassen
    setNetwork(readStoredNetworkId());
    return () => {
      window.removeEventListener(NETWORK_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const change = useCallback((raw) => { setNetwork(setGlobalNetwork(raw)); }, []);
  return [network, change];
}
