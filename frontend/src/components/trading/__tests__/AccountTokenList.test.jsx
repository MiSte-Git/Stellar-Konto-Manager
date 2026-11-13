import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import AccountTokenList from '../AccountTokenList.jsx';
import { DEFAULT_HIDE_OPTIONS, isTokenHidden, tokensFromAccount } from '../accountTokens.js';
import { resetTokenFlagCache } from '../hooks/useTokenFlags.js';

const ME = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const GOOD = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const BAD = 'GCTAWY73CNMLONWUID7TMJT55NW4MS2MHMW26O222UGG2PRFE6ZXEH7N';
const DOWN = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const hoisted = vi.hoisted(() => ({ paths: vi.fn() }));
vi.mock('../../../utils/stellar/stellarUtils.js', async (orig) => ({
  ...(await orig()),
  getHorizonServerForNetwork: () => ({
    strictSendPaths: (source) => ({ call: () => hoisted.paths(source.getCode()) }),
  }),
}));

const account = {
  balances: [
    { asset_type: 'native', balance: '100' },
    { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: GOOD, balance: '5' },
    { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: BAD, balance: '127165.150949' },
    { asset_type: 'credit_alphanum12', asset_code: 'DUSTCOIN', asset_issuer: GOOD, balance: '0' },
    { asset_type: 'credit_alphanum4', asset_code: 'OFFL', asset_issuer: DOWN, balance: '1' },
    { asset_type: 'liquidity_pool_shares', liquidity_pool_id: 'ab'.repeat(32), balance: '1' },
  ],
};

function expertFetch() {
  return vi.fn(async (url) => {
    const issuer = new URL(String(url), 'http://x').searchParams.get('issuer');
    if (issuer === BAD) return { ok: true, json: async () => ({ status: 'listed', tags: ['malicious'] }) };
    if (issuer === DOWN) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ status: 'unlisted', tags: [] }) };
  });
}

function renderList(props = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountTokenList account={account} accountId={ME} network="PUBLIC" onTrade={() => {}} onOpenDetails={() => {}} {...props} />
    </I18nextProvider>,
  );
}
const codes = () => screen.queryAllByTestId('account-token-code').map((el) => el.textContent);

beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  resetTokenFlagCache();
  vi.stubGlobal('fetch', expertFetch());
  hoisted.paths.mockReset().mockImplementation(async (code) => ({ records: code === 'USDC' ? [{ destination_amount: '0.1' }] : [] }));
});
afterEach(() => vi.unstubAllGlobals());

describe('accountTokens', () => {
  it('nur Token, ohne XLM und Pool-Anteile, sortiert', () => {
    expect(tokensFromAccount(account).map((t) => t.code)).toEqual(['DUSTCOIN', 'LDEX', 'OFFL', 'USDC']);
  });
  it('Standard: Schalter aus, SCAM vorausgewaehlt; nur sichere Befunde blenden aus', () => {
    expect(DEFAULT_HIDE_OPTIONS).toEqual({ mode: 'all', scam: true, zero: false, noMarket: false });
    const tk = { code: 'LDEX', issuer: BAD, balance: '0' };
    const flags = { scam: { [BAD]: 'yes' }, market: { [`LDEX:${BAD}`]: 'no' } };
    expect(isTokenHidden(tk, DEFAULT_HIDE_OPTIONS, flags)).toBe(false);
    expect(isTokenHidden(tk, { ...DEFAULT_HIDE_OPTIONS, mode: 'hide' }, flags)).toBe(true);
    expect(isTokenHidden(tk, { mode: 'hide', scam: true }, { scam: { [BAD]: 'unknown' } })).toBe(false);
    expect(isTokenHidden(tk, { mode: 'hide', scam: true }, { scam: { [BAD]: 'loading' } })).toBe(false);
    // Nur diese zeigen: nur sichere Treffer bleiben
    expect(isTokenHidden(tk, { mode: 'only', scam: true }, flags)).toBe(false);
    expect(isTokenHidden(tk, { mode: 'only', scam: true }, { scam: { [BAD]: 'unknown' } })).toBe(true);
    expect(isTokenHidden({ ...tk, issuer: GOOD, balance: '1' }, { mode: 'only', scam: true }, { scam: { [GOOD]: 'no' } })).toBe(true);
  });
});

