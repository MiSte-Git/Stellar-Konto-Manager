import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, MuxedAccount } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import i18n from '../../../i18n.js';
import BatchPaymentDialog from '../BatchPaymentDialog.jsx';
import {
  BATCH_PAYMENT_STORAGE_KEY, createEmptyRow, readSentEntry, saveBatchRows, sentEntryKey, writeSentEntry,
} from '../../../utils/batchPayment/batchPaymentStore.js';
import { paymentFingerprint, routingFingerprint } from '../../../utils/batchPayment/batchPaymentLogic.js';
import { RESEND_WINDOW_MS } from '../../../utils/batchPayment/batchPaymentStore.js';
import { AmbiguousSubmitResultError } from '../../../utils/stellar/submitTransactionSafely.js';
import { resolveOrValidateAccount } from '../../../utils/stellar/stellarUtils.js';

const SENDER = Keypair.random();
const SENDER2 = Keypair.random();
const DEST_A = Keypair.random().publicKey();
const DEST_B = Keypair.random().publicKey();

const hoisted = vi.hoisted(() => ({
  ledgerClosedAt: { value: undefined },
  loadAccountMock: vi.fn(),
  getSessionSecretMock: vi.fn(),
  submitMock: vi.fn(),
  txLookupMock: vi.fn(),
  serverNetworkMock: vi.fn(),
  paymentsMock: vi.fn(),
  requestInterceptors: [],
}));
// Wie der Request-Interceptor des SDK: jeder Horizon-Request ruft die registrierten Handler.
const countRequest = () => hoisted.requestInterceptors.forEach((fn) => fn?.({}));

const fakeServer = () => ({
  httpClient: {
    interceptors: {
      request: {
        use: (fn) => hoisted.requestInterceptors.push(fn) - 1,
        eject: (id) => { hoisted.requestInterceptors[id] = null; },
      },
    },
  },
  loadAccount: hoisted.loadAccountMock,
  ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ base_reserve_in_stroops: 5000000, closed_at: hoisted.ledgerClosedAt.value }] }) }) }) }),
  transactions: () => ({ transaction: (hash) => ({ call: () => hoisted.txLookupMock(hash) }) }),
  payments: () => {
    const b = { forAccount: () => b, order: () => b, limit: () => b, join: () => b, call: () => hoisted.paymentsMock() };
    return b;
  },
});
vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => fakeServer(),
  getHorizonServerForNetwork: (network) => { hoisted.serverNetworkMock(network); return fakeServer(); },
  resolveOrValidateAccount: vi.fn(async (input) => {
    if (input === 'friend*example.com') return { accountId: DEST_A, muxedAddress: null };
    const { MuxedAccount: Mx, StrKey: SK } = await import('@stellar/stellar-sdk');
    if (SK.isValidMed25519PublicKey(input)) return { accountId: Mx.fromAddress(input, '0').baseAccount().accountId(), muxedAddress: input };
    return { accountId: input, muxedAddress: null };
  }),
}));
vi.mock('../../../utils/stellar/fees.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveFeePerOp: vi.fn(async () => '100'),
}));
vi.mock('../../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: hoisted.getSessionSecretMock,
}));
vi.mock('../../../utils/stellar/submitTransactionSafely.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTransactionSafely: hoisted.submitMock,
}));

const hashOf = (tx) => Buffer.from(tx.hash()).toString('hex');
const memoOf = (tx) => Buffer.from(tx.memo.value).toString();

function account(id, sequence = '100') {
  return Object.assign(new Account(id, sequence), {
    account_id: id,
    subentry_count: 0,
    balances: [{ asset_type: 'native', balance: '1000' }],
    signers: [{ key: id, weight: 1 }],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  });
}

function renderDialog() {
  return render(
    <I18nextProvider i18n={i18n}>
      <BatchPaymentDialog onClose={() => {}} />
    </I18nextProvider>
  );
}

const rowA = (o = {}) => createEmptyRow({ source: SENDER.publicKey(), dest: DEST_A, amount: '5', memoVal: 'a', ...o });
const rowB = (o = {}) => createEmptyRow({ source: SENDER.publicKey(), dest: DEST_B, amount: '6', memoVal: 'b', ...o });
const fpOf = (row, destination) => paymentFingerprint({ network: 'PUBLIC', row, destination });

async function checkAndWait(readyCount) {
  fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
  if (readyCount) await waitFor(() => expect(screen.getAllByText('Bereit')).toHaveLength(readyCount));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
  hoisted.requestInterceptors.length = 0;
  hoisted.loadAccountMock.mockImplementation(async (id) => { countRequest(); return account(id); });
  hoisted.getSessionSecretMock.mockImplementation(async (acc) => (acc === SENDER.publicKey() ? SENDER.secret() : acc === SENDER2.publicKey() ? SENDER2.secret() : ''));
  hoisted.submitMock.mockImplementation(async (_server, tx) => ({ hash: hashOf(tx) }));
  hoisted.txLookupMock.mockImplementation(async () => { const e = new Error('nf'); e.response = { status: 404 }; throw e; });
  hoisted.ledgerClosedAt.value = undefined;
  hoisted.paymentsMock.mockImplementation(async () => ({ records: [] }));
});

afterEach(() => vi.restoreAllMocks());

