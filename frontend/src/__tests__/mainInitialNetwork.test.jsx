import { act, waitFor } from '@testing-library/react';

// Review N2-5: main.jsx reicht das Netz an Seiten weiter (ListTrustlines, Liquidity Pools, ...).
// Schon der erste Render muss das gespeicherte Netz tragen, nicht erst nach dem Effekt.
// Geprueft am Kopf-Eingabefeld, das devTestnet direkt nutzt und statisch importiert ist
// (Lazy-Seiten wie LiquidityPoolsPage verdecken den Fehler, weil sie erst nach dem Effekt rendern).
const hoisted = vi.hoisted(() => ({ headerClasses: [] }));

// Kopf-Eingabefeld: Klassen jedes Renders mitschreiben (Rahmenfarbe haengt an devTestnet).
vi.mock('../components/AddressDropdown.jsx', () => ({
  default: ({ inputClassName = '', value = '', onChange }) => {
    hoisted.headerClasses.push(inputClassName);
    return <input className={inputClassName} value={value} onChange={(e) => onChange?.(e.target.value)} />;
  },
}));

vi.mock('../utils/stellar/stellarUtils.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    // Kein echter Horizon-Aufruf
    getHorizonServer: (...args) => {
      const server = orig.getHorizonServer(...args);
      server.ledgers = () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) });
      return server;
    },
  };
});

vi.setConfig({ testTimeout: 45000 });

describe('main.jsx: Netz beim Start', () => {
  it('Wallet-Kopf: das Eingabefeld traegt beim gespeicherten Testnet von Anfang an die Testnet-Markierung', async () => {
    window.localStorage.clear();
    window.localStorage.setItem('SKM_NET_INIT', '1');
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    hoisted.headerClasses.length = 0;
    await act(async () => { await import('../main.jsx'); });
    await waitFor(() => expect(document.querySelector('input.wallet-input')).not.toBeNull(), { timeout: 20000 });
    // Jeder Render des Kopf-Eingabefelds (auch verworfene Durchgaenge) zeigt Testnet,
    // keiner rendert zuerst als Mainnet (grau).
    const walletInputs = hoisted.headerClasses.filter((c) => c.includes('wallet-input'));
    expect(walletInputs.length).toBeGreaterThan(0);
    expect(walletInputs.every((c) => c.includes('border-yellow-500'))).toBe(true);
  });
});
