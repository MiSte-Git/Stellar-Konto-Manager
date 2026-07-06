import React from 'react';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account } from '@stellar/stellar-sdk';
import i18n from '../../../i18n.js';
import AssetSearch from '../AssetSearch.jsx';

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
}));

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  // SecretKeyModal also imports validateSecretKey from this module, so keep
  // every real export and only override the network-facing functions below.
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccountMock,
    feeStats: vi.fn(async () => ({ fee_charged: { mode: '100' } })),
    submitTransaction: hoisted.submitTransactionMock,
    offers: () => ({
      forAccount: () => ({
        limit: () => ({
          call: async () => ({ records: hoisted.offersRecords.value }),
        }),
      }),
    }),
    orderbook: () => ({ call: async () => ({ bids: [], asks: [] }) }),
    liquidityPools: () => ({ forAssets: () => ({ call: async () => ({ records: [] }) }) }),
    strictSendPaths: () => ({ call: async () => ({ records: hoisted.pathRecords.value }) }),
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
async function searchAndSelectAsset(expectedTrustlineLabel = 'Trustline vorhanden') {
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

afterEach(() => {
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