describe('BatchPaymentDialog', () => {
  it('saves the entered list without a secret and loads it again', async () => {
    const first = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Sender' }), { target: { value: SENDER.publicKey() } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Empfänger' }), { target: { value: DEST_A } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Betrag' }), { target: { value: '7' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Memo' }), { target: { value: 'Runde' } });
    first.unmount();

    expect(window.localStorage.getItem(BATCH_PAYMENT_STORAGE_KEY)).not.toContain(SENDER.secret());
    renderDialog();
    expect(screen.getByRole('textbox', { name: 'Sender' }).value).toBe(SENDER.publicKey());
    expect(screen.getByRole('textbox', { name: 'Betrag' }).value).toBe('7');
    expect(screen.getByRole('textbox', { name: 'Memo' }).value).toBe('Runde');
  });

  it('sends each row as its own transaction and shows a summary with explorer links', async () => {
    const a = rowA(); const b = rowB();
    saveBatchRows('PUBLIC', [a, b]);
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));

    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('2 von 2 Zahlungen gesendet'));
    expect(hoisted.submitMock.mock.calls.map(([, tx]) => memoOf(tx))).toEqual(['a', 'b']);
    expect(hoisted.getSessionSecretMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('batch-summary').textContent).toContain('11 XLM');
    const hash = hashOf(hoisted.submitMock.mock.calls[0][1]);
    const links = screen.getAllByRole('link').filter((l) => l.getAttribute('href').includes(hash));
    expect(links.length).toBeGreaterThan(0);
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'success', hash });
  });

  it('preselects nothing that was already sent, but allows a deliberate resend', async () => {
    const a = rowA();
    saveBatchRows('PUBLIC', [a]);
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'c'.repeat(64), at: Date.now() - 1000, status: 'success' });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/bereits gesendet/)).toBeInTheDocument());
    const cb = screen.getByRole('checkbox');
    expect(cb.checked).toBe(false);
    expect(screen.getByRole('button', { name: '0 Zahlungen senden' })).toBeDisabled();

    fireEvent.click(cb);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
  });

  it('protects even after the row was removed and entered again', async () => {
    const a = rowA();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'c'.repeat(64), at: Date.now(), status: 'success' });
    saveBatchRows('PUBLIC', [rowA({ memoType: 'text' })]); // neue Zeile, neue ID, gleiche Zahlung
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/bereits gesendet/)).toBeInTheDocument());
  });

  it('skips a payment that another tab sent after the check', async () => {
    const a = rowA();
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'd'.repeat(64), at: Date.now(), status: 'success' });
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/inzwischen bereits gesendet/)).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('collects all keys first and sends nothing when one is cancelled', async () => {
    saveBatchRows('PUBLIC', [rowA(), createEmptyRow({ source: SENDER2.publicKey(), dest: DEST_B, amount: '1', memoVal: 'x' })]);
    hoisted.getSessionSecretMock.mockImplementation(async (acc) => (acc === SENDER.publicKey() ? SENDER.secret() : ''));
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));

    await waitFor(() => expect(screen.getByTestId('secret-modal-subtitle').textContent).toContain(SENDER2.publicKey()));
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /abbrechen/i }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('0 von 2'));
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('marks a payment as unclear before submitting, stops after an ambiguous result and blocks it', async () => {
    const a = rowA(); const b = rowB();
    let entryDuringSubmit = null;
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => {
      entryDuringSubmit = readSentEntry('PUBLIC', fpOf(a, DEST_A));
      throw new AmbiguousSubmitResultError(hashOf(tx), new Error('timeout'));
    });
    saveBatchRows('PUBLIC', [a, b]);
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));

    await waitFor(() => expect(screen.getByText(/gestoppt wegen unklarem Status/)).toBeInTheDocument());
    expect(screen.getByText(/Ursache: timeout/)).toBeInTheDocument();
    expect(entryDuringSubmit).toMatchObject({ status: 'ambiguous' });
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).status).toBe('ambiguous');
    expect(readSentEntry('PUBLIC', fpOf(b, DEST_B))).toBeNull();

    // Neu pruefen: Horizon kennt die Transaktion noch nicht -> hart gesperrt, Hash sichtbar.
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/Gesperrt: Der Status/)).toBeInTheDocument());
    expect(screen.getAllByRole('checkbox')[0]).toBeDisabled();
    expect(screen.getAllByRole('checkbox')[0].checked).toBe(false);

    // Horizon findet sie jetzt erfolgreich -> wird zu "bereits gesendet" (Antwort mit
    // passendem Hash, siehe F5).
    hoisted.txLookupMock.mockImplementation(async (hash) => ({ hash, successful: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/bereits gesendet/)).toBeInTheDocument());
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).status).toBe('success');
  });

  it('restores the previous state after a definite failure', async () => {
    const a = rowA();
    hoisted.submitMock.mockImplementationOnce(async () => {
      const e = new Error('bad');
      e.response = { data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } } } };
      throw e;
    });
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/op_underfunded/)).toBeInTheDocument());
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toBeNull();
  });

  it('stops after the current payment when the dialog is unmounted mid-run, and keeps the log', async () => {
    const a = rowA(); const b = rowB();
    let release;
    hoisted.submitMock.mockImplementationOnce((_s, tx) => new Promise((resolve) => { release = () => resolve({ hash: hashOf(tx) }); }));
    saveBatchRows('PUBLIC', [a, b]);
    const view = renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });

    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).status).toBe('success');
    expect(readSentEntry('PUBLIC', fpOf(b, DEST_B))).toBeNull();
  });

  it('refuses to send when storage is not writable', async () => {
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/nicht beschreibbar/));
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('shows the resolved account for a federation address and blocks duplicates in the list', async () => {
    saveBatchRows('PUBLIC', [rowA({ dest: 'friend*example.com' }), rowA()]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText('friend*example.com')).toBeInTheDocument());
    expect(screen.getAllByTitle(DEST_A).length).toBeGreaterThan(0);
    expect(screen.getByText(/schon weiter oben in der Liste/)).toBeInTheDocument();
  });

  it('blocks a multisig sender in the review', async () => {
    hoisted.loadAccountMock.mockImplementation(async (id) => (id === SENDER.publicKey()
      ? Object.assign(account(id), { signers: [{ key: id, weight: 1 }, { key: DEST_B, weight: 1 }] })
      : account(id)));
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/Multisig-Konto/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '0 Zahlungen senden' })).toBeDisabled();
  });

  it('sends again normally when the earlier send is older than 20 hours (entry still in the log)', async () => {
    const a = rowA();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'c'.repeat(64), at: Date.now() - RESEND_WINDOW_MS - 60000, status: 'success' });
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
  });

  it('sends to M-addresses of any shape and protects them', async () => {
    let m;
    do { m = new MuxedAccount(new Account(Keypair.random().publicKey(), '0'), '7').accountId(); } while (!/S/.test(m.slice(1, 14)));
    const a = rowA({ dest: m, memoType: 'none', memoVal: '' });
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(readSentEntry('PUBLIC', fpOf(a, m)).status).toBe('success');
  });

  it('releases an unclear payment once Horizon has a ledger after its maxTime (sequence still free: with pin)', async () => {
    const a = rowA();
    const maxTime = Math.floor(Date.now() / 1000) - 120;
    // Konto-Sequence 100 (Mock), Transaktion hatte 101: Sequence noch frei.
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'e'.repeat(64), at: Date.now(), status: 'ambiguous', maxTime, seq: '101', source: SENDER.publicKey() });
    hoisted.ledgerClosedAt.value = new Date((maxTime + 65) * 1000).toISOString();
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText('Bereit')).toBeInTheDocument(), { timeout: 5000 });
    // Nicht geloescht, sondern als nicht ausgefuehrt mit Pin vermerkt
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'notApplied', pin: true, seq: '101', hash: 'e'.repeat(64) });
  });

  it('keeps an unclear payment blocked while the ledger has not passed maxTime, whatever the client clock says', async () => {
    const a = rowA();
    const maxTime = Math.floor(Date.now() / 1000) - 3600; // Client-Uhr: laengst abgelaufen
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'e'.repeat(64), at: Date.now() - 3600000, status: 'ambiguous', maxTime });
    hoisted.ledgerClosedAt.value = new Date((maxTime - 30) * 1000).toISOString(); // Horizon im Rueckstand
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/Gesperrt: Der Status/)).toBeInTheDocument());
  });

  it('shows issuers, keeps equal codes apart and blocks a fake XLM', async () => {
    const issuer1 = Keypair.random().publicKey();
    const issuer2 = Keypair.random().publicKey();
    hoisted.loadAccountMock.mockImplementation(async (id) => Object.assign(account(id), {
      balances: [
        { asset_type: 'native', balance: '1000' },
        { asset_code: 'USDC', asset_issuer: issuer1, balance: '100', is_authorized: true },
        { asset_code: 'USDC', asset_issuer: issuer2, balance: '100', is_authorized: true },
      ],
    }));
    saveBatchRows('PUBLIC', [
      rowA({ assetKey: `USDC:${issuer1}` }),
      rowB({ assetKey: `USDC:${issuer2}` }),
      rowA({ dest: DEST_B, memoVal: 'z', assetKey: `XLM:${issuer1}` }),
    ]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    expect(await screen.findByText(/nicht das native XLM/)).toBeInTheDocument();
  });

  it('shows two issuers of the same code separately in the review totals', async () => {
    const issuer1 = Keypair.random().publicKey();
    const issuer2 = Keypair.random().publicKey();
    hoisted.loadAccountMock.mockImplementation(async (id) => Object.assign(account(id), {
      balances: [
        { asset_type: 'native', balance: '1000' },
        { asset_code: 'USDC', asset_issuer: issuer1, balance: '100', is_authorized: true },
        { asset_code: 'USDC', asset_issuer: issuer2, balance: '100', is_authorized: true },
      ],
    }));
    saveBatchRows('PUBLIC', [rowA({ assetKey: `USDC:${issuer1}` }), rowB({ assetKey: `USDC:${issuer2}` })]);
    renderDialog();
    await checkAndWait(2);
    const total = screen.getByTestId('batch-total').textContent;
    expect(total).toContain(`USDC (${issuer1.slice(0, 8)}…${issuer1.slice(-8)})`);
    expect(total).toContain(`USDC (${issuer2.slice(0, 8)}…${issuer2.slice(-8)})`);
  });

  it('warns when the same payment was sent before via M-address instead of G plus memo id', async () => {
    const m = new MuxedAccount(new Account(DEST_A, '0'), '42').accountId();
    const viaM = rowA({ dest: m, memoType: 'none', memoVal: '' });
    const route = routingFingerprint({ network: 'PUBLIC', row: viaM, destination: m });
    writeSentEntry('PUBLIC', route, { hash: 'f'.repeat(64), at: Date.now(), status: 'success' });
    saveBatchRows('PUBLIC', [rowA({ memoType: 'id', memoVal: '42' })]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/gleicher ID/)).toBeInTheDocument());
    const cb = screen.getByRole('checkbox');
    expect(cb.checked).toBe(false);
    expect(cb).not.toBeDisabled();
  });

  it('reports when the success entry could not be written, the payment stays unclear in the log', async () => {
    const a = rowA();
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    const original = Storage.prototype.setItem;
    let writes = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (String(key).startsWith('skm_batch_sent_v1:PUBLIC:')) {
        writes += 1;
        if (writes > 1) throw new Error('quota');
      }
      return original.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    expect(screen.getAllByText(/Protokoll konnte nicht aktualisiert werden/).length).toBeGreaterThan(0);
    vi.restoreAllMocks();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).status).toBe('ambiguous');
  });

  it('ends the run without sending when unmounted during the key prompt', async () => {
    hoisted.getSessionSecretMock.mockResolvedValue('');
    saveBatchRows('PUBLIC', [rowA()]);
    const view = renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('secret-modal-subtitle')).toBeInTheDocument());
    view.unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('runs the send loop under a per-network lock when Web Locks exist', async () => {
    const request = vi.fn((name, opts, cb) => (typeof opts === 'function' ? opts() : cb({})));
    Object.defineProperty(window.navigator, 'locks', { value: { request }, configurable: true });
    try {
      saveBatchRows('PUBLIC', [rowA()]);
      renderDialog();
      await checkAndWait(1);
      fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
      await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
      expect(request).toHaveBeenCalledWith('skm-batch-send-PUBLIC', { ifAvailable: true }, expect.any(Function));
    } finally {
      delete window.navigator.locks;
    }
  });

  it('copies the details of all payments', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    saveBatchRows('PUBLIC', [rowA(), rowB()]);
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('2 von 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Details kopieren' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0];
    expect(text).toContain(DEST_A);
    expect(text).toContain(DEST_B);
    expect(text).toContain('5 XLM');
    expect(text).toContain(`TX: ${hashOf(hoisted.submitMock.mock.calls[0][1])}`);
    expect(text).not.toContain(SENDER.secret());
  });

  it('stops with concurrentRun when another tab overwrites the entry right after our write', async () => {
    const a = rowA(); const b = rowB();
    saveBatchRows('PUBLIC', [a, b]);
    renderDialog();
    await checkAndWait(2);
    const original = Storage.prototype.setItem;
    const foreign = JSON.stringify({ hash: '9'.repeat(64), at: Date.now(), status: 'ambiguous' });
    let done = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      original.call(this, key, value);
      if (!done && String(key).startsWith('skm_batch_sent_v1:PUBLIC:') && value.includes('ambiguous')) {
        done = true;
        original.call(this, key, foreign); // anderer Tab schreibt dazwischen
      }
    });
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    expect(screen.getAllByText(/eine andere Sammelzahlung sendet/).length).toBeGreaterThan(0);
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).hash).toBe('9'.repeat(64));
  });

  it('restores after a definite failure only where its own entry still stands', async () => {
    const a = rowA();
    saveBatchRows('PUBLIC', [a]);
    hoisted.submitMock.mockImplementationOnce(async () => {
      writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: '8'.repeat(64), at: Date.now(), status: 'ambiguous' });
      const e = new Error('bad');
      e.response = { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } };
      throw e;
    });
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/tx_bad_seq/)).toBeInTheDocument());
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).hash).toBe('8'.repeat(64));
  });

  it('writes the routing entry as unclear too and blocks the other form while unclear', async () => {
    const m = new MuxedAccount(new Account(DEST_A, '0'), '42').accountId();
    const viaM = rowA({ dest: m, memoType: 'none', memoVal: '' });
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => { throw new AmbiguousSubmitResultError(hashOf(tx), new Error('t')); });
    saveBatchRows('PUBLIC', [viaM]);
    const view = renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    const route = routingFingerprint({ network: 'PUBLIC', row: viaM, destination: m });
    expect(readSentEntry('PUBLIC', route).status).toBe('ambiguous');
    view.unmount();

    saveBatchRows('PUBLIC', [rowA({ memoType: 'id', memoVal: '42' })]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/gleicher ID .* unklaren Status/)).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('waits for another tab holding the send lock and can cancel the wait', async () => {
    window.localStorage.setItem('skm_batch_send_lock_v1:skm-batch-send-PUBLIC', JSON.stringify({ owner: 'other-tab', at: Date.now() }));
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-waiting-lock')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Warten abbrechen' }));
    await waitFor(() => expect(screen.getByText(/Warten auf andere Sammelzahlung abgebrochen/)).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('sends nothing when unmounted while waiting for the lock', async () => {
    window.localStorage.setItem('skm_batch_send_lock_v1:skm-batch-send-PUBLIC', JSON.stringify({ owner: 'other-tab', at: Date.now() }));
    saveBatchRows('PUBLIC', [rowA()]);
    const view = renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-waiting-lock')).toBeInTheDocument());
    view.unmount();
    window.localStorage.removeItem('skm_batch_send_lock_v1:skm-batch-send-PUBLIC');
    await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('warns in the form when a field contains something like a secret key', async () => {
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Memo' }), { target: { value: `key ${SENDER.secret()}` } });
    expect(screen.getByText(/wie ein Secret Key aussieht/)).toBeInTheDocument();
  });

  it('stops with lockLost when another tab took over the storage lock during the run', async () => {
    const a = rowA(); const b = rowB();
    saveBatchRows('PUBLIC', [a, b]);
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => {
      window.localStorage.setItem('skm_batch_send_lock_v1:skm-batch-send-PUBLIC', JSON.stringify({ owner: 'other-tab', at: Date.now() }));
      return { hash: hashOf(tx) };
    });
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 2'));
    expect(screen.getByText(/ein anderer Tab übernommen hat/)).toBeInTheDocument();
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
  });

  it('takes back its own main entry when writing the routing entry fails', async () => {
    const m = new MuxedAccount(new Account(DEST_A, '0'), '42').accountId();
    const a = rowA({ dest: m, memoType: 'none', memoVal: '' });
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    const original = Storage.prototype.setItem;
    let sentWrites = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (String(key).startsWith('skm_batch_sent_v1:PUBLIC:')) {
        sentWrites += 1;
        if (sentWrites === 2) throw new Error('quota'); // Routing-Eintrag
      }
      return original.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    vi.restoreAllMocks();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(readSentEntry('PUBLIC', fpOf(a, m))).toBeNull();
  });

  it('flags the same payment as M-address and as G plus memo id in one list already in the check', async () => {
    const m = new MuxedAccount(new Account(DEST_A, '0'), '42').accountId();
    saveBatchRows('PUBLIC', [rowA({ dest: m, memoType: 'none', memoVal: '' }), rowA({ memoType: 'id', memoVal: '42' })]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/dort als M-Adresse/)).toBeInTheDocument());
    expect(screen.getAllByText('Bereit')).toHaveLength(1);
  });

  it('never resolves a destination that contains a secret', async () => {
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Empfänger' }), { target: { value: `${SENDER.secret()}*evil.example` } });
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/die Zeile wird nicht geprüft/)).toBeInTheDocument());
    expect(resolveOrValidateAccount).not.toHaveBeenCalled();
  });

  it('does not block the other form of a payment when the first row is not selected', async () => {
    const m = new MuxedAccount(new Account(DEST_A, '0'), '42').accountId();
    const viaM = rowA({ dest: m, memoType: 'none', memoVal: '' });
    writeSentEntry('PUBLIC', fpOf(viaM, m), { hash: 'c'.repeat(64), at: Date.now(), status: 'success' });
    saveBatchRows('PUBLIC', [viaM, rowA({ memoType: 'id', memoVal: '42' })]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/bereits gesendet/)).toBeInTheDocument());
    expect(screen.queryByText(/dort als M-Adresse/)).not.toBeInTheDocument();
    expect(screen.getByText('Bereit')).toBeInTheDocument();
  });

  it('stops with lockLost when the lock is lost while the account is loading', async () => {
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    hoisted.loadAccountMock.mockImplementation(async (id) => {
      window.localStorage.setItem('skm_batch_send_lock_v1:skm-batch-send-PUBLIC', JSON.stringify({ owner: 'other-tab', at: Date.now() }));
      return account(id);
    });
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/ein anderer Tab übernommen hat/)).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(readSentEntry('PUBLIC', fpOf(rowA(), DEST_A))).toBeNull();
  });

  it('warns about a compromised or deactivated recipient and does not preselect the row', async () => {
    const m = new MuxedAccount(new Account(DEST_B, '0'), '7').accountId();
    window.localStorage.setItem('stm_trusted_wallets', JSON.stringify({ wallets: [
      { address: DEST_A, label: 'Alt', compromised: true },
      { address: DEST_B, label: 'Weg', deactivated: true },
    ] }));
    saveBatchRows('PUBLIC', [rowA(), rowB({ dest: m, memoType: 'none', memoVal: '' })]);
    renderDialog();
    expect(screen.getByText(/als kompromittiert markiert/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getAllByText(/nicht vorgewählt/)).toHaveLength(2));
    expect(screen.getByText(/als kompromittiert markiert/)).toBeInTheDocument();
    // M-Adresse: Markierung des Basis-G-Kontos greift.
    expect(screen.getByText(/als deaktiviert markiert/)).toBeInTheDocument();
    expect(screen.queryByText('Bereit')).not.toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox', { name: 'Senden' });
    expect(boxes.map((b) => b.checked)).toEqual([false, false]);
    expect(boxes.every((b) => !b.disabled)).toBe(true);
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    expect(memoOf(hoisted.submitMock.mock.calls[0][1])).toBe('a');
  });

  it('shows the memo type in the review and in the copied details', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    saveBatchRows('PUBLIC', [rowA({ memoType: 'id', memoVal: '12345' }), rowB({ memoVal: '12345' })]);
    renderDialog();
    await checkAndWait(2);
    expect(screen.getByText('12345 (ID)')).toBeInTheDocument();
    expect(screen.getByText('12345 (Text)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Details kopieren' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0];
    expect(text).toContain('Memo: 12345 (ID)');
    expect(text).toContain('Memo: 12345 (Text)');
  });
});

