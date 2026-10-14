import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';
import i18n from '../../../i18n.js';
import AppLayout from '../AppLayout.jsx';
import { publishActiveMainView, setMainMounted } from '../../../utils/appNavigation.js';

function renderLayout() {
  return render(
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <AppLayout>
          <div>Inhalt</div>
        </AppLayout>
      </BrowserRouter>
    </I18nextProvider>
  );
}

function desktopNav() {
  return within(screen.getByTestId('sidebar-desktop'));
}

describe('AppLayout / Sidebar', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    setMainMounted(true);
    act(() => publishActiveMainView(null));
  });

  afterEach(() => {
    setMainMounted(false);
  });

  it('rendert Abschnitte und markiert Wallet als Startseite', () => {
    renderLayout();
    const nav = desktopNav();
    expect(nav.getByText('Konto')).toBeInTheDocument();
    expect(nav.getByText('Erweitert')).toBeInTheDocument();
    expect(nav.getByText('Lernen')).toBeInTheDocument();
    const wallet = nav.getByRole('button', { name: 'Wallet' });
    expect(wallet).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });

  it('blendet Spenden aus, solange SHOW_DONATE_BUTTON aus ist', () => {
    renderLayout();
    expect(desktopNav().queryByRole('button', { name: 'Spenden' })).toBeNull();
  });

  it('oeffnet Main-Ansichten ueber stm:openMenu', () => {
    renderLayout();
    const received = [];
    const handler = (e) => received.push(e.detail);
    window.addEventListener('stm:openMenu', handler);
    fireEvent.click(desktopNav().getByRole('button', { name: 'Zahlung senden' }));
    window.removeEventListener('stm:openMenu', handler);
    expect(received).toEqual(['sendPayment']);
  });

  it('folgt der aktiven Main-Ansicht (inkl. Unteransichten)', () => {
    renderLayout();
    act(() => publishActiveMainView('deleteByIssuer'));
    expect(desktopNav().getByRole('button', { name: 'Meine Token-Freigaben' })).toHaveAttribute('aria-current', 'page');
    expect(desktopNav().getByRole('button', { name: 'Wallet' })).not.toHaveAttribute('aria-current');
  });

  it('navigiert zu eigenen Routen und markiert sie aktiv', () => {
    renderLayout();
    fireEvent.click(desktopNav().getByRole('button', { name: 'Quiz' }));
    expect(window.location.pathname).toMatch(/\/quiz$/);
    expect(desktopNav().getByRole('button', { name: 'Quiz' })).toHaveAttribute('aria-current', 'page');
  });

  it('Drawer: oeffnen, Fokus, Escape und Overlay schliessen', () => {
    renderLayout();
    const burger = screen.getByRole('button', { name: 'Navigation öffnen' });
    fireEvent.click(burger);
    const dialog = screen.getByRole('dialog');
    expect(burger).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Wallet' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(burger);

    fireEvent.click(burger);
    fireEvent.click(screen.getByTestId('sidebar-overlay'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Drawer schliesst nach Auswahl eines Eintrags', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Token-Käufe' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
