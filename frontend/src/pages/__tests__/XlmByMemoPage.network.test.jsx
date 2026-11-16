// Transaktionen durchsuchen fragt das Netz aus dem Kopf ab (vorher fest Mainnet, auch bei Testnet).
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Keypair } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import { NETWORKS } from '../../config/networks.js';
import XlmByMemoPage from '../XlmByMemoPage.jsx';

const hoisted = vi.hoisted(() => ({ urls: [] }));

vi.mock('../../utils/stellar/stellarUtils', async (importOriginal) => {
  const chain = () => {
    const b = { forAccount: () => b, order: () => b, limit: () => b, cursor: () => b, call: async () => ({ records: [] }) };
    return b;
  };
  return {
    ...(await importOriginal()),
    getHorizonServer: (url) => {
      hoisted.urls.push(url);
      return { operations: chain, transactions: chain };
    },
  };
});

const PK = Keypair.random().publicKey();
beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => { hoisted.urls.length = 0; });

const loadOn = async (network) => {
  render(<I18nextProvider i18n={i18n}><XlmByMemoPage publicKey={PK} network={network} /></I18nextProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Letzte 24 Stunden' }));
  await waitFor(() => expect(screen.getByText(/Treffer: 0 von 0|Keine Operationen/)).toBeInTheDocument());
};

describe('XlmByMemoPage: Netz', () => {
  it('Testnet: alle Abfragen gehen an Horizon Testnet', async () => {
    await loadOn('TESTNET');
    expect(hoisted.urls.length).toBeGreaterThan(0);
    expect(new Set(hoisted.urls)).toEqual(new Set([NETWORKS.TESTNET.horizonUrl]));
  });

  it('Gegenprobe Mainnet: Abfragen gehen an Horizon Mainnet', async () => {
    await loadOn('PUBLIC');
    expect(new Set(hoisted.urls)).toEqual(new Set([NETWORKS.PUBLIC.horizonUrl]));
  });
});

// Verdrahtung im Kopf (main.jsx zu schwer fuer einen Seitentest): Netz wird uebergeben und ist Teil
// des Keys, ein Netzwechsel baut die Seite neu auf und verwirft alte Ergebnisse.
describe('main.jsx: Verdrahtung', () => {
  it('uebergibt das Netz und nimmt es in den Key', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${globalThis.process.cwd()}/src/main.jsx`, 'utf8');
    const block = src.slice(src.indexOf('<XlmByMemoPage'), src.indexOf('/>', src.indexOf('<XlmByMemoPage')));
    expect(block).toContain("key={`${devTestnet ? 'TESTNET' : 'PUBLIC'}:${refreshToken}`}");
    expect(block).toContain("network={devTestnet ? 'TESTNET' : 'PUBLIC'}");
  });
});