describe('BatchPaymentDialog: Netzwechsel', () => {
  const renderWith = (props) => render(
    <I18nextProvider i18n={i18n}>
      <BatchPaymentDialog onClose={() => {}} {...props} />
    </I18nextProvider>
  );
  const switchTo = async (net) => {
    window.localStorage.setItem('SKM_NETWORK', net);
    await act(async () => { window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: net })); });
  };

  it('schliesst ohne aktiven Lauf und behaelt die gespeicherte Liste', async () => {
    const a = rowA();
    saveBatchRows('PUBLIC', [a]);
    const onNetworkChangeClose = vi.fn();
    const onClose = vi.fn();
    renderWith({ onClose, onNetworkChangeClose });
    await checkAndWait(1); // Pruefung fertig, Lauf nicht gestartet
    await switchTo('TESTNET');
    expect(onNetworkChangeClose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(BATCH_PAYMENT_STORAGE_KEY)).toContain(DEST_A);
  });

  it('ohne eigenen Callback fuer den Netzwechsel schliesst er ueber onClose', async () => {
    const onClose = vi.fn();
    renderWith({ onClose });
    await switchTo('TESTNET');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ein Event fuer dasselbe Netz schliesst nicht', async () => {
    const onClose = vi.fn();
    renderWith({ onClose });
    await switchTo('PUBLIC');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mit aktivem Lauf: laufende Zahlung endet, keine weitere Zahlung, Hinweis, Liste bleibt', async () => {
    const a = rowA(); const b = rowB();
    let release;
    hoisted.submitMock.mockImplementationOnce((_s, tx) => new Promise((resolve) => { release = () => resolve({ hash: hashOf(tx) }); }));
    saveBatchRows('PUBLIC', [a, b]);
    const onNetworkChangeClose = vi.fn();
    renderWith({ onNetworkChangeClose });
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));

    await switchTo('TESTNET');
    expect(onNetworkChangeClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('batch-network-stopped').textContent).toBe(i18n.t('batchPayment:networkChanged.stopped'));
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });

    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).status).toBe('success');
    expect(readSentEntry('PUBLIC', fpOf(b, DEST_B))).toBeNull();
    expect(screen.getByText(new RegExp(i18n.t('batchPayment:errors.networkChanged')))).toBeInTheDocument();
    expect(window.localStorage.getItem(BATCH_PAYMENT_STORAGE_KEY)).toContain(DEST_B);
  });

  it('Wechsel waehrend der Key-Abfrage: nichts gesendet', async () => {
    hoisted.getSessionSecretMock.mockImplementation(async () => '');
    saveBatchRows('PUBLIC', [rowA()]);
    renderWith({});
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(document.querySelector('input[type="password"], input[placeholder="z.B."]')).not.toBeNull());
    await switchTo('TESTNET');
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(i18n.t('batchPayment:errors.networkChanged')))).toBeInTheDocument();
  });
});


