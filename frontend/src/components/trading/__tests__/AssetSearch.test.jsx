import React from 'react';
import { act, render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import i18n from '../../../i18n.js';
import AssetSearch from '../AssetSearch.jsx';
import { resetServerNetworkCalls, serverNetworkCalls } from '../../../test/horizonMock.js';
import { hasSessionSecrets, setSessionSecrets, SESSION_LOCKED_EVENT } from '../../../utils/sessionSecrets.js';

// Same well-known testnet-style keypairs used in tradingTransactions.test.js, so a
// human scanning both files recognizes the same fixture accounts.
const ACCOUNT = {
  secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
  publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
};
const ISSUER_PK = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const ASSET_CODE = 'FOO';

// Mutable boxes so individual tests can steer the fake Horizon server's
// responses without re-declaring the whole vi.mock factory (which is hoisted
// above the rest of this file by Vitest, so it cannot close over plain `let`
// declarations placed below it - only over vi.hoisted() state).
const hoisted = vi.hoisted(() => ({
  loadAccountMock: vi.fn(),
  submitTransactionMock: vi.fn(),
  loadTrustlinesMock: vi.fn(),
  resolveOrValidateAccountMock: vi.fn(async (input) => ({ accountId: input, muxedAddress: null })),
  offersRecords: { value: [] },
  pathRecords: { value: [] },
  createJob: vi.fn(),
  pendingRemember: [],
}));

vi.mock('../../../utils/sessionSecrets.js', async (importOriginal) => {
  const actual = await importOriginal();
  // Das Merken laeuft nach dem Senden asynchron: mitzaehlen, damit die Tests es abwarten koennen.
  return { ...actual, rememberSessionSecrets: (...args) => { const p = actual.rememberSessionSecrets(...args); hoisted.pendingRemember.push(p); return p; } };
});

vi.mock('../../../utils/multisigApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createMultisigJobFromXdr: (...args) => hoisted.createJob(...args),
}));

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../../test/horizonMock.js')).withNetworkServer({
  // SecretKeyModal also imports validateSecretKey from this module, so keep
  // every real export and only override the network-facing functions below.
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccountMock,
    feeStats: vi.fn(async () => ({ fee_charged: { mode: '100' } })),
    submitTransaction: hoisted.submitTransactionMock,
    offers: () => ({
      forAccount: () => ({
        order: () => ({
          limit: () => ({
            call: async () => ({ records: hoisted.offersRecords.value }),
          }),
        }),
      }),
    }),
    orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
    liquidityPools: () => ({ forAssets: () => ({ call: async () => ({ records: [] }) }) }),
    strictSendPaths: () => ({ call: async () => ({ records: hoisted.pathRecords.value }) }),
    root: async () => ({ network_passphrase: Networks.PUBLIC }),
  }),
  loadTrustlines: hoisted.loadTrustlinesMock,
  resolveOrValidateAccount: hoisted.resolveOrValidateAccountMock,
}));

// Builds a real stellar-sdk Account (so TransactionBuilder can use it) and
// tacks on the Horizon fields (signers/thresholds/...) AssetSearch reads.
function makeFundedAccount(publicKey, sequence = '100') {
  const account = new Account(publicKey, sequence);
  return Object.assign(account, {
    account_id: publicKey,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: [{ key: publicKey, weight: 1, type: 'ed25519_public_key' }],
    balances: [{ asset_type: 'native', balance: '10000.0000000' }],
    flags: {},
    subentry_count: 1,
  });
}

const ASSET_SEARCH_RESULT = { assetCode: ASSET_CODE, assetIssuer: ISSUER_PK };
const PRESENT_TRUSTLINE = {
  assetCode: ASSET_CODE,
  assetIssuer: ISSUER_PK,
  assetBalance: '1000.0000000',
  limit: '1000000.0000000',
  isAuthorized: true,
  isAuthorizedToMaintainLiabilities: true,
};

