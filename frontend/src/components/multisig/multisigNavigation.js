import { multisigJobPath } from '../../utils/basePath.js';

/**
 * Oeffnet das Job-Detail eines Multisig-Jobs. Laeuft ueber pushState + popstate,
 * damit main.jsx die Ansicht wie bei Vor/Zurueck aus der URL uebernimmt. Das
 * Zugriffstoken (falls bekannt) geht wie bei geteilten Job-Links als ?token= mit.
 */
export function openMultisigJob(jobId, token) {
  if (!jobId) return;
  try {
    window.history.pushState({}, '', multisigJobPath(jobId, token));
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}