describe('BatchPaymentDialog: Server und Key-Abfrage beim Netzwechsel (N2, N3)', () => {
  const switchTo = async (net) => {
    window.localStorage.setItem('SKM_NETWORK', net);
    await act(async () => { window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: net })); });
  };

  it('erzeugt den Server mit dem Netz des Dialogs (N2)', () => {
    renderDialog();
    expect(hoisted.serverNetworkMock).toHaveBeenCalledWith('PUBLIC');
    expect(hoisted.serverNetworkMock).not.toHaveBeenCalledWith('TESTNET');
  });

  it('Netzwechsel waehrend die Session-Secrets gelesen werden: keine Key-Abfrage (N3)', async () => {
    let releaseSecret;
    hoisted.getSessionSecretMock.mockImplementation(() => new Promise((r) => { releaseSecret = () => r(''); }));
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(releaseSecret).toBeTypeOf('function'));

    await switchTo('TESTNET');
    await act(async () => { releaseSecret(); await new Promise((r) => setTimeout(r, 0)); });

    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    expect(document.querySelector('input[placeholder="z.B."]')).toBeNull();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(i18n.t('batchPayment:errors.networkChanged')))).toBeInTheDocument();
  });

});

describe('BatchPaymentDialog: unklarer Status: Uhrzeit, Status jetzt pruefen, automatische Pruefung', () => {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const isoAt = (sec) => new Date(sec * 1000).toISOString();
  const clearTimeOf = (maxTime) => {
    const d = new Date((maxTime + 60) * 1000);
    return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString() : d.toLocaleString();
  };
  const netError = async () => { throw new TypeError('Failed to fetch'); };
  const checkNow = () => fireEvent.click(screen.getByRole('button', { name: 'Status jetzt prüfen' }));

  async function blockedReview(entryOverrides = {}) {
    const a = rowA();
    const maxTime = nowSec() + 100;
    // Sequence 101 bei Konto-Sequence 100 (Mock): Sequence noch frei.
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), {
      hash: 'e'.repeat(64), at: Date.now(), status: 'ambiguous', maxTime, seq: '101', source: SENDER.publicKey(), ...entryOverrides,
    });
    hoisted.ledgerClosedAt.value = isoAt(nowSec()); // Netz: noch innerhalb der Gueltigkeit
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/Gesperrt: Der Status/)).toBeInTheDocument());
    return { a, maxTime };
  }

  it('zeigt die Uhrzeit, ab der der Status eindeutig wird (maxTime plus 60 s), ohne maxTime den Hinweis', async () => {
    const { maxTime } = await blockedReview();
    const line = screen.getByTestId('batch-ambiguous-clear-at').textContent;
    expect(line).toContain(`Eindeutig ab ca. ${clearTimeOf(maxTime)}`);
    // Gegenprobe: nicht maxTime selbst (ohne Puffer)
    const d = new Date(maxTime * 1000);
    expect(line).not.toContain(d.toLocaleTimeString());
    expect(screen.queryByText(/3 Minuten\)/)).toBeNull();
  });

  it('ohne maxTime keine Uhrzeit, sondern der Hinweis, dass das Ende unbekannt ist', async () => {
    await blockedReview({ maxTime: undefined });
    expect(screen.getByTestId('batch-ambiguous-countdown').textContent).toMatch(/Ende der Gültigkeit nicht bekannt/);
    expect(screen.queryByTestId('batch-ambiguous-clear-at')).toBeNull();
  });

  it('Status jetzt pruefen vor Ablauf: bleibt gesperrt; nach Ablauf (expired): erneut senden moeglich', async () => {
    const { a } = await blockedReview();
    checkNow();
    await waitFor(() => expect(screen.getByText(/Noch nicht eindeutig/)).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByText(/Horizon war nicht erreichbar/)).toBeNull();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).status).toBe('ambiguous');
    expect(screen.queryByRole('button', { name: 'Erneut senden' })).toBeNull();

    // Netz hat einen Ledger nach maxTime plus Puffer geschlossen, Transaktion nicht da.
    const entry = readSentEntry('PUBLIC', fpOf(a, DEST_A));
    hoisted.ledgerClosedAt.value = isoAt(entry.maxTime + 65);
    checkNow();
    await waitFor(() => expect(screen.getByTestId('batch-resolved-not-sent')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText(/alte Transaktion ist nicht mehr gültig/)).toBeInTheDocument();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'notApplied', pin: true });
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
    expect(screen.getByRole('checkbox').checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Erneut senden' }));
    expect(screen.getByRole('checkbox').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
  });

  it('success: als gesendet anzeigen, nicht vorgewaehlt; failed: als nicht gesendet', async () => {
    const { a } = await blockedReview();
    hoisted.txLookupMock.mockImplementation(async (hash) => ({ hash, successful: true }));
    checkNow();
    await waitFor(() => expect(screen.getByText(/nachträglich bestätigt/)).toBeInTheDocument());
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).status).toBe('success');
    expect(screen.getByText(/Mit gleichen Daten bereits gesendet/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox').checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Erneut senden' })).toBeNull();
  });

  it('failed (im Ledger fehlgeschlagen) gilt als nicht gesendet', async () => {
    const { a } = await blockedReview();
    hoisted.txLookupMock.mockImplementation(async (hash) => ({ hash, successful: false }));
    checkNow();
    await waitFor(() => expect(screen.getByTestId('batch-resolved-not-sent')).toBeInTheDocument());
    // Sequence von der fehlgeschlagenen Transaktion verbraucht: kein Pin
    const e = readSentEntry('PUBLIC', fpOf(a, DEST_A));
    expect(e.status).toBe('notApplied');
    expect(e.pin).toBeUndefined();
  });

  it('unknown (Horizon nicht erreichbar): Hinweis statt still gesperrt', async () => {
    const { a } = await blockedReview();
    hoisted.txLookupMock.mockImplementation(netError);
    checkNow();
    await waitFor(() => expect(screen.getByText(/Horizon war nicht erreichbar/)).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A)).status).toBe('ambiguous');
    expect(screen.queryByText(/Noch nicht eindeutig/)).toBeNull();
  });

  it('prueft im Ergebnis nach Ablauf einmal automatisch und zeigt dann Erneut senden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const a = rowA();
      let maxTime;
      hoisted.submitMock.mockImplementationOnce(async (_s, tx) => {
        maxTime = Number(tx.timeBounds.maxTime);
        throw new AmbiguousSubmitResultError(hashOf(tx), new TypeError('Failed to fetch'));
      });
      saveBatchRows('PUBLIC', [a]);
      renderDialog();
      await checkAndWait(1);
      fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
      await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
      expect(screen.getByTestId('batch-ambiguous-clear-at').textContent).toContain(clearTimeOf(maxTime));
      hoisted.ledgerClosedAt.value = isoAt(maxTime + 65);
      const lookupsBefore = hoisted.txLookupMock.mock.calls.length;

      // Gegenprobe: vor Ablauf keine Abfrage
      await act(async () => { await vi.advanceTimersByTimeAsync(200 * 1000); });
      expect(hoisted.txLookupMock.mock.calls.length).toBe(lookupsBefore);

      await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      await waitFor(() => expect(screen.getByTestId('batch-resolved-not-sent')).toBeInTheDocument());
      expect(screen.getByText(/Nicht gesendet \(laut Horizon nicht im Ledger/)).toBeInTheDocument();
      expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'notApplied', pin: true, seq: '101', source: SENDER.publicKey() });
      const lookupsAfter = hoisted.txLookupMock.mock.calls.length;
      expect(lookupsAfter).toBe(lookupsBefore + 2); // Abfrage plus Wiederholung, nur einmal
      await act(async () => { await vi.advanceTimersByTimeAsync(600 * 1000); });
      expect(hoisted.txLookupMock.mock.calls.length).toBe(lookupsAfter);

      // Erneut senden fuehrt zur neuen Pruefung, die Zahlung ist wieder bereit
      fireEvent.click(screen.getByRole('button', { name: 'Erneut senden' }));
      await waitFor(() => expect(screen.getByText('Bereit')).toBeInTheDocument());
      expect(screen.getByRole('checkbox').checked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BatchPaymentDialog: Countdown und Diagnose bei unklarem Status', () => {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const isoAt = (sec) => new Date(sec * 1000).toISOString();
  const countdownSeconds = () => {
    const m = screen.getByTestId('batch-ambiguous-countdown').textContent.match(/in (\d\d):(\d\d)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  // Zeitpunkt der automatischen Pruefung: maxTime + 60 s Puffer + 10 s Marge
  const dueOf = (maxTime) => (maxTime + 60) * 1000 + 10 * 1000;
  const fake = () => vi.useFakeTimers({
    shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });

  it('zaehlt herunter, stimmt nach Neuladen und prueft nach Ablauf automatisch', async () => {
    fake();
    try {
      const a = rowA();
      const maxTime = nowSec() + 100;
      writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'e'.repeat(64), at: Date.now(), status: 'ambiguous', maxTime, seq: '101', source: SENDER.publicKey() });
      hoisted.ledgerClosedAt.value = isoAt(nowSec());
      saveBatchRows('PUBLIC', [a]);
      const first = renderDialog();
      fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
      await waitFor(() => expect(screen.getByTestId('batch-ambiguous-countdown')).toBeInTheDocument());
      const box = screen.getByTestId('batch-ambiguous-countdown');
      expect(box.textContent).toMatch(/^Status unklar\. SKM prüft automatisch erneut in \d\d:\d\d\. Vorher nicht erneut senden, auch nicht als Einzelzahlung\.$/);
      expect(box.className).toContain('bg-amber-50');
      expect(box.className).not.toMatch(/bg-red/);
      const expected0 = Math.ceil((dueOf(maxTime) - Date.now()) / 1000);
      expect(Math.abs(countdownSeconds() - expected0)).toBeLessThanOrEqual(1);
      expect(screen.getByTestId('batch-ambiguous-clear-at').textContent).toContain('Eindeutig ab ca.');

      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000); });
      const after30 = countdownSeconds();
      expect(Math.abs(after30 - (expected0 - 30))).toBeLessThanOrEqual(1);

      // Neuladen: Countdown haengt an maxTime, beginnt also nicht von vorn.
      first.unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000); });
      renderDialog();
      fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
      await waitFor(() => expect(screen.getByTestId('batch-ambiguous-countdown')).toBeInTheDocument());
      const afterReload = countdownSeconds();
      expect(Math.abs(afterReload - (expected0 - 60))).toBeLessThanOrEqual(1);
      expect(afterReload).toBeLessThan(expected0 - 50); // Gegenprobe: kein Neustart bei vollem Wert

      // Vor Ablauf keine automatische Abfrage
      const lookupsBefore = hoisted.txLookupMock.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync((afterReload - 5) * 1000); });
      expect(hoisted.txLookupMock.mock.calls.length).toBe(lookupsBefore);

      // Nach Ablauf: "Wird geprueft ...", dann Ergebnis (abgelaufen -> nicht gesendet)
      hoisted.ledgerClosedAt.value = isoAt(maxTime + 65);
      await act(async () => { await vi.advanceTimersByTimeAsync(6 * 1000); });
      await waitFor(() => expect(screen.getByTestId('batch-ambiguous-countdown').textContent).toBe('Status unklar. Wird geprüft …'));
      expect(hoisted.txLookupMock.mock.calls.length).toBe(lookupsBefore + 1);
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      await waitFor(() => expect(screen.getByTestId('batch-resolved-not-sent')).toBeInTheDocument());
      expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'notApplied', pin: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('zeigt nach Ablauf das Ergebnis der Pruefung im Kasten (Horizon nicht erreichbar)', async () => {
    fake();
    try {
      const a = rowA();
      const maxTime = nowSec() + 5;
      writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'e'.repeat(64), at: Date.now(), status: 'ambiguous', maxTime });
      hoisted.ledgerClosedAt.value = isoAt(nowSec());
      saveBatchRows('PUBLIC', [a]);
      renderDialog();
      fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
      await waitFor(() => expect(screen.getByTestId('batch-ambiguous-countdown').textContent).toMatch(/erneut in/));
      hoisted.txLookupMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
      await act(async () => { await vi.advanceTimersByTimeAsync(80 * 1000); });
      await waitFor(() => expect(screen.getByTestId('batch-ambiguous-countdown').textContent).toMatch(/Horizon war nicht erreichbar/));
      expect(screen.getByRole('checkbox')).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Details kopieren enthaelt die Diagnosefelder, aber keinen XDR und keine Secrets', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const planted = 'A'.repeat(80); // wie ein XDR-Stueck in einer Fehlermeldung
    let submittedXdr = '';
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => {
      submittedXdr = tx.toXDR();
      countRequest();
      throw new AmbiguousSubmitResultError(hashOf(tx), new TypeError('Failed to fetch'), {
        request: {
          method: 'POST', url: 'https://horizon.stellar.org/transactions', at: '2026-11-06T09:28:41.123Z', durationMs: 1234,
          error: { name: 'TypeError', message: `Failed to fetch ${planted} ${SENDER.secret()}`, status: null, statusText: '', readable: false },
          online: true, visibility: 'visible',
        },
        lookups: [
          { at: '2026-11-06T09:28:41.200Z', result: 'notFound', status: 404 },
          { at: '2026-11-06T09:28:42.700Z', result: 'network', name: 'TypeError', message: 'Failed to fetch' },
          { at: '2026-11-06T09:28:44.200Z', result: 'status', status: 503 },
        ],
      });
    });
    saveBatchRows('PUBLIC', [rowA(), rowB()]);
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Details kopieren' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0];
    expect(text).toContain('Diagnose');
    expect(text).toContain('Request: POST https://horizon.stellar.org/transactions');
    expect(text).toContain('Zeitpunkt: 2026-11-06T09:28:41.123Z, Dauer: 1234 ms');
    expect(text).toContain('Fehler: TypeError:');
    expect(text).toContain('keine lesbare Antwort');
    expect(text).toContain('navigator.onLine: true, visibilityState: visible');
    const runCount = Number(text.match(/Horizon-Requests im Lauf: (\d+) \(seit Öffnen des Dialogs: (\d+)\)/)?.[1]);
    const totalCount = Number(text.match(/seit Öffnen des Dialogs: (\d+)/)?.[1]);
    expect(runCount).toBe(2); // loadAccount + Submit der ersten Zahlung
    expect(totalCount).toBeGreaterThan(runCount); // plus Laden und Pruefen der Liste
    expect(text).toContain('Abfragen des Hashes danach: 3');
    expect(text).toMatch(/1\. 2026-11-06T09:28:41\.200Z 404 \(nicht gefunden\)/);
    expect(text).toMatch(/2\. 2026-11-06T09:28:42\.700Z Netzfehler \(TypeError: Failed to fetch\)/);
    expect(text).toMatch(/3\. 2026-11-06T09:28:44\.200Z HTTP 503/);
    expect(text).toContain('Eindeutig ab ca.');
    // keine Secrets, kein XDR (weder der gesendete noch ein Stueck in der Meldung)
    expect(submittedXdr.length).toBeGreaterThan(50);
    expect(text).not.toContain(submittedXdr);
    expect(text).not.toContain(planted);
    expect(text).not.toContain(SENDER.secret());
  });

  it('Gegenprobe: ohne unklaren Status keine Diagnose in den Details', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Details kopieren' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).not.toContain('Diagnose');
  });
});

