import { act, fireEvent, waitFor } from '@testing-library/react';

// main.jsx mountet beim Import selbst; getestet wird die echte Kopfzeile.
const hoisted = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock('../utils/stellar/stellarUtils.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    handleSourceSubmit: (...args) => hoisted.submit(...args),
    // Kein echter Horizon-Aufruf fuer die Reserve auf Neues Konto erstellen
    getHorizonServer: (...args) => {
      const server = orig.getHorizonServer(...args);
      server.ledgers = () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) });
      return server;
    },
  };
});

const G = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const SLOW = { timeout: 20000 };
vi.setConfig({ testTimeout: 45000 });

const headerInput = () => document.querySelector('input.wallet-input');
const sourceLine = () => Array.from(document.querySelectorAll('p')).find((p) => p.textContent.endsWith(': ' + G));
const badge = () => document.querySelector('[data-testid="network-badge"]');
const pageRadio = (value) => document.querySelector(`input[name="network"][value="${value}"]`);

async function mountAppWithAccount(network = 'PUBLIC') {
  window.localStorage.clear();
  window.localStorage.setItem('SKM_NET_INIT', '1');
  window.localStorage.setItem('SKM_NETWORK', network);
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await act(async () => { await import('../main.jsx'); });
  const input = await waitFor(() => {
    expect(headerInput()).not.toBeNull();
    return headerInput();
  }, SLOW);
  await act(async () => {
    fireEvent.change(input, { target: { value: G } });
    fireEvent.submit(input.form);
  });
  await waitFor(() => expect(sourceLine()?.textContent).toContain(G), SLOW);
}

async function openView(id) {
  await act(async () => { window.dispatchEvent(new CustomEvent('stm:openMenu', { detail: id })); });
}

describe('Wallet-Kopf auf Seiten ohne Kontobezug', () => {
  beforeEach(() => {
    hoisted.submit.mockReset();
    hoisted.submit.mockImplementation(async () => ({ publicKey: G, summary: { xlmBalance: '10.0000000' } }));
  });

  it('ist auf createAccount und feedback ausgeblendet, auf wallet und sendPayment sichtbar; das Konto bleibt geladen', async () => {
    await mountAppWithAccount();
    const loads = hoisted.submit.mock.calls.length;

    await openView('createAccount');
    await waitFor(() => expect(pageRadio('PUBLIC')).not.toBeNull(), SLOW);
    expect(headerInput()).toBeNull();
    expect(sourceLine()).toBeUndefined();

    await openView('feedback');
    await waitFor(() => expect(pageRadio('PUBLIC')).toBeNull(), SLOW);
    expect(headerInput()).toBeNull();
    expect(sourceLine()).toBeUndefined();

    await openView('home');
    await waitFor(() => expect(headerInput()).not.toBeNull(), SLOW);
    expect(headerInput().value).toBe(G);
    expect(sourceLine().textContent).toContain(G);

    await openView('sendPayment');
    await waitFor(() => expect(headerInput()).not.toBeNull(), SLOW);
    expect(headerInput().value).toBe(G);
    expect(sourceLine().textContent).toContain(G);

    // Zurueck ohne erneutes Laden: das Konto war die ganze Zeit im State
    expect(hoisted.submit.mock.calls.length).toBe(loads);
  });

  it('Netzschalter auf createAccount und Netz-Anzeige der Kopfleiste stimmen immer ueberein', async () => {
    await mountAppWithAccount('PUBLIC');
    await openView('createAccount');
    await waitFor(() => expect(pageRadio('PUBLIC')).not.toBeNull(), SLOW);
    expect(pageRadio('PUBLIC').checked).toBe(true);
    expect(badge().textContent).toContain('Mainnet');

    await act(async () => { fireEvent.click(pageRadio('TESTNET')); });
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe('TESTNET');
    expect(pageRadio('TESTNET').checked).toBe(true);
    expect(badge().textContent).toContain('Testnet');

    // Zurueck auf Wallet: Testnet-Checkbox im Kopf zeigt dasselbe Netz
    await openView('home');
    const checkbox = await waitFor(() => {
      const el = headerInput()?.form?.querySelector('input[type="checkbox"]');
      expect(el).toBeTruthy();
      return el;
    }, SLOW);
    expect(checkbox.checked).toBe(true);
    await act(async () => { fireEvent.click(checkbox); });
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe('PUBLIC');
    expect(badge().textContent).toContain('Mainnet');

    await openView('createAccount');
    await waitFor(() => expect(pageRadio('PUBLIC')).not.toBeNull(), SLOW);
    expect(pageRadio('PUBLIC').checked).toBe(true);
  });

  it('zeigt die Fehlerzeile (Konto-Fehler und Script-Fehler) auch auf createAccount, ausserhalb des Kopfs', async () => {
    hoisted.submit.mockRejectedValue(new Error('Konto nicht gefunden'));
    await mountAppWithAccount('TESTNET').catch(() => {});
    await openView('createAccount');
    await waitFor(() => expect(pageRadio('PUBLIC')).not.toBeNull(), SLOW);
    expect(headerInput()).toBeNull();
    const line = await waitFor(() => {
      const el = document.querySelector('[data-testid="main-error"]');
      expect(el).not.toBeNull();
      return el;
    }, SLOW);
    expect(line.textContent).toContain('Konto nicht gefunden');

    await act(async () => { window.onerror('Boom im Test', 'http://localhost/src/x.js', 1, 2, new Error('Boom im Test')); });
    await waitFor(() => expect(document.querySelector('[data-testid="main-error"]').textContent).toContain('Boom im Test'), SLOW);

    // Auf Seiten mit Kopf steht die Zeile wie bisher im Kopf, nicht doppelt
    await openView('home');
    await waitFor(() => expect(headerInput()).not.toBeNull(), SLOW);
    expect(document.querySelector('[data-testid="main-error"]')).toBeNull();
  });

  it('Netzwechsel aus anderem Tab wirkt wie ein Wechsel in diesem Tab', async () => {
    await mountAppWithAccount('PUBLIC');
    const checkbox = headerInput().form.querySelector('input[type="checkbox"]');
    expect(checkbox.checked).toBe(false);
    const calls = hoisted.submit.mock.calls.length;

    // Anderer Tab schreibt SKM_NETWORK; dieser Tab bekommt nur das storage-Event
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'SKM_NETWORK', newValue: 'TESTNET' })); });
    await waitFor(() => expect(checkbox.checked).toBe(true), SLOW);
    expect(badge().textContent).toContain('Testnet');
    // Konto wird im neuen Netz neu geprueft, wie beim Wechsel im eigenen Tab
    await waitFor(() => expect(hoisted.submit.mock.calls.length).toBeGreaterThan(calls), SLOW);
    expect(hoisted.submit.mock.calls.at(-1)[2]).toBe('TESTNET');
  });
});
