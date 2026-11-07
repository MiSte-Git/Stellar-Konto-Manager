import React from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import SendPaymentPage from '../SendPaymentPage.jsx';
import { clearSendPaymentDraft } from '../../utils/sendPaymentDraft.js';
import { clearAllSessionSecrets } from '../../utils/sessionSecrets.js';
import { AmbiguousSubmitResultError } from '../../utils/stellar/submitTransactionSafely.js';
import { txHashHex } from '../../utils/stellar/txHash.js';
import {
  accountEntryKey, readAccountEntry, resetAccountSendGuardMemory, writeAccountEntry,
} from '../../utils/submitGuard/accountSendGuard.js';
import { writeSentEntry } from '../../utils/batchPayment/batchPaymentStore.js';

// Zahlung senden mit unklarem Status nach den Regeln der Sammelzahlung: gespeicherte Sperre
// pro Netz und Konto, Freigabe nur ueber Horizon, Erneut senden nur mit derselben
// signierten Transaktion.

const SENDER = Keypair.random();
const OTHER = Keypair.random().publicKey();
const DEST_PK = Keypair.random().publicKey();
const H = (c) => c.repeat(64);

const hoisted = vi.hoisted(() => ({
  loadAccountMock: vi.fn(),
  getSessionSecretMock: vi.fn(),
  submitMock: vi.fn(),
  txLookupMock: vi.fn(),
  ledgerMock: vi.fn(),
  serverNetworkMock: vi.fn(),
  copyMock: vi.fn(),
}));

vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => {
  const fakeServer = () => ({
    loadAccount: hoisted.loadAccountMock,
    feeStats: vi.fn(async () => ({ fee_charged: { mode: '100' } })),
    offers: () => ({ forAccount: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) }),
    ledgers: () => ({ order: () => ({ limit: () => ({ call: () => hoisted.ledgerMock() }) }) }),
    transactions: () => ({ transaction: (hash) => ({ call: () => hoisted.txLookupMock(hash) }) }),
  });
  return {
    ...(await importOriginal()),
    getHorizonServer: fakeServer,
    getHorizonServerForNetwork: (network) => { hoisted.serverNetworkMock(network); return fakeServer(); },
    resolveOrValidateAccount: vi.fn(async (input) => ({ accountId: input, muxedAddress: null, address: input })),
    reverseFederationLookup: vi.fn(async () => null),
  };
});
vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: hoisted.getSessionSecretMock,
}));
vi.mock('../../utils/stellar/submitTransactionSafely.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTransactionSafely: hoisted.submitMock,
}));
vi.mock('../../utils/clipboard.js', () => ({ copyText: hoisted.copyMock }));

function funded(publicKey, sequence = '100') {
  return Object.assign(new Account(publicKey, sequence), {
    account_id: publicKey,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: [{ key: publicKey, weight: 1, type: 'ed25519_public_key' }],
    balances: [{ asset_type: 'native', balance: '10000.0000000' }],
    subentry_count: 0,
  });
}