describe('BatchPaymentDialog: Sequence beim erneuten Senden (F1)', () => {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const OLD = 'e'.repeat(64);
  const pinned = (o = {}) => ({
    hash: OLD, at: Date.now() - 600000, status: 'notApplied', maxTime: nowSec() - 300, seq: '105', source: SENDER.publicKey(), pin: true, ...o,
  });
  const badSeq = () => { const e = new Error('bad'); e.response = { status: 400, data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } }; return e; };
  // Ein Pin wird nur genutzt, wenn die Konto-Sequence genau Pin - 1 ist (F7, gleiche Bedingung
  // wie beim Vergeben des Pins). Das Konto steht in diesen Tests daher auf 104.
  beforeEach(() => {
    hoisted.loadAccountMock.mockImplementation(async (id) => { countRequest(); return account(id, '104'); });
  });

  it('Erneut senden nutzt genau die gepinnte Sequence (Konto-Sequence = Pin - 1)', async () => {
    const a = rowA();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), pinned());
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    const tx = hoisted.submitMock.mock.calls[0][1];
    expect(tx.sequence).toBe('105');
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'success', seq: '105', hash: hashOf(tx) });
  });

  it('F7: Konto-Sequence weit unter dem Pin (z.B. Testnet-Reset): nicht senden, strenger Pfad', async () => {
    // Frueher wurde hier mit Sequence 105 gesendet und vom Netz mit tx_bad_seq abgelehnt.
    hoisted.loadAccountMock.mockImplementation(async (id) => { countRequest(); return account(id, '100'); });
    const a = rowA();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), pinned());
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/passt nicht mehr zum Konto/)).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'ambiguous', hash: OLD, seq: '105' });
  });

  it('Gegenprobe: ohne Pin (Sequence war verbraucht) normale Sequence', async () => {
    hoisted.loadAccountMock.mockImplementation(async (id) => { countRequest(); return account(id, '100'); });
    const a = rowA();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), pinned({ pin: false }));
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock.mock.calls[0][1].sequence).toBe('101');
  });

  it('vermerkt Sequence, Quellkonto und frueheren Hash im unklaren Eintrag', async () => {
    const a = rowA();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), pinned());
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => { throw new AmbiguousSubmitResultError(hashOf(tx), new Error('t')); });
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'ambiguous', seq: '105', source: SENDER.publicKey(), prev: [OLD] });
  });

  it('sendet die Zahlung mit Pin vor anderen Zahlungen desselben Kontos', async () => {
    const a = rowA(); const b = rowB();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), pinned());
    saveBatchRows('PUBLIC', [b, a]); // in der Liste steht a hinten
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('2 von 2'));
    const calls = hoisted.submitMock.mock.calls.map(([, tx]) => [memoOf(tx), tx.sequence]);
    expect(calls[0]).toEqual(['a', '105']);
    expect(calls[1][0]).toBe('b');
  });

  it('Sequence inzwischen erreicht: nicht senden, fruehere Transaktion wieder als unklar fuehren', async () => {
    const a = rowA();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), pinned());
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    hoisted.loadAccountMock.mockImplementation(async (id) => { countRequest(); const acc = account(id); return Object.assign(acc, { sequenceNumber: () => '105' }); });
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/Sequence der früheren Transaktion ist inzwischen verbraucht/)).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'ambiguous', hash: OLD, seq: '105' });
  });

  it('tx_bad_seq: keine zweite Sendung, moeglicherweise gesendet, Hash gesucht, Hinweis, Rest gestoppt', async () => {
    const a = rowA(); const b = rowB();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), pinned());
    hoisted.submitMock.mockImplementationOnce(async () => { throw badSeq(); });
    saveBatchRows('PUBLIC', [a, b]);
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument(), { timeout: 8000 });
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Möglicherweise gesendet/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Sequence der früheren Transaktion abgelehnt/)).toBeInTheDocument();
    expect(hoisted.txLookupMock).toHaveBeenCalledWith(OLD);
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'ambiguous', hash: OLD, seq: '105' });
    expect(readSentEntry('PUBLIC', fpOf(b, DEST_B))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Erneut senden' })).toBeNull();
  }, 15000);

  it('Gegenprobe tx_bad_seq: fruehere Transaktion gefunden -> gesendet mit deren Hash, Lauf geht weiter', async () => {
    const a = rowA(); const b = rowB();
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), pinned());
    hoisted.submitMock.mockImplementationOnce(async () => { throw badSeq(); });
    hoisted.txLookupMock.mockImplementation(async (hash) => {
      if (hash === OLD) return { hash, successful: true };
      const e = new Error('nf'); e.response = { status: 404 }; throw e;
    });
    saveBatchRows('PUBLIC', [a, b]);
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('2 von 2'));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(2); // a einmal (abgelehnt), b normal
    expect(screen.getByText(/mit der früheren Transaktion bereits gesendet/)).toBeInTheDocument();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'success', hash: OLD });
  });

  it('Gegenprobe: tx_bad_seq ohne Pin bleibt ein eindeutiger Fehler (Eintrag zurueckgesetzt)', async () => {
    const a = rowA();
    hoisted.submitMock.mockImplementationOnce(async () => { throw badSeq(); });
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/Fehlgeschlagen: tx_bad_seq/)).toBeInTheDocument());
    expect(screen.queryByText(/Möglicherweise gesendet/)).toBeNull();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toBeNull();
  });
});

