import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import MultisigCreatePage, { FRIENDBOT_TIMEOUT_MS } from '../MultisigCreatePage.jsx';
import { setGlobalNetwork } from '../../utils/globalNetwork.js';
import { confirmNavigation, hasNavigationGuard } from '../../utils/navigationGuard.js';
import { SESSION_LOCKED_EVENT } from '../../utils/sessionSecrets.js';

// Review N21-1 bis N21-4 und Sicherung des Secret Keys auf "Neues Konto erstellen".
// Grundsatz: Der Secret Key eines Kontos, fuer das eine Aktivierung gesendet wurde oder
// gesendet worden sein koennte, verschwindet nicht, bevor der Nutzer die Sicherung bestaetigt.
const hoisted = vi.hoisted(() => ({}));
vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ base_reserve_in_stroops: 5000000 }] }) }) }) }),
    loadAccount: async (pk) => {
      hoisted.loads.push(pk);
      // Optional: Antwort von Horizon zurueckhalten (Fenster vor dem Senden)
      if (hoisted.loadGate) await hoisted.loadGate;
      if (pk === hoisted.funderPub) {
        const { Account } = await import('@stellar/stellar-sdk');
        return new Account(pk, '1');
      }
      if (hoisted.existing.has(pk)) {
        const { Account } = await import('@stellar/stellar-sdk');
        return new Account(pk, '1');
      }
      throw Object.assign(new Error('not found'), { response: { status: 404 } });
    },
    submitTransaction: async (tx) => {
      hoisted.submitted += 1;
      if (hoisted.submitImpl) return hoisted.submitImpl(tx);
      return { hash: 'h' };
    },
  }),
}));
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

const tx = (key, opts) => i18n.t(key, opts);
const FRIENDBOT = 'https://friendbot.stellar.org';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MultisigCreatePage />
    </I18nextProvider>
  );
}

async function generate(view) {
  await act(async () => { fireEvent.click(view.getByText(tx('multisigCreate:generateKeys'))); });
  const pub = view.container.textContent.match(/G[A-Z2-7]{55}/)[0];
  const sec = view.container.textContent.match(/S[A-Z2-7]{55}/)[0];
  return { pub, sec };
}
const confirmBackup = (view) => act(async () => { fireEvent.click(view.getByTestId('create-backup-confirm')); });
const activateOnlyButton = (view) => view.getByText(tx('multisigCreate:activateOnly')).closest('button');
const createButton = (view) => view.getByText(tx('multisigCreate:createButton')).closest('button');
const clickActivateOnly = (view) => act(async () => { fireEvent.click(activateOnlyButton(view)); });
const friendbotCalls = () => globalThis.fetch.mock.calls.filter(([url]) => String(url).startsWith(FRIENDBOT));

function mockFriendbot(...responses) {
  // Je Aufruf die naechste Antwort: Response, Error (Netzfehler) oder Funktion
  const queue = [...responses];
  globalThis.fetch.mockImplementation(async (url) => {
    if (!String(url).startsWith(FRIENDBOT)) return new Response('{}', { status: 200 });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url);
    return next.clone();
  });
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  window.localStorage.clear();
  hoisted.loads = [];
  hoisted.existing = new Set();
  hoisted.submitted = 0;
  hoisted.submitImpl = null;
  hoisted.funderPub = '';
  hoisted.loadGate = null;
  vi.spyOn(globalThis, 'fetch');
  // Rueckfragen (neue Schluessel ersetzen) bestaetigen
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Checkbox: Secret Key gesichert ist Pflicht vor jeder Aktivierung', () => {
  it.each(['TESTNET', 'PUBLIC'])('%s: ohne Haken gesperrt, mit Haken moeglich; neue Schluessel setzen den Haken zurueck', async (network) => {
    window.localStorage.setItem('SKM_NETWORK', network);
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await generate(view);
    expect(activateOnlyButton(view)).toBeDisabled();
    expect(createButton(view)).toBeDisabled();
    // Klick trotz Sperre: nichts passiert
    await clickActivateOnly(view);
    expect(friendbotCalls()).toHaveLength(0);
    expect(view.queryByTestId('funder-confirm')).toBeNull();

    // Gegenprobe: mit Haken geht es
    await confirmBackup(view);
    expect(activateOnlyButton(view)).not.toBeDisabled();
    expect(createButton(view)).not.toBeDisabled();
    await clickActivateOnly(view);
    if (network === 'TESTNET') {
      await waitFor(() => expect(friendbotCalls()).toHaveLength(1));
    } else {
      await view.findByTestId('funder-confirm');
    }

    // Neue Schluessel: Haken weg
    await generate(view);
    expect(view.getByTestId('create-backup-confirm').checked).toBe(false);
    expect(activateOnlyButton(view)).toBeDisabled();
  });
});