const renderFor = (publicKey = SENDER.publicKey()) => render(
  <I18nextProvider i18n={i18n}>
    <SendPaymentPage publicKey={publicKey} />
  </I18nextProvider>
);
const inputAfterLabel = (text) => screen.getByText(text, { selector: 'label' }).parentElement.querySelector('input');
const destInput = () => screen.getByPlaceholderText('G... oder user*domain');
const amountInput = () => inputAfterLabel('Betrag');
const sendButton = () => screen.getByRole('button', { name: 'Senden' });
const fillForm = (amount = '10') => {
  fireEvent.change(destInput(), { target: { value: DEST_PK } });
  fireEvent.change(amountInput(), { target: { value: amount } });
};
const confirmSend = async () => {
  fireEvent.click(sendButton());
  await screen.findByText('Transaktion bestätigen');
  fireEvent.click(screen.getByRole('button', { name: 'Bist du sicher?' }));
};
const nf = () => { const e = new Error('nf'); e.response = { status: 404 }; return e; };
const nowSec = () => Math.floor(Date.now() / 1000);
const ledgerAt = (sec) => ({ records: [{ closed_at: new Date(sec * 1000).toISOString(), base_reserve_in_stroops: 5000000 }] });
const ambiguousFetch = (tx) => new AmbiguousSubmitResultError(
  txHashHex(tx), new TypeError('Failed to fetch'),
  { request: { method: 'POST', url: 'https://horizon.example/transactions', at: new Date().toISOString(), durationMs: 12, error: { name: 'TypeError', message: 'Failed to fetch', status: null } }, lookups: [{ at: 'x', result: 'notFound' }] },
);
const PAYMENT = { dest: DEST_PK, amount: '10', assetKey: 'XLM', memoType: 'text', memoVal: '' };
const SUMMARY = { recipient: DEST_PK, amountDisplay: '10', asset: 'XLM', memo: '', activated: false, muxedActivationCapture: false };
function storedEntry(o = {}) {
  return {
    hash: H('a'), at: Date.now() - 5000, status: 'ambiguous', maxTime: nowSec() + 170, seq: '101', source: SENDER.publicKey(),
    origin: 'payment', cause: { kind: 'network', status: null }, payment: PAYMENT, summary: SUMMARY, ...o,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
  clearSendPaymentDraft();
  resetAccountSendGuardMemory();
  hoisted.loadAccountMock.mockImplementation(async (pk) => funded(pk));
  hoisted.getSessionSecretMock.mockResolvedValue(SENDER.secret());
  hoisted.submitMock.mockImplementation(async (_s, tx) => ({ hash: txHashHex(tx) }));
  hoisted.txLookupMock.mockImplementation(async () => { throw nf(); });
  hoisted.ledgerMock.mockImplementation(async () => ledgerAt(nowSec()));
  hoisted.copyMock.mockResolvedValue(true);
});

