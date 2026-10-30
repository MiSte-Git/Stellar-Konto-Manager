import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, MuxedAccount } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import i18n from '../../../i18n.js';
import BatchPaymentDialog from '../BatchPaymentDialog.jsx';
import {
  BATCH_PAYMENT_STORAGE_KEY, createEmptyRow, readSentEntry, saveBatchRows, writeSentEntry,
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
}));

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccountMock,
    ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ base_reserve_in_stroops: 5000000, closed_at: hoisted.ledgerClosedAt.value }] }) }) }) }),
    transactions: () => ({ transaction: (hash) => ({ call: () => hoisted.txLookupMock(hash) }) }),
  }),
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

function account(id) {
  return Object.assign(new Account(id, '100'), {
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
  hoisted.loadAccountMock.mockImplementation(async (id) => account(id));
  hoisted.getSessionSecretMock.mockImplementation(async (acc) => (acc === SENDER.publicKey() ? SENDER.secret() : acc === SENDER2.publicKey() ? SENDER2.secret() : ''));
  hoisted.submitMock.mockImplementation(async (_server, tx) => ({ hash: hashOf(tx) }));
  hoisted.txLookupMock.mockImplementation(async () => { const e = new Error('nf'); e.response = { status: 404 }; throw e; });
  hoisted.ledgerClosedAt.value = undefined;
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

    // Horizon findet sie jetzt erfolgreich -> wird zu "bereits gesendet".
    hoisted.txLookupMock.mockResolvedValue({ successful: true });
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

  it('releases an unclear payment once Horizon has a ledger after its maxTime', async () => {
    const a = rowA();
    const maxTime = Math.floor(Date.now() / 1000) - 120;
    writeSentEntry('PUBLIC', fpOf(a, DEST_A), { hash: 'e'.repeat(64), at: Date.now(), status: 'ambiguous', maxTime });
    hoisted.ledgerClosedAt.value = new Date((maxTime + 65) * 1000).toISOString();
    saveBatchRows('PUBLIC', [a]);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(screen.getByText('Bereit')).toBeInTheDocument(), { timeout: 5000 });
    expect(readSentEntry('PUBLIC', fpOf(a, DEST_A))).toBeNull();
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
});
