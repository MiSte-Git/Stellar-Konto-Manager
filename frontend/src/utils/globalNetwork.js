// Globales Netz (Mainnet/Testnet): ein Weg zum Setzen und einer zum Lesen.
//
// Setzen: setGlobalNetwork() schreibt SKM_NETWORK und SKM_HORIZON_URL und meldet
// den Wechsel per Event stm-network-changed. Genutzt von der Testnet-Checkbox im
// Wallet-Kopf (main.jsx) und vom Netzschalter auf "Neues Konto erstellen".
// Lesen: useGlobalNetwork() folgt jedem Wechsel per Event; Wechsel aus anderen
// Tabs macht installCrossTabNetworkSync() zu einem solchen Event.
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

export const NETWORK_CHANGED_CODE = 'network_changed';

/**
 * Gilt das Netz, mit dem ein Ablauf begonnen hat, noch als gespeichertes globales Netz?
 * Liest SKM_NETWORK nur zum Vergleich, nie als Quelle fuer Server oder Passphrase. Nach
 * einem Wechsel in einem anderen Tab ist localStorage schon neu, bevor das Event ankommt.
 */
export function isFlowNetworkCurrent(flowNetwork) {
  const id = normalizeNetworkId(flowNetwork);
  return !!id && id === readStoredNetworkId();
}

/**
 * Vor dem Signieren aufrufen. Wirft mit code NETWORK_CHANGED_CODE, wenn das globale Netz
 * nicht mehr das des Ablaufs ist. message: i18n-Key oder fertiger Text, je nachdem, wie die
 * Stelle Fehler anzeigt. Standard: "Abgebrochen ... Es wurde nichts gesendet."
 */
export function assertFlowNetwork(flowNetwork, message = 'createAccount:networkChanged.funderAborted') {
  if (!isFlowNetworkCurrent(flowNetwork)) {
    throw Object.assign(new Error(message), { code: NETWORK_CHANGED_CODE });
  }
}

/** Netz aus einem stm-network-changed-Event, sonst aus SKM_NETWORK. */
export function networkFromEvent(e) {
  const detail = typeof e?.detail === 'string' ? e.detail : '';
  return isNetworkEnabled(detail) ? normalizeNetworkId(detail) : readStoredNetworkId();
}

/**
 * Wechsel aus einem anderen Tab: localStorage ist zwischen Tabs geteilt, also
 * liest readStoredNetworkId() sofort das neue Netz, auch wenn dieser Tab nichts
 * davon mitbekommt. Damit Anzeige, geladenes Konto und offene Formulare nicht
 * auseinanderlaufen, wird der Wechsel hier als normales stm-network-changed
 * gemeldet. Dann greifen dieselben Regeln wie beim Wechsel im eigenen Tab
 * (Konto neu pruefen, Seiten setzen Eingaben zurueck). Einmal beim Start
 * installieren (main.jsx); weitere Aufrufe tun nichts. Gibt eine
 * Aufraeumfunktion zurueck (fuer Tests).
 */
let crossTabInstalled = null;
export function installCrossTabNetworkSync() {
  if (typeof window === 'undefined') return () => {};
  if (crossTabInstalled) return crossTabInstalled;
  const onStorage = (e) => {
    if (e && e.key !== null && e.key !== undefined && e.key !== 'SKM_NETWORK') return;
    window.dispatchEvent(new CustomEvent(NETWORK_CHANGED_EVENT, { detail: readStoredNetworkId() }));
  };
  window.addEventListener('storage', onStorage);
  crossTabInstalled = () => {
    window.removeEventListener('storage', onStorage);
    crossTabInstalled = null;
  };
  return crossTabInstalled;
}

/** Aktuelles globales Netz plus Setter (setGlobalNetwork). */
export function useGlobalNetwork() {
  const [network, setNetwork] = useState(() => readStoredNetworkId());
  useEffect(() => {
    const onChange = (e) => setNetwork(networkFromEvent(e));
    window.addEventListener(NETWORK_CHANGED_EVENT, onChange);
    // Wechsel zwischen erstem Render und Effekt nicht verpassen
    setNetwork(readStoredNetworkId());
    return () => window.removeEventListener(NETWORK_CHANGED_EVENT, onChange);
  }, []);
  const change = useCallback((raw) => { setNetwork(setGlobalNetwork(raw)); }, []);
  return [network, change];
}
