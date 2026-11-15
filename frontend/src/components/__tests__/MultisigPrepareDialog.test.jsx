import React from 'react';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import MultisigPrepareDialog from '../MultisigPrepareDialog.jsx';

// Wie MultisigResultDialog (R-2): Hat das Backend beim Anlegen gesendet (z. B. MultisigEditPage mit
// gemerktem Key, der die Schwelle allein erreicht), zeigt der Dialog den Status aus der Antwort.
const NOT_SENT_HINT = 'Diese Transaktion wurde noch nicht an das Netzwerk gesendet.';

function renderDialog(props = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MultisigPrepareDialog open onClose={() => {}} hash={'a'.repeat(64)} xdr="AAAA" {...props} />
    </I18nextProvider>
  );
}

describe('MultisigPrepareDialog: Status aus der Backend-Antwort', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('ohne Status und bei pending_signatures wie bisher: noch nicht gesendet', () => {
    const { unmount } = renderDialog();
    expect(screen.getByText(NOT_SENT_HINT)).toBeInTheDocument();
    unmount();
    renderDialog({ jobStatus: 'pending_signatures' });
    expect(screen.getByText(NOT_SENT_HINT)).toBeInTheDocument();
    expect(screen.queryByTestId('multisig-result-submit-unclear')).toBeNull();
  });

  it('submitted_success: gesendet, nicht noch nicht gesendet', () => {
    renderDialog({ jobStatus: 'submitted_success' });
    expect(screen.getByTestId('multisig-result-submitted')).toHaveTextContent(i18n.t('multisig:job.statusHelp.submitted_success'));
    expect(screen.queryByText(NOT_SENT_HINT)).toBeNull();
  });

  it('submitted_failed: Fehler mit Grund', () => {
    renderDialog({ jobStatus: 'submitted_failed', submitReason: 'Transaction Failed' });
    expect(screen.getByTestId('multisig-result-submit-failed'))
      .toHaveTextContent(i18n.t('multisig:detail.submitFailed', { reason: 'Transaction Failed' }));
    expect(screen.queryByText(NOT_SENT_HINT)).toBeNull();
  });

  it('submit_unclear: Hinweis wie im Job-Detail mit Grund', () => {
    renderDialog({ jobStatus: 'submit_unclear', submitReason: 'Timeout' });
    const box = screen.getByTestId('multisig-result-submit-unclear');
    expect(box).toHaveTextContent(i18n.t('multisig:detail.submitUnclear.title'));
    expect(box).toHaveTextContent(i18n.t('multisig:detail.submitUnclear.body'));
    expect(box).toHaveTextContent(i18n.t('multisig:detail.submitUnclear.reason', { reason: 'Timeout' }));
    expect(screen.queryByText(NOT_SENT_HINT)).toBeNull();
  });
});
