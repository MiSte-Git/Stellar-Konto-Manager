import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import ReceivePage from '../ReceivePage.jsx';
import { groupAddress } from '../../utils/stellar/walletSummary.js';

const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const MUXED = 'MATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAAAAAAAAAAAAAPN2YQ';

function renderPage(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ReceivePage {...props} />
    </I18nextProvider>
  );
}

describe('ReceivePage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    window.localStorage.clear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('teilt Adressen in 4er-Gruppen', () => {
    expect(groupAddress('GABCDEFGHIJ')).toEqual(['GABC', 'DEFG', 'HIJ']);
    expect(groupAddress(PK).join('')).toBe(PK);
  });

  it('zeigt ohne Konto einen Hinweis', () => {
    renderPage({ publicKey: '' });
    expect(screen.getByTestId('receive-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-code')).toBeNull();
  });

  it('zeigt QR-Code und Adresse und kopiert die Adresse', async () => {
    renderPage({ publicKey: PK });
    expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    expect(screen.getByTestId('receive-address')).toHaveAttribute('aria-label', PK);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Adresse kopieren/ }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PK);
    expect(screen.getByRole('status')).toHaveTextContent('Kopiert');
  });

  it('wechselt bei Muxed-Identitaet zwischen M- und G-Adresse', () => {
    renderPage({ publicKey: PK, muxedAddress: MUXED });
    expect(screen.getByTestId('receive-address')).toHaveAttribute('aria-label', MUXED);
    fireEvent.click(screen.getByRole('button', { name: /Basiskonto/ }));
    expect(screen.getByTestId('receive-address')).toHaveAttribute('aria-label', PK);
  });

  it('markiert die ersten und letzten 8 Zeichen fett, auch bei M-Adressen', () => {
    const strongText = () => Array.from(
      screen.getByTestId('receive-address').querySelectorAll('[data-strong="true"]')
    ).map((el) => el.textContent).join('');
    renderPage({ publicKey: PK, muxedAddress: MUXED });
    expect(strongText()).toBe(MUXED.slice(0, 8) + MUXED.slice(-8));
    fireEvent.click(screen.getByRole('button', { name: /Basiskonto/ }));
    expect(strongText()).toBe(PK.slice(0, 8) + PK.slice(-8));
    expect(screen.getByTestId('receive-address').textContent.replace(/\s/g, '')).toBe(PK);
  });

  it('warnt im Testnet', () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    renderPage({ publicKey: PK });
    expect(screen.getByText(/Du bist im Testnet/)).toBeInTheDocument();
  });
});