describe('Secret Key: Kopieren und Verbergen', () => {
  it('kopiert den Secret Key und kann ihn verbergen und wieder anzeigen', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const view = renderPage();
    const { sec } = await generate(view);
    await act(async () => { fireEvent.click(view.getByTestId('create-secret-copy')); });
    expect(writeText).toHaveBeenCalledWith(sec);
    expect(view.getByTestId('create-secret-copy-status').textContent).toBe(tx('multisigCreate:secretKey.copied'));

    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-secret').textContent).not.toContain(sec);
    expect(view.container.textContent).not.toContain(sec);
    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
  });
});

describe('Sitzungssperre: Secret Key verbergen, nicht verwerfen', () => {
  it('skm:session-locked verbirgt den Key; Seite, Vermerk und Waechter bleiben; Anzeigen zeigt ihn wieder', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    const { pub, sec } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation')).toBeInTheDocument());

    await act(async () => { window.dispatchEvent(new CustomEvent(SESSION_LOCKED_EVENT)); });
    expect(view.container.textContent).not.toContain(sec);
    expect(view.getByTestId('create-secret').textContent).toBe('•'.repeat(sec.length));
    expect(view.getByTestId('create-secret-toggle').textContent).toBe(tx('multisigCreate:secretKey.show'));
    // Seite, Adresse, Vermerk und Waechter unveraendert
    expect(view.getByTestId('create-activation-pub').textContent).toBe(pub);
    expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess'));
    expect(view.getByTestId('create-backup-confirm').checked).toBe(true);
    expect(hasNavigationGuard()).toBe(true);

    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
  });

  it('Gegenprobe: ohne Sperr-Ereignis bleibt der Key sichtbar, andere Ereignisse verbergen ihn nicht', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    const { sec } = await generate(view);
    await act(async () => { window.dispatchEvent(new CustomEvent('stm-session-secret-changed', { detail: {} })); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    expect(view.getByTestId('create-secret-toggle').textContent).toBe(tx('multisigCreate:secretKey.hide'));
  });
});

describe('N21-1: Vermerk bleibt, kein zweiter Versand nach unklarem Ausgang', () => {
  it('Testnet: Friendbot ohne Antwort, zweiter Klick auf Nur aktivieren sendet nicht, Netzwechsel verwirft nicht', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(new TypeError('Failed to fetch'), json(400, { detail: 'account already funded to starting balance' }));
    const view = renderPage();
    const { pub, sec } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));

    await clickActivateOnly(view);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.stillUnclear')));
    expect(friendbotCalls()).toHaveLength(1);
    expect(view.getByTestId('create-activation')).toBeInTheDocument();

    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.container.textContent).toContain(sec);
    expect(view.getByTestId('create-network-notice').textContent).toBe(tx('createAccount:networkChanged.keptActivated', { network: 'Testnet' }));
  });

  it('Mainnet: Horizon-Timeout, zweiter Klick oeffnet keinen Funder-Dialog und sendet nichts', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    hoisted.submitImpl = async () => { throw new Error('timeout'); };
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await act(async () => { fireEvent.click(await view.findByTestId('funder-confirm')); });
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));
    expect(hoisted.submitted).toBe(1);

    await clickActivateOnly(view);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.stillUnclear')));
    expect(view.queryByTestId('funder-confirm')).toBeNull();
    expect(hoisted.submitted).toBe(1);
    // Live geprueft, bevor entschieden wurde
    expect(hoisted.loads.filter((pk) => pk === pub).length).toBeGreaterThanOrEqual(2);

    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(view.container.textContent).toContain(pub);
  });

  it('Konto existiert inzwischen: zweiter Versuch wertet es als aktiviert und sendet nicht', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(new TypeError('Failed to fetch'));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));
    hoisted.existing.add(pub); // erste Anfrage kam doch an
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(view.container.textContent).toContain(tx('multisigCreate:alreadyActive'));
    expect(friendbotCalls()).toHaveLength(1);
  });

  it('Erstellen: vor der Aktivierung live geprueft, existierendes Konto wird nicht erneut aktiviert', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    const { pub } = await generate(view);
    hoisted.existing.add(pub);
    await act(async () => { fireEvent.click(view.getByLabelText(new RegExp(tx('multisigCreate:activateNow')))); });
    await confirmBackup(view);
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(friendbotCalls()).toHaveLength(0);

    // Gegenprobe: Konto existiert nicht -> Erstellen aktiviert ueber Friendbot
    // ("Sofort aktivieren" bleibt beim Erzeugen neuer Schluessel gesetzt)
    await generate(view);
    expect(view.getByLabelText(new RegExp(tx('multisigCreate:activateNow'))).checked).toBe(true);
    await confirmBackup(view);
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(friendbotCalls()).toHaveLength(1));
  });
});

