import React from 'react';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import i18n from '../../../i18n.js';
import AssetSearch from '../AssetSearch.jsx';
import { readAccountEntry, resetAccountSendGuardMemory, writeAccountEntry } from '../../../utils/submitGuard/accountSendGuard.js';
import { writeSentEntry } from '../../../utils/batchPayment/batchPaymentStore.js';

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
}));

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
        limit: () => ({
          call: async () => ({ records: hoisted.offersRecords.value }),
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


const H = (c) => c.repeat(64);

async function openLimitOrder() {
  renderPage();
  await searchAndSelectAsset();
  const limitSection = screen.getByText('Limit-Orders').closest('section');
  const [amountInput, priceInput] = within(limitSection).getAllByRole('textbox');
  fireEvent.change(amountInput, { target: { value: '50' } });
  fireEvent.change(priceInput, { target: { value: '0.75' } });
  return limitSection;
}

async function sendLimitOrder(limitSection) {
  fireEvent.click(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Weiter zur Signatur' }));
  typeSecret(ACCOUNT.secret);
  submitSecretModal();
}

describe('AssetSearch - unklarer Sendestatus (Sendeschutz wie Zahlung senden)', () => {
  // Wie ein Neuladen der Seite: der Arbeitsspeicher des Sendeschutzes (bekannte unklare Eintraege).
  beforeEach(() => { resetAccountSendGuardMemory(); });

  it('unklar: Eintrag vor dem Submit, Kasten mit Hash, Aktionen gesperrt, kein Knopf zum Freigeben', async () => {
    hoisted.submitTransactionMock.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    const limitSection = await openLimitOrder();
    await sendLimitOrder(limitSection);

    // Die Nachfrage bei Horizon (8 Versuche im Abstand von 1,5 s) laeuft vor dem Ergebnis "unklar".
    const panel = await screen.findByTestId('send-ambiguous', {}, { timeout: 20000 });
    const stored = readAccountEntry('PUBLIC', ACCOUNT.publicKey);
    expect(stored).toMatchObject({ status: 'ambiguous', origin: 'trade', source: ACCOUNT.publicKey });
    expect(stored.cause).toMatchObject({ kind: 'network' });
    expect(within(panel).getByTestId('send-ambiguous-hash')).toHaveTextContent(stored.hash);
    expect(within(panel).getByText(/Aktion: Limit-Order/)).toBeInTheDocument();
    // Die Aktionen sind gesperrt; der alte Knopf "Status geprueft - Aktionen wieder freigeben" gibt es nicht mehr.
    expect(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' })).toBeDisabled();
    expect(screen.queryByText(/Aktionen wieder freigeben/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Status geprüft/ })).not.toBeInTheDocument();
    // Freigabe nur ueber Horizon ("Status jetzt pruefen"), nie manuell.
    expect(within(panel).getByTestId('send-ambiguous-check')).toBeInTheDocument();
    expect(hoisted.submitTransactionMock).toHaveBeenCalledTimes(1);
  }, 40000);

  it('unklarer Eintrag aus "Zahlung senden" sperrt das Trading fuer dieses Konto', async () => {
    writeAccountEntry('PUBLIC', ACCOUNT.publicKey, {
      hash: H('a'), at: Date.now(), status: 'ambiguous', maxTime: Math.floor(Date.now() / 1000) + 3600, seq: '101', source: ACCOUNT.publicKey,
      origin: 'payment', cause: { kind: 'timeout', status: null },
    });
    const limitSection = await openLimitOrder();
    expect(await screen.findByTestId('send-ambiguous')).toBeInTheDocument();
    expect(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' })).toBeDisabled();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('unklarer Eintrag der Sammelzahlung mit diesem Konto sperrt das Trading', async () => {
    writeSentEntry('PUBLIC', 'fp1', {
      hash: H('b'), at: Date.now(), status: 'ambiguous', maxTime: Math.floor(Date.now() / 1000) + 3600, seq: '7', source: ACCOUNT.publicKey,
    });
    const limitSection = await openLimitOrder();
    expect(await screen.findByTestId('send-ambiguous')).toBeInTheDocument();
    expect(within(limitSection).getByRole('button', { name: 'Limit-Order platzieren' })).toBeDisabled();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('Swap ist bei unklarem Eintrag ebenfalls gesperrt', async () => {
    writeAccountEntry('PUBLIC', ACCOUNT.publicKey, {
      hash: H('a'), at: Date.now(), status: 'ambiguous', maxTime: Math.floor(Date.now() / 1000) + 3600, seq: '101', source: ACCOUNT.publicKey, origin: 'trade',
    });
    renderPage();
    await searchAndSelectAsset();
    const swapSection = screen.getByText('Swap-Preview').closest('section');
    const [amountInput] = within(swapSection).getAllByRole('textbox');
    fireEvent.change(amountInput, { target: { value: '20' } });
    fireEvent.click(within(swapSection).getByRole('button', { name: 'Preis prüfen' }));
    await within(swapSection).findByText(/100\.0000000\s*FOO/);
    expect(within(swapSection).getByRole('button', { name: 'Swap ausführen' })).toBeDisabled();
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('Pin passt nicht mehr zur Konto-Sequence: nicht gesendet, fruehere Transaktion wieder unklar', async () => {
    writeAccountEntry('PUBLIC', ACCOUNT.publicKey, {
      hash: H('c'), at: Date.now(), status: 'notApplied', pin: true, maxTime: 2000, seq: '105', source: ACCOUNT.publicKey, origin: 'payment',
    });
    const limitSection = await openLimitOrder();
    await sendLimitOrder(limitSection);
    await waitFor(() => {
      expect(readAccountEntry('PUBLIC', ACCOUNT.publicKey)).toMatchObject({ status: 'ambiguous', hash: H('c'), recheck: 'pinConsumed' });
    });
    expect(hoisted.submitTransactionMock).not.toHaveBeenCalled();
  });

  it('Erfolg: Eintrag success mit Herkunft trade, keine Sperre danach', async () => {
    const limitSection = await openLimitOrder();
    await sendLimitOrder(limitSection);
    await screen.findByText(/Limit-Order wurde platziert/);
    expect(readAccountEntry('PUBLIC', ACCOUNT.publicKey)).toMatchObject({ status: 'success', origin: 'trade' });
    expect(screen.queryByTestId('send-ambiguous')).not.toBeInTheDocument();
  });

  it('eindeutig abgelehnt (op_underfunded): kein Eintrag, keine Sperre', async () => {
    hoisted.submitTransactionMock.mockReset().mockRejectedValue(Object.assign(new Error('tx_failed: op_underfunded'), {
      response: { status: 400, data: { extras: { result_codes: { operations: ['op_underfunded'] } } } },
    }));
    const limitSection = await openLimitOrder();
    await sendLimitOrder(limitSection);
    await screen.findByText(/op_underfunded/);
    expect(readAccountEntry('PUBLIC', ACCOUNT.publicKey)).toBeNull();
    expect(screen.queryByTestId('send-ambiguous')).not.toBeInTheDocument();
  });
});
