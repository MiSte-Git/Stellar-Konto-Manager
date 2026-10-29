import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import MultisigSigningOptions from '../MultisigSigningOptions.jsx';

function renderOptions(props = {}) {
  const handlers = { onChoiceChange: vi.fn(), onProceed: vi.fn(), onCancel: vi.fn() };
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MultisigSigningOptions open choice="job" {...handlers} {...props}>
        <div data-testid="summary">Zusammenfassung</div>
      </MultisigSigningOptions>
    </I18nextProvider>
  );
  return { ...view, ...handlers };
}

describe('MultisigSigningOptions', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('rendert nichts, wenn geschlossen', () => {
    renderOptions({ open: false });
    expect(screen.queryByText('Option wählen')).toBeNull();
  });

  it('zeigt Titel, Zusammenfassung und die drei Optionen, Job mit Empfohlen-Badge', () => {
    renderOptions();
    expect(screen.getByText('Option wählen')).toBeInTheDocument();
    expect(screen.getByTestId('summary')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.value)).toEqual(['job', 'local', 'xdr']);
    expect(screen.getByRole('radio', { name: /Multisig-Job erstellen \(Standard\)/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Alle Signaturen lokal eingeben/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /XDR exportieren \(nicht senden\)/ })).not.toBeChecked();
    const jobLabel = screen.getByRole('radio', { name: /Multisig-Job erstellen/ }).closest('label');
    expect(within(jobLabel).getByText('Empfohlen')).toBeInTheDocument();
    expect(screen.getAllByText('Empfohlen')).toHaveLength(1);
  });

  it('meldet Auswahl, Weiter und Abbrechen (auch ueber das ×)', () => {
    const { onChoiceChange, onProceed, onCancel } = renderOptions();
    fireEvent.click(screen.getByRole('radio', { name: /XDR exportieren/ }));
    expect(onChoiceChange).toHaveBeenCalledWith('xdr');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(onProceed).toHaveBeenCalledTimes(1);
    const [closeX, cancelButton] = screen.getAllByRole('button', { name: 'Abbrechen' });
    fireEvent.click(closeX);
    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('sperrt Weiter per proceedDisabled und bei gewaehlter gesperrter Option', () => {
    const { rerender } = renderOptions({ proceedDisabled: true });
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
    rerender(
      <I18nextProvider i18n={i18n}>
        <MultisigSigningOptions open choice="xdr" onChoiceChange={() => {}} onProceed={() => {}} onCancel={() => {}} disabledOptions={['xdr']} />
      </I18nextProvider>
    );
    expect(screen.getByRole('radio', { name: /XDR exportieren/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
  });

  it('oeffnet und schliesst den Erklaerdialog; nach dem Schliessen des Optionsdialogs ist er beim naechsten Oeffnen zu', () => {
    const { rerender } = renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(screen.getByText('Optionen erklärt')).toBeInTheDocument();
    const closeButtons = screen.getAllByRole('button', { name: 'Schließen' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByText('Optionen erklärt')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    const wrap = (open) => (
      <I18nextProvider i18n={i18n}>
        <MultisigSigningOptions open={open} choice="job" onChoiceChange={() => {}} onProceed={() => {}} onCancel={() => {}} />
      </I18nextProvider>
    );
    rerender(wrap(false));
    rerender(wrap(true));
    expect(screen.queryByText('Optionen erklärt')).toBeNull();
  });
});
