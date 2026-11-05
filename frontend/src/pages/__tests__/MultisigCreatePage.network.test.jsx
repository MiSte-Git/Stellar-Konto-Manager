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
        // Optional: neues Konto existiert (nach der Aktivierung)
        if (hoisted.otherLoad) return hoisted.otherLoad(pk);
        // Wie Horizon: unbekanntes Konto ist ein 404
        throw Object.assign(new Error('not found'), { response: { status: 404 } });
      },
      submitTransaction: async (tx) => {
        hoisted.submitted += 1;
        hoisted.submittedTxs.push(tx);
        if (hoisted.submitImpl) return hoisted.submitImpl(tx);
        return { hash: 'h' };
      },
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
// Pflicht vor jeder Aktivierung: Secret Key gesichert
const confirmBackup = async (view) => {
  await act(async () => { fireEvent.click(view.getByTestId('create-backup-confirm')); });
};
const notFound = () => Object.assign(new Error('not found'), { response: { status: 404 } });

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
    hoisted.otherLoad = null;
    hoisted.submitImpl = null;
    hoisted.submittedTxs = [];
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

  // Neue Regel: Erzeugte Schluessel verschwinden nur durch eine ausdrueckliche Handlung.
  it('Netzwechsel ohne Aktivierung: Schluessel bleiben mit ihrem Netz, Aktivieren gesperrt; nach Rueckwechsel wieder moeglich', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"hash":"fb"}', { status: 200 }));
    const view = renderPage();
    const { container, getByText, queryByTestId, getByTestId } = view;
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    const pub = container.textContent.match(/G[A-Z2-7]{55}/)?.[0];
    const sec = container.textContent.match(/S[A-Z2-7]{55}/)?.[0];
    expect(pub).toBeTruthy();
    expect(getByTestId('create-keys-network').textContent).toBe(i18n.t('multisigCreate:keys.network', { network: 'Testnet' }));
    await confirmBackup(view);
    expect(queryByTestId('create-network-notice')).toBeNull();
    const activateOnly = () => getByText(i18n.t('multisigCreate:activateOnly')).closest('button');
    const createAll = () => getByText(i18n.t('multisigCreate:createButton')).closest('button');

    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(radio(container, 'PUBLIC').checked).toBe(true);
    expect(container.textContent).toContain(pub);
    expect(container.textContent).toContain(sec);
    expect(getByTestId('create-keys-network').textContent).toBe(i18n.t('multisigCreate:keys.network', { network: 'Testnet' }));
    expect(getByTestId('create-network-notice').textContent).toBe(i18n.t('createAccount:networkChanged.keptKeys', { network: 'Testnet', current: 'Mainnet' }));
    expect(getByTestId('create-keys-locked')).toBeInTheDocument();
    expect(activateOnly()).toBeDisabled();
    expect(createAll()).toBeDisabled();
    // Klick trotz Sperre: weder Friendbot noch Funder-Dialog
    await act(async () => { fireEvent.click(activateOnly()); });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(queryByTestId('funder-confirm')).toBeNull();

    // Gegenprobe: Rueckwechsel, dann geht es normal weiter
    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(queryByTestId('create-network-notice')).toBeNull();
    expect(queryByTestId('create-keys-locked')).toBeNull();
    expect(activateOnly()).not.toBeDisabled();
    await act(async () => { fireEvent.click(activateOnly()); });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(String(fetchSpy.mock.calls[0][0])).toContain(encodeURIComponent(pub));
    fetchSpy.mockRestore();
  });

  it('Schluessel verwerfen: Rueckfrage; Abbrechen behaelt sie, Bestaetigen entfernt sie samt Hinweis', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const view = renderPage();
    const { container, getByText, queryByTestId, getByTestId } = view;
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    const pub = container.textContent.match(/G[A-Z2-7]{55}/)[0];
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    await act(async () => { fireEvent.click(getByTestId('create-keys-discard')); });
    expect(confirmSpy).toHaveBeenCalledWith(i18n.t('multisigCreate:keys.discardConfirm'));
    expect(container.textContent).toContain(pub);

    confirmSpy.mockReturnValue(true);
    await act(async () => { fireEvent.click(getByTestId('create-keys-discard')); });
    expect(container.textContent).not.toContain(pub);
    expect(container.textContent).not.toMatch(/S[A-Z2-7]{55}/);
    expect(queryByTestId('create-network-notice')).toBeNull();
    expect(queryByTestId('create-keys-discard')).toBeNull();
    expect(container.textContent).toContain(i18n.t('multisigCreate:keys.discarded'));
    confirmSpy.mockRestore();
  });

  it('neue Schluessel ersetzen angezeigte nur nach Rueckfrage', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container, getByText } = renderPage();
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    const pub = container.textContent.match(/G[A-Z2-7]{55}/)[0];
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    expect(confirmSpy).toHaveBeenCalledWith(i18n.t('multisigCreate:keys.replaceConfirm'));
    expect(container.textContent).toContain(pub);
    // Gegenprobe: bestaetigt -> neue Schluessel
    confirmSpy.mockReturnValue(true);
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    expect(container.textContent).not.toContain(pub);
    expect(container.textContent).toMatch(/G[A-Z2-7]{55}/);
    confirmSpy.mockRestore();
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
    const view = renderPage();
    const { getByText, findByTestId, container } = view;
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    await confirmBackup(view);
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
    const view = renderPage();
    const { getByText, findByTestId, queryByTestId, container } = view;
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    await confirmBackup(view);
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

  it('Funder-Dialog: Netzwechsel per Event schliesst den Dialog, Schluessel bleiben gesperrt', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const { getByText, findByTestId, queryByTestId, container } = view;
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    const pub = container.textContent.match(/G[A-Z2-7]{55}/)[0];
    await confirmBackup(view);
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:activateOnly'))); });
    await findByTestId('funder-confirm');
    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(queryByTestId('funder-confirm')).toBeNull();
    expect(container.textContent).toContain(pub);
    expect(view.getByTestId('create-network-notice').textContent).toBe(i18n.t('createAccount:networkChanged.keptKeys', { network: 'Mainnet', current: 'Testnet' }));
    expect(hoisted.submitted).toBe(0);
  });
});

