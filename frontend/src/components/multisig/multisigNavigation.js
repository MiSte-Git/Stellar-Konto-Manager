import { getMultisigJobId, getMultisigJobToken, multisigJobPath } from '../../utils/basePath.js';

// Zugriffstoken je Job-ID, nur im Speicher: uebersteht Navigation innerhalb der
// App, nicht aber ein Neuladen (dann greift resolveToken in MultisigJobDetail).
const jobTokens = new Map();

function removeTokenFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    params.delete('token');
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  } catch { /* noop */ }
}

/**
 * Liefert das bekannte Zugriffstoken eines Jobs. Steht auf einer Job-URL noch
 * ?token= (geteilter Link), wird es uebernommen und aus der Adresszeile entfernt;
 * uebrige Query-Parameter, Pfad und Hash bleiben. Mehrfacher Aufruf ist unschaedlich.
 */
export function takeMultisigJobToken(jobId) {
  const fromUrl = getMultisigJobToken();
  const urlJobId = getMultisigJobId();
  if (fromUrl && urlJobId) {
    jobTokens.set(urlJobId, fromUrl);
    removeTokenFromUrl();
  }
  return jobTokens.get(jobId) || null;
}

/**
 * Oeffnet das Job-Detail eines Multisig-Jobs. Laeuft ueber pushState + popstate,
 * damit main.jsx die Ansicht wie bei Vor/Zurueck aus der URL uebernimmt. Das
 * Zugriffstoken (falls bekannt) bleibt im Speicher und erreicht das Job-Detail
 * ueber die Prop aus main.jsx, die URL ist nur /multisig/jobs/<id>.
 */
export function openMultisigJob(jobId, token) {
  if (!jobId) return;
  if (token) jobTokens.set(jobId, token);
  try {
    window.history.pushState({}, '', multisigJobPath(jobId));
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}