describe('N21-2: Friendbot-Antworten', () => {
  it.each([
    [500, 'Internal Server Error'],
    [502, '<html>Bad Gateway</html>'],
    [429, '{"detail":"rate limit exceeded"}'],
  ])('Status %s zaehlt als unklar: Vermerk bleibt, Netzwechsel verwirft nicht', async (status, body) => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(new Response(body, { status }));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));
    expect(view.container.textContent).toContain(tx('multisigCreate:activation.friendbotUnclear', { status }));
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(view.container.textContent).toContain(pub);
  });

  it('400 mit "Konto existiert" zaehlt als aktiviert', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(400, { status: 400, detail: 'createAccountAlreadyExist' }));
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(view.container.textContent).toContain(tx('multisigCreate:alreadyActive'));
  });

  it('Gegenprobe: 400 mit Fehlertext und Konto existiert nicht: abgelehnt, Netzwechsel behaelt die Schluessel ohne Vermerk', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(400, { status: 400, detail: 'invalid address' }));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.friendbotRejected', { status: 400 })));
    expect(view.queryByTestId('create-activation')).toBeNull();
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-network-notice').textContent).toBe(tx('createAccount:networkChanged.keptKeys', { network: 'Testnet', current: 'Mainnet' }));
  });

  it('400 mit Fehlertext, Konto existiert aber live: aktiviert, nicht abgelehnt', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    const { pub } = await generate(view);
    mockFriendbot(() => { hoisted.existing.add(pub); return json(400, { detail: 'transaction failed' }); });
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
  });
});

describe('N21-4: eindeutige Ablehnung nach Netzwechsel', () => {
  function pendingSubmit() {
    let reject;
    hoisted.submitImpl = () => new Promise((_, r) => { reject = r; });
    const rejection = () => Object.assign(new Error('rejected'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } } });
    return () => reject(rejection());
  }

  async function startMainnetActivation(view) {
    const keys = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await act(async () => { fireEvent.click(await view.findByTestId('funder-confirm')); });
    await waitFor(() => expect(hoisted.submitted).toBe(1));
    return keys;
  }

  it('Ablehnung kommt nach dem Wechsel: Vermerk weg, Schluessel bleiben gesperrt, Hinweis wie ohne Aktivierung', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const rejectNow = pendingSubmit();
    const view = renderPage();
    const { pub } = await startMainnetActivation(view);
    // Waehrend die Aktivierung laeuft: Wechsel behaelt die Schluessel
    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-network-notice').textContent).toBe(tx('createAccount:networkChanged.keptActivated', { network: 'Mainnet' }));

    await act(async () => { rejectNow(); });
    await waitFor(() => expect(view.queryByTestId('create-activation')).toBeNull());
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-network-notice').textContent).toBe(tx('createAccount:networkChanged.keptKeys', { network: 'Mainnet', current: 'Testnet' }));
    expect(view.getByTestId('create-keys-locked')).toBeInTheDocument();
    // Waechter bleibt: Schluessel verschwinden nur durch den Nutzer
    expect(hasNavigationGuard()).toBe(true);
  });

  it('Gegenprobe: Ablehnung ohne Netzwechsel: Vermerk weg, Schluessel bleiben im selben Netz', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const rejectNow = pendingSubmit();
    const view = renderPage();
    const { pub } = await startMainnetActivation(view);
    await act(async () => { rejectNow(); });
    await waitFor(() => expect(view.queryByTestId('create-activation')).toBeNull());
    expect(view.container.textContent).toContain(pub);
    expect(view.queryByTestId('create-network-notice')).toBeNull();
  });
});

