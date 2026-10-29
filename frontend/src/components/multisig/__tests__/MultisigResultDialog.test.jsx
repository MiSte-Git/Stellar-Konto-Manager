import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import MultisigResultDialog from '../MultisigResultDialog.jsx';

const SIGNER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
// 2026-11-01 12:00 UTC
const MAX_TIME = String(Date.UTC(2026, 10, 1, 12, 0) / 1000);

function renderDialog(props = {}) {
  const handlers = { onClose: vi.fn() };
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MultisigResultDialog {...handlers} {...props} />
    </I18nextProvider>
  );
  return { ...view, ...handlers };
}

describe('MultisigResultDialog', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('Job: Status, Signaturstand, fehlende Signer, Frist, Job-ID, Zum Job und Jetzt signieren', () => {
    const onOpenJob = vi.fn();
    const onSignNow = vi.fn();
    renderDialog({
      type: 'job',
      jobId: 'job-1',
      hash: 'abc',
      validUntil: MAX_TIME,
      signing: { required: 2, collected: 1, missingSigners: [{ publicKey: SIGNER, weight: 1 }] },
      summaryItems: [{ label: 'Quelle', value: 'GSRC' }],
      onOpenJob,
      onSignNow,
    });
    expect(screen.getByText('Transaktion für Multisig vorbereitet')).toBeInTheDocument();
    expect(screen.getByText('Multisig-Job wurde erstellt. Die Transaktion wurde noch nicht gesendet.')).toBeInTheDocument();
    expect(screen.getByTestId('multisig-result-progress')).toHaveTextContent('Signaturgewicht: gesammelt 1 von 2.');
    expect(screen.getByTestId('multisig-result-missing')).toHaveTextContent(`Noch fehlende Signer${SIGNER.slice(0, 8)}…${SIGNER.slice(-8)} (Gewicht 1)`);
    expect(screen.getByTitle(SIGNER)).toBeInTheDocument();
    const deadline = screen.getByTestId('multisig-result-deadline').textContent;
    expect(deadline).toMatch(/^Muss bis .*2026.* vollständig signiert und eingereicht sein\.$/);
    expect(screen.getByText('job-1')).toBeInTheDocument();
    expect(screen.getByText('Quelle:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zum Job' }));
    expect(onOpenJob).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt signieren' }));
    expect(onSignNow).toHaveBeenCalled();
    // Naechste Schritte klappen auf
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Schritte' }));
    expect(screen.getByText('Was jetzt zu tun ist')).toBeInTheDocument();
  });

  it('Job ohne fehlende Signer und ohne Zum-Job-Handler zeigt weder Liste noch Button', () => {
    renderDialog({ type: 'job', jobId: 'job-2', signing: { required: 1, collected: 1, missingSigners: [] } });
    expect(screen.queryByTestId('multisig-result-missing')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zum Job' })).toBeNull();
    expect(screen.queryByTestId('multisig-result-deadline')).toBeNull();
  });

  it('XDR: kein Job, nichts gesendet, Frist wie beim Job, XDR kopierbar', () => {
    renderDialog({ type: 'xdr', hash: 'h', xdr: 'AAAAXDR', validUntil: MAX_TIME });
    expect(screen.getByText('XDR vorbereitet (nicht gesendet)')).toBeInTheDocument();
    expect(screen.getByText('Es wurde nichts an das Netzwerk gesendet.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Es wurde kein Multisig-Job angelegt.')).toBeInTheDocument();
    expect(screen.getByTestId('multisig-result-deadline')).toHaveTextContent(/^Muss bis /);
    expect(screen.getByDisplayValue('AAAAXDR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zum Job' })).toBeNull();
    expect(screen.queryByTestId('multisig-result-progress')).toBeNull();
  });

  it('unbegrenzte Gueltigkeit wird als solche genannt', () => {
    renderDialog({ type: 'xdr', hash: 'h', xdr: 'X', validUntil: '0' });
    expect(screen.getByTestId('multisig-result-deadline')).toHaveTextContent('Ohne zeitliche Begrenzung gültig.');
  });

  it('Gesendet: Status, Explorer-Links, Details kopieren, keine Frist', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    renderDialog({
      type: 'sent',
      hash: 'h1',
      validUntil: MAX_TIME,
      explorerLinks: [{ href: 'https://stellar.expert/tx/h1', label: 'stellar.expert' }],
      copyDetailsText: 'Quelle: G\nHash: h1',
    });
    expect(screen.getByText('Transaktion gesendet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'stellar.expert' })).toHaveAttribute('href', 'https://stellar.expert/tx/h1');
    expect(screen.queryByTestId('multisig-result-deadline')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details kopieren' }));
    expect(writeText).toHaveBeenCalledWith('Quelle: G\nHash: h1');
    expect(await screen.findByRole('button', { name: 'Kopiert' })).toBeInTheDocument();
  });

  it('Schliessen steht unten rechts nach dem optionalen Zurueck; × oben schliesst ebenfalls', () => {
    const onBack = vi.fn();
    const { onClose } = renderDialog({ type: 'xdr', hash: 'h', xdr: 'X', onBack });
    const footerButtons = screen.getByRole('button', { name: 'Zurück' }).parentElement.querySelectorAll('button');
    expect(Array.from(footerButtons).map((b) => b.textContent)).toEqual(['Zurück', 'Schließen']);
    const [closeX, closeBottom] = screen.getAllByRole('button', { name: 'Schließen' });
    fireEvent.click(closeX);
    fireEvent.click(closeBottom);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
  });
});
