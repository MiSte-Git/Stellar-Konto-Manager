import { act, fireEvent, waitFor, screen } from '@testing-library/react';

// Route /assets/CODE-ISSUER: main.jsx zeigt die Asset-Detailseite, Zurueck fuehrt zur Wallet,
// Handeln oeffnet Token suchen und handeln mit vorgemerktem Asset (Pfad ohne Query).
const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const hoisted = vi.hoisted(() => ({ detailProps: null, tradingSeen: [] }));

vi.mock('../pages/AssetDetailPage.jsx', () => ({
  default: (props) => {
    hoisted.detailProps = props;
    return (
      <div data-testid="stub-asset-detail">
        <button type="button" onClick={props.onBack}>stub-back</button>
        <button type="button" onClick={() => props.onTrade({ code: 'LDEX', issuer: ISSUER })}>stub-trade</button>
      </div>
    );
  },
}));

vi.mock('../pages/TradingAssetsPage.jsx', async () => {
  const { consumePendingTradingAsset } = await import('../utils/appNavigation.js');
  return {
    default: () => {
      const pending = consumePendingTradingAsset();
      if (pending) hoisted.tradingSeen.push(pending);
      return <div data-testid="stub-trading" />;
    },
  };
});

vi.mock('../utils/stellar/stellarUtils.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    getHorizonServer: (...args) => {
      const server = orig.getHorizonServer(...args);
      server.ledgers = () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) });
      return server;
    },
  };
});

vi.setConfig({ testTimeout: 45000 });

describe('main.jsx: Asset-Detailseite', () => {
  it('Direktaufruf zeigt die Seite, Handeln oeffnet Trading mit vorgemerktem Asset, Zurueck fuehrt zur Wallet', async () => {
    window.localStorage.clear();
    window.localStorage.setItem('SKM_NET_INIT', '1');
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    window.history.replaceState({}, '', `/assets/LDEX-${ISSUER}`);
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    await act(async () => { await import('../main.jsx'); });

    await screen.findByTestId('stub-asset-detail', {}, { timeout: 20000 });
    expect(window.location.pathname).toBe(`/assets/LDEX-${ISSUER}`);
    expect(hoisted.detailProps.network).toBe('PUBLIC');

    await act(async () => { fireEvent.click(screen.getByText('stub-trade')); });
    await screen.findByTestId('stub-trading', {}, { timeout: 20000 });
    expect(window.location.pathname).toBe('/trading/assets');
    expect(hoisted.tradingSeen).toEqual([{ code: 'LDEX', issuer: ISSUER }]);

    // Zurueck im Browser: wieder Detailseite, dann zur Wallet
    await act(async () => { window.history.back(); });
    await screen.findByTestId('stub-asset-detail', {}, { timeout: 20000 });
    await act(async () => { fireEvent.click(screen.getByText('stub-back')); });
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    await waitFor(() => expect(screen.queryByTestId('stub-asset-detail')).toBeNull());
  });
});
