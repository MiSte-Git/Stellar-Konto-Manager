import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import LiquidityPoolsPage from '../LiquidityPoolsPage.jsx';
import { poolIdFor } from '../../utils/stellar/liquidityPools.js';

const hoisted = vi.hoisted(() => ({
  loadAccount: vi.fn(),
  accountCall: vi.fn(),
  poolByIdCall: vi.fn(),
  forAssetsCall: vi.fn(),
  submit: vi.fn(),
  createJob: vi.fn(),
  collected: [],
}));

vi.mock('../../utils/multisigApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createMultisigJobFromXdr: (...args) => hoisted.createJob(...args),
}));

vi.mock('../../utils/stellar/submitTransactionSafely.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTransactionSafely: (...args) => hoisted.submit(...args),
}));

// Schlanker Ersatz fuer das SecretKeyModal: liefert die vorbereiteten Signer.
vi.mock('../../components/SecretKeyModal.jsx', () => ({
  default: ({ onConfirm, onCancel }) => (
    <div data-testid="secret-modal">
      <button type="button" onClick={() => onConfirm(hoisted.collected)}>keys-ok</button>
      <button type="button" onClick={onCancel}>keys-cancel</button>
    </div>
  ),
}));

vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: (id) => hoisted.loadAccount(id),
    feeStats: async () => ({}),
    root: async () => ({ network_passphrase: Networks.PUBLIC }),
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
// normalizeNativePool prueft die Pool-ID gegen die Assets, daher eine echte ID (XLM/EURC)
const OTHER_POOL_ID = poolIdFor(Asset.native(), new Asset('EURC', USDC_ISSUER));

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
    hoisted.poolByIdCall.mockImplementation(async (id) => (id === OTHER_POOL_ID
      ? poolRecord(id, { reserves: [{ asset: 'native', amount: '10.0000000' }, { asset: `EURC:${USDC_ISSUER}`, amount: '5.0000000' }] })
      : poolRecord(id)));
    renderPage({ publicKey: PK });
    const rows = await screen.findAllByTestId('pool-position');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('XLM / USDC');
    expect(rows[0]).toHaveTextContent('Native Stellar Pool');
    expect(rows[0]).toHaveTextContent('25 %');
    // Betraege mit Einheit im Wert
    expect(rows[0]).toHaveTextContent('Pool Shares25,0 Pool Shares');
    expect(rows[0]).toHaveTextContent('Gegenwert XLM250,0 XLM');
    expect(rows[0]).toHaveTextContent(`Gegenwert USDC50,0 USDC:${USDC_ISSUER.slice(0, 8)}...${USDC_ISSUER.slice(-8)}`);
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
    expect(await screen.findByText('Keine Positionen. Über Pool finden kannst du in einen Pool einzahlen.')).toBeInTheDocument();
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
    expect(facts).toHaveTextContent('Reserve XLM1.000,0 XLM');
    expect(facts).toHaveTextContent(`Reserve USDC200,0 USDC:${USDC_ISSUER.slice(0, 8)}...${USDC_ISSUER.slice(-8)}`);
    expect(facts).toHaveTextContent('Total Pool Shares100,0 Pool Shares');
  });

  it('setzt den Paar-Fehler zurueck, sobald sich am Asset-Paar etwas aendert', async () => {
    renderPage({ publicKey: '' });
    const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    const pairError = 'Bitte für beide Seiten ein Asset wählen.';

    // Art wechseln (erste Seite XLM -> Token)
    submit();
    expect(screen.getByText(pairError)).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('Token')[0]);
    expect(screen.queryByText(pairError)).toBeNull();

    // Suche gestartet (auch eine ungueltige Eingabe zaehlt)
    submit();
    expect(screen.getByText(pairError)).toBeInTheDocument();
    const [firstSearch] = screen.getAllByLabelText('Token suchen');
    fireEvent.change(firstSearch, { target: { value: '!!' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Suchen' })[0]);
    expect(screen.queryByText(pairError)).toBeNull();

    // Token gewaehlt (exakte Eingabe waehlt den Treffer direkt)
    submit();
    expect(screen.getByText(pairError)).toBeInTheDocument();
    fireEvent.change(firstSearch, { target: { value: `USDC:${USDC_ISSUER}` } });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Suchen' })[0]); });
    expect(await screen.findByText('Gewähltes Token')).toBeInTheDocument();
    expect(screen.queryByText(pairError)).toBeNull();

    // zweite Seite: zweimal dasselbe Asset, dann Art der zweiten Seite wechseln
    fireEvent.click(screen.getAllByLabelText('XLM')[1]);
    fireEvent.click(screen.getAllByLabelText('XLM')[0]);
    submit();
    expect(screen.getByText('Bitte zwei verschiedene Assets wählen.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('Token')[1]);
    expect(screen.queryByText('Bitte zwei verschiedene Assets wählen.')).toBeNull();
  });

  describe('veraltete Pool-Fakten im Modus Asset-Paar', () => {
    // XLM (erste Seite) / USDC (zweite Seite) laden
    async function loadPair() {
      renderPage({ publicKey: '' });
      fireEvent.change(screen.getByLabelText('Token suchen'), { target: { value: `USDC:${USDC_ISSUER}` } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Suchen' })); });
      await screen.findByText('Gewähltes Token');
      hoisted.forAssetsCall.mockResolvedValue({ records: [poolRecord()] });
      fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
      await screen.findByTestId('pool-facts');
    }

    it('verwirft den Pool, wenn sich die Art einer Seite aendert', async () => {
      await loadPair();
      fireEvent.click(screen.getAllByLabelText('Token')[0]);
      expect(screen.queryByTestId('pool-facts')).toBeNull();
    });

    it('verwirft den Pool beim Abwaehlen ueber den Loeschen-Button und leert den Picker', async () => {
      await loadPair();
      fireEvent.click(screen.getByRole('button', { name: 'Eingabe und Auswahl löschen' }));
      expect(screen.queryByTestId('pool-facts')).toBeNull();
      expect(screen.getByLabelText('Token suchen')).toHaveValue('');
      expect(screen.queryByTestId('asset-picker-selected')).toBeNull();
      expect(screen.queryByTestId('asset-picker-results')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Eingabe und Auswahl löschen' })).toBeNull();
    });

    it('verwirft den Pool nicht beim Tippen, aber sobald eine neue Suche die Auswahl zuruecksetzt', async () => {
      await loadPair();
      fireEvent.change(screen.getByLabelText('Token suchen'), { target: { value: `USDC:${USDC_ISSUER} ` } });
      expect(screen.getByTestId('pool-facts')).toBeInTheDocument();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Suchen' })); });
      await screen.findByText('Gewähltes Token');
      expect(screen.queryByTestId('pool-facts')).toBeNull();
    });

    it('verwirft eine laufende Antwort, wenn sich das Paar waehrend des Ladens aendert', async () => {
      renderPage({ publicKey: '' });
      fireEvent.change(screen.getByLabelText('Token suchen'), { target: { value: `USDC:${USDC_ISSUER}` } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Suchen' })); });
      await screen.findByText('Gewähltes Token');
      let resolvePool;
      hoisted.forAssetsCall.mockImplementation(() => new Promise((resolve) => { resolvePool = resolve; }));
      fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
      fireEvent.click(screen.getAllByLabelText('Token')[0]);
      await act(async () => { resolvePool({ records: [poolRecord()] }); });
      expect(screen.queryByTestId('pool-facts')).toBeNull();
    });

    it('laesst einen per ?pool= geladenen Pool beim Oeffnen stehen', async () => {
      window.history.replaceState({}, '', `/trading/pools?pool=${POOL_ID}`);
      hoisted.poolByIdCall.mockResolvedValue(poolRecord());
      renderPage({ publicKey: '' });
      expect(await screen.findByTestId('pool-facts')).toBeInTheDocument();
    });
  });

  it('setzt beim Moduswechsel Fehler und gefundenen Pool zurueck', async () => {
    renderPage({ publicKey: '' });
    // Paar-Fehler verschwindet beim Wechsel zu Pool-ID und kommt nicht zurueck
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    expect(screen.getByText('Bitte für beide Seiten ein Asset wählen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Pool-ID' }));
    expect(screen.queryByText('Bitte für beide Seiten ein Asset wählen.')).toBeNull();

    // ID-Fehler verschwindet beim Wechsel zum Asset-Paar
    fireEvent.change(screen.getByLabelText('Pool-ID (64 Hex-Zeichen)'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    expect(await screen.findByText(/keine gültige Pool-ID/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Asset-Paar' }));
    expect(screen.queryByText(/keine gültige Pool-ID/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Pool-ID' }));
    expect(screen.queryByText(/keine gültige Pool-ID/)).toBeNull();
    expect(screen.queryByText('Bitte für beide Seiten ein Asset wählen.')).toBeNull();
  });

  it('laesst einen gefundenen Pool beim Moduswechsel verschwinden', async () => {
    window.history.replaceState({}, '', `/trading/pools?pool=${POOL_ID}`);
    hoisted.poolByIdCall.mockResolvedValue(poolRecord());
    renderPage({ publicKey: '' });
    expect(await screen.findByTestId('pool-facts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Asset-Paar' }));
    expect(screen.queryByTestId('pool-facts')).toBeNull();
  });

  it('meldet eine leere Pool-ID mit eigenem Hinweis', () => {
    renderPage({ publicKey: '' });
    fireEvent.click(screen.getByRole('tab', { name: 'Pool-ID' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pool laden' }));
    expect(screen.getByText('Bitte eine Pool-ID eingeben.')).toBeInTheDocument();
    expect(screen.queryByText(/keine gültige Pool-ID/)).toBeNull();
    expect(hoisted.poolByIdCall).not.toHaveBeenCalled();
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

  it('sperrt Einzahlen ohne Konto und schliesst den Dialog bei Kontowechsel', async () => {
    window.history.replaceState({}, '', `/trading/pools?pool=${POOL_ID}`);
    hoisted.poolByIdCall.mockResolvedValue(poolRecord());
    hoisted.accountCall.mockResolvedValue({ balances: [] });
    hoisted.loadAccount.mockReturnValue(new Promise(() => {}));
    const view = renderPage({ publicKey: '' });
    expect(await screen.findByRole('button', { name: 'Einzahlen' })).toBeDisabled();
    expect(screen.getByText('Zum Einzahlen wird ein existierendes Konto benötigt.')).toBeInTheDocument();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <LiquidityPoolsPage network="PUBLIC" publicKey={PK} />
      </I18nextProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Einzahlen' }));
    expect(await screen.findByTestId('deposit-dialog')).toBeInTheDocument();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <LiquidityPoolsPage network="PUBLIC" publicKey={PK2} />
      </I18nextProvider>
    );
    await waitFor(() => expect(screen.queryByTestId('deposit-dialog')).toBeNull());
  });

  it('zeigt das Ergebnis eines Submits, dessen Dialog beim Netzwechsel abgebaut wurde, ohne Pool-Suche im neuen Netz', async () => {
    window.history.replaceState({}, '', `/trading/pools?pool=${POOL_ID}`);
    const owner = Keypair.random();
    const shareLine = { asset_type: 'liquidity_pool_shares', liquidity_pool_id: POOL_ID, balance: '25.0000000' };
    const usdcLine = { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC_ISSUER, balance: '0', limit: '1000', buying_liabilities: '0', selling_liabilities: '0', is_authorized: true };
    hoisted.accountCall.mockResolvedValue({ balances: [{ asset_type: 'native', balance: '100' }, shareLine] });
    hoisted.poolByIdCall.mockResolvedValue(poolRecord());
    hoisted.loadAccount.mockImplementation(async () => Object.assign(new Account(owner.publicKey(), '1'), {
      balances: [{ asset_type: 'native', balance: '100.0000000', selling_liabilities: '0' }, usdcLine, shareLine],
      subentry_count: 3,
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      signers: [{ key: owner.publicKey(), weight: 1, type: 'ed25519_public_key' }],
    }));
    hoisted.collected = [{ keypair: owner }];
    let rejectSubmit;
    hoisted.submit.mockReset();
    hoisted.submit.mockImplementation(() => new Promise((_resolve, reject) => { rejectSubmit = reject; }));

    const view = renderPage({ publicKey: owner.publicKey() });
    // Pool aus ?pool= ist in der Pool-Ansicht geladen
    expect(await screen.findByTestId('pool-facts')).toHaveTextContent(POOL_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Abheben' }));
    fireEvent.click(await screen.findByRole('button', { name: '50 %' }));
    fireEvent.click(screen.getByRole('button', { name: 'Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    await waitFor(() => expect(hoisted.submit).toHaveBeenCalledTimes(1));

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <LiquidityPoolsPage network="TESTNET" publicKey={owner.publicKey()} />
      </I18nextProvider>
    );
    await waitFor(() => expect(screen.queryByTestId('withdraw-dialog')).toBeNull());
    const callsBefore = hoisted.accountCall.mock.calls.length;
    const { AmbiguousSubmitResultError } = await import('../../utils/stellar/submitTransactionSafely.js');
    await act(async () => { rejectSubmit(new AmbiguousSubmitResultError('feedface')); });

    const note = await screen.findByTestId('liquidity-background-result');
    expect(note).toHaveTextContent('Status unklar – nicht erneut senden');
    expect(note).toHaveTextContent('feedface');
    // Hinweis nennt Netz und Konto des Absendens, nicht das aktuelle Netz
    const pk = owner.publicKey();
    expect(note).toHaveTextContent(`Gesendet im Netz Mainnet vom Konto ${pk.slice(0, 8)}...${pk.slice(-8)}.`);
    // Positionen werden neu geladen
    await waitFor(() => expect(hoisted.accountCall.mock.calls.length).toBeGreaterThan(callsBefore));
    // keine Pool-Suche im neuen Netz (die Pool-Ansicht bleibt nach dem Netzwechsel leer)
    expect(screen.queryByTestId('pool-facts')).toBeNull();
    expect(screen.queryByTestId('pool-not-found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hinweis schließen' }));
    expect(screen.queryByTestId('liquidity-background-result')).toBeNull();
  });

  it('meldet einen Multisig-Job, der waehrend eines Netzwechsels erstellt wurde, mit Netz, Konto und Job-ID', async () => {
    const owner = Keypair.random();
    const cosigner = Keypair.random();
    const shareLine = { asset_type: 'liquidity_pool_shares', liquidity_pool_id: POOL_ID, balance: '25.0000000' };
    const usdcLine = { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC_ISSUER, balance: '0', limit: '1000', buying_liabilities: '0', selling_liabilities: '0', is_authorized: true };
    hoisted.accountCall.mockResolvedValue({ balances: [{ asset_type: 'native', balance: '100' }, shareLine] });
    hoisted.poolByIdCall.mockResolvedValue(poolRecord());
    hoisted.loadAccount.mockImplementation(async () => Object.assign(new Account(owner.publicKey(), '1'), {
      balances: [{ asset_type: 'native', balance: '100.0000000', selling_liabilities: '0' }, usdcLine, shareLine],
      subentry_count: 3,
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
      signers: [{ key: owner.publicKey(), weight: 1, type: 'ed25519_public_key' }, { key: cosigner.publicKey(), weight: 1, type: 'ed25519_public_key' }],
    }));
    let resolveJob;
    hoisted.createJob.mockReset();
    hoisted.createJob.mockImplementation(() => new Promise((resolve) => { resolveJob = resolve; }));

    const view = renderPage({ publicKey: owner.publicKey() });
    fireEvent.click(await screen.findByRole('button', { name: 'Abheben' }));
    fireEvent.click(await screen.findByRole('button', { name: '50 %' }));
    fireEvent.click(screen.getByRole('button', { name: 'Operationen prüfen' }));
    // Multisig-Konto: Optionsdialog, Standard ist "Multisig-Job erstellen"
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    expect(await screen.findByRole('radio', { name: /Multisig-Job erstellen/ })).toBeChecked();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Weiter' })); });
    await waitFor(() => expect(hoisted.createJob).toHaveBeenCalledTimes(1));

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <LiquidityPoolsPage network="TESTNET" publicKey={owner.publicKey()} />
      </I18nextProvider>
    );
    await waitFor(() => expect(screen.queryByTestId('withdraw-dialog')).toBeNull());
    await act(async () => { resolveJob({ id: 'job-77', hash: 'jobhash77', xdr: 'x' }); });

    const note = await screen.findByTestId('liquidity-background-result');
    const pk = owner.publicKey();
    expect(note).toHaveTextContent('Ein Multisig-Job wurde nach dem Schließen des Dialogs erstellt.');
    expect(note).toHaveTextContent(`Erstellt im Netz Mainnet für das Konto ${pk.slice(0, 8)}...${pk.slice(-8)}, Job-ID job-77.`);
    expect(hoisted.createJob.mock.calls[0][0].network).toBe('public');
  });

  it('sperrt Einzahlen bei leerem Pool', async () => {
    window.history.replaceState({}, '', `/trading/pools?pool=${POOL_ID}`);
    hoisted.poolByIdCall.mockResolvedValue(poolRecord(POOL_ID, { total_shares: '0.0000000', reserves: [{ asset: 'native', amount: '0.0000000' }, { asset: `USDC:${USDC_ISSUER}`, amount: '0.0000000' }] }));
    hoisted.accountCall.mockResolvedValue({ balances: [] });
    renderPage({ publicKey: PK });
    expect(await screen.findByRole('button', { name: 'Einzahlen' })).toBeDisabled();
  });
});
