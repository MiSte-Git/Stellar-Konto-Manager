import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';

const loadAccount = vi.fn();
const poolCall = vi.fn();
vi.mock('../../utils/stellar/stellarUtils.js', () => {
  const chain = { forAccount: () => chain, order: () => chain, limit: () => chain, join: () => chain, call: async () => ({ records: [] }) };
  return { getHorizonServer: () => ({
    loadAccount,
    payments: () => chain,
    claimableBalances: () => ({ claimant: () => chain }),
    liquidityPools: () => ({ liquidityPoolId: (id) => ({ call: () => poolCall(id) }) }),
  }) };
});

import WalletHome from '../WalletHome.jsx';
import { parseHorizonPoolAsset, poolIdFor } from '../../utils/stellar/liquidityPools.js';
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

  it('Details je Token oeffnet die Asset-Detailseite, Pool-Anteile haben keinen Asset-Details-Button', async () => {
    poolCall.mockRejectedValue(new Error('offline'));
    loadAccount.mockResolvedValue({
      subentry_count: 2,
      balances: [
        { asset_type: 'native', balance: '10' },
        { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: PK, balance: '127165.150949' },
        { asset_type: 'liquidity_pool_shares', liquidity_pool_id: 'ab'.repeat(32), balance: '1' },
      ],
    });
    window.localStorage.setItem('skm.wallet.assetsOpen', '1');
    const onOpenRoute = vi.fn();
    renderHome({ publicKey: PK, onOpenRoute });
    await screen.findByTestId('wallet-home-xlm');
    const buttons = screen.getAllByTestId('wallet-home-asset-details');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Details zu LDEX');
    fireEvent.click(buttons[0]);
    expect(onOpenRoute).toHaveBeenCalledWith(`assets/LDEX-${PK}`);
  });
  it('Pool-Anteile zeigen Paar, Shares und Gegenwert beider Assets, Details fuehrt zur Liquidity-Seite', async () => {
    const xlm = parseHorizonPoolAsset('native');
    const ldex = parseHorizonPoolAsset(`LDEX:${PK}`);
    const poolId = poolIdFor(xlm, ldex);
    poolCall.mockResolvedValue({
      id: poolId, fee_bp: 30, total_shares: '1000.0000000', total_trustlines: '5',
      reserves: [{ asset: 'native', amount: '200.0000000' }, { asset: `LDEX:${PK}`, amount: '4000000.0000000' }],
    });
    loadAccount.mockResolvedValue({
      subentry_count: 1,
      balances: [
        { asset_type: 'native', balance: '10' },
        { asset_type: 'liquidity_pool_shares', liquidity_pool_id: poolId, balance: '250.0000000' },
      ],
    });
    window.localStorage.setItem('skm.wallet.assetsOpen', '1');
    const onOpenRoute = vi.fn();
    renderHome({ publicKey: PK, onOpenRoute });
    // 250 von 1000 Shares = ein Viertel der Reserven
    const value = await screen.findByText(/Gegenwert ≈ 50 XLM \+ 1.?000.?000 LDEX/);
    expect(value).toHaveAttribute('data-testid', 'wallet-home-pool-value');
    expect(screen.getByText('Pool XLM / LDEX')).toBeInTheDocument();
    expect(poolCall).toHaveBeenCalledWith(poolId);
    fireEvent.click(screen.getByTestId('wallet-home-pool-details'));
    expect(onOpenRoute).toHaveBeenCalledWith(`trading/pools?pool=${poolId}`);
  });

  it('eingeklappte Assets laden keine Pools', async () => {
    loadAccount.mockResolvedValue({
      subentry_count: 1,
      balances: [{ asset_type: 'native', balance: '10' }, { asset_type: 'liquidity_pool_shares', liquidity_pool_id: 'ab'.repeat(32), balance: '1' }],
    });
    poolCall.mockReset();
    renderHome({ publicKey: PK });
    await screen.findByTestId('wallet-home-xlm');
    expect(poolCall).not.toHaveBeenCalled();
  });
  it('Filter blendet nicht passende Assets aus, zaehlt Treffer und laesst sich leeren', async () => {
    const OTHER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
    loadAccount.mockResolvedValue({
      subentry_count: 3,
      balances: [
        { asset_type: 'native', balance: '10' },
        { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: PK, balance: '1' },
        { asset_type: 'credit_alphanum12', asset_code: 'LLOYDSCE', asset_issuer: OTHER, balance: '2' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: OTHER, balance: '3' },
      ],
    });
    window.localStorage.setItem('skm.wallet.assetsOpen', '1');
    renderHome({ publicKey: PK, onOpenRoute: () => {} });
    await screen.findByTestId('wallet-home-xlm');
    const list = () => screen.getByTestId('wallet-home-assets').querySelector('#wallet-home-asset-list');
    fireEvent.change(screen.getByTestId('wallet-home-asset-search'), { target: { value: 'ld' } });
    expect(list().textContent).toContain('LDEX');
    expect(list().textContent).not.toContain('LLOYDSCE');
    expect(list().textContent).not.toContain('USDC');
    expect(list().textContent).not.toContain('Stellar Lumens');
    expect(screen.getByTestId('wallet-home-asset-search-count')).toHaveTextContent('1 von 4 Assets');
    fireEvent.change(screen.getByTestId('wallet-home-asset-search'), { target: { value: 'gibtsnicht' } });
    expect(screen.getByTestId('wallet-home-asset-search-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eingabe löschen' }));
    expect(list().textContent).toContain('USDC');
    expect(list().textContent).toContain('Stellar Lumens');
  });
});
