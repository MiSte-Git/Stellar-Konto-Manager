import { getMultisigJobId, multisigJobPath } from '../../utils/basePath.js';
import { SESSION_LOCKED_EVENT } from '../../utils/sessionSecrets.js';

// Zugriffstoken je Job-ID, nur im Speicher: uebersteht Navigation innerhalb der
// App, nicht aber ein Neuladen (dann greift resolveToken in MultisigJobDetail).
// Geleert beim Sperren (Schloss, Inaktivitaet) und beim Kontowechsel (#10). Im Endzustand
// bewusst nicht: Das Token braucht auch das Lesen des Ergebnisses, und wer den Job angelegt
// hat, kommt ohne gemerktes Secret sonst nicht mehr an die Anzeige.
const jobTokens = new Map();

/** Alle gemerkten Job-Tokens vergessen (Sperren, Kontowechsel). */
export function clearMultisigJobTokens() {
  jobTokens.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener(SESSION_LOCKED_EVENT, clearMultisigJobTokens);
}

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
 * Liefert das bekannte Zugriffstoken eines Jobs (nur aus dem Speicher). Geteilte Links mit
 * Token gibt es nicht (Entscheidung 16.11., #10): Steht auf einer Job-URL noch ?token=,
 * wird es nicht uebernommen, sondern nur aus der Adresszeile entfernt, damit es nicht im
 * Verlauf oder im Referer stehen bleibt; uebrige Query-Parameter, Pfad und Hash bleiben.
 * Co-Signer holen das Token ueber Challenge und Signatur (resolveToken in MultisigJobDetail).
 */
export function takeMultisigJobToken(jobId) {
  try {
    if (getMultisigJobId() && new URLSearchParams(window.location.search).has('token')) removeTokenFromUrl();
  } catch { /* noop */ }
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
