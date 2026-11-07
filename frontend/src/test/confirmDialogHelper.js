// Testhilfe fuer den eigenen Bestaetigungsdialog (components/ConfirmDialog.jsx).
// autoAnswerConfirmDialog(true|false): beantwortet jeden erscheinenden Dialog selbst und
// merkt die Texte in seen. stop() beendet das Beobachten.
import { fireEvent } from '@testing-library/react';

export function autoAnswerConfirmDialog(answer = true) {
  const seen = [];
  const handle = () => {
    const dlg = document.querySelector('[data-testid="confirm-dialog"]');
    if (!dlg || dlg.dataset.answered) return;
    dlg.dataset.answered = '1';
    seen.push(dlg.querySelector('p')?.textContent || '');
    fireEvent.click(dlg.querySelector(answer ? '[data-testid="confirm-dialog-ok"]' : '[data-testid="confirm-dialog-cancel"]'));
  };
  const observer = new MutationObserver(handle);
  observer.observe(document.body, { childList: true, subtree: true });
  return { seen, stop: () => observer.disconnect() };
}
