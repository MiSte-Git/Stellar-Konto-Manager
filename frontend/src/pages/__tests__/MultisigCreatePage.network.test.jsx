import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import MultisigCreatePage from '../MultisigCreatePage.jsx';
import { setGlobalNetwork } from '../../utils/globalNetwork.js';
import { resetServerNetworkCalls, serverNetworkCalls } from '../../test/horizonMock.js';

// Kein echter Horizon-Aufruf: Reserve des neuen Netzes kommt aus dem Stub.
const hoisted = vi.hoisted(() => ({ urls: [], submitted: 0, loadedFunder: 0, funderSecret: '' }));
vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await importOriginal()),
  getHorizonServer: (url) => {
    hoisted.urls.push(url);
    return {
      ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ base_reserve_in_stroops: 5000000 }] }) }) }) }),
      // Neues Konto existiert noch nicht; ein Laden des Funders zaehlt als Versuch
      loadAccount: async (pk) => {
        if (pk && pk === hoisted.funderPub) {
          hoisted.loadedFunder += 1;
          // Optional: Funder existiert (Test fuer einen Wechsel waehrend des Ladens)
          if (hoisted.funderLoad) return hoisted.funderLoad(pk);
        }
        throw new Error('not found');
      },
      submitTransaction: async () => { hoisted.submitted += 1; return { hash: 'h' }; },
    };
  },
}));
// Funder-Dialog ersetzen: ein Klick bestaetigt mit einem Test-Keypair
vi.mock('../../components/SecretKeyModal.jsx', async () => {
  const { Keypair } = await import('@stellar/stellar-sdk');
  return {
    default: ({ onConfirm }) => (
      <button
        type="button"
        data-testid="funder-confirm"
        onClick={() => {
          const kp = Keypair.random();
          hoisted.funderPub = kp.publicKey();
          onConfirm([{ keypair: kp, publicKey: kp.publicKey(), weight: 1 }]);
        }}
      >
        confirm
      </button>
    ),
  };
});

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
    hoisted.submitted = 0;
    hoisted.loadedFunder = 0;
    hoisted.funderPub = '';
    hoisted.funderLoad = null;
    resetServerNetworkCalls();
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

  });

  it('verwirft generierte Schluessel bei einem Netzwechsel und zeigt einen Hinweis', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container, getByText, queryByTestId } = renderPage();
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    const pub = container.textContent.match(/G[A-Z2-7]{55}/)?.[0];
    expect(pub).toBeTruthy();
    expect(queryByTestId('create-network-notice')).toBeNull();
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(radio(container, 'PUBLIC').checked).toBe(true);
    expect(container.textContent).not.toContain(pub);
    expect(container.textContent).not.toMatch(/S[A-Z2-7]{55}/);
    expect(queryByTestId('create-network-notice').textContent).toBe(i18n.t('createAccount:networkChanged.reset'));
    // Neue Schluessel fuer das neue Netz blenden den Hinweis aus
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    expect(queryByTestId('create-network-notice')).toBeNull();
  });

  it('ohne erzeugte Schluessel bleibt der Netzwechsel ohne Hinweis', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { queryByTestId } = renderPage();
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(queryByTestId('create-network-notice')).toBeNull();
  });

  it('Funder: Server mit dem Netz der Seite; Wechsel waehrend das Funder-Konto laedt: nichts signiert', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const { Account } = await import('@stellar/stellar-sdk');
    hoisted.funderLoad = (pk) => {
      // Anderer Tab wechselt, waehrend Horizon antwortet; Event noch nicht hier.
      window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
      return new Account(pk, '1');
    };
    const { getByText, findByTestId, container } = renderPage();
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:activateOnly'))); });
    const confirm = await findByTestId('funder-confirm');
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(() => expect(container.textContent).toContain(i18n.t('createAccount:networkChanged.funderAborted')));
    expect(hoisted.loadedFunder).toBe(1);
    expect(hoisted.submitted).toBe(0);
    expect(serverNetworkCalls.length).toBeGreaterThan(0);
    expect(serverNetworkCalls.every((n) => n === 'PUBLIC')).toBe(true);
  });

  it('Funder-Dialog: bricht ab, wenn das Netz seit dem Oeffnen gewechselt hat', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const { getByText, findByTestId, queryByTestId, container } = renderPage();
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:activateOnly'))); });
    const confirm = await findByTestId('funder-confirm');
    // Wechsel ohne Event in diesem Fenster (z. B. anderer Tab vor der Weiterleitung)
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    await act(async () => { fireEvent.click(confirm); });
    expect(hoisted.submitted).toBe(0);
    expect(hoisted.loadedFunder).toBe(0);
    expect(container.textContent).toContain(i18n.t('createAccount:networkChanged.funderAborted'));
    expect(queryByTestId('funder-confirm')).toBeNull();
  });

  it('Funder-Dialog: Netzwechsel per Event schliesst den Dialog und verwirft die Schluessel', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const { getByText, findByTestId, queryByTestId } = renderPage();
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:activateOnly'))); });
    await findByTestId('funder-confirm');
    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(queryByTestId('funder-confirm')).toBeNull();
    expect(queryByTestId('create-network-notice')).not.toBeNull();
    expect(hoisted.submitted).toBe(0);
  });
});