describe('BatchPaymentDialog: fehlender Protokolleintrag (F2)', () => {
  const isoAt = (sec) => new Date(sec * 1000).toISOString();
  const checkNow = () => fireEvent.click(screen.getByRole('button', { name: 'Status jetzt prüfen' }));
  const match = (o = {}) => ({
    type: 'payment', from: SENDER.publicKey(), to: DEST_A, asset_type: 'native', amount: '5.0000000', transaction_successful: true,
    created_at: new Date(Date.now() - 60000).toISOString(), transaction_hash: 'd'.repeat(64),
    transaction_attr: { memo_type: 'text', memo: 'a' }, ...o,
  });

  // Lauf mit unklarem Ergebnis, danach verschwindet der Eintrag (z.B. Website-Daten geloescht).
  async function ambiguousThenLost() {
    const a = rowA();
    let maxTime;
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => {
      maxTime = Number(tx.timeBounds.maxTime);
      throw new AmbiguousSubmitResultError(hashOf(tx), new TypeError('Failed to fetch'));
    });
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), null);
    checkNow();
    await waitFor(() => expect(screen.getByTestId('batch-log-missing')).toBeInTheDocument());
    return { a, maxTime };
  }

  it('Ergebnis: kein laut Horizon, kein Erneut senden, Hinweis auf die Suche', async () => {
    await ambiguousThenLost();
    expect(screen.getByText('Status unklar – Eintrag im Sende-Protokoll fehlt')).toBeInTheDocument();
    expect(screen.getByTestId('batch-log-missing').textContent).toMatch(/sucht SKM bei Horizon nach dieser Zahlung/);
    expect(screen.queryByText(/laut Horizon/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Erneut senden' })).toBeNull();
    expect(screen.queryByTestId('batch-resolved-not-sent')).toBeNull();
    expect(hoisted.paymentsMock).not.toHaveBeenCalled(); // die Suche laeuft erst vor dem Senden
  });

  it('Horizon findet die Zahlung: wie bereits gesendet, nicht vorgewaehlt, nur bewusst waehlbar', async () => {
    const { a, maxTime } = await ambiguousThenLost();
    hoisted.ledgerClosedAt.value = isoAt(maxTime + 65);
    hoisted.paymentsMock.mockResolvedValue({ records: [match()] });
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/bereits gesendet/)).toBeInTheDocument());
    expect(hoisted.paymentsMock).toHaveBeenCalledTimes(1);
    const cb = screen.getByRole('checkbox');
    expect(cb.checked).toBe(false);
    expect(cb).not.toBeDisabled();
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'success', hash: 'd'.repeat(64) });
  });

  it('Gegenprobe: andere Zahlung (anderer Betrag) gefunden -> normale Zahlung, mit Pin der frueheren Sequence', async () => {
    const { a, maxTime } = await ambiguousThenLost();
    hoisted.ledgerClosedAt.value = isoAt(maxTime + 65);
    hoisted.paymentsMock.mockResolvedValue({ records: [match({ amount: '6' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText('Bereit')).toBeInTheDocument());
    expect(screen.getByRole('checkbox').checked).toBe(true);
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toMatchObject({ status: 'notApplied', pin: true, seq: '101' });
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(2);
    expect(hoisted.submitMock.mock.calls[1][1].sequence).toBe('101');
  });

  it('Horizon nicht erreichbar: Hinweis, nicht senden', async () => {
    const { maxTime } = await ambiguousThenLost();
    hoisted.ledgerClosedAt.value = isoAt(maxTime + 65);
    hoisted.paymentsMock.mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/Horizon konnte nicht nach dieser Zahlung/)).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '0 Zahlungen senden' })).toBeDisabled();
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
  });

  it('Gegenprobe: fruehere Transaktion laut Netz noch gueltig -> gesperrt, keine Suche', async () => {
    const { maxTime } = await ambiguousThenLost();
    hoisted.ledgerClosedAt.value = isoAt(maxTime - 10);
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText(/kann laut Netz noch ankommen/)).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(hoisted.paymentsMock).not.toHaveBeenCalled();
  });

  it('Gegenprobe: ohne verschwundenen Eintrag keine Suche bei Horizon', async () => {
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    expect(hoisted.paymentsMock).not.toHaveBeenCalled();
  });
});

