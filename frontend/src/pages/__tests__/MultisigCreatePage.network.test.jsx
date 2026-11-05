import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import MultisigCreatePage from '../MultisigCreatePage.jsx';
import { setGlobalNetwork } from '../../utils/globalNetwork.js';

// Kein echter Horizon-Aufruf: Reserve des neuen Netzes kommt aus dem Stub.
const hoisted = vi.hoisted(() => ({ urls: [] }));
vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: (url) => {
    hoisted.urls.push(url);
    return {
      ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ base_reserve_in_stroops: 5000000 }] }) }) }) }),
    };
  },
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MultisigCreatePage />
    </I18nextProvider>
  );
}

const radio = (container, value) => container.querySelector(`input[name="network"][value="${value}"]`);

describe('MultisigCreatePage: Netzschalter ist der globale Netzschalter', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    window.localStorage.clear();
    hoisted.urls.length = 0;
  });

  it.each(['TESTNET', 'PUBLIC'])('startet mit dem globalen Netz %s', (network) => {
    window.localStorage.setItem('SKM_NETWORK', network);
    const { container } = renderPage();
    expect(radio(container, network).checked).toBe(true);
    expect(radio(container, network === 'TESTNET' ? 'PUBLIC' : 'TESTNET').checked).toBe(false);
  });

  it('Wechsel auf der Seite setzt das globale Netz wie die Testnet-Checkbox', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const events = [];
    const listener = (e) => events.push(e.detail);
    window.addEventListener('stm-network-changed', listener);
    const { container } = renderPage();

    await act(async () => { fireEvent.click(radio(container, 'TESTNET')); });
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe('TESTNET');
    expect(window.localStorage.getItem('SKM_HORIZON_URL')).toBe('https://horizon-testnet.stellar.org');
    expect(radio(container, 'TESTNET').checked).toBe(true);

    await act(async () => { fireEvent.click(radio(container, 'PUBLIC')); });
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe('PUBLIC');
    expect(window.localStorage.getItem('SKM_HORIZON_URL')).toBeNull();
    window.removeEventListener('stm-network-changed', listener);
    expect(events).toEqual(['TESTNET', 'PUBLIC']);
  });

  it('folgt einem globalen Wechsel von anderer Stelle und laedt die Reserve des neuen Netzes', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const { container } = renderPage();
    expect(radio(container, 'PUBLIC').checked).toBe(true);

    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(radio(container, 'TESTNET').checked).toBe(true);
    await waitFor(() => expect(hoisted.urls).toContain('https://horizon-testnet.stellar.org'));

    // Anderer Tab: nur localStorage, kein Event in diesem Fenster
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'SKM_NETWORK', newValue: 'PUBLIC' })); });
    expect(radio(container, 'PUBLIC').checked).toBe(true);
  });

  it('behaelt generierte Schluessel bei einem Netzwechsel (bisheriges Verhalten)', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container, getByText } = renderPage();
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    const pub = container.textContent.match(/G[A-Z2-7]{55}/)?.[0];
    expect(pub).toBeTruthy();
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(radio(container, 'PUBLIC').checked).toBe(true);
    expect(container.textContent).toContain(pub);
  });
});
