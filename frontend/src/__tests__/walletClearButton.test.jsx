import { act, fireEvent, screen, waitFor } from '@testing-library/react';

// main.jsx mountet beim Import selbst; getestet wird die echte Kopfzeile.
const hoisted = vi.hoisted(() => ({ submit: vi.fn(), revalidateCalls: 0 }));

vi.mock('../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  handleSourceSubmit: (...args) => { hoisted.revalidateCalls += 1; return hoisted.submit(...args); },
}));

const G = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
// Der Import laedt die ganze App, unter Last im Volllauf dauert das deutlich laenger.
const SLOW = { timeout: 20000 };
vi.setConfig({ testTimeout: 45000 });

async function mountApp(network) {
  window.localStorage.clear();
  window.localStorage.setItem('SKM_NET_INIT', '1');
  window.localStorage.setItem('SKM_NETWORK', network);
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await act(async () => { await import('../main.jsx'); });
  const input = await waitFor(() => {
    const el = document.querySelector('input.wallet-input');
    expect(el).not.toBeNull();
    return el;
  }, SLOW);
  // Wie ein Nutzer ueber das Adressfeld laden
  await act(async () => {
    fireEvent.change(input, { target: { value: G } });
    fireEvent.submit(input.form);
  });
}

const clearButton = () => screen.findByRole('button', { name: 'Eingabe löschen' }, SLOW);

describe('Loeschen-Button im Adressfeld', () => {
  beforeEach(() => {
    hoisted.revalidateCalls = 0;
    hoisted.submit.mockReset();
    hoisted.submit.mockImplementation(async () => ({ publicKey: G, summary: { xlmBalance: '10.0000000' } }));
  });

  it.each(['TESTNET', 'PUBLIC'])('behaelt das Netz %s und entlaedt das Konto', async (network) => {
    await mountApp(network);
    await waitFor(() => expect(hoisted.submit).toHaveBeenCalled(), SLOW);
    const events = [];
    const listener = (e) => events.push(e.detail);
    window.addEventListener('stm-network-changed', listener);
    const before = hoisted.revalidateCalls;
    await act(async () => { fireEvent.click(await clearButton()); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    window.removeEventListener('stm-network-changed', listener);
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe(network);
    expect(events).toEqual([]);
    expect(window.localStorage.getItem('SKM_LAST_ACCOUNT')).toBeNull();
    // Das entladene Konto wird nicht neu geladen
    expect(hoisted.revalidateCalls).toBe(before);
    expect(document.querySelector('input.wallet-input').value).toBe('');
  });

  it('setzt die Anzeige "nicht gefunden" zurueck, auch ohne Netzwechsel-Event', async () => {
    hoisted.submit.mockRejectedValue(new Error('Konto nicht gefunden'));
    await mountApp('TESTNET');
    await waitFor(() => expect(document.querySelector('input.wallet-input').className).toContain('border-red-500'), SLOW);
    await act(async () => { fireEvent.click(await clearButton()); });
    await waitFor(() => expect(document.querySelector('input.wallet-input').className).not.toContain('border-red-500'), SLOW);
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe('TESTNET');
  });
});