describe('BatchPaymentDialog: unlesbarer Eintrag und Details kopieren (F4, F6)', () => {
  it('F4: unlesbarer Eintrag bleibt stehen und sperrt die Zahlung als unklar', async () => {
    const a = rowA();
    const key = sentEntryKey('PUBLIC', fpOf(a, DEST_A));
    window.localStorage.setItem(key, '{kaputt');
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByTestId('batch-ambiguous-unreadable')).toBeInTheDocument());
    expect(screen.getByText(/Gesperrt: Der Status/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(window.localStorage.getItem(key)).toBe('{kaputt');
    expect(hoisted.txLookupMock).not.toHaveBeenCalled();
    // Gegenprobe: ohne Eintrag ist dieselbe Zahlung bereit
    window.localStorage.removeItem(key);
    fireEvent.click(screen.getByRole('button', { name: 'Zurück zur Liste' }));
    await checkAndWait(1);
  });

  it('F6: Meldung wird vor Details kopieren bereinigt (kein Secret, kein langes Base64)', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const planted = 'B'.repeat(80);
    hoisted.submitMock.mockImplementationOnce(async () => { throw new Error(`boom ${planted} ${SENDER.secret()}`); });
    hoisted.submitMock.mockImplementationOnce(async () => {
      const e = new Error('bad'); e.response = { data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } } } }; throw e;
    });
    saveBatchRows('PUBLIC', [rowA(), rowB()]);
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Details kopieren' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0];
    expect(text).not.toContain(planted);
    expect(text).not.toContain(SENDER.secret());
    // Gegenprobe: normale Meldungen bleiben lesbar
    expect(text).toContain('tx_failed / op_underfunded');
  });
});

// Gemeinsame Sperre mit "Zahlung senden": Ein unklarer Eintrag einer Einzelzahlung sperrt
// jede Zahlung desselben Senders in der Sammelzahlung (utils/submitGuard/accountSendGuard.js).
describe('BatchPaymentDialog: Sperre durch unklare Einzelzahlung', () => {
  const pendingSingle = () => ({
    hash: 'e'.repeat(64), at: Date.now(), status: 'ambiguous', maxTime: Math.floor(Date.now() / 1000) + 170,
    seq: '101', source: SENDER.publicKey(), origin: 'payment', cause: { kind: 'network', status: null },
  });

  it('sperrt die Zeilen dieses Senders schon beim Pruefen, andere Sender bleiben bereit', async () => {
    const { writeAccountEntry, resetAccountSendGuardMemory } = await import('../../../utils/submitGuard/accountSendGuard.js');
    resetAccountSendGuardMemory();
    writeAccountEntry('PUBLIC', SENDER.publicKey(), pendingSingle());
    saveBatchRows('PUBLIC', [rowA(), createEmptyRow({ source: SENDER2.publicKey(), dest: DEST_B, amount: '1', memoVal: 'x' })]);
    renderDialog();
    await checkAndWait(1);
    expect(screen.getByText(/Einzelzahlung \(Zahlung senden\) mit unklarem Status/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock.mock.calls.map(([, tx]) => tx.source)).toEqual([SENDER2.publicKey()]);
  });

  it('Einzelzahlung wird nach dem Pruefen unklar (anderer Tab): Zeile wird beim Senden uebersprungen', async () => {
    const { writeAccountEntry, resetAccountSendGuardMemory } = await import('../../../utils/submitGuard/accountSendGuard.js');
    resetAccountSendGuardMemory();
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    writeAccountEntry('PUBLIC', SENDER.publicKey(), pendingSingle());
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/Einzelzahlung \(Zahlung senden\) mit unklarem Status/)).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });
});