function mockFetch() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('trade/assets/search')) {
      return { ok: true, json: async () => ({ items: [ASSET_SEARCH_RESULT] }) };
    }
    if (u.includes('trade/assets/facts')) {
      return {
        ok: true,
        json: async () => ({
          issuerAccount: { home_domain: '', flags: {} },
          toml: { status: 'notChecked', currencies: [], matches: [] },
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AssetSearch />
    </I18nextProvider>
  );
}

// Searches for the fixture asset and selects it via the "Details" action,
// then waits for the trustline lookup (mocked via loadTrustlinesMock) to settle
// into the given badge text ("Trustline vorhanden" by default). Note the same
// text can also appear as the (disabled) row action label once selected, so we
// assert on "at least one" rather than a single unique match.
// Seit Teil C (13.11.) startet die Seite mit Konto im Modus Im Konto: fuer die Suche umschalten.
function switchToBlockchain() {
  const toggle = screen.queryByRole('button', { name: 'Auf der Blockchain' });
  if (toggle && toggle.getAttribute('aria-pressed') !== 'true') fireEvent.click(toggle);
}

async function searchAndSelectAsset(expectedTrustlineLabel = 'Trustline vorhanden') {
  switchToBlockchain();
  fireEvent.change(screen.getByPlaceholderText('USDC, G... oder USDC:G...'), {
    target: { value: ASSET_CODE },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
  await waitFor(() => {
    expect(screen.getAllByText(expectedTrustlineLabel).length).toBeGreaterThan(0);
  });
}

function typeSecret(value) {
  const input = document.querySelector('input[type="password"]');
  fireEvent.change(input, { target: { value } });
  return input;
}

function submitSecretModal() {
  fireEvent.click(screen.getByRole('button', { name: /senden|submit/i }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', mockFetch());
  window.localStorage.clear();
  window.localStorage.setItem('SKM_LAST_ACCOUNT', ACCOUNT.publicKey);

  hoisted.loadAccountMock.mockReset().mockImplementation(async () => makeFundedAccount(ACCOUNT.publicKey));
  hoisted.submitTransactionMock.mockReset().mockResolvedValue({ hash: 'submittedhash123' });
  hoisted.loadTrustlinesMock.mockReset().mockImplementation(async () => [PRESENT_TRUSTLINE]);
  hoisted.resolveOrValidateAccountMock.mockClear();
  hoisted.offersRecords.value = [];
  hoisted.pathRecords.value = [{ destination_amount: '100.0000000', path: [], source_asset_type: 'native' }];
});

afterEach(async () => {
  // Offenes Merken abwarten (erst Makrotask, dann die Promises), erst dann leeren: sonst taucht der
  // Key im naechsten Test auf.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.allSettled(hoisted.pendingRemember.splice(0));
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('AssetSearch - Limit-Order erstellen (manageSellOffer)', () => {
  it('creates a limit order and shows the success message with the tx hash', async () => {
    renderPage();
    await searchAndSelectAsset();

    const limitSection = screen.getByText('Limit-Orders').closest('section');
    const [amountInput, priceInput] = within(limitSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.change(priceInput, { target: { value: '0.75' } });
    fireEvent.click(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' }));

    // Confirmation dialog appears before any signing happens.
    await screen.findByText('Limit-Order bestätigen');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter zur Signatur' }));

    typeSecret(ACCOUNT.secret);
    submitSecretModal();

    await screen.findByText(/Limit-Order wurde platziert\. Transaktion:/);
    expect(screen.getByText(/submittedhash123/)).toBeInTheDocument();

    expect(hoisted.submitTransactionMock).toHaveBeenCalledTimes(1);
    const submittedTx = hoisted.submitTransactionMock.mock.calls[0][0];
    const op = submittedTx.operations[0];
    expect(op.type).toBe('manageSellOffer');
    expect(op.amount).toBe('50.0000000');
    expect(op.price).toBe('0.75');
    expect(op.selling.code).toBe(ASSET_CODE);
  });

  it('signiert mit dem Server des Ablaufnetzes und bricht nach einem Wechsel in einem anderen Tab ab', async () => {
    renderPage();
    await searchAndSelectAsset();
    const limitSection = screen.getByText('Limit-Orders').closest('section');
    const [amountInput, priceInput] = within(limitSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.change(priceInput, { target: { value: '0.75' } });
    fireEvent.click(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' }));
    await screen.findByText('Limit-Order bestätigen');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter zur Signatur' }));
    typeSecret(ACCOUNT.secret);

    resetServerNetworkCalls();
    // Waehrend der Ablauf das Konto laedt, wechselt ein anderer Tab das Netz.
    hoisted.loadAccountMock.mockImplementation(async () => {
      window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
      return makeFundedAccount(ACCOUNT.publicKey);
    });
    submitSecretModal();

    expect((await screen.findAllByText(i18n.t('createAccount:networkChanged.funderAborted'))).length).toBeGreaterThan(0);
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
    expect(serverNetworkCalls).toEqual(['PUBLIC']);
  });

  it('rejects an invalid price without ever contacting the network', async () => {
    renderPage();
    await searchAndSelectAsset();

    const limitSection = screen.getByText('Limit-Orders').closest('section');
    const [amountInput, priceInput] = within(limitSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.change(priceInput, { target: { value: '-1' } });
    fireEvent.click(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' }));

    await screen.findByText('Bitte einen gültigen Preis größer 0 eingeben.');
    expect(screen.queryByText('Limit-Order bestätigen')).not.toBeInTheDocument();
    // loadAccount/loadTrustlines already ran for the page's own account info,
    // but no transaction may ever be built or submitted for an invalid price.
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('surfaces a Horizon submit failure (e.g. insufficient balance) as an error and keeps the modal open', async () => {
    // Models Horizon rejecting the transaction with op_underfunded: a non-ambiguous
    // failure (has result_codes), so submitTransactionSafely rethrows it as-is.
    const underfundedError = Object.assign(new Error('tx_failed: op_underfunded'), {
      response: { status: 400, data: { extras: { result_codes: { operations: ['op_underfunded'] } } } },
    });
    hoisted.submitTransactionMock.mockReset().mockRejectedValue(underfundedError);

    renderPage();
    await searchAndSelectAsset();

    const limitSection = screen.getByText('Limit-Orders').closest('section');
    const [amountInput, priceInput] = within(limitSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.change(priceInput, { target: { value: '0.75' } });
    fireEvent.click(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weiter zur Signatur' }));

    typeSecret(ACCOUNT.secret);
    submitSecretModal();

    await screen.findByText(/op_underfunded/);
    // The modal stays open so the user can retry instead of losing context.
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument();
    expect(screen.queryByText(/Limit-Order wurde platziert/)).not.toBeInTheDocument();
  });
});

describe('AssetSearch - Limit-Order stornieren', () => {
  it('shows a confirmation dialog and cancels the order with amount 0', async () => {
    hoisted.offersRecords.value = [{
      id: '555',
      selling_asset_type: 'credit_alphanum4',
      selling_asset_code: ASSET_CODE,
      selling_asset_issuer: ISSUER_PK,
      buying_asset_type: 'native',
      amount: '50.0000000',
      price: '0.7500000',
      price_r: { n: 3, d: 4 },
    }];

    renderPage();
    await searchAndSelectAsset();

    const limitSection = screen.getByText('Limit-Orders').closest('section');
    fireEvent.click(await within(limitSection).findByRole('button', { name: 'Löschen' }));

    // Confirmation dialog with the cancel-specific warning must appear first.
    await screen.findByText('Limit-Order löschen');
    expect(screen.getByText('Diese Aktion löscht die offene Offer, indem sie mit Menge 0 ersetzt wird.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter zur Signatur' }));

    typeSecret(ACCOUNT.secret);
    submitSecretModal();

    await screen.findByText(/Limit-Order wurde gelöscht\. Transaktion:/);

    expect(hoisted.submitTransactionMock).toHaveBeenCalledTimes(1);
    const submittedTx = hoisted.submitTransactionMock.mock.calls[0][0];
    const op = submittedTx.operations[0];
    expect(op.type).toBe('manageSellOffer');
    expect(op.amount).toBe('0.0000000');
    expect(op.offerId).toBe('555');
  });
});

describe('AssetSearch - Ziel-Token-Picker im Swap', () => {
  const CLEAR = 'Eingabe löschen';
  const TARGET_QUERY = `${ASSET_CODE}:${ISSUER_PK}`;

  async function openTargetPicker() {
    renderPage();
    await searchAndSelectAsset();
    const swapSection = screen.getByText('Swap-Preview').closest('section');
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Token -> Token' }));
    return swapSection;
  }

  it('setzt ueber den Loeschen-Button Eingabe, Treffer und Auswahl zurueck', async () => {
    const swapSection = await openTargetPicker();
    expect(within(swapSection).queryByRole('button', { name: CLEAR })).toBeNull();
    const input = within(swapSection).getByLabelText('Ziel-Token');
    fireEvent.change(input, { target: { value: TARGET_QUERY } });
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Ziel suchen' }));
    await within(swapSection).findByTestId('asset-picker-selected');
    expect(within(swapSection).getByTestId('asset-picker-results')).toBeInTheDocument();

    fireEvent.click(within(swapSection).getByRole('button', { name: CLEAR }));
    expect(input).toHaveValue('');
    expect(within(swapSection).queryByTestId('asset-picker-selected')).toBeNull();
    expect(within(swapSection).queryByTestId('asset-picker-results')).toBeNull();
    expect(within(swapSection).queryByRole('button', { name: CLEAR })).toBeNull();
  });

  it('verwirft eine laufende Suche beim Loeschen', async () => {
    const swapSection = await openTargetPicker();
    let resolveSearch;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveSearch = resolve; })));
    fireEvent.change(within(swapSection).getByLabelText('Ziel-Token'), { target: { value: TARGET_QUERY } });
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Ziel suchen' }));
    fireEvent.click(within(swapSection).getByRole('button', { name: CLEAR }));
    expect(within(swapSection).getByRole('button', { name: 'Ziel suchen' })).toBeEnabled();
    await act(async () => { resolveSearch({ ok: true, json: async () => ({ items: [ASSET_SEARCH_RESULT] }) }); });
    expect(within(swapSection).queryByTestId('asset-picker-results')).toBeNull();
    expect(within(swapSection).queryByTestId('asset-picker-selected')).toBeNull();
  });
});

describe('AssetSearch - Market-Swap ausführen', () => {
  it('computes the slippage-adjusted minimum and executes the swap', async () => {
    renderPage();
    await searchAndSelectAsset();

    const swapSection = screen.getByText('Swap-Preview').closest('section');
    const [amountInput, slippageInput] = within(swapSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '20' } });
    fireEvent.change(slippageInput, { target: { value: '2' } });
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Preis prüfen' }));

    // 100 destination units at 2% slippage -> minimum of 98.
    await within(swapSection).findByText(/98\s*FOO/);
    expect(within(swapSection).getByText(/100\.0000000\s*FOO/)).toBeInTheDocument();

    fireEvent.click(within(swapSection).getByRole('button', { name: 'Swap ausführen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weiter zur Signatur' }));

    typeSecret(ACCOUNT.secret);
    submitSecretModal();

    await screen.findByText(/Swap wurde ausgeführt\. Transaktion:/);
    const submittedTx = hoisted.submitTransactionMock.mock.calls[0][0];
    const op = submittedTx.operations[0];
    expect(op.type).toBe('pathPaymentStrictSend');
    expect(op.sendAmount).toBe('20.0000000');
    expect(op.destMin).toBe('98.0000000');
    expect(op.destination).toBe(ACCOUNT.publicKey);
  });

  it('blocks trading (preflight) when the loaded account does not exist on the network yet', async () => {
    const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } });
    hoisted.loadAccountMock.mockReset().mockRejectedValue(notFound);
    hoisted.loadTrustlinesMock.mockReset().mockRejectedValue(notFound);

    renderPage();
    await searchAndSelectAsset('Trustline-Status konnte nicht geladen werden');

    // Neither the swap nor the limit-order UI may render for an account that
    // was never funded/created on the network - both live behind the same
    // "trustline present" gate, which an unresolvable account can never reach.
    expect(screen.queryByText('Swap-Preview')).not.toBeInTheDocument();
    expect(screen.queryByText('Limit-Orders')).not.toBeInTheDocument();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });
});

// Ergebnisliste: nur Details. Der Weg zur Trustline fuehrt immer ueber die Detailansicht
// mit den Token-Fakten (ADR 0002), nie direkt aus einer Zeile in die Bestaetigung.
describe('AssetSearch - Ergebnisliste nur mit Details', () => {
  beforeEach(() => {
    hoisted.loadTrustlinesMock.mockReset().mockImplementation(async () => []);
  });

  async function search() {
    switchToBlockchain();
    fireEvent.change(screen.getByPlaceholderText('USDC, G... oder USDC:G...'), { target: { value: ASSET_CODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
    return screen.findByRole('button', { name: 'Details' });
  }

  it('die Liste hat je Zeile nur den Button Details', async () => {
    renderPage();
    await search();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getAllByRole('button').map((b) => b.textContent)).toEqual(['Details']);
  });

  it('Details oeffnet die Detailansicht, dort oeffnet Trustline hinzufuegen die Bestaetigung', async () => {
    renderPage();
    fireEvent.click(await search());
    // Detailansicht mit Trustline-Abschnitt, Bestaetigung noch nicht offen
    await screen.findByText('Trustline vorbereiten');
    expect(screen.getAllByText('Trustline fehlt').length).toBeGreaterThan(0);
    expect(screen.queryByText('Trustline bestätigen')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Trustline hinzufügen' }));
    expect(await screen.findByText('Trustline bestätigen')).toBeInTheDocument();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('aus der Liste gibt es keinen direkten Weg in die Bestaetigung', async () => {
    renderPage();
    await search();
    const table = screen.getByRole('table');
    // Jeder Zeilen-Button fuehrt hoechstens in die Detailansicht. Details zuletzt: Ein
    // anderer Button (frueher Trustline) wuerde sonst nach der Auswahl gesperrt und nie geprueft.
    const row = within(table).getAllByRole('row')[1];
    const buttons = within(row).getAllByRole('button');
    const ordered = [...buttons.filter((b) => b.textContent !== 'Details'), ...buttons.filter((b) => b.textContent === 'Details')];
    for (const button of ordered) fireEvent.click(button);
    await screen.findByText('Trustline vorbereiten');
    // Auch nach abgeschlossener Trustline-Pruefung kein automatisches Nachschieben des Dialogs
    await waitFor(() => expect(hoisted.loadTrustlinesMock).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText('Trustline bestätigen')).toBeNull();
  });
});

// Multisig im Trading (ADR 0007): Auswahl Job/lokal/XDR nur, wenn kein einzelner Signer reicht.
describe('AssetSearch - Multisig-Ablauf', () => {
  const COSIGNER = Keypair.random();
  // med 2, beide Signer Gewicht 1: kein einzelner Signer erreicht changeTrust/payment/manageOffer
  function makeTwoOfTwo(acct, med = 2) {
    acct.thresholds = { low_threshold: 0, med_threshold: med, high_threshold: 2 };
    acct.signers = [
      { key: ACCOUNT.publicKey, weight: 1, type: 'ed25519_public_key' },
      { key: COSIGNER.publicKey(), weight: 1, type: 'ed25519_public_key' },
    ];
    return acct;
  }
  const decodeJobTx = (call = 0) => TransactionBuilder.fromXDR(hoisted.createJob.mock.calls[call][0].txXdr, Networks.PUBLIC);
  const OPTIONS_TITLE = 'Option wählen';
  const LOCAL = 'Alle Signaturen lokal eingeben';
  const jobRadio = () => document.querySelector('input[name="multisig-flow-choice"][value="job"]');
  const localRadio = () => document.querySelector('input[name="multisig-flow-choice"][value="local"]');

  beforeEach(() => {
    hoisted.createJob.mockReset().mockResolvedValue({ id: 'job-7', hash: 'jobhash7', xdr: 'AAAA', requiredWeight: 2, collectedSigners: [] });
  });

  async function openTrustlineConfirm({ med = 2 } = {}) {
    hoisted.loadAccountMock.mockImplementation(async () => makeTwoOfTwo(makeFundedAccount(ACCOUNT.publicKey), med));
    hoisted.loadTrustlinesMock.mockReset().mockImplementation(async () => []);
    renderPage();
    await searchAndSelectAsset('Trustline fehlt');
    // Kontodaten (Signer, Schwellen) muessen geladen sein, bevor entschieden wird
    await waitFor(() => expect(hoisted.loadAccountMock).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'Trustline hinzufügen' }));
    await screen.findByText('Trustline bestätigen');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('trading:assetSearch.trustlineConfirm.continue') }));
  }

  it('2-von-2: Trustline zeigt die Auswahl; Job-Weg legt einen Job ohne lokale Signatur an', async () => {
    await openTrustlineConfirm();
    expect(await screen.findByText(OPTIONS_TITLE)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(jobRadio().checked).toBe(true);
    expect(jobRadio().disabled).toBe(false);

    resetServerNetworkCalls();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await waitFor(() => expect(hoisted.createJob).toHaveBeenCalledTimes(1));
    expect(hoisted.createJob.mock.calls[0][0]).toMatchObject({ network: 'public', accountId: ACCOUNT.publicKey });
    const tx = decodeJobTx();
    expect(tx.signatures).toHaveLength(0);
    expect(tx.operations.map((op) => op.type)).toEqual(['changeTrust']);
    expect(tx.operations[0].line.code).toBe(ASSET_CODE);
    // Zeitfenster aus den Einstellungen (Standard 24 h), nicht die 60 s des direkten Wegs
    expect(Number(tx.timeBounds.maxTime) - Math.floor(Date.now() / 1000)).toBeGreaterThan(3600);
    // Konto, Sequence und Passphrase aus dem Netz des Ablaufs
    expect(serverNetworkCalls.every((n) => n === 'PUBLIC')).toBe(true);
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/job-7/)).toBeInTheDocument();
  });

  it('2-von-2: lokaler Weg verlangt alle Keys und sendet mit beiden Signaturen', async () => {
    await openTrustlineConfirm();
    await screen.findByText(OPTIONS_TITLE);
    fireEvent.click(localRadio());
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    const inputs = await waitFor(() => {
      const found = Array.from(document.querySelectorAll('input[type="password"]'));
      expect(found.length).toBe(2);
      return found;
    });
    // Nur ein Key reicht nicht
    fireEvent.change(inputs[0], { target: { value: ACCOUNT.secret } });
    submitSecretModal();
    expect(await screen.findByText(/Benötigt: 2, vorhanden: 1/)).toBeInTheDocument();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();

    fireEvent.change(inputs[1], { target: { value: COSIGNER.secret() } });
    submitSecretModal();
    await waitFor(() => expect(hoisted.submitTransactionMock).toHaveBeenCalledTimes(1));
    const submitted = hoisted.submitTransactionMock.mock.calls[0][0];
    expect(submitted.signatures).toHaveLength(2);
    expect(hoisted.createJob).not.toHaveBeenCalled();
  });

  it('Gegenprobe: mehrere Signer, aber einer reicht: keine Auswahl, direkt der Secret-Key-Dialog', async () => {
    await openTrustlineConfirm({ med: 1 });
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
    expect(screen.queryByText(OPTIONS_TITLE)).toBeNull();
    expect(screen.queryByText(LOCAL)).toBeNull();
  });

  it('2-von-2: Swap als Job gesperrt, mit Hinweis; lokal vorausgewaehlt', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => makeTwoOfTwo(makeFundedAccount(ACCOUNT.publicKey)));
    renderPage();
    await searchAndSelectAsset();
    const swapSection = screen.getByText('Swap-Preview').closest('section');
    const [amountInput] = within(swapSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '20' } });
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Preis prüfen' }));
    await within(swapSection).findByText(/100\.0000000\s*FOO/);
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Swap ausführen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weiter zur Signatur' }));

    await screen.findByText(OPTIONS_TITLE);
    expect(jobRadio().disabled).toBe(true);
    expect(localRadio().checked).toBe(true);
    expect(screen.getByTestId('signing-options-note')).toHaveTextContent(i18n.t('trading:assetSearch.multisig.swapJobDisabled'));
    expect(hoisted.createJob).not.toHaveBeenCalled();
  });

  const xdrRadio = () => document.querySelector('input[name="multisig-flow-choice"][value="xdr"]');
  const signingSummary = () => screen.getByTestId('liquidity-signing-summary');
  const contextChangedText = () => i18n.t('trading:assetSearch.multisig.contextChanged');

  async function openSwapOptions() {
    const swapSection = screen.getByText('Swap-Preview').closest('section');
    const [amountInput] = within(swapSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '20' } });
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Preis prüfen' }));
    await within(swapSection).findByText(/100\.0000000\s*FOO/);
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Swap ausführen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weiter zur Signatur' }));
  }

  it('T-1: Netzwechsel bei offener Auswahl schliesst sie: kein Job, kein XDR, Hinweis', async () => {
    await openTrustlineConfirm();
    await screen.findByText(OPTIONS_TITLE);
    act(() => {
      window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
      window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'TESTNET' }));
    });
    await waitFor(() => expect(screen.queryByText(OPTIONS_TITLE)).toBeNull());
    expect(screen.getAllByText(contextChangedText()).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Weiter' })).toBeNull();
    expect(hoisted.createJob).not.toHaveBeenCalled();
    expect(screen.queryByText(/job-7/)).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('T-1: Kontowechsel bei offener Auswahl schliesst sie: kein Job, kein XDR, Hinweis', async () => {
    await openTrustlineConfirm();
    await screen.findByText(OPTIONS_TITLE);
    const other = Keypair.random().publicKey();
    act(() => {
      window.dispatchEvent(new CustomEvent('stm:accountSelected', { detail: { address: other } }));
    });
    await waitFor(() => expect(screen.queryByText(OPTIONS_TITLE)).toBeNull());
    expect(screen.getAllByText(contextChangedText()).length).toBeGreaterThan(0);
    expect(hoisted.createJob).not.toHaveBeenCalled();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('T-2: Auswahl und Job-Ergebnis zeigen Code und vollstaendigen Issuer', async () => {
    await openTrustlineConfirm();
    await screen.findByText(OPTIONS_TITLE);
    expect(signingSummary()).toHaveTextContent(`${ASSET_CODE}, Issuer ${ISSUER_PK}`);
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await waitFor(() => expect(hoisted.createJob).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('liquidity-job-summary')).toHaveTextContent(`${ASSET_CODE}, Issuer ${ISSUER_PK}`);
  });

  it('T-2/T-3: Swap als XDR zeigt Quelle, Ziel mit Issuer, Betrag, destMin und den Kurs-Hinweis', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => makeTwoOfTwo(makeFundedAccount(ACCOUNT.publicKey)));
    renderPage();
    await searchAndSelectAsset();
    await openSwapOptions();
    await screen.findByText(OPTIONS_TITLE);
    const summary = signingSummary();
    expect(summary).toHaveTextContent(i18n.t('trading:assetSearch.multisig.summary.sendAsset'));
    expect(summary).toHaveTextContent(`${ASSET_CODE}, Issuer ${ISSUER_PK}`);
    expect(summary).toHaveTextContent(/XLM/);
    expect(summary).toHaveTextContent(i18n.t('trading:assetSearch.multisig.summary.destMin'));
    expect(screen.getByTestId('signing-options-note')).toHaveTextContent(i18n.t('trading:assetSearch.multisig.swapJobDisabled'));
    fireEvent.click(xdrRadio());
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    const result = await screen.findByTestId('liquidity-job-summary');
    expect(result).toHaveTextContent(`${ASSET_CODE}, Issuer ${ISSUER_PK}`);
    expect(result).toHaveTextContent('20');
    expect(result).toHaveTextContent(i18n.t('trading:assetSearch.multisig.swapXdrNote'));
    expect(hoisted.createJob).not.toHaveBeenCalled();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('T-4: Schwellen low=1 med=0 high=3: Swap ohne Auswahl, direkt der Secret-Key-Dialog', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => {
      const acct = makeTwoOfTwo(makeFundedAccount(ACCOUNT.publicKey));
      acct.thresholds = { low_threshold: 1, med_threshold: 0, high_threshold: 3 };
      return acct;
    });
    renderPage();
    await searchAndSelectAsset();
    await waitFor(() => expect(hoisted.loadAccountMock).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await openSwapOptions();
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
    expect(screen.queryByText(OPTIONS_TITLE)).toBeNull();
  });

  it('T-5: Ergebnis einer Limit-Order rechnet die Schwelle aus manageSellOffer (ohne requiredWeight vom Backend)', async () => {
    hoisted.createJob.mockResolvedValue({ id: 'job-8', hash: 'jobhash8', xdr: 'AAAA', requiredWeight: null, collectedSigners: [] });
    hoisted.loadAccountMock.mockImplementation(async () => makeTwoOfTwo(makeFundedAccount(ACCOUNT.publicKey)));
    renderPage();
    await searchAndSelectAsset();
    const limitSection = screen.getByText('Limit-Orders').closest('section');
    const [amountInput, priceInput] = within(limitSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.change(priceInput, { target: { value: '0.75' } });
    fireEvent.click(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weiter zur Signatur' }));
    await screen.findByText(OPTIONS_TITLE);
    expect(signingSummary()).toHaveTextContent(`${ASSET_CODE}, Issuer ${ISSUER_PK}`);
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await waitFor(() => expect(hoisted.createJob).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(i18n.t('multisig:confirm.result.job.progress', { collected: 0, required: 2 }))).toBeInTheDocument();
    expect(screen.getByTestId('liquidity-job-summary')).toHaveTextContent(`${ASSET_CODE}, Issuer ${ISSUER_PK}`);
  });

  it('2-von-2: Limit-Order als Job ohne lokale Signatur', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => makeTwoOfTwo(makeFundedAccount(ACCOUNT.publicKey)));
    renderPage();
    await searchAndSelectAsset();
    const limitSection = screen.getByText('Limit-Orders').closest('section');
    const [amountInput, priceInput] = within(limitSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.change(priceInput, { target: { value: '0.75' } });
    fireEvent.click(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weiter zur Signatur' }));

    await screen.findByText(OPTIONS_TITLE);
    expect(jobRadio().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await waitFor(() => expect(hoisted.createJob).toHaveBeenCalledTimes(1));
    const tx = decodeJobTx();
    expect(tx.signatures).toHaveLength(0);
    expect(tx.operations[0].type).toBe('manageSellOffer');
    expect(tx.operations[0].amount).toBe('50.0000000');
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });
});

// Gemerkter Session-Key: Trading signiert nach der Bestaetigung damit, der Key-Dialog kommt nur,
// wenn kein passender Key gemerkt ist.
describe('AssetSearch - gemerkter Session-Key', () => {
  const REMEMBER = 'Secret Key für diese Sitzung merken';

  async function placeOffer(limitSection) {
    const [amountInput, priceInput] = within(limitSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.change(priceInput, { target: { value: '0.75' } });
    fireEvent.click(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' }));
    await screen.findByText('Limit-Order bestätigen');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter zur Signatur' }));
  }
  const limitSectionOf = () => screen.getByText('Limit-Orders').closest('section');

  it('Merken im Dialog (Standard): die zweite Limit-Order signiert ohne Key-Dialog', async () => {
    renderPage();
    await searchAndSelectAsset();
    await placeOffer(limitSectionOf());
    typeSecret(ACCOUNT.secret);
    submitSecretModal();
    await screen.findByText(/Limit-Order wurde platziert\. Transaktion:/);
    await waitFor(() => expect(hasSessionSecrets(ACCOUNT.publicKey)).toBe(true));

    await placeOffer(limitSectionOf());
    await waitFor(() => expect(hoisted.submitTransactionMock).toHaveBeenCalledTimes(2));
    expect(document.querySelector('input[type="password"]')).toBeNull();
    const tx = hoisted.submitTransactionMock.mock.calls[1][0];
    expect(tx.operations[0].type).toBe('manageSellOffer');
    expect(tx.signatures).toHaveLength(1);
  });

  it('Gegenprobe: Haken Merken aus: nichts gespeichert, die zweite Limit-Order fragt den Key wieder ab', async () => {
    renderPage();
    await searchAndSelectAsset();
    await placeOffer(limitSectionOf());
    fireEvent.click(screen.getByLabelText(REMEMBER));
    typeSecret(ACCOUNT.secret);
    submitSecretModal();
    await screen.findByText(/Limit-Order wurde platziert\. Transaktion:/);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hasSessionSecrets(ACCOUNT.publicKey)).toBe(false);

    await placeOffer(limitSectionOf());
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(hoisted.submitTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('Gegenprobe: schlaegt das Senden fehl, wird der Key nicht gemerkt', async () => {
    hoisted.submitTransactionMock.mockReset().mockRejectedValue(Object.assign(new Error('tx_failed: op_underfunded'), {
      response: { status: 400, data: { extras: { result_codes: { operations: ['op_underfunded'] } } } },
    }));
    renderPage();
    await searchAndSelectAsset();
    await placeOffer(limitSectionOf());
    typeSecret(ACCOUNT.secret);
    submitSecretModal();
    await screen.findByText(/op_underfunded/);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hasSessionSecrets(ACCOUNT.publicKey)).toBe(false);
  });

  it('bereits gemerkter Key: Limit-Order geht nach der Bestaetigung direkt raus, ohne Key-Dialog', async () => {
    await setSessionSecrets(ACCOUNT.publicKey, { [ACCOUNT.publicKey]: ACCOUNT.secret });
    renderPage();
    await searchAndSelectAsset();
    await placeOffer(limitSectionOf());
    await screen.findByText(/Limit-Order wurde platziert\. Transaktion:/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(hoisted.submitTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('bereits gemerkter Key: Swap signiert nach der Bestaetigung ohne Key-Dialog', async () => {
    await setSessionSecrets(ACCOUNT.publicKey, { [ACCOUNT.publicKey]: ACCOUNT.secret });
    renderPage();
    await searchAndSelectAsset();
    const swapSection = screen.getByText('Swap-Preview').closest('section');
    const [amountInput, slippageInput] = within(swapSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '20' } });
    fireEvent.change(slippageInput, { target: { value: '2' } });
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Preis prüfen' }));
    await within(swapSection).findByText(/98\s*FOO/);
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Swap ausführen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weiter zur Signatur' }));
    await screen.findByText(/Swap wurde ausgeführt\. Transaktion:/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(hoisted.submitTransactionMock.mock.calls[0][0].operations[0].type).toBe('pathPaymentStrictSend');
  });

  it('Fehler bei der automatischen Signatur wird angezeigt, kein stilles Scheitern', async () => {
    await setSessionSecrets(ACCOUNT.publicKey, { [ACCOUNT.publicKey]: ACCOUNT.secret });
    hoisted.submitTransactionMock.mockReset().mockRejectedValue(Object.assign(new Error('tx_failed: op_underfunded'), {
      response: { status: 400, data: { extras: { result_codes: { operations: ['op_underfunded'] } } } },
    }));
    renderPage();
    await searchAndSelectAsset();
    await placeOffer(limitSectionOf());
    expect((await screen.findAllByText(/op_underfunded/)).length).toBeGreaterThan(0);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('Fremd-Key unter dem eigenen Konto abgelegt, aber kein Signer des Kontos: Key-Dialog, nichts gesendet', async () => {
    const stranger = Keypair.random();
    await setSessionSecrets(ACCOUNT.publicKey, { [stranger.publicKey()]: stranger.secret() });
    renderPage();
    await searchAndSelectAsset();
    await placeOffer(limitSectionOf());
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('gemerkter Key eines anderen Kontos wird nicht genommen: Key-Dialog', async () => {
    const stranger = Keypair.random();
    await setSessionSecrets(stranger.publicKey(), { [stranger.publicKey()]: stranger.secret() });
    renderPage();
    await searchAndSelectAsset();
    await placeOffer(limitSectionOf());
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('Sperre nach der Bestaetigung: nichts signiert, nichts gesendet, Hinweis', async () => {
    await setSessionSecrets(ACCOUNT.publicKey, { [ACCOUNT.publicKey]: ACCOUNT.secret });
    renderPage();
    await searchAndSelectAsset();
    // Das Laden des Kontos im Ablauf haelt an, bis die Sperre ausgeloest ist.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    hoisted.loadAccountMock.mockImplementation(async () => { await gate; return makeFundedAccount(ACCOUNT.publicKey); });
    await placeOffer(limitSectionOf());
    await act(async () => { window.dispatchEvent(new CustomEvent(SESSION_LOCKED_EVENT)); });
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect((await screen.findAllByText(/Die Sitzung wurde gesperrt/)).length).toBeGreaterThan(0);
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('Gegenprobe: Sperre VOR der Bestaetigung bricht nichts ab (neue Aktion signiert normal)', async () => {
    await setSessionSecrets(ACCOUNT.publicKey, { [ACCOUNT.publicKey]: ACCOUNT.secret });
    renderPage();
    await searchAndSelectAsset();
    await act(async () => { window.dispatchEvent(new CustomEvent(SESSION_LOCKED_EVENT)); });
    // Die Sperre loescht hier nur das Event, der Key bleibt (Test): die Aktion laeuft durch.
    await placeOffer(limitSectionOf());
    await screen.findByText(/Limit-Order wurde platziert\. Transaktion:/);
    expect(hoisted.submitTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('Veraltete Kontodaten (Konto ist inzwischen 2-von-2): Fehler wird gezeigt, Konto neu geladen, naechster Versuch zeigt die Auswahl', async () => {
    const cosigner = Keypair.random();
    await setSessionSecrets(ACCOUNT.publicKey, { [ACCOUNT.publicKey]: ACCOUNT.secret });
    let twoOfTwo = false;
    hoisted.loadAccountMock.mockImplementation(async () => {
      const acct = makeFundedAccount(ACCOUNT.publicKey);
      if (twoOfTwo) {
        acct.thresholds = { low_threshold: 0, med_threshold: 2, high_threshold: 2 };
        acct.signers = [
          { key: ACCOUNT.publicKey, weight: 1, type: 'ed25519_public_key' },
          { key: cosigner.publicKey(), weight: 1, type: 'ed25519_public_key' },
        ];
      }
      return acct;
    });
    renderPage();
    await searchAndSelectAsset();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    twoOfTwo = true; // das Konto aendert sich, die Seite weiss es noch nicht
    await placeOffer(limitSectionOf());
    expect((await screen.findAllByText(/reichen nicht aus/)).length).toBeGreaterThan(0);
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
    // Konto wurde neu geladen: der zweite Versuch signiert nicht wieder automatisch, sondern zeigt die Auswahl.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await placeOffer(limitSectionOf());
    expect(await screen.findByText('Option wählen')).toBeInTheDocument();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('Merken in unsicherer Umgebung (kein crypto.subtle): gesendet wird, nichts wird gespeichert, Hinweis erscheint', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (a) => globalThis.crypto.getRandomValues(a), subtle: undefined });
    renderPage();
    await searchAndSelectAsset();
    await placeOffer(limitSectionOf());
    typeSecret(ACCOUNT.secret);
    submitSecretModal();
    await screen.findByText(/Limit-Order wurde platziert/);
    expect((await screen.findAllByText(/konnte nicht gespeichert werden/)).length).toBeGreaterThan(0);
    expect(hasSessionSecrets(ACCOUNT.publicKey)).toBe(false);
  });
});

describe('AssetSearch - Vorbelegtes Asset (Handeln aus der Asset-Detailseite)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('sucht das vorgemerkte Asset exakt und oeffnet die Detailansicht, ohne zu senden', async () => {
    const { setPendingTradingAsset } = await import('../../../utils/appNavigation.js');
    setPendingTradingAsset({ code: ASSET_CODE, issuer: ISSUER_PK });
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Trustline vorhanden').length).toBeGreaterThan(0));
    const searchCall = fetch.mock.calls.map(([u]) => String(u)).find((u) => u.includes('trade/assets/search'));
    expect(searchCall).toContain(`code=${ASSET_CODE}`);
    expect(searchCall).toContain(`issuer=${ISSUER_PK}`);
    expect(screen.getByPlaceholderText('USDC, G... oder USDC:G...').value).toBe(`${ASSET_CODE}:${ISSUER_PK}`);
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('liest ?asset=CODE:ISSUER aus der URL, ein ungueltiger Wert loest keine Suche aus', async () => {
    window.history.replaceState({}, '', `/trading/assets?asset=${ASSET_CODE}:${ISSUER_PK}`);
    const first = renderPage();
    await waitFor(() => expect(screen.getAllByText('Trustline vorhanden').length).toBeGreaterThan(0));
    first.unmount();

    fetch.mockClear();
    window.history.replaceState({}, '', `/trading/assets?asset=${ASSET_CODE}:GKAPUTT`);
    renderPage();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(fetch.mock.calls.some(([u]) => String(u).includes('trade/assets/search'))).toBe(false);
  });

  it('ohne Vorbelegung bleibt die Suche leer', async () => {
    renderPage();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(fetch.mock.calls.some(([u]) => String(u).includes('trade/assets/search'))).toBe(false);
    switchToBlockchain();
    expect(screen.getByPlaceholderText('USDC, G... oder USDC:G...').value).toBe('');
  });
});

describe('AssetSearch - Modus Im Konto (Teil C, 13.11.)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  function withFooTrustline() {
    hoisted.loadAccountMock.mockImplementation(async () => {
      const account = makeFundedAccount(ACCOUNT.publicKey);
      account.balances = [
        ...account.balances,
        { asset_type: 'credit_alphanum4', asset_code: ASSET_CODE, asset_issuer: ISSUER_PK, balance: '1000.0000000' },
      ];
      return account;
    });
  }

  it('startet mit Konto im Modus Im Konto und zeigt dessen Token, ohne Suche im Backend', async () => {
    withFooTrustline();
    renderPage();
    expect(screen.getByRole('button', { name: 'Im Konto' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('button', { name: `${ASSET_CODE} handeln` })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('USDC, G... oder USDC:G...')).toBeNull();
    expect(fetch.mock.calls.some(([u]) => String(u).includes('trade/assets/search'))).toBe(false);
  });

  it('Handeln oeffnet die Detailansicht des Tokens, ohne zu senden', async () => {
    withFooTrustline();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: `${ASSET_CODE} handeln` }));
    await waitFor(() => expect(screen.getAllByText('Trustline vorhanden').length).toBeGreaterThan(0));
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('Details oeffnet die Asset-Detailseite', async () => {
    withFooTrustline();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: `Details zu ${ASSET_CODE}` }));
    expect(window.location.pathname).toBe(`/assets/${ASSET_CODE}-${ISSUER_PK}`);
  });

  it('ohne Konto startet die Seite mit der Suche auf der Blockchain', () => {
    window.localStorage.removeItem('SKM_LAST_ACCOUNT');
    renderPage();
    expect(screen.getByRole('button', { name: 'Auf der Blockchain' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('USDC, G... oder USDC:G...')).toBeInTheDocument();
  });
  it('W1: Vorbelegung waehlt bei USDC und usdc desselben Issuers genau die richtige Schreibweise', async () => {
    fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('trade/assets/search')) {
        return { ok: true, json: async () => ({ items: [{ assetCode: ASSET_CODE.toLowerCase(), assetIssuer: ISSUER_PK }, ASSET_SEARCH_RESULT] }) };
      }
      return { ok: true, json: async () => ({ issuerAccount: { home_domain: '', flags: {} }, toml: { status: 'notChecked', currencies: [], matches: [] } }) };
    });
    const { setPendingTradingAsset } = await import('../../../utils/appNavigation.js');
    setPendingTradingAsset({ code: ASSET_CODE, issuer: ISSUER_PK });
    renderPage();
    // PRESENT_TRUSTLINE ist FOO: nur bei exakter Auswahl erscheint Trustline vorhanden
    await waitFor(() => expect(screen.getAllByText('Trustline vorhanden').length).toBeGreaterThan(0));
    expect(screen.queryByText('Trustline fehlt')).toBeNull();
  });

  it('W4: Netzwechsel verwirft die Token des alten Netzes sofort', async () => {
    withFooTrustline();
    renderPage();
    expect(await screen.findByRole('button', { name: `${ASSET_CODE} handeln` })).toBeInTheDocument();
    hoisted.loadAccountMock.mockImplementation(() => new Promise(() => {})); // neues Netz antwortet noch nicht
    await act(async () => {
      window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
      window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'TESTNET' }));
    });
    expect(screen.queryByRole('button', { name: `${ASSET_CODE} handeln` })).toBeNull();
    expect(screen.getByText('Token des Kontos werden geladen …')).toBeInTheDocument();
  });
  it('Konto im Netz nicht gefunden: Kontoliste zeigt Hinweis statt endlosem Laden', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => { throw Object.assign(new Error('Not Found'), { response: { status: 404 } }); });
    renderPage();
    expect(await screen.findByTestId('account-tokens-error')).toHaveTextContent('existiert in diesem Netz nicht');
  });

  it('Blockchain-Suche hat einen Loeschen-Button', async () => {
    renderPage();
    switchToBlockchain();
    const input = screen.getByPlaceholderText('USDC, G... oder USDC:G...');
    fireEvent.change(input, { target: { value: 'LDEX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Eingabe löschen' }));
    expect(input.value).toBe('');
  });
});
