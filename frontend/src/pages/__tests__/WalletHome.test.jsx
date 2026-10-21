import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';

const loadAccount = vi.fn();
vi.mock('../../utils/stellar/stellarUtils.js', () => {
  const chain = { forAccount: () => chain, order: () => chain, limit: () => chain, join: () => chain, call: async () => ({ records: [] }) };
  return { getHorizonServer: () => ({ loadAccount, payments: () => chain, claimableBalances: () => ({ claimant: () => chain }) }) };
});

import WalletHome from '../WalletHome.jsx';
import { XlmPriceContext } from '../../utils/xlmPriceContext.js';

const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const price = { value: 0.5, symbol: 'CHF ', locale: 'de-CH' };

function renderHome(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <XlmPriceContext.Provider value={price}>
        <WalletHome onAction={() => {}} {...props} />
      </XlmPriceContext.Provider>
    </I18nextProvider>
  );
}

describe('WalletHome', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    loadAccount.mockReset();
    window.localStorage.clear();
  });

  it('zeigt den Leerzustand ohne Konto', () => {
    renderHome({ publicKey: '' });
    expect(screen.getByTestId('wallet-home-empty')).toBeInTheDocument();
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it('zeigt im Leerzustand den spielerischen Einstieg und oeffnet die Routen', () => {
    const onOpenRoute = vi.fn();
    renderHome({ publicKey: '', onOpenRoute });
    const teaser = screen.getByTestId('wallet-home-discover');
    expect(teaser).toHaveTextContent('Stellar spielerisch entdecken');
    fireEvent.click(screen.getByRole('button', { name: /Los geht/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Gefahren erkennen' }));
    expect(onOpenRoute.mock.calls).toEqual([['discover'], ['learn/scam-simulator']]);
  });

  it('zeigt Guthaben, Fiat-Wert, Assets und loest Aktionen aus', async () => {
    loadAccount.mockResolvedValue({
      subentry_count: 1,
      balances: [
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: PK, balance: '3' },
        { asset_type: 'native', balance: '200', selling_liabilities: '0' },
      ],
    });
    const onAction = vi.fn();
    renderHome({ publicKey: PK, onAction });
    expect(await screen.findByTestId('wallet-home-xlm')).toHaveTextContent('200');
    expect(screen.getAllByText(/CHF 100/).length).toBeGreaterThan(0);
    // Assets sind standardmaessig eingeklappt und zeigen nur die Anzahl
    expect(screen.getByTestId('wallet-home-assets-collapsed')).toHaveTextContent('XLM und 1 Token');
    expect(screen.queryByText('USDC')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Assets/ }));
    expect(screen.getByText('USDC')).toBeInTheDocument();
    expect(screen.getByText(/SKM bewertet keine Token/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Senden/ }));
    fireEvent.click(screen.getByRole('button', { name: /Tauschen/ }));
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['sendPayment', 'tradingAssets']);
  });

  it('meldet ein nicht aktiviertes Konto', async () => {
    loadAccount.mockRejectedValue({ response: { status: 404 } });
    renderHome({ publicKey: PK });
    expect(await screen.findByTestId('wallet-home-notfound')).toBeInTheDocument();
  });

  it('merkt sich den aufgeklappten Zustand der Assets', async () => {
    loadAccount.mockResolvedValue({ subentry_count: 0, balances: [{ asset_type: 'native', balance: '10' }] });
    window.localStorage.setItem('skm.wallet.assetsOpen', '1');
    renderHome({ publicKey: PK });
    await screen.findByTestId('wallet-home-xlm');
    expect(screen.queryByTestId('wallet-home-assets-collapsed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assets/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
