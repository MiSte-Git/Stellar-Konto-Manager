import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import AssetDetailPage from '../AssetDetailPage.jsx';
import { serverNetworkCalls, resetServerNetworkCalls } from '../../test/horizonMock.js';
import { clearAggregationCache } from '../../utils/stellar/assetMarket.js';

const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';

const hoisted = vi.hoisted(() => ({ loadAccount: vi.fn(), book: vi.fn(), trades: vi.fn(), paths: vi.fn(), aggs: vi.fn(), assets: vi.fn() }));
vi.mock('../../utils/stellar/stellarUtils.js', async (orig) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await orig()),
  getHorizonServer: () => {
    const chain = (fn, args) => {
      const c = { limit: () => c, order: () => c, call: () => fn(...args) };
      return c;
    };
    return {
      loadAccount: hoisted.loadAccount,
      orderbook: (...a) => chain(hoisted.book, a),
      trades: () => ({ forAssetPair: (...a) => chain(hoisted.trades, a) }),
      strictSendPaths: (...a) => ({ call: () => hoisted.paths(...a) }),
      tradeAggregation: (...a) => chain(hoisted.aggs, a),
      assets: () => { const c = { forCode: () => c, forIssuer: () => c, limit: () => c, call: () => hoisted.assets() }; return c; },
    };
  },
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
  clearAggregationCache();
  resetServerNetworkCalls();
  hoisted.loadAccount.mockReset();
  // Standard: kein Markt (leeres Orderbuch, keine Trades, kein Pfad, keine Aggregationen)
  hoisted.book.mockReset().mockResolvedValue({ bids: [], asks: [] });
  hoisted.trades.mockReset().mockResolvedValue({ records: [] });
  hoisted.paths.mockReset().mockResolvedValue({ records: [] });
  hoisted.aggs.mockReset().mockResolvedValue({ records: [] });
  hoisted.assets.mockReset().mockResolvedValue({ records: [] });
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
  it('W2: Asset mit dem Code XLM zeigt die Warnung', async () => {
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/XLM-${ISSUER}`);
    expect(screen.getByTestId('activity-fake-native')).toBeInTheDocument();
  });
});

describe('AssetDetailPage: Kurs, Kennzahlen, Verlauf, Orderbuch', () => {
  const nf7 = (v) => new Intl.NumberFormat('de', { maximumFractionDigits: 7 }).format(v);
  const HOUR = 3600 * 1000;
  function withMarket() {
    const now = Date.now();
    hoisted.book.mockResolvedValue({
      bids: [{ price: '0.0000114', amount: '114' }, { price: '0.0000113', amount: '113' }, { price: '0.0000112', amount: '112' }],
      asks: [{ price: '0.0000116', amount: '1000000' }, { price: '0.0000117', amount: '1000' }, { price: '0.0000118', amount: '1000' }],
    });
    hoisted.trades.mockResolvedValue({ records: [{
      base_asset_type: 'native', counter_asset_type: 'credit_alphanum4', counter_asset_code: 'LDEX', counter_asset_issuer: ISSUER,
      price: { n: 10000000, d: 114 }, ledger_close_time: new Date(now - HOUR).toISOString(),
    }] });
    hoisted.paths.mockResolvedValue({ records: [{ destination_amount: '0.0000113' }] });
    hoisted.aggs.mockResolvedValue({ records: [
      { timestamp: String(now - 100 * HOUR), open: '0.00001', close: '0.000011', high: '0.000012', low: '0.000009', counter_volume: '50', base_volume: '1', trade_count: '1' },
      { timestamp: String(now - 2 * HOUR), open: '0.000011', close: '0.0000114', high: '0.0000149', low: '0.0000111', counter_volume: '111601', base_volume: '1', trade_count: '3' },
    ] });
  }

  it('zeigt letzten Handel, Mitte, Spread, Tausch 1 Einheit, Bestand in XLM und Kennzahlen; Netz explizit', async () => {
    withMarket();
    hoisted.loadAccount.mockResolvedValue(account([
      { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: ISSUER, balance: '1000000', limit: '1', selling_liabilities: '0', buying_liabilities: '0' },
    ]));
    renderAt(`/assets/LDEX-${ISSUER}`, { network: 'TESTNET' });
    expect((await screen.findByTestId('asset-market-last')).textContent).toBe(`${nf7(0.0000114)} XLM`);
    expect(screen.getByTestId('asset-market-mid').textContent).toBe(`${nf7(0.0000115)} XLM`);
    expect(screen.getByTestId('asset-market-send-one').textContent).toBe(`${nf7(0.0000113)} XLM`);
    expect(screen.getByTestId('asset-market-spread').textContent).toMatch(/^1,7\d? %$/);
    // Bestand nur zur Orderbuch-Mitte (nicht duenn): 1.000.000 x 0,0000115
    expect(await screen.findByTestId('asset-market-holding')).toHaveTextContent('Orderbuch-Mitte etwa 11,5 XLM');
    expect(screen.getByTestId('asset-market-24h')).toHaveTextContent('111.601 XLM');
    // 24 h gegen den Schlusskurs vor dem Zeitraum: 0,000011 -> 0,0000114
    expect(screen.getByTestId('asset-market-24h')).toHaveTextContent('+3,64 %');
    expect(screen.queryByTestId('asset-market-24h-firsttrade')).toBeNull();
    expect(screen.getByTestId('asset-market-7d')).toHaveTextContent('111.651 XLM');
    expect(screen.getByTestId('asset-market-7d')).toHaveTextContent('+14 %');
    expect(screen.getByTestId('asset-market-7d-firsttrade')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-market-thin')).toBeNull();
    // Orderbuch: Kaufangebot 114 XLM zu 0,0000114 = 10.000.000 LDEX
    expect(screen.getByTestId('asset-orderbook-bids')).toHaveTextContent('10.000.000');
    expect(screen.getByTestId('asset-orderbook-asks')).toHaveTextContent('1.000.000');
    expect(serverNetworkCalls.every((n) => n === 'TESTNET')).toBe(true);
    // Paar: Token als Basis, XLM als Gegenwert
    const [base, counter] = hoisted.book.mock.calls[0];
    expect(base.getCode()).toBe('LDEX');
    expect(counter.isNative()).toBe(true);
  });

  it('ohne Markt: kein Handel, kein Angebot, kein Pfad, duennes Orderbuch, nie 0', async () => {
    hoisted.loadAccount.mockResolvedValue(account([
      { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: ISSUER, balance: '5', limit: '1', selling_liabilities: '0', buying_liabilities: '0' },
    ]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect((await screen.findByTestId('asset-market-last')).textContent).toBe('kein Handel');
    expect(screen.getByTestId('asset-market-mid').textContent).toBe('kein Angebot');
    expect(screen.getByTestId('asset-market-send-one').textContent).toBe('kein Pfad');
    expect(screen.getByTestId('asset-market-thin')).toBeInTheDocument();
    expect(screen.getByTestId('asset-market-24h')).toHaveTextContent('kein Handel');
    expect(screen.getByTestId('asset-chart-empty')).toBeInTheDocument();
    expect(await screen.findByTestId('asset-market-holding')).toHaveTextContent('keine Angebote');
    expect(screen.getByTestId('asset-market')).not.toHaveTextContent(/(^|\s)0 XLM/);
  });

  it('Horizon-Fehler je Teil: nicht verfuegbar statt kein Handel, kein Angebot oder kein Pfad (AM-3)', async () => {
    hoisted.trades.mockRejectedValue(new Error('down'));
    hoisted.aggs.mockRejectedValue(new Error('down'));
    hoisted.book.mockRejectedValue(new Error('down'));
    hoisted.paths.mockRejectedValue(new Error('down'));
    // ein Teil gelingt, sonst gilt alles als gescheitert
    hoisted.trades.mockResolvedValueOnce({ records: [] });
    hoisted.loadAccount.mockResolvedValue(account([
      { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: ISSUER, balance: '5', limit: '1', selling_liabilities: '0', buying_liabilities: '0' },
    ]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect((await screen.findByTestId('asset-market-mid')).textContent).toBe('nicht verfügbar');
    expect(screen.getByTestId('asset-market-spread').textContent).toBe('nicht verfügbar');
    expect(screen.getByTestId('asset-market-send-one').textContent).toBe('nicht verfügbar');
    expect(screen.getByTestId('asset-market-24h')).toHaveTextContent('nicht verfügbar');
    expect(await screen.findByTestId('asset-market-holding')).toHaveTextContent('Orderbuch ist nicht verfügbar');
  });

  it('alle Teile scheitern: Gesamthinweis', async () => {
    for (const m of [hoisted.trades, hoisted.aggs, hoisted.book, hoisted.paths]) m.mockRejectedValue(new Error('down'));
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect(await screen.findByText('Marktdaten konnten nicht geladen werden.')).toBeInTheDocument();
  });

  it('Horizon 429: Hinweis auf begrenzte Anfragen', async () => {
    hoisted.aggs.mockRejectedValue(Object.assign(new Error('429'), { response: { status: 429 } }));
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect(await screen.findByTestId('asset-market-rate-limited')).toBeInTheDocument();
    expect(screen.getByTestId('asset-market-24h')).toHaveTextContent('nicht verfügbar');
  });

  it('nie gehandeltes Asset (Horizon 404): kein Handel, kein Fehler', async () => {
    const nf = () => Object.assign(new Error('nf'), { response: { status: 404 } });
    hoisted.trades.mockRejectedValue(nf());
    hoisted.aggs.mockRejectedValue(nf());
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect((await screen.findByTestId('asset-market-last')).textContent).toBe('kein Handel');
    expect(screen.getByTestId('asset-market-24h')).toHaveTextContent('kein Handel');
  });

  it('duennes Orderbuch: Bestand ohne Wert, auch bei hohem letzten Handel (AM-2)', async () => {
    withMarket();
    hoisted.book.mockResolvedValue({ bids: [{ price: '0.0000001', amount: '1' }], asks: [{ price: '100', amount: '1' }] });
    hoisted.loadAccount.mockResolvedValue(account([
      { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: ISSUER, balance: '5000000', limit: '1', selling_liabilities: '0', buying_liabilities: '0' },
    ]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect(await screen.findByTestId('asset-market-holding')).toHaveTextContent('zu dünn');
    expect(screen.getByTestId('asset-market-holding')).not.toHaveTextContent(/XLM/);
    expect(screen.getByTestId('asset-market-thin')).toBeInTheDocument();
  });

  it('sehr kleine Preise und Betraege nie als 0 (AM-4)', async () => {
    hoisted.trades.mockResolvedValue({ records: [{
      base_asset_type: 'credit_alphanum4', base_asset_code: 'LDEX', base_asset_issuer: ISSUER, counter_asset_type: 'native',
      price: { n: 3, d: 100000000 }, ledger_close_time: new Date().toISOString(),
    }] });
    hoisted.aggs.mockResolvedValue({ records: [
      { timestamp: String(Date.now() - 3600 * 1000), open: '0.0000000', open_r: { n: '3', d: '100000000' }, close: '0.0000000', close_r: { n: '3', d: '100000000' }, high: '0.0000000', high_r: { n: '3', d: '100000000' }, low: '0.0000000', low_r: { n: '3', d: '100000000' }, counter_volume: '0.004', base_volume: '1', trade_count: '1' },
    ] });
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect((await screen.findByTestId('asset-market-last')).textContent).toBe(`${new Intl.NumberFormat('de', { maximumSignificantDigits: 6 }).format(3e-8)} XLM`);
    expect(screen.getByTestId('asset-market-24h')).toHaveTextContent('< 0,01 XLM');
    expect(screen.getByTestId('asset-chart-single')).toHaveTextContent('0,00000003');
  });

  it('Wechsel des Assets per Zurueck: alte Kurse verschwinden sofort, auch wenn die neue Antwort haengt (AM-1)', async () => {
    withMarket();
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect((await screen.findByTestId('asset-market-last')).textContent).toBe(`${nf7(0.0000114)} XLM`);
    const never = new Promise(() => {});
    for (const m of [hoisted.trades, hoisted.aggs, hoisted.book, hoisted.paths]) m.mockReturnValue(never);
    const { act } = await import('@testing-library/react');
    await act(async () => {
      window.history.pushState({}, '', `/assets/OTHER-${ISSUER}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('asset-detail-code').textContent).toBe('OTHER');
    expect(screen.queryByTestId('asset-market-last')).toBeNull();
    expect(screen.getByTestId('asset-market')).not.toHaveTextContent(nf7(0.0000114));
  });

  it('Verlauf: Tooltip per Pfeiltaste, 30 Tage laden erst bei Auswahl, Aktualisieren laedt neu', async () => {
    withMarket();
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    const chart = await screen.findByTestId('asset-chart');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByTestId('asset-chart-tooltip')).toHaveTextContent('XLM');
    expect(screen.getByTestId('asset-chart-live').textContent).toContain('XLM');
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByTestId('asset-chart-live').textContent).toContain(nf7(0.0000114));
    fireEvent.keyDown(chart, { key: 'Escape' });
    expect(screen.queryByTestId('asset-chart-tooltip')).toBeNull();
    expect(screen.getByTestId('asset-chart-live').textContent).toBe('');
    expect(hoisted.aggs).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '30 Tage' }));
    await waitFor(() => expect(hoisted.aggs).toHaveBeenCalledTimes(2));
    expect(hoisted.aggs.mock.calls[1][4]).toBe(24 * HOUR);
    fireEvent.click(screen.getByRole('button', { name: '24 h' }));
    expect(hoisted.aggs).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('asset-market-reload'));
    await waitFor(() => expect(hoisted.book).toHaveBeenCalledTimes(2));
  });

  it('Verlauf umkehren: Token je 1 XLM, zurueck zu XLM je Token; 1 Jahr laedt Tageswerte', async () => {
    withMarket();
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    const chart = await screen.findByTestId('asset-chart');
    expect(screen.getByTestId('asset-chart-title')).toHaveTextContent('XLM je 1 LDEX');
    fireEvent.click(screen.getByTestId('asset-chart-invert'));
    expect(screen.getByTestId('asset-chart-title')).toHaveTextContent('LDEX je 1 XLM');
    expect(screen.getByTestId('asset-chart-invert')).toHaveTextContent('In XLM anzeigen');
    fireEvent.keyDown(screen.getByTestId('asset-chart'), { key: 'End' });
    const live = screen.getByTestId('asset-chart-live').textContent;
    expect(live).toContain('LDEX');
    expect(live).not.toContain(nf7(0.0000114));
    fireEvent.click(screen.getByTestId('asset-chart-invert'));
    expect(screen.getByTestId('asset-chart-title')).toHaveTextContent('XLM je 1 LDEX');
    expect(chart).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1 Jahr' }));
    await waitFor(() => expect(hoisted.aggs).toHaveBeenCalledTimes(2));
    expect(hoisted.aggs.mock.calls[1][4]).toBe(24 * HOUR);
    expect(hoisted.aggs.mock.calls[1][3] - hoisted.aggs.mock.calls[1][2]).toBe(365 * 24 * HOUR);
    // KV-7: Knopf ohne aria-pressed, Zeichen nicht vorgelesen; KV-9: Hinweis zum Volumen nur umgekehrt
    expect(screen.getByTestId('asset-chart-invert')).not.toHaveAttribute('aria-pressed');
    expect(screen.queryByTestId('asset-chart-volume-note')).toBeNull();
    fireEvent.click(screen.getByTestId('asset-chart-invert'));
    expect(screen.getByTestId('asset-chart-volume-note')).toBeInTheDocument();
  });

  it('KV-2: nach Aktualisieren holt der lange Verlauf den neuen Stand; KV-6: Fehler wird bei erneuter Auswahl wiederholt', async () => {
    withMarket();
    hoisted.loadAccount.mockResolvedValue(account([]));
    const t0 = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      renderAt(`/assets/LDEX-${ISSUER}`);
      await screen.findByTestId('asset-chart');
      fireEvent.click(screen.getByRole('button', { name: '3 Monate' }));
      await waitFor(() => expect(hoisted.aggs).toHaveBeenCalledTimes(2));
      nowSpy.mockReturnValue(t0 + 10 * 60 * 1000);
      fireEvent.click(screen.getByTestId('asset-market-reload'));
      await waitFor(() => expect(hoisted.aggs).toHaveBeenCalledTimes(4));
      expect(hoisted.aggs.mock.calls[3][3]).toBe(t0 + 10 * 60 * 1000);

      hoisted.aggs.mockRejectedValue(new Error('down'));
      clearAggregationCache();
      fireEvent.click(screen.getByRole('button', { name: '6 Monate' }));
      await waitFor(() => expect(hoisted.aggs).toHaveBeenCalledTimes(5));
      await screen.findByText('nicht verfügbar');
      fireEvent.click(screen.getByRole('button', { name: '6 Monate' }));
      await waitFor(() => expect(hoisted.aggs).toHaveBeenCalledTimes(6));
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('AssetDetailPage: Angaben des Issuers und Logo', () => {
  function stubFacts(toml) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ issuerAccount: { home_domain: 'lumendex.online', flags: {} }, toml }),
    })));
  }
  beforeEach(() => { hoisted.loadAccount.mockResolvedValue(account([])); });

  it('zeigt die Angaben als Text, URL nicht klickbar, Logo ueber unser Backend', async () => {
    stubFacts({
      status: 'loaded', url: 'https://lumendex.online/.well-known/stellar.toml', currencies: [], error: '',
      matches: [{ code: 'LDEX', issuer: ISSUER, name: 'LumenDex', desc: 'Token der Börse', status: 'live',
        is_asset_anchored: false, attestation_of_reserve: 'https://evil.example/login', image: 'https://lumendex.online/logo.png' }],
    });
    renderAt(`/assets/LDEX-${ISSUER}`);
    await screen.findByTestId('issuer-toml-fields');
    expect(screen.getByText('Aus der stellar.toml des Issuers, nicht geprüft. Der Issuer kann hier alles eintragen.')).toBeTruthy();
    expect(screen.getByTestId('issuer-toml-name').textContent).toContain('LumenDex');
    expect(screen.getByTestId('issuer-toml-status').textContent).toContain('Aktiv');
    expect(screen.getByTestId('issuer-toml-is_asset_anchored').textContent).toContain('Nein');
    const att = screen.getByTestId('issuer-toml-attestation_of_reserve');
    expect(att.textContent).toContain('https://evil.example/login');
    expect(att.querySelector('a')).toBeNull();
    const logo = screen.getByTestId('asset-logo');
    const src = logo.getAttribute('src');
    expect(src).toContain('/api/trade/assets/logo?');
    expect(src).toContain('code=LDEX');
    expect(src).toContain(`issuer=${ISSUER}`);
    expect(src).toContain('network=PUBLIC');
    expect(src).not.toContain('lumendex.online');
    expect(logo.getAttribute('alt')).toBe('');
    fireEvent.error(logo);
    expect(screen.queryByTestId('asset-logo')).toBeNull();
  });

  it('nicht in der TOML gelistet: Hinweis, kein Logo', async () => {
    stubFacts({ status: 'loaded', url: 'https://lumendex.online/.well-known/stellar.toml', currencies: [], matches: [], error: '' });
    renderAt(`/assets/LDEX-${ISSUER}`);
    await screen.findByTestId('issuer-toml-not-listed');
    expect(screen.queryByTestId('asset-logo')).toBeNull();
  });

  it('TOML nicht geladen: Hinweis, kein Logo', async () => {
    stubFacts({ status: 'failed', url: '', currencies: [], matches: [], error: 'timeout' });
    renderAt(`/assets/LDEX-${ISSUER}`);
    await screen.findByText('Keine Angaben: Die stellar.toml des Issuers konnte nicht geladen werden oder es gibt keine.');
    expect(screen.queryByTestId('asset-logo')).toBeNull();
  });

  it('zeigt Holder und ausgegebene Menge aus Horizon /assets, mit Aufteilung', async () => {
    hoisted.loadAccount.mockResolvedValue(account([]));
    hoisted.assets.mockResolvedValue({ records: [
      { asset_code: 'ldex', asset_issuer: ISSUER, accounts: { authorized: 1, authorized_to_maintain_liabilities: 0, unauthorized: 0 }, balances: { authorized: '1', authorized_to_maintain_liabilities: '0', unauthorized: '0' } },
      { asset_code: 'LDEX', asset_issuer: ISSUER, accounts: { authorized: 1200, authorized_to_maintain_liabilities: 3, unauthorized: 2 },
        balances: { authorized: '1000.5', authorized_to_maintain_liabilities: '0.25', unauthorized: '0' },
        claimable_balances_amount: '10', liquidity_pools_amount: '0.0000001', contracts_amount: '0' },
    ] });
    renderAt(`/assets/LDEX-${ISSUER}`);
    const nf = new Intl.NumberFormat('de', { maximumFractionDigits: 7 });
    expect((await screen.findByTestId('asset-supply-holders')).textContent).toBe(nf.format(1205));
    expect(screen.getByTestId('asset-supply-holders-split').textContent).toContain(nf.format(1200));
    expect(screen.getByTestId('asset-supply-amount').textContent).toBe(`${nf.format(1010.7500001)} LDEX`);
    const breakdown = screen.getByTestId('asset-supply-breakdown').textContent;
    expect(breakdown).toContain(nf.format(1000.75));
    expect(breakdown).toContain(nf.format(10));
    expect(breakdown).not.toContain('Contracts');
  });

  it('ohne Datensatz: Hinweis, dass kein Konto eine Trustline haelt', async () => {
    hoisted.loadAccount.mockResolvedValue(account([]));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect(await screen.findByTestId('asset-supply-none')).toBeTruthy();
    expect(screen.queryByTestId('asset-supply-amount')).toBeNull();
  });

  it('Abruffehler zeigt keinen Wert', async () => {
    hoisted.loadAccount.mockResolvedValue(account([]));
    hoisted.assets.mockRejectedValue(new Error('net'));
    renderAt(`/assets/LDEX-${ISSUER}`);
    expect(await screen.findByTestId('asset-supply-error')).toBeTruthy();
    expect(screen.queryByTestId('asset-supply-holders')).toBeNull();
  });
});