describe('Verlassen der Seite: beforeunload und Fertig, Key gesichert', () => {
  const beforeUnloadPrevented = () => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it('Waechter ab dem Erzeugen; mit Vermerk weiter gesetzt; nach Fertig entfernt und Key weg', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    // Gegenprobe: ohne Schluessel kein Waechter
    expect(beforeUnloadPrevented()).toBe(false);
    expect(hasNavigationGuard()).toBe(false);
    const { sec } = await generate(view);
    // KS-2: schon nur erzeugt (nichts gesendet) gesetzt
    expect(beforeUnloadPrevented()).toBe(true);
    expect(hasNavigationGuard()).toBe(true);

    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(beforeUnloadPrevented()).toBe(true);
    expect(hasNavigationGuard()).toBe(true);

    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    expect(beforeUnloadPrevented()).toBe(false);
    expect(hasNavigationGuard()).toBe(false);
    expect(view.container.textContent).not.toContain(sec);
    expect(view.container.textContent).toContain(tx('multisigCreate:activation.finished'));
  });

  it('Unmount meldet den Waechter ab', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(hasNavigationGuard()).toBe(true));
    view.unmount();
    expect(hasNavigationGuard()).toBe(false);
    expect(beforeUnloadPrevented()).toBe(false);
  });
});

// KS-1: Fenster zwischen Klick und Vermerk (Horizon-Aufrufe). Der Waechter haelt die Seite;
// wird sie trotzdem ausgehaengt, sendet der laufende Ablauf nichts mehr.
describe('KS-1: Seite verlassen, bevor die Aktivierung gesendet ist', () => {
  function holdHorizon() {
    let release;
    hoisted.loadGate = new Promise((r) => { release = r; });
    return () => { hoisted.loadGate = null; release(); };
  }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

  async function confirmFunderAndHold(view) {
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    const confirmButton = await view.findByTestId('funder-confirm');
    const release = holdHorizon();
    await act(async () => { fireEvent.click(confirmButton); });
    await waitFor(() => expect(hoisted.loads).toContain(hoisted.funderPub));
    return release;
  }

  it('Mainnet: Funder bestaetigt, waehrend der Horizon-Aufrufe fragt ein Menuewechsel nach', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const release = await confirmFunderAndHold(view);
    window.confirm.mockReturnValue(false);
    // main.jsx fragt bei jedem Menuewechsel ueber confirmNavigation()
    expect(confirmNavigation()).toBe(false);
    expect(window.confirm).toHaveBeenLastCalledWith(tx('multisigCreate:leaveGuard.confirmKeys'));
    expect(beforeUnloadPrevented()).toBe(true);
    // Gegenprobe: ohne Aushaengen laeuft der Ablauf zu Ende und sendet einmal
    release();
    await waitFor(() => expect(hoisted.submitted).toBe(1));
    await waitFor(() => expect(view.getByTestId('create-activation')).toBeInTheDocument());
  });

  it('Mainnet: erzwungenes Aushaengen waehrend der Horizon-Aufrufe: danach wird nichts gesendet', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const release = await confirmFunderAndHold(view);
    view.unmount();
    expect(hasNavigationGuard()).toBe(false);
    release();
    await settle();
    expect(hoisted.submitted).toBe(0);
  });

  it('Testnet: Aushaengen waehrend der Live-Pruefung: Friendbot wird nicht aufgerufen', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    const release = holdHorizon();
    await clickActivateOnly(view);
    await waitFor(() => expect(hoisted.loads).toContain(pub));
    view.unmount();
    release();
    await settle();
    expect(friendbotCalls()).toHaveLength(0);
  });

  const beforeUnloadPrevented = () => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
});

