import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import LiquidityPoolsPage from '../LiquidityPoolsPage.jsx';

const hoisted = vi.hoisted(() => ({
  accountCall: vi.fn(),
  poolByIdCall: vi.fn(),
  forAssetsCall: vi.fn(),
}));

vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    accounts: () => ({ accountId: (id) => ({ call: () => hoisted.accountCall(id) }) }),
    liquidityPools: () => ({
      liquidityPoolId: (id) => ({ call: () => hoisted.poolByIdCall(id) }),
      forAssets: (...assets) => ({ call: () => hoisted.forAssetsCall(...assets) }),
    }),
  }),
}));

const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const PK2 = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const POOL_ID = 'a468d41d8e9b8f3c7209651608b74b7db7ac9952dcae0cdf24871d1d9c7b0088';
const OTHER_POOL_ID = 'b'.repeat(64);

const poolRecord = (id = POOL_ID, overrides = {}) => ({
  id,
  fee_bp: 30,
  total_trustlines: '42',
  total_shares: '100.0000000',
  reserves: [
    { asset: 'native', amount: '1000.0000000' },
    { asset: `USDC:${USDC_ISSUER}`, amount: '200.0000000' },
  ],
  ...overrides,
});

const notFoundError = () => Object.assign(new Error('Not Found'), { response: { status: 404 } });

function renderPage(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <LiquidityPoolsPage network="PUBLIC" {...props} />
    </I18nextProvider>
  );
}

