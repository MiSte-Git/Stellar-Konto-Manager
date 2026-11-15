// Grund aus submittedResult.error eines Multisig-Jobs: ein String (beide Backends seit F-3); ein Objekt
// ist das alte Node-Format. Gemeinsam fuer Job-Detail und Ergebnisdialog.
export function submitReasonText(submittedResult) {
  const err = submittedResult?.error;
  if (!err) return '';
  if (typeof err === 'string') return err;
  return String(err.title || err.detail || err.message || 'submit_failed');
}

// R-2: Status, in denen das Backend schon gesendet hat (Anlegen oder Merge). Der Ergebnisdialog zeigt
// dann den Ausgang statt "noch nicht gesendet" und bietet kein weiteres Signieren an.
export const BACKEND_SENT_STATUSES = new Set(['submitted_success', 'submitted_failed', 'submit_unclear']);