describe('Zahlung senden: unklarer Status wie in der Sammelzahlung', () => {
  it('Netzwerkfehler: richtige Ursache, Uhrzeit, Countdown, gesperrt, ohne Freigabe-Button, Eintrag gespeichert', async () => {
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => { throw ambiguousFetch(tx); });
    renderFor();
    fillForm();
    await confirmSend();

    const panel = await screen.findByTestId('send-ambiguous');
    expect(screen.getByTestId('send-ambiguous-cause').textContent).toContain('Netzwerkfehler');
    expect(panel.textContent).not.toContain('Zeitüberschreitung oder Serverfehler');
    expect(screen.getByTestId('send-ambiguous-sent-at').textContent).toMatch(/Gesendet um/);
    expect(screen.getByTestId('send-ambiguous-countdown').textContent).toMatch(/prüft automatisch erneut in 0[34]:\d\d/);
    expect(screen.getByTestId('send-ambiguous-clear-at')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Senden wieder freigeben/ })).toBeNull();
    expect(sendButton()).toBeDisabled();
    // Kein widerspruechlicher Hinweis "unklar, im Explorer pruefen" neben dem Kasten
    expect(screen.queryByTestId('send-sent-before')).toBeNull();

    const tx = hoisted.submitMock.mock.calls[0][1];
    const raw = window.localStorage.getItem(accountEntryKey('PUBLIC', SENDER.publicKey()));
    const stored = JSON.parse(raw);
    expect(stored).toMatchObject({
      hash: txHashHex(tx), source: SENDER.publicKey(), seq: String(tx.sequence), maxTime: Number(tx.timeBounds.maxTime),
      network: 'PUBLIC', status: 'ambiguous', cause: { kind: 'network', status: null },
    });
    expect(raw).not.toContain(SENDER.secret());
    expect(raw).not.toContain(tx.toXDR());
    expect(screen.getByTestId('send-ambiguous-hash').textContent).toBe(txHashHex(tx));
    expect(screen.getByTestId('send-ambiguous-resend')).toBeInTheDocument();

    // Details kopieren: Diagnose ohne Secret und ohne XDR
    fireEvent.click(screen.getByTestId('send-ambiguous-copy'));
    await waitFor(() => expect(hoisted.copyMock).toHaveBeenCalledTimes(1));
    const text = hoisted.copyMock.mock.calls[0][0];
    expect(text).toContain(`TX: ${txHashHex(tx)}`);
    expect(text).toContain('Diagnose');
    expect(text).toContain('Failed to fetch');
    expect(text).not.toContain(SENDER.secret());
    expect(text).not.toContain(tx.toXDR());
  });

  it('Neuladen waehrend der Sperre: bleibt gesperrt, Erneut senden mit klarem Hinweis nicht verfuegbar', async () => {
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => { throw ambiguousFetch(tx); });
    const first = renderFor();
    fillForm();
    await confirmSend();
    await screen.findByTestId('send-ambiguous');
    first.unmount();
    // Neuladen: Arbeitsspeicher weg, localStorage bleibt
    resetAccountSendGuardMemory();
    clearSendPaymentDraft();

    renderFor();
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    expect(screen.getByTestId('send-ambiguous-resend-missing')).toBeInTheDocument();
    expect(screen.queryByTestId('send-ambiguous-resend')).toBeNull();
    fillForm();
    expect(sendButton()).toBeDisabled();
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
  });

  it('Neuladen waehrend des Sendens (Eintrag ohne Ursache): gesperrt, Ursache unbekannt', () => {
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry({ cause: undefined }));
    renderFor();
    expect(screen.getByTestId('send-ambiguous-cause').textContent).toContain('unterbrochen');
  });

  it('Horizon beim Pruefen nicht erreichbar: bleibt gesperrt, Meldung', async () => {
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry());
    hoisted.txLookupMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    hoisted.ledgerMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    renderFor();
    fireEvent.click(screen.getByTestId('send-ambiguous-check'));
    await waitFor(() => expect(screen.getByTestId('send-ambiguous').textContent).toContain('Horizon war nicht erreichbar'));
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())?.status).toBe('ambiguous');
    expect(hoisted.serverNetworkMock).toHaveBeenLastCalledWith('PUBLIC');
  });

  it('doch angewendet: Erfolg wie nach normalem Senden, kein erneutes Senden, Vermerk gesendet', async () => {
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry());
    hoisted.txLookupMock.mockImplementation(async (hash) => ({ hash, successful: true }));
    // Sitzung gesperrt: kein Secret im Speicher, Pruefen braucht keins
    clearAllSessionSecrets();
    hoisted.getSessionSecretMock.mockResolvedValue(null);
    renderFor();
    fillForm();
    fireEvent.click(screen.getByTestId('send-ambiguous-check'));

    await waitFor(() => expect(screen.queryByTestId('send-ambiguous')).toBeNull());
    expect(screen.getByTestId('send-ambiguous-resolved').dataset.kind).toBe('applied');
    expect(screen.getAllByText('Erfolgreich gesendet').length).toBeGreaterThan(0);
    expect(screen.getByTestId('send-sent-before').textContent).toContain('bereits gesendet');
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())).toMatchObject({ status: 'success', hash: H('a') });
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(hoisted.getSessionSecretMock).not.toHaveBeenCalled();
    // Entwurf bleibt wie nach einem normalen Erfolg
    expect(amountInput().value).toBe('10');
  });

  it('abgelaufen, Sequence frei: automatisch geprueft, freigegeben, naechste Zahlung mit derselben Sequence', async () => {
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry({ maxTime: nowSec() - 400, seq: '201' }));
    hoisted.loadAccountMock.mockImplementation(async (pk) => funded(pk, pk === SENDER.publicKey() ? '200' : '100'));
    renderFor();
    // Automatische Pruefung beim Laden (Zeitpunkt vorbei), Ergebnis nach kurzer Wiederholung
    const notice = await screen.findByTestId('send-ambiguous-resolved', {}, { timeout: 5000 });
    expect(notice.dataset.kind).toBe('notApplied');
    expect(notice.textContent).toContain('Sequence der alten Transaktion');
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())).toMatchObject({ status: 'notApplied', pin: true });

    fillForm();
    await confirmSend();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    expect(hoisted.submitMock.mock.calls[0][1].sequence).toBe('201');
  });

  it('Rechneruhr voraus: Entscheidung aus der Ledger-Zeit, bleibt gesperrt', async () => {
    // maxTime laut lokaler Uhr vorbei, laut Netz noch gueltig
    const maxTime = nowSec() - 400;
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry({ maxTime }));
    hoisted.ledgerMock.mockImplementation(async () => ledgerAt(maxTime - 30));
    renderFor();
    await waitFor(() => expect(screen.getByTestId('send-ambiguous-countdown').textContent).toContain('Noch nicht eindeutig'));
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())?.status).toBe('ambiguous');
    fillForm();
    expect(sendButton()).toBeDisabled();
  });

  it('Erneut senden: genau dieselbe signierte Transaktion, Erfolg loest die Sperre', async () => {
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => { throw ambiguousFetch(tx); });
    renderFor();
    fillForm();
    await confirmSend();
    await screen.findByTestId('send-ambiguous');
    const firstTx = hoisted.submitMock.mock.calls[0][1];

    fireEvent.click(screen.getByTestId('send-ambiguous-resend'));
    await waitFor(() => expect(screen.queryByTestId('send-ambiguous')).toBeNull());
    expect(hoisted.submitMock).toHaveBeenCalledTimes(2);
    const secondTx = hoisted.submitMock.mock.calls[1][1];
    expect(txHashHex(secondTx)).toBe(txHashHex(firstTx));
    expect(screen.getByTestId('send-ambiguous-resolved').dataset.kind).toBe('applied');
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())).toMatchObject({ status: 'success', hash: txHashHex(firstTx) });
  });

  it('Erneut senden abgelehnt: bleibt gesperrt, Horizon wird gefragt', async () => {
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => { throw ambiguousFetch(tx); });
    renderFor();
    fillForm();
    await confirmSend();
    await screen.findByTestId('send-ambiguous');
    hoisted.submitMock.mockImplementationOnce(async () => {
      throw Object.assign(new Error('bad'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } } });
    });
    fireEvent.click(screen.getByTestId('send-ambiguous-resend'));
    await waitFor(() => expect(screen.getByTestId('send-ambiguous-resend-rejected').textContent).toContain('tx_bad_seq'));
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    await waitFor(() => expect(hoisted.txLookupMock).toHaveBeenCalled());
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())?.status).toBe('ambiguous');
  });

  it('Sammelzahlung unklar fuer dieses Konto: Einzelzahlung gesperrt; anderes Konto nicht', () => {
    writeSentEntry('PUBLIC', 'fp-x', { hash: H('b'), at: Date.now(), status: 'ambiguous', maxTime: nowSec() + 100, seq: '9', source: SENDER.publicKey() });
    const first = renderFor();
    expect(screen.getByTestId('send-ambiguous').textContent).toContain('Sammelzahlung');
    fillForm();
    expect(sendButton()).toBeDisabled();
    first.unmount();
    renderFor(OTHER);
    expect(screen.queryByTestId('send-ambiguous')).toBeNull();
  });

  it('zwei Tabs: Eintrag aus Tab A sperrt Tab B sofort (storage-Event)', async () => {
    renderFor();
    fillForm();
    expect(sendButton()).not.toBeDisabled();
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry());
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: accountEntryKey('PUBLIC', SENDER.publicKey()) }));
    });
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('zwei Tabs: Tab A sendet gerade (gleicher Lock wie die Sammelzahlung), Tab B wartet und kann abbrechen', async () => {
    window.localStorage.setItem('skm_batch_send_lock_v1:skm-batch-send-PUBLIC', JSON.stringify({ owner: 'tab-a', at: Date.now() }));
    renderFor();
    fillForm();
    await confirmSend();
    await screen.findByTestId('send-lock-waiting');
    fireEvent.click(screen.getByRole('button', { name: 'Warten abbrechen' }));
    await waitFor(() => expect(screen.getByText('Warten abgebrochen. Nicht gesendet.')).toBeInTheDocument());
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('Netz- und Kontowechsel verwerfen den Eintrag nicht, Rueckkehr zeigt ihn wieder', async () => {
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry());
    const first = renderFor();
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    await act(async () => { window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'TESTNET' })); });
    expect(screen.queryByTestId('send-ambiguous')).toBeNull();
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    await act(async () => { window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' })); });
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    first.unmount();

    const other = renderFor(OTHER);
    expect(screen.queryByTestId('send-ambiguous')).toBeNull();
    other.unmount();
    renderFor();
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())?.hash).toBe(H('a'));
  });

  it('unlesbarer Eintrag: gesperrt, mit Pruefung ueber Horizon als Ausweg', () => {
    window.localStorage.setItem(accountEntryKey('PUBLIC', SENDER.publicKey()), '{kaputt');
    renderFor();
    expect(screen.getByTestId('send-ambiguous-unreadable')).toBeInTheDocument();
    expect(screen.getByTestId('send-ambiguous-check')).toBeInTheDocument();
    fillForm();
    expect(sendButton()).toBeDisabled();
  });

  it('eindeutiger Fehler beim Senden: keine Sperre', async () => {
    hoisted.submitMock.mockImplementationOnce(async () => {
      throw Object.assign(new Error('bad'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } } } } });
    });
    renderFor();
    fillForm();
    await confirmSend();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText(/op_underfunded|unterfinanziert|Guthaben/i).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('send-ambiguous')).toBeNull();
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())).toBeNull();
  });
});

