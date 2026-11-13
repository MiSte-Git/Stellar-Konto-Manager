import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import AssetDetailPage from '../AssetDetailPage.jsx';
import { serverNetworkCalls, resetServerNetworkCalls } from '../../test/horizonMock.js';

const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';

const hoisted = vi.hoisted(() => ({ loadAccount: vi.fn() }));
vi.mock('../../utils/stellar/stellarUtils.js', async (orig) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await orig()),
  getHorizonServer: () => ({ loadAccount: hoisted.loadAccount }),
}));

function account(balances) {
  return { account_id: PK, balances: [{ asset_type: 'native', balance: '100' }, ...balances] };
}

function renderAt(path, props = {}) {
  window.history.replaceState({}, '', path);
  return render(
    <I18nextProvider i18n={i18n}>
      <AssetDetailPage publicKey={PK} network="PUBLIC" {...props} />
    </I18nextProvider>,
  );
}

beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  resetServerNetworkCalls();
  hoisted.loadAccount.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ issuerAccount: { home_domain: 'lumendex.online', flags: {} }, toml: { status: 'notChecked', currencies: [], matches: [] } }),
  })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('AssetDetailPage', () => {
  it('zeigt Saldo, gebundene Betraege und Verfuegbar aus dem Konto (Netz explizit)', async () => {
    hoisted.loadAccount.mockResolvedValue(account([
      { asset_type: 'credit_alphanum12', asset_code: 'LDEXX', asset_issuer: ISSUER, balance: '999', limit: '1000', selling_liabilities: '0', buying_liabilities: '0' },
      { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: ISSUER, balance: '127165.150949', limit: '922337203685.4775807', selling_liabilities: '100000', buying_liabilities: '5', is_authorized: true },
      { asset_type: 'liquidity_pool_shares', liquidity_pool_id: 'ab'.repeat(32), balance: '39984.0424132' },
    ]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect(screen.getByTestId('asset-detail-code').textContent).toBe('LDEX');
    expect(screen.getByTestId('asset-detail-issuer').textContent).toBe(ISSUER);
    const value = await screen.findByTestId('asset-detail-balance-value');
    expect(value.textContent).toBe(`${new Intl.NumberFormat('de', { maximumFractionDigits: 7 }).format(127165.150949)} LDEX`);
    expect(screen.getByText(`${new Intl.NumberFormat('de', { maximumFractionDigits: 7 }).format(27165.150949)} LDEX`)).toBeTruthy();
    expect(screen.getByText(`${new Intl.NumberFormat('de').format(100000)} LDEX`)).toBeTruthy();
    expect(hoisted.loadAccount).toHaveBeenCalledWith(PK);
    expect(serverNetworkCalls).toContain('PUBLIC');
    // Fakten aus dem Backend
    await screen.findByText('lumendex.online');
    const factsCall = String(fetch.mock.calls.find(([u]) => String(u).includes('trade/assets/facts'))[0]);
    expect(factsCall).toContain('code=LDEX');
    expect(factsCall).toContain(`issuer=${ISSUER}`);
  });

  it('ohne Trustline: Hinweis statt Saldo', async () => {
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect(await screen.findByTestId('asset-detail-no-trustline')).toBeTruthy();
    expect(screen.queryByTestId('asset-detail-balance')).toBeNull();
  });

  it('ohne Konto: kein Horizon-Aufruf, Fakten trotzdem', async () => {
    renderAt(`/assets/LDEX-${ISSUER}`, { publicKey: '' });
    expect(screen.getByText('Kein Konto geladen. Lade oben ein Konto, um deinen Bestand zu sehen.')).toBeTruthy();
    await screen.findByText('lumendex.online');
    expect(hoisted.loadAccount).not.toHaveBeenCalled();
  });

  it('Handeln gibt Code und Issuer weiter', async () => {
    hoisted.loadAccount.mockResolvedValue(account([]));
    const onTrade = vi.fn();
    renderAt(`/assets/LDEX-${ISSUER}`, { onTrade });
    fireEvent.click(screen.getByTestId('asset-detail-trade'));
    expect(onTrade).toHaveBeenCalledWith({ code: 'LDEX', issuer: ISSUER });
  });

  it('ungueltiger Link: Hinweis, kein Laden', async () => {
    renderAt('/assets/LDEX-GKAPUTT');
    expect(screen.getByTestId('asset-detail-invalid')).toBeTruthy();
    await waitFor(() => expect(hoisted.loadAccount).not.toHaveBeenCalled());
    expect(fetch).not.toHaveBeenCalled();
  });
});