// KS-2: Schluessel ohne Aktivierung durch SKM (Adresse kann von aussen gefuellt werden)
describe('KS-2: Waechter fuer erzeugte Schluessel ohne Aktivierung', () => {
  const beforeUnloadPrevented = () => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it('Menuewechsel und Reload fragen nach; nach Schluessel verwerfen nicht mehr', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const { sec } = await generate(view);
    window.confirm.mockReturnValue(false);
    expect(confirmNavigation()).toBe(false);
    expect(window.confirm).toHaveBeenLastCalledWith(tx('multisigCreate:leaveGuard.confirmKeys'));
    expect(beforeUnloadPrevented()).toBe(true);
    expect(view.getByTestId('create-secret').textContent).toBe(sec);

    // Verwerfen abgebrochen: alles bleibt
    await act(async () => { fireEvent.click(view.getByTestId('create-keys-discard')); });
    expect(hasNavigationGuard()).toBe(true);
    expect(view.getByTestId('create-secret').textContent).toBe(sec);

    // Gegenprobe: Verwerfen bestaetigt -> keine Rueckfrage, kein beforeunload
    window.confirm.mockReturnValue(true);
    await act(async () => { fireEvent.click(view.getByTestId('create-keys-discard')); });
    expect(view.container.textContent).not.toContain(sec);
    expect(hasNavigationGuard()).toBe(false);
    expect(beforeUnloadPrevented()).toBe(false);
    window.confirm.mockClear();
    expect(confirmNavigation()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('Schluessel verwerfen und Fertig sind waehrend eines laufenden Ablaufs gesperrt', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    let answer;
    mockFriendbot(() => new Promise((r) => { answer = r; }));
    const view = renderPage();
    const { sec } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(friendbotCalls()).toHaveLength(1));
    expect(view.getByTestId('create-keys-discard')).toBeDisabled();
    expect(view.getByTestId('create-activation-finish')).toBeDisabled();
    await act(async () => { fireEvent.click(view.getByTestId('create-keys-discard')); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    await act(async () => { answer(json(200, { hash: 'fb' })); });
    await waitFor(() => expect(view.getByTestId('create-keys-discard')).not.toBeDisabled());
    expect(view.getByTestId('create-activation-finish')).not.toBeDisabled();
  });
});

// KS-4: Friendbot ohne Antwort endet nach FRIENDBOT_TIMEOUT_MS als unklarer Ausgang
describe('KS-4: Friendbot mit Timeout', () => {
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
  let signals;
  function friendbotHangs() {
    signals = [];
    globalThis.fetch.mockImplementation((url, opts) => {
      if (!String(url).startsWith(FRIENDBOT)) return Promise.resolve(new Response('{}', { status: 200 }));
      signals.push(opts?.signal);
      return new Promise((_, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });
  }

  it('keine Antwort: nach dem Timeout unklar, Vermerk gesetzt, kein zweiter Versand', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    friendbotHangs();
    const view = renderPage();
    const { pub, sec } = await generate(view);
    await confirmBackup(view);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await clickActivateOnly(view);
      await flush();
      expect(friendbotCalls()).toHaveLength(1);
      expect(signals[0]).toBeDefined();
      await act(async () => { vi.advanceTimersByTime(FRIENDBOT_TIMEOUT_MS - 1); });
      await flush();
      expect(signals[0].aborted).toBe(false);
      expect(view.container.textContent).not.toContain(tx('multisigCreate:activation.friendbotTimeout', { seconds: 30 }));
      await act(async () => { vi.advanceTimersByTime(1); });
      await flush();
    } finally {
      vi.useRealTimers();
    }
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.friendbotTimeout', { seconds: 30 })));
    expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous'));
    expect(view.getByTestId('create-activation-pub').textContent).toBe(pub);
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    expect(hasNavigationGuard()).toBe(true);
    expect(activateOnlyButton(view)).not.toBeDisabled();
    // Zweiter Klick: Vermerk ohne sichtbares Konto -> kein zweiter Versand
    await clickActivateOnly(view);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.stillUnclear')));
    expect(friendbotCalls()).toHaveLength(1);
  });

  it('Gegenprobe: Antwort vor dem Timeout: aktiviert, Timer geloescht, kein Abbruch', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    signals = [];
    globalThis.fetch.mockImplementation(async (url, opts) => {
      if (String(url).startsWith(FRIENDBOT)) signals.push(opts?.signal);
      return json(200, { hash: 'fb' });
    });
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await clickActivateOnly(view);
      await flush();
      await act(async () => { vi.advanceTimersByTime(FRIENDBOT_TIMEOUT_MS * 2); });
    } finally {
      vi.useRealTimers();
    }
    expect(signals[0].aborted).toBe(false);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
  });
});