// Review N2-1: Nach gesendeter Aktivierung (Erfolg oder unklar) gehoeren die Schluessel zu
// einem womoeglich gefuellten Konto und duerfen beim Netzwechsel nie verworfen werden.
describe('MultisigCreatePage: Schluessel nach gesendeter Aktivierung', () => {
  const COSIGNER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
  let confirmSpy;

  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    window.localStorage.clear();
    hoisted.submitted = 0;
    hoisted.loadedFunder = 0;
    hoisted.funderPub = '';
    hoisted.funderLoad = null;
    hoisted.otherLoad = null;
    hoisted.submitImpl = null;
    hoisted.submittedTxs = [];
    hoisted.activationFailed = false;
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => confirmSpy.mockRestore());

  // Mainnet: Schluessel erzeugen, Multisig mit einem Signer, sofort aktivieren, Funder bestaetigen.
  async function startCreateAll(view, { onNewAccountLoad } = {}) {
    const { getByText, getByLabelText, findByTestId, container } = view;
    const { Account } = await import('@stellar/stellar-sdk');
    hoisted.funderLoad = (pk) => new Account(pk, '1');
    // Neues Konto existiert erst nach der Aktivierung (Live-Pruefung davor: 404)
    hoisted.otherLoad = (pk) => {
      if (hoisted.submitted === 0 || hoisted.activationFailed) throw notFound();
      onNewAccountLoad?.();
      return new Account(pk, '1');
    };
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:generateKeys'))); });
    const pub = container.textContent.match(/G[A-Z2-7]{55}/)[0];
    const sec = container.textContent.match(/S[A-Z2-7]{55}/)[0];
    await act(async () => { fireEvent.click(getByLabelText(i18n.t('multisigCreate:enableMultisig'))); });
    const signerInput = Array.from(container.querySelectorAll('input')).find((i) => i.placeholder === 'G...');
    await act(async () => { fireEvent.change(signerInput, { target: { value: COSIGNER } }); });
    await act(async () => { fireEvent.click(getByLabelText(new RegExp(i18n.t('multisigCreate:activateNow')))); });
    await confirmBackup(view);
    await act(async () => { fireEvent.click(getByText(i18n.t('multisigCreate:createButton'))); });
    await act(async () => { fireEvent.click(await findByTestId('funder-confirm')); });
    return { pub, sec };
  }

  it('Aktivierung gesendet, Netzwechsel vor dem Multisig-Schritt: Schluessel, Adresse und Hash bleiben, Multisig gesperrt; nach Rueckwechsel wieder moeglich', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const { getByTestId, queryByTestId, findByTestId, container } = view;
    let switched = false;
    // Wechsel genau zwischen Aktivierung und Multisig-Schritt (Laden des neuen Kontos)
    const { pub, sec } = await startCreateAll(view, {
      onNewAccountLoad: () => { if (!switched) { switched = true; setGlobalNetwork('TESTNET'); } },
    });
    await waitFor(() => expect(container.textContent).toContain(i18n.t('createAccount:networkChanged.stoppedAfterPartial')));
    expect(hoisted.submitted).toBe(1); // nur die Aktivierung

    // Schluessel, Adresse, Hash mit dem Netz der Aktivierung
    expect(container.textContent).toContain(pub);
    expect(container.textContent).toContain(sec);
    expect(getByTestId('create-activation-pub').textContent).toBe(pub);
    expect(getByTestId('create-activation-hash').textContent).toBe(`${i18n.t('multisigCreate:activation.hash')}: h`);
    expect(getByTestId('create-activation').textContent).toContain(i18n.t('multisigCreate:activation.title', { network: 'Mainnet' }));
    expect(getByTestId('create-activation-backup').textContent).toBe(i18n.t('multisigCreate:activation.backupNow'));
    expect(getByTestId('create-network-notice').textContent).toBe(i18n.t('createAccount:networkChanged.keptActivated', { network: 'Mainnet' }));
    // Weitere Schritte gesperrt
    expect(getByTestId('create-activation-locked')).toBeInTheDocument();
    expect(queryByTestId('create-activation-set-multisig')).toBeNull();
    expect(view.getByText(i18n.t('multisigCreate:createButton')).closest('button')).toBeDisabled();

    // Rueckwechsel: Multisig nachholen
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(queryByTestId('create-activation-locked')).toBeNull();
    const setButton = await findByTestId('create-activation-set-multisig');
    await act(async () => { fireEvent.click(setButton); });
    await waitFor(() => expect(hoisted.submitted).toBe(2));
    const setOptions = hoisted.submittedTxs[1];
    expect(setOptions.source).toBe(pub);
    expect(setOptions.operations.map((o) => o.type)).toEqual(['setOptions', 'setOptions']);
    expect(container.textContent).toContain(i18n.t('multisigCreate:createdAndConfigured', { hash: 'h' }));
    expect(queryByTestId('create-activation-set-multisig')).toBeNull();
  });

  it('unklarer Ausgang der Aktivierung zaehlt wie gesendet: Schluessel bleiben beim Netzwechsel', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    // Keine Antwort von Horizon (Timeout): Konto kann existieren
    hoisted.submitImpl = async () => { throw new Error('timeout'); };
    hoisted.activationFailed = true; // im Netz (noch) nicht sichtbar
    const view = renderPage();
    const { pub, sec } = await startCreateAll(view);
    await waitFor(() => expect(view.container.textContent).toContain('timeout'));
    expect(view.getByTestId('create-activation').textContent).toContain(i18n.t('multisigCreate:activation.statusAmbiguous'));

    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.container.textContent).toContain(sec);
    expect(view.getByTestId('create-activation-locked')).toBeInTheDocument();
    expect(view.getByTestId('create-network-notice').textContent).toBe(i18n.t('createAccount:networkChanged.keptActivated', { network: 'Mainnet' }));
  });

  it('eindeutig abgelehnte Aktivierung: Vermerk weg, Schluessel bleiben beim Netzwechsel gesperrt', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    hoisted.activationFailed = true;
    hoisted.submitImpl = async () => {
      throw Object.assign(new Error('rejected'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } } });
    };
    const view = renderPage();
    const { pub } = await startCreateAll(view);
    await waitFor(() => expect(view.container.textContent).toContain('rejected'));
    expect(view.queryByTestId('create-activation')).toBeNull();
    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-keys-locked')).toBeInTheDocument();
    expect(view.getByTestId('create-network-notice').textContent).toBe(i18n.t('createAccount:networkChanged.keptKeys', { network: 'Mainnet', current: 'Testnet' }));
  });

  it('ohne Aktivierung bleiben die Schluessel beim Netzwechsel, Multisig-Erstellen gesperrt', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    await act(async () => { fireEvent.click(view.getByText(i18n.t('multisigCreate:generateKeys'))); });
    const pub = view.container.textContent.match(/G[A-Z2-7]{55}/)[0];
    await confirmBackup(view);
    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.queryByTestId('create-activation')).toBeNull();
    expect(view.getByText(i18n.t('multisigCreate:createButton')).closest('button')).toBeDisabled();
    expect(view.getByTestId('create-network-notice').textContent).toBe(i18n.t('createAccount:networkChanged.keptKeys', { network: 'Mainnet', current: 'Testnet' }));
    expect(hoisted.submitted).toBe(0);
  });
});