// Nachbesserung review_zahlung_unklar_sonnet.md (F2, F5, F6, F8)
describe('Zahlung senden: Texte je Zustand, Sperre durch die Sammelzahlung, Vermerk, Fee-Bump', () => {
  it('F5: Text je Zustand: mit Ursache gesendet, ohne Ursache moeglicherweise gesendet, erneut geprueft ohne Ursache', () => {
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry());
    const r1 = renderFor();
    expect(screen.getByTestId('send-ambiguous-body').textContent).toMatch(/^Die Transaktion wurde gesendet/);
    r1.unmount();
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry({ cause: undefined }));
    const r2 = renderFor();
    expect(screen.getByTestId('send-ambiguous-body').textContent).toMatch(/möglicherweise gesendet/);
    r2.unmount();
    writeAccountEntry('PUBLIC', SENDER.publicKey(), storedEntry({ cause: undefined, recheck: 'pinConsumed' }));
    renderFor();
    expect(screen.getByTestId('send-ambiguous-body').textContent).toMatch(/erneut streng über Horizon/);
    expect(screen.queryByTestId('send-ambiguous-cause')).toBeNull();
  });

  it('F2: unlesbarer Eintrag der Sammelzahlung (ohne Quellkonto) sperrt jedes Konto im Netz, mit Pruefung als Ausweg', () => {
    window.localStorage.setItem(`skm_batch_sent_v1:PUBLIC:${'f'.repeat(64)}`, '{kaputt');
    renderFor(OTHER);
    expect(screen.getByTestId('send-ambiguous-body').textContent).toMatch(/Sammelzahlung ist unlesbar/);
    expect(screen.getByTestId('send-ambiguous-check')).toBeInTheDocument();
    fillForm();
    expect(sendButton()).toBeDisabled();
  });

  it('F8: Klaerung in einem anderen Tab raeumt den unklaren Vermerk dieses Tabs, auch wenn danach eine neue Zahlung den Eintrag ersetzt', async () => {
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => { throw ambiguousFetch(tx); });
    renderFor();
    fillForm();
    await confirmSend();
    await screen.findByTestId('send-ambiguous');
    const key = accountEntryKey('PUBLIC', SENDER.publicKey());
    const oldValue = window.localStorage.getItem(key);
    const old = JSON.parse(oldValue);
    const resolved = JSON.stringify({ ...old, status: 'notApplied' });
    // Anderer Tab: erst geklaert, dann eine andere Zahlung erfolgreich gesendet.
    const next = JSON.stringify({ ...old, hash: H('9'), status: 'success', payment: { ...old.payment, amount: '11' } });
    window.localStorage.setItem(key, next);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: resolved }));
      window.dispatchEvent(new StorageEvent('storage', { key, oldValue: resolved, newValue: next }));
    });
    await waitFor(() => expect(screen.queryByTestId('send-ambiguous')).toBeNull());
    // Formular steht noch mit den Daten der unklaren Zahlung: kein Hinweis "unklarer Status" mehr.
    expect(screen.queryByTestId('send-sent-before')).toBeNull();
    expect(sendButton()).not.toBeDisabled();
  });

  it('F6: Fee-Bump einer anderen Partei: angezeigt wird unser Hash, der Fee-Bump-Hash zusaetzlich', async () => {
    hoisted.submitMock.mockImplementationOnce(async (_s, tx) => ({ hash: txHashHex(tx), feeBumpHash: H('c') }));
    renderFor();
    fillForm();
    await confirmSend();
    await screen.findByTestId('send-success-feebump');
    expect(screen.getByTestId('send-success-feebump').textContent).toContain(H('c'));
    const tx = hoisted.submitMock.mock.calls[0][1];
    expect(screen.getByTestId('sent-result-feebump').textContent).toContain(H('c'));
    expect(readAccountEntry('PUBLIC', SENDER.publicKey())).toMatchObject({ status: 'success', hash: txHashHex(tx) });
  });
});