// Nachbesserung review_zahlung_unklar_sonnet.md: Pin und Sperre gelten fuer das Konto, in
// beiden Sendewegen; unlesbare Eintraege sperren alle Konten im Netz.
describe('BatchPaymentDialog: Pin und Sperre pro Konto (F1, F2)', () => {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const singlePin = (o = {}) => ({
    hash: 'e'.repeat(64), at: Date.now() - 600000, status: 'notApplied', maxTime: nowSec() - 300, seq: '105',
    source: SENDER.publicKey(), origin: 'payment', pin: true, ...o,
  });
  async function guard() {
    const mod = await import('../../../utils/submitGuard/accountSendGuard.js');
    mod.resetAccountSendGuardMemory();
    return mod;
  }
  // Arbeitsspeicher des Moduls (bekannte unklare Eintraege) wie nach einem Neuladen leeren.
  beforeEach(async () => { await guard(); });

  it('Pin aus Zahlung senden: die Sammelzahlung nutzt genau diese Sequence, danach ist der Pin erledigt', async () => {
    const { writeAccountEntry, readAccountEntry } = await guard();
    hoisted.loadAccountMock.mockImplementation(async (id) => { countRequest(); return account(id, '104'); });
    writeAccountEntry('PUBLIC', SENDER.publicKey(), singlePin());
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock.mock.calls[0][1].sequence).toBe('105');
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())).toMatchObject({ status: 'notApplied' });
    expect(readAccountEntry('PUBLIC', SENDER.publicKey()).pin).toBeUndefined();
  });

  it('Pin aus Zahlung senden passt nicht (Konto weiter): nicht senden, Eintrag wieder unklar, Konto gesperrt', async () => {
    const { writeAccountEntry, readAccountEntry } = await guard();
    hoisted.loadAccountMock.mockImplementation(async (id) => { countRequest(); return account(id, '105'); });
    writeAccountEntry('PUBLIC', SENDER.publicKey(), singlePin());
    saveBatchRows('PUBLIC', [rowA(), rowB()]);
    renderDialog();
    await checkAndWait(2);
    fireEvent.click(screen.getByRole('button', { name: '2 Zahlungen senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary')).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())).toMatchObject({ status: 'ambiguous', recheck: 'pinConsumed' });
    expect(screen.getByText(/Sequence der früheren Transaktion ist inzwischen verbraucht/)).toBeInTheDocument();
    expect(screen.getByText(/Einzelzahlung \(Zahlung senden\) mit unklarem Status/)).toBeInTheDocument();
  });

  it('Pin einer anderen Zahlung desselben Senders (Sammelzahlung) gilt auch fuer diese Zeile', async () => {
    hoisted.loadAccountMock.mockImplementation(async (id) => { countRequest(); return account(id, '104'); });
    const other = rowA({ dest: DEST_B, amount: '9', memoVal: 'x' });
    writeSentEntry('PUBLIC', fpOf(other, DEST_B), singlePin({ origin: undefined }));
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock.mock.calls[0][1].sequence).toBe('105');
    expect(readSentEntry('PUBLIC', fpOf(other, DEST_B)).pin).toBeUndefined();
  });

  it('unklar sperrt das Konto: andere unklare Zahlung desselben Senders sperrt alle seine Zeilen, andere Sender nicht', async () => {
    const other = rowA({ dest: DEST_B, amount: '9', memoVal: 'x' });
    writeSentEntry('PUBLIC', fpOf(other, DEST_B), {
      hash: 'd'.repeat(64), at: Date.now(), status: 'ambiguous', maxTime: nowSec() + 170, seq: '101', source: SENDER.publicKey(),
    });
    hoisted.ledgerClosedAt.value = new Date(nowSec() * 1000).toISOString();
    saveBatchRows('PUBLIC', [rowA(), createEmptyRow({ source: SENDER2.publicKey(), dest: DEST_B, amount: '1', memoVal: 'y' })]);
    renderDialog();
    await checkAndWait(1);
    expect(screen.getByText(/andere Zahlung mit unklarem Status offen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByTestId('batch-summary').textContent).toContain('1 von 1'));
    expect(hoisted.submitMock.mock.calls.map(([, tx]) => tx.source)).toEqual([SENDER2.publicKey()]);
  });

  it('andere Zahlung desselben Senders wird beim Senden unklar (anderer Tab): Zeile uebersprungen', async () => {
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    const other = rowA({ dest: DEST_B, amount: '9', memoVal: 'x' });
    writeSentEntry('PUBLIC', fpOf(other, DEST_B), {
      hash: 'd'.repeat(64), at: Date.now(), status: 'ambiguous', maxTime: nowSec() + 170, seq: '101', source: SENDER.publicKey(),
    });
    fireEvent.click(screen.getByRole('button', { name: '1 Zahlung senden' }));
    await waitFor(() => expect(screen.getByText(/andere Zahlung mit unklarem Status offen/)).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('unlesbarer Eintrag ohne Quellkonto sperrt alle Zeilen im Netz, Hinweis mit Ausweg ueber Horizon', async () => {
    await guard();
    const brokenKey = `skm_batch_sent_v1:PUBLIC:${'f'.repeat(64)}`;
    window.localStorage.setItem(brokenKey, JSON.stringify({ hash: 'c'.repeat(64), status: 'kaputt' }));
    saveBatchRows('PUBLIC', [rowA(), createEmptyRow({ source: SENDER2.publicKey(), dest: DEST_B, amount: '1', memoVal: 'y' })]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByTestId('batch-unreadable-banner')).toBeInTheDocument());
    expect(screen.getAllByText(/unlesbar und lässt sich keinem Konto zuordnen/)).toHaveLength(2);
    expect(screen.queryByText('Bereit')).toBeNull();
    // Lesbarer Hash im Ledger: Sperre frei, Liste neu geprueft
    hoisted.txLookupMock.mockImplementation(async (hash) => {
      if (hash === 'c'.repeat(64)) return { hash, successful: true };
      const e = new Error('nf'); e.response = { status: 404 }; throw e;
    });
    fireEvent.click(screen.getByTestId('batch-unreadable-check'));
    await waitFor(() => expect(screen.getAllByText('Bereit')).toHaveLength(2));
    expect(window.localStorage.getItem(brokenKey)).toBeNull();
    expect(screen.getByTestId('batch-unreadable-banner').textContent).toMatch(/im Kontoverlauf prüfen/);
  });

  it('unlesbarer Eintrag in einem anderen Netz sperrt nicht', async () => {
    window.localStorage.setItem(`skm_batch_sent_v1:TESTNET:${'f'.repeat(64)}`, '{kaputt');
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    await checkAndWait(1);
    expect(screen.queryByTestId('batch-unreadable-banner')).toBeNull();
  });
});

// N4 (Buendel 4a): Abbruch der Pruefung. Die Klaerung unklarer Eintraege laeuft seriell, bis ca.
// 32 s je Eintrag; ein Abbruch durch die Nutzerin beendet sie, ohne etwas freizugeben.
describe('BatchPaymentDialog: Pruefung abbrechen (N4)', () => {
  it('Abbrechen mitten in der Klaerung: zurueck zur Liste, Eintrag bleibt unklar und gesperrt', async () => {
    const { resetAccountSendGuardMemory } = await import('../../../utils/submitGuard/accountSendGuard.js');
    resetAccountSendGuardMemory();
    const maxTime = Math.floor(Date.now() / 1000) - 1000;
    // Anderer unklarer Eintrag desselben Senders; seine Sequence liegt weit unter der des Kontos
    // (100): strenger Pfad mit 30 s Wartezeit zwischen zwei Abfragen.
    const other = { hash: 'd'.repeat(64), at: Date.now() - 2000 * 1000, status: 'ambiguous', maxTime, seq: '50', source: SENDER.publicKey() };
    writeSentEntry('PUBLIC', 'andere-zahlung', other);
    hoisted.ledgerClosedAt.value = new Date((maxTime + 65) * 1000).toISOString();
    saveBatchRows('PUBLIC', [rowA()]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    const cancel = await screen.findByTestId('batch-check-cancel');
    // Etwas warten, damit die Klaerung in der 30-s-Wartezeit steckt.
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    fireEvent.click(cancel);
    await screen.findByText(/Prüfung abgebrochen/);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeEnabled();
    expect(screen.queryByTestId('batch-check-cancel')).toBeNull();
    // Nichts freigegeben, nichts veraendert: der Eintrag steht weiter als unklar im Protokoll.
    expect(readSentEntry('PUBLIC', 'andere-zahlung')).toMatchObject({ status: 'ambiguous', hash: other.hash });
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });
});