describe('LiquidityPoolsPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    hoisted.accountCall.mockReset();
    hoisted.poolByIdCall.mockReset();
    hoisted.forAssetsCall.mockReset();
    window.history.replaceState({}, '', '/trading/pools');
    // Token-Fakten (Backend) und Asset-Suche
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('trade/assets/search')) {
        return { ok: true, json: async () => ({ items: [{ assetCode: 'USDC', assetIssuer: USDC_ISSUER, accounts: 10 }] }) };
      }
      return { ok: false, json: async () => ({}) };
    });
  });

  it('sperrt ohne Konto nur die Positionen, Pool finden bleibt nutzbar', () => {
    renderPage({ publicKey: '' });
    expect(screen.getByTestId('pool-positions')).toContainElement(screen.getByTestId('account-gate'));
    expect(screen.getByTestId('pool-finder')).toBeInTheDocument();
    expect(hoisted.accountCall).not.toHaveBeenCalled();
  });

  it('zeigt bei nicht existierendem Konto die AccountGate mit Hinweis', () => {
    renderPage({ publicKey: PK, notFound: true });
    expect(screen.getByTestId('account-gate')).toHaveTextContent(PK);
    expect(hoisted.accountCall).not.toHaveBeenCalled();
  });

  it('zeigt Positionen mit Anteil, Gegenwert und Quelle, Trustline mit 0 Shares gekennzeichnet', async () => {
    hoisted.accountCall.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '10' },
        { asset_type: 'liquidity_pool_shares', liquidity_pool_id: POOL_ID, balance: '25.0000000' },
        { asset_type: 'liquidity_pool_shares', liquidity_pool_id: OTHER_POOL_ID, balance: '0.0000000' },
      ],
    });
    hoisted.poolByIdCall.mockImplementation(async (id) => poolRecord(id));
    renderPage({ publicKey: PK });
    const rows = await screen.findAllByTestId('pool-position');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('XLM / USDC');
    expect(rows[0]).toHaveTextContent('Native Stellar Pool');
    expect(rows[0]).toHaveTextContent('25 %');
    expect(rows[0]).toHaveTextContent('250');
    expect(rows[0]).toHaveTextContent('50');
    expect(rows[0]).not.toHaveTextContent('Bestand 0');
    expect(rows[1]).toHaveTextContent('Trustline ohne Pool Shares (Bestand 0)');
  });

  it('verwirft die Antwort eines alten Kontos nach einem Kontowechsel', async () => {
    let resolveOld;
    hoisted.accountCall.mockImplementation((id) => (id === PK
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ balances: [] })));
    const view = renderPage({ publicKey: PK });
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <LiquidityPoolsPage network="PUBLIC" publicKey={PK2} />
      </I18nextProvider>
    );
    expect(await screen.findByText('Dieses Konto hat keine Pool-Share-Trustline.')).toBeInTheDocument();
    await act(async () => {
      resolveOld({ balances: [{ asset_type: 'liquidity_pool_shares', liquidity_pool_id: POOL_ID, balance: '1' }] });
    });
    expect(screen.queryByTestId('pool-position')).toBeNull();
    expect(hoisted.poolByIdCall).not.toHaveBeenCalled();
  });

  it('waehlt einen gueltigen Pool aus dem Query-Param vor', async () => {
    window.history.replaceState({}, '', `/trading/pools?pool=${POOL_ID}`);
    hoisted.poolByIdCall.mockResolvedValue(poolRecord());
    renderPage({ publicKey: '' });
    const facts = await screen.findByTestId('pool-facts');
    expect(hoisted.poolByIdCall).toHaveBeenCalledWith(POOL_ID);
    expect(facts).toHaveTextContent(POOL_ID);
    expect(facts).toHaveTextContent('Native Stellar Pool');
    expect(facts).toHaveTextContent('0,30 % (30 bps)');
    expect(facts).toHaveTextContent('42');
  });

  it('ignoriert einen ungueltigen Query-Param', () => {
    window.history.replaceState({}, '', '/trading/pools?pool=xyz');
    renderPage({ publicKey: '' });
    expect(hoisted.poolByIdCall).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pool-facts')).toBeNull();
  });

  it('unterscheidet 404 (neutraler Hinweis) von Netzwerkfehlern', async () => {
    renderPage({ publicKey: '' });
    fireEvent.click(screen.getByRole('tab', { name: 'Pool-ID' }));
    fireEvent.change(screen.getByLabelText('Pool-ID (64 Hex-Zeichen)'), { target: { value: POOL_ID } });

    hoisted.poolByIdCall.mockRejectedValueOnce(notFoundError());
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    expect(await screen.findByTestId('pool-not-found')).toHaveTextContent('Unter dieser Pool-ID existiert kein Liquidity Pool.');

    hoisted.poolByIdCall.mockRejectedValueOnce(new Error('Network Error'));
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    expect(await screen.findByText(/Pool-Daten konnten nicht geladen werden/)).toBeInTheDocument();
    expect(screen.queryByTestId('pool-not-found')).toBeNull();
  });

  it('meldet eine ungueltige Pool-ID ohne Horizon-Aufruf', async () => {
    renderPage({ publicKey: '' });
    fireEvent.click(screen.getByRole('tab', { name: 'Pool-ID' }));
    fireEvent.change(screen.getByLabelText('Pool-ID (64 Hex-Zeichen)'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    expect(await screen.findByText(/keine gültige Pool-ID/)).toBeInTheDocument();
    expect(hoisted.poolByIdCall).not.toHaveBeenCalled();
  });

  it('zeigt fuer ein Paar ohne Pool einen neutralen Hinweis und die Reserven in Nutzerreihenfolge', async () => {
    renderPage({ publicKey: '' });
    // Erstes Asset: Token USDC, zweites: XLM (umgekehrt zur kanonischen Reihenfolge)
    const [firstTokenRadio] = screen.getAllByLabelText('Token');
    fireEvent.click(firstTokenRadio);
    const [firstXlmRadio, secondXlmRadio] = screen.getAllByLabelText('XLM');
    expect(firstXlmRadio).not.toBeChecked();
    fireEvent.click(secondXlmRadio);
    fireEvent.change(screen.getByLabelText('Token suchen'), { target: { value: `USDC:${USDC_ISSUER}` } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
    });
    expect(await screen.findByText('Gewähltes Token')).toBeInTheDocument();

    hoisted.forAssetsCall.mockResolvedValueOnce({ records: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    expect(await screen.findByTestId('pool-not-found')).toHaveTextContent('Für dieses Asset-Paar existiert noch kein Liquidity Pool.');

    hoisted.forAssetsCall.mockResolvedValueOnce({ records: [poolRecord()] });
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    const facts = await screen.findByTestId('pool-facts');
    await waitFor(() => expect(facts).toHaveTextContent('USDC / XLM'));
    const text = facts.textContent;
    expect(text.indexOf('Reserve USDC')).toBeLessThan(text.indexOf('Reserve XLM'));
  });

  it('meldet ein Paar aus zweimal XLM, ohne Horizon zu fragen', () => {
    renderPage({ publicKey: '' });
    const [, secondXlmRadio] = screen.getAllByLabelText('XLM');
    fireEvent.click(secondXlmRadio);
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    expect(screen.getByText('Bitte zwei verschiedene Assets wählen.')).toBeInTheDocument();
    expect(hoisted.forAssetsCall).not.toHaveBeenCalled();
  });

  it('setzt die Pool-Suche beim Netzwechsel zurueck', async () => {
    window.history.replaceState({}, '', `/trading/pools?pool=${POOL_ID}`);
    hoisted.poolByIdCall.mockRejectedValue(new Error('Network Error'));
    const view = renderPage({ publicKey: '' });
    expect(await screen.findByText(/Pool-Daten konnten nicht geladen werden/)).toBeInTheDocument();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <LiquidityPoolsPage network="TESTNET" publicKey="" />
      </I18nextProvider>
    );
    await waitFor(() => expect(screen.queryByText(/Pool-Daten konnten nicht geladen werden/)).toBeNull());
  });
});