describe('AccountTokenList', () => {
  it('zeigt beim Oeffnen alle Token und prueft nichts', async () => {
    renderList();
    expect(codes()).toEqual(['DUSTCOIN', 'LDEX', 'OFFL', 'USDC']);
    expect(screen.getByTestId('account-tokens-count')).toHaveTextContent('4 von 4 Token');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(fetch).not.toHaveBeenCalled();
    expect(hoisted.paths).not.toHaveBeenCalled();
  });

  it('Ausblenden an: SCAM wird nach Pruefung ausgeblendet, nicht pruefbarer Issuer bleibt sichtbar', async () => {
    renderList();
    fireEvent.click(screen.getByTestId('account-tokens-mode-hide'));
    expect(screen.getByTestId('account-tokens-hide-scam')).toBeChecked();
    await waitFor(() => expect(codes()).toEqual(['DUSTCOIN', 'OFFL', 'USDC']));
    expect(screen.getByTestId('account-tokens-count')).toHaveTextContent('3 von 4 Token, 1 ausgeblendet');
    // je Issuer nur eine Abfrage (GOOD hat zwei Token)
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(hoisted.paths).not.toHaveBeenCalled();
  });

  it('Saldo 0 und kein Marktpreis', async () => {
    renderList();
    fireEvent.click(screen.getByTestId('account-tokens-mode-hide'));
    fireEvent.click(screen.getByTestId('account-tokens-hide-scam'));
    fireEvent.click(screen.getByTestId('account-tokens-hide-zero'));
    await waitFor(() => expect(codes()).toEqual(['LDEX', 'OFFL', 'USDC']));
    fireEvent.click(screen.getByTestId('account-tokens-hide-market'));
    await waitFor(() => expect(codes()).toEqual(['USDC']));
    expect(hoisted.paths).toHaveBeenCalledTimes(4);
  });

  it('Marktpruefung mit Fehler blendet nicht aus', async () => {
    hoisted.paths.mockImplementation(async (code) => { if (code === 'OFFL') throw new Error('down'); return { records: [] }; });
    renderList();
    fireEvent.click(screen.getByTestId('account-tokens-mode-hide'));
    fireEvent.click(screen.getByTestId('account-tokens-hide-scam'));
    fireEvent.click(screen.getByTestId('account-tokens-hide-market'));
    await waitFor(() => expect(codes()).toEqual(['OFFL']));
  });

  it('Filter, Details und Handeln geben den Token weiter', async () => {
    const onTrade = vi.fn();
    const onOpenDetails = vi.fn();
    renderList({ onTrade, onOpenDetails });
    fireEvent.change(screen.getByTestId('account-tokens-filter'), { target: { value: 'ld' } });
    expect(codes()).toEqual(['LDEX']);
    const row = screen.getByTestId('account-token');
    fireEvent.click(within(row).getByRole('button', { name: 'LDEX handeln' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Details zu LDEX' }));
    expect(onTrade).toHaveBeenCalledWith({ code: 'LDEX', issuer: BAD, balance: '127165.150949' });
    expect(onOpenDetails).toHaveBeenCalledWith({ code: 'LDEX', issuer: BAD, balance: '127165.150949' });
    fireEvent.change(screen.getByTestId('account-tokens-filter'), { target: { value: 'nichts' } });
    expect(screen.getByTestId('account-tokens-nomatch')).toBeInTheDocument();
  });

  it('ohne Konto ein Hinweis', () => {
    renderList({ accountId: '', account: null });
    expect(screen.getByTestId('account-tokens-noaccount')).toBeInTheDocument();
  });
  it('W2: Token mit dem Code XLM bekommt die Warnung', () => {
    renderList({ account: { balances: [{ asset_type: 'credit_alphanum4', asset_code: 'XLM', asset_issuer: BAD, balance: '1' }] } });
    expect(screen.getByTestId('activity-fake-native')).toBeInTheDocument();
  });
  it('Nur diese zeigen: nur Token mit Warn-Tag, nicht pruefbare fehlen', async () => {
    renderList();
    fireEvent.click(screen.getByTestId('account-tokens-mode-only'));
    expect(screen.getByTestId('account-tokens-mode-only')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(codes()).toEqual(['LDEX']));
    expect(screen.getByTestId('account-tokens-count')).toHaveTextContent('1 von 4 Token passen zum Filter');
    fireEvent.click(screen.getByTestId('account-tokens-mode-all'));
    expect(codes()).toEqual(['DUSTCOIN', 'LDEX', 'OFFL', 'USDC']);
  });

  it('Konto im Netz nicht vorhanden: Hinweis statt endlosem Laden', () => {
    renderList({ account: null, accountError: 'notFound' });
    expect(screen.getByTestId('account-tokens-error')).toHaveTextContent('existiert in diesem Netz nicht');
    expect(screen.queryByText('Token des Kontos werden geladen …')).toBeNull();
  });
});
