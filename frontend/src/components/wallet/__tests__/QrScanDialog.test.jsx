import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import QrScanDialog from '../QrScanDialog.jsx';

function renderDialog(props = {}) {
  const onResult = props.onResult || vi.fn(() => null);
  const onClose = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <QrScanDialog onResult={onResult} onClose={onClose} />
    </I18nextProvider>
  );
  return { onResult, onClose };
}

describe('QrScanDialog', () => {
  afterEach(() => { delete navigator.mediaDevices; });

  it('meldet fehlende Kamera und erlaubt das Einfuegen', async () => {
    const { onResult } = renderDialog();
    await screen.findByText(/keine Kamera verfügbar/);
    fireEvent.change(screen.getByLabelText('Oder Link bzw. Adresse einfügen'), { target: { value: '  web+stellar:pay?destination=G  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onResult).toHaveBeenCalledWith('web+stellar:pay?destination=G');
  });

  it('zeigt den Fehler aus onResult und bleibt offen', async () => {
    renderDialog({ onResult: vi.fn(() => 'Fehler XY') });
    fireEvent.change(screen.getByLabelText('Oder Link bzw. Adresse einfügen'), { target: { value: 'kaputt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(await screen.findByText('Fehler XY')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('meldet eine verweigerte Kamera-Freigabe', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { const e = new Error('nope'); e.name = 'NotAllowedError'; throw e; }) },
    });
    renderDialog();
    await screen.findByText(/Zugriff auf die Kamera wurde nicht erlaubt/);
  });

  it('stoppt die Kamera beim Schliessen', async () => {
    const stop = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <QrScanDialog onResult={() => null} onClose={() => {}} />
      </I18nextProvider>
    );
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });
});
