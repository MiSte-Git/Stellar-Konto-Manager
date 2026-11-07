import { act, fireEvent, waitFor } from '@testing-library/react';

// Review N21-3: Nach gesendeter Aktivierung fragt die App vor dem Verlassen von "Neues Konto
// erstellen" nach (Menue, Browser-Zurueck). Abbrechen behaelt Seite und Secret Key, nach
// "Fertig, Key gesichert" wird nicht mehr gefragt. main.jsx mountet beim Import selbst.
const hoisted = vi.hoisted(() => ({ existing: new Set() }));

vi.mock('../utils/stellar/stellarUtils.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    // Kein echter Horizon-Aufruf
    getHorizonServer: (...args) => {
      const server = orig.getHorizonServer(...args);
      server.ledgers = () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) });
      server.loadAccount = async (pk) => {
        if (hoisted.existing.has(pk)) return { accountId: () => pk };
        throw Object.assign(new Error('not found'), { response: { status: 404 } });
      };
      return server;
    },
  };
});

const SLOW = { timeout: 20000 };
vi.setConfig({ testTimeout: 45000 });

const pageRadio = (value) => document.querySelector(`input[name="network"][value="${value}"]`);
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const buttonByText = (text) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
const openView = (id) => act(async () => { window.dispatchEvent(new CustomEvent('stm:openMenu', { detail: id })); });

let i18n;
let confirmSpy;

async function mountOnCreateAccountWithActivation({ activate = true } = {}) {
  window.localStorage.clear();
  window.localStorage.setItem('SKM_NET_INIT', '1');
  window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await act(async () => { await import('../main.jsx'); });
  i18n = (await import('../i18n.js')).default;
  await act(async () => { await i18n.changeLanguage('de'); });
  await openView('createAccount');
  await waitFor(() => expect(pageRadio('TESTNET')).not.toBeNull(), SLOW);

  await act(async () => { fireEvent.click(buttonByText(i18n.t('multisigCreate:generateKeys'))); });
  // Secret Key startet verborgen: fuer die Pruefungen anzeigen
  expect(byTestId('create-secret').textContent).not.toMatch(/^S/);
  await act(async () => { fireEvent.click(byTestId('create-secret-toggle')); });
  const sec = byTestId('create-secret').textContent;
  expect(sec).toMatch(/^S[A-Z2-7]{55}$/);
  if (!activate) return { sec };
  await act(async () => { fireEvent.click(byTestId('create-backup-confirm')); });
  await act(async () => { fireEvent.click(byTestId('create-activate')); });
  await waitFor(() => expect(byTestId('create-activation')).not.toBeNull(), SLOW);
  return { sec };
}

describe('Neues Konto erstellen: Verlassen mit offenem Vermerk', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (
      String(url).startsWith('https://friendbot.stellar.org')
        ? new Response('{"hash":"fb"}', { status: 200 })
        : new Response('{}', { status: 200 })
    ));
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('Menuewechsel fragt nach; Abbrechen behaelt Seite und Key; Bestaetigen verlaesst', async () => {
    const { sec } = await mountOnCreateAccountWithActivation();
    const leaveText = i18n.t('multisigCreate:leaveGuard.confirm');

    await openView('feedback');
    expect(confirmSpy).toHaveBeenCalledWith(leaveText);
    expect(pageRadio('TESTNET')).not.toBeNull();
    expect(byTestId('create-secret').textContent).toBe(sec);

    confirmSpy.mockReturnValue(true);
    await openView('feedback');
    await waitFor(() => expect(pageRadio('TESTNET')).toBeNull(), SLOW);
    expect(document.body.textContent).not.toContain(sec);
  });

  it('Browser-Zurueck innerhalb der App fragt nach; Abbrechen behaelt Seite, Key und URL', async () => {
    const { sec } = await mountOnCreateAccountWithActivation();
    // Browser geht zurueck auf eine eigene Route (unmountet sonst Main samt Seite)
    window.history.replaceState({}, '', '/quiz');
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
    expect(pageRadio('TESTNET')).not.toBeNull();
    expect(byTestId('create-secret').textContent).toBe(sec);
    // Aufraeumen: Diese App-Instanz bleibt gemountet (main.jsx mountet selbst) und hoert
    // weiter auf stm:openMenu; ohne Abschluss fragte ihr Waechter im naechsten Test mit.
    await act(async () => { fireEvent.click(byTestId('create-activation-finish')); });
  });

  it('KS-2: nur erzeugte Schluessel: Menuewechsel fragt nach; nach Schluessel verwerfen ohne Nachfrage', async () => {
    const { sec } = await mountOnCreateAccountWithActivation({ activate: false });
    await openView('feedback');
    expect(confirmSpy).toHaveBeenCalledWith(i18n.t('multisigCreate:leaveGuard.confirmKeys'));
    expect(pageRadio('TESTNET')).not.toBeNull();
    expect(byTestId('create-secret').textContent).toBe(sec);

    // Schluessel verwerfen (Rueckfrage bestaetigen), danach verlaesst der Menuewechsel direkt
    confirmSpy.mockReturnValue(true);
    await act(async () => { fireEvent.click(byTestId('create-keys-discard')); });
    await act(async () => { fireEvent.click(byTestId('confirm-dialog-ok')); });
    expect(byTestId('create-secret')).toBeNull();
    confirmSpy.mockClear();
    await openView('feedback');
    await waitFor(() => expect(pageRadio('TESTNET')).toBeNull(), SLOW);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('Gegenprobe: nach Fertig, Key gesichert verlaesst der Menuewechsel ohne Nachfrage', async () => {
    await mountOnCreateAccountWithActivation();
    await act(async () => { fireEvent.click(byTestId('create-activation-finish')); });
    await openView('feedback');
    await waitFor(() => expect(pageRadio('TESTNET')).toBeNull(), SLOW);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
  // KS-6: React-Router-Link im Footer von Main (Impressum) haengte die Seite ohne Rueckfrage aus
  const imprintLink = () => document.querySelector('a[href$="/legal"]');
  const clickLink = (a) => act(async () => {
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });

  it('KS-6: Impressum-Link fragt nach; Abbrechen behaelt Seite und Key; Bestaetigen navigiert', async () => {
    const { sec } = await mountOnCreateAccountWithActivation({ activate: false });
    expect(imprintLink()).not.toBeNull();

    await clickLink(imprintLink());
    expect(confirmSpy).toHaveBeenCalledWith(i18n.t('multisigCreate:leaveGuard.confirmKeys'));
    expect(window.location.pathname).toBe('/');
    expect(pageRadio('TESTNET')).not.toBeNull();
    expect(byTestId('create-secret').textContent).toBe(sec);

    confirmSpy.mockReturnValue(true);
    await clickLink(imprintLink());
    await waitFor(() => expect(window.location.pathname).toBe('/legal'), SLOW);
    await waitFor(() => expect(pageRadio('TESTNET')).toBeNull(), SLOW);
    expect(document.body.textContent).not.toContain(sec);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it('Gegenprobe: ohne Schluessel navigiert der Impressum-Link ohne Rueckfrage', async () => {
    const { sec } = await mountOnCreateAccountWithActivation({ activate: false });
    confirmSpy.mockReturnValue(true);
    await act(async () => { fireEvent.click(byTestId('create-keys-discard')); });
    await act(async () => { fireEvent.click(byTestId('confirm-dialog-ok')); });
    expect(document.body.textContent).not.toContain(sec);
    confirmSpy.mockClear();

    await clickLink(imprintLink());
    await waitFor(() => expect(window.location.pathname).toBe('/legal'), SLOW);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
