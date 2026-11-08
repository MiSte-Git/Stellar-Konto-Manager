import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { AmbiguousSubmitResultError } from '../../../utils/stellar/submitTransactionSafely.js';
import i18n from '../../../i18n.js';
import BatchConvertDialog from '../BatchConvertDialog.jsx';
import { resetServerNetworkCalls, serverNetworkCalls } from '../../../test/horizonMock.js';
import { readAccountEntry, resetAccountSendGuardMemory, writeAccountEntry } from '../../../utils/submitGuard/accountSendGuard.js';
import { withSendLock } from '../../../utils/submitGuard/sendLock.js';

// Schalter fuer die Probe "Sperre wirkungslos": Dann schuetzt nur die Schleife des Sammel-Tauschs
// (break) vor weiterem Senden, nicht die Sperre des Kontos.
const guardSwitch = vi.hoisted(() => ({ off: false }));
vi.mock('../../../utils/submitGuard/accountSendGuard.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, findAccountSendBlock: (...args) => (guardSwitch.off ? null : orig.findAccountSendBlock(...args)) };
});

const ME = {
  secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
  publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
};
const COSIGNER = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const id = (n) => `00000000${String(n).padStart(64, '0')}`;

const hoisted = vi.hoisted(() => ({
  loadAccountMock: vi.fn(), submitMock: vi.fn(), pathsMock: vi.fn(), recordsMock: vi.fn(), rememberMock: vi.fn(async () => {}), txLookupMock: vi.fn(), ledgerMock: vi.fn(),
}));

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../../test/horizonMock.js')).withNetworkServer({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccountMock,
    root: vi.fn(async () => ({ network_passphrase: 'Test SDF Network ; September 2015' })),
    feeStats: vi.fn(async () => ({ last_ledger_base_fee: '100', fee_charged: { mode: '100', p95: '100' } })),
    strictSendPaths: (src) => ({ call: () => hoisted.pathsMock(src) }),
    claimableBalances: () => ({ claimant: () => ({ limit: () => ({ call: hoisted.recordsMock }) }) }),
    transactions: () => ({ transaction: (hash) => ({ call: () => hoisted.txLookupMock(hash) }) }),
    ledgers: () => ({ order: () => ({ limit: () => ({ call: () => hoisted.ledgerMock() }) }) }),
  }),
}));
vi.mock('../../../utils/stellar/submitTransactionSafely.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTransactionSafely: hoisted.submitMock,
}));
vi.mock('../../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecrets: vi.fn(async () => ({})),
  rememberSessionSecrets: hoisted.rememberMock,
}));

function makeAccount({ multisig = false } = {}) {
  return Object.assign(new Account(ME.publicKey, '100'), {
    account_id: ME.publicKey,
    thresholds: multisig ? { low_threshold: 2, med_threshold: 2, high_threshold: 2 } : { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: multisig
      ? [{ key: ME.publicKey, weight: 1, type: 'ed25519_public_key' }, { key: COSIGNER, weight: 1, type: 'ed25519_public_key' }]
      : [{ key: ME.publicKey, weight: 1, type: 'ed25519_public_key' }],
    balances: [{ asset_type: 'native', balance: '100.0000000' }],
  });
}

const tokenItem = (n, code) => ({
  id: id(n), amount: '5.0000000', sponsor: '', window: null, claimableNow: true, isIssuer: false, hasTrustline: false,
  asset: { isNative: false, code, issuer: ISSUER, key: `${code}:${ISSUER}` },
});

// Horizon-Records passend zu den Eintraegen, fuer die Frischepruefung vor dem Signieren
function recordsFor(items) {
  return items.map((it) => ({
    id: it.id,
    asset: it.asset.isNative ? 'native' : `${it.asset.code}:${it.asset.issuer}`,
    amount: it.amount,
    claimants: [{ destination: ME.publicKey, predicate: { unconditional: true } }],
  }));
}

function renderDialog(props = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const items = props.items || [tokenItem(1, 'SPAMA'), tokenItem(2, 'SPAMB'), tokenItem(3, 'NOMKT')];
  hoisted.recordsMock.mockResolvedValue({ records: recordsFor(items) });
  render(
    <I18nextProvider i18n={i18n}>
      <BatchConvertDialog
        publicKey={ME.publicKey}
        account={makeAccount()}
        network="TESTNET"
        available={50}
        items={items}
        multisig={false}
        multisigTimeoutSeconds={86400}
        fmt={(v) => String(v)}
        onClose={onClose}
        onDone={onDone}
        {...props}
      />
    </I18nextProvider>
  );
  return { onDone, onClose };
}

const row = (n) => screen.getAllByTestId('batch-row').find((li) => li.getAttribute('data-claimable-id') === id(n));
const checkbox = (n) => within(row(n)).getByRole('checkbox');

async function loadPreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau laden' }));
  await waitFor(() => expect(screen.getAllByTestId('batch-row').length).toBeGreaterThan(0));
}

async function startAndSign() {
  fireEvent.click(screen.getByRole('button', { name: /einlösen & umwandeln/ }));
  await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
  fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: ME.secret } });
  const buttons = screen.getAllByRole('button', { name: /^(senden|submit)$/i });
  fireEvent.click(buttons[buttons.length - 1]);
}

beforeEach(() => {
  // Wie in der App: gespeichertes globales Netz = Netz des Dialogs (Pruefung vor dem Signieren).
  window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
  vi.clearAllMocks();
  hoisted.loadAccountMock.mockImplementation(async (pk) => (pk === ME.publicKey ? makeAccount() : { flags: {} }));
  hoisted.pathsMock.mockImplementation(async (src) => ({ records: src.code === 'NOMKT' ? [] : [{ destination_amount: '1.5', path: [] }] }));
  hoisted.submitMock.mockResolvedValue({ hash: 'batchhash' });
  hoisted.txLookupMock.mockImplementation(async () => { throw Object.assign(new Error('nf'), { response: { status: 404 } }); });
  hoisted.ledgerMock.mockImplementation(async () => ({ records: [{ closed_at: new Date().toISOString(), base_reserve_in_stroops: 5000000 }] }));
});

describe('BatchConvertDialog', () => {
  it('waehlt alle umwandelbaren vor und markiert Token ohne Markt', async () => {
    renderDialog();
    await loadPreview();
    expect(checkbox(1)).toBeChecked();
    expect(checkbox(2)).toBeChecked();
    expect(checkbox(3)).not.toBeChecked();
    expect(checkbox(3)).toBeDisabled();
    expect(within(row(3)).getByText('kein Markt gefunden')).toBeInTheDocument();
    expect(screen.getByText('2 von 3 ausgewählt')).toBeInTheDocument();
  });

  it('wandelt nur die ausgewaehlten in einer Transaktion um', async () => {
    const { onDone } = renderDialog();
    await loadPreview();
    fireEvent.click(checkbox(2));
    await startAndSign();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    const tx = hoisted.submitMock.mock.calls[0][1];
    expect(tx.operations.map((o) => o.type)).toEqual(['changeTrust', 'claimClaimableBalance', 'pathPaymentStrictSend', 'changeTrust']);
    expect(tx.operations[1].balanceId).toBe(id(1));
    expect(tx.operations[2].destMin).toBe('1.4700000');
    await screen.findByText(/Transaktion 1: 1 Einträge umgewandelt/);
    expect(onDone).toHaveBeenCalled();
  });

  it('teilt viele Eintraege auf mehrere Transaktionen auf', async () => {
    renderDialog({ items: Array.from({ length: 30 }, (_, i) => tokenItem(i + 1, `T${i}`)) });
    await loadPreview();
    await startAndSign();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(2));
    expect(hoisted.submitMock.mock.calls[0][1].operations).toHaveLength(100);
    expect(hoisted.submitMock.mock.calls[1][1].operations).toHaveLength(20);
  });

  it('Server mit dem Netz des Dialogs; nach einem Wechsel in einem anderen Tab keine weitere Transaktion', async () => {
    resetServerNetworkCalls();
    // Nach der ersten gesendeten Transaktion wechselt ein anderer Tab das Netz.
    hoisted.submitMock.mockImplementationOnce(async () => {
      window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
      return { hash: 'first' };
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog({ items: Array.from({ length: 30 }, (_, i) => tokenItem(i + 1, `T${i}`)) });
    await loadPreview();
    await startAndSign();
    await screen.findByText(new RegExp(i18n.t('createAccount:networkChanged.stoppedAfterPartial').slice(0, 40)));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    expect(serverNetworkCalls.length).toBeGreaterThan(0);
    expect(serverNetworkCalls.every((n) => n === 'TESTNET')).toBe(true);
    errSpy.mockRestore();
  });

  it('bricht nach einer fehlgeschlagenen Transaktion ab', async () => {
    const err = new Error('http 400');
    err.response = { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } };
    hoisted.submitMock.mockRejectedValueOnce(err);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog({ items: Array.from({ length: 30 }, (_, i) => tokenItem(i + 1, `T${i}`)) });
    await loadPreview();
    await startAndSign();
    await screen.findByText(/Transaktion 1 mit 25 Einträgen fehlgeschlagen/);
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('lehnt ein ungueltiges eigenes Ziel-Asset ab', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Anderes Asset (CODE:Herausgeber)' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Anderes Asset (CODE:Herausgeber)' }), { target: { value: 'LDEX:kaputt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau laden' }));
    await screen.findByText(/Ungültiges Ziel-Asset/);
    expect(hoisted.pathsMock).not.toHaveBeenCalled();
  });

  it('sperrt den Start, wenn die Reserve nicht reicht', async () => {
    renderDialog({ available: 0.1 });
    await loadPreview();
    expect(screen.getByText(/Nicht genug verfügbares XLM/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /einlösen & umwandeln/ })).toBeDisabled();
  });

  it('legt bei Multisig nur die erste Transaktion als Job an', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => (pk === ME.publicKey ? makeAccount({ multisig: true }) : { flags: {} }));
    const fetchMock = vi.fn(async (_url, opts) => ({ ok: true, json: async () => ({ id: 'job-7', txHash: 'h', txXdrCurrent: JSON.parse(opts.body).txXdr }) }));
    vi.stubGlobal('fetch', fetchMock);
    renderDialog({ multisig: true, account: makeAccount({ multisig: true }), items: Array.from({ length: 30 }, (_, i) => tokenItem(i + 1, `T${i}`)) });
    await loadPreview();
    expect(screen.getByText(/nur die erste Transaktion mit 25 Einträgen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Als Multisig-Job vorbereiten' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const tx = TransactionBuilder.fromXDR(JSON.parse(fetchMock.mock.calls[0][1].body).txXdr, Networks.TESTNET);
    expect(tx.operations).toHaveLength(100);
    expect(tx.signatures).toHaveLength(0);
    expect(Number(tx.timeBounds.maxTime) - Math.floor(Date.now() / 1000)).toBeGreaterThan(3600);
    await screen.findByText('job-7');
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('waehlt das Ziel aus den eigenen Trustlines per Suche', async () => {
    const acct = makeAccount();
    acct.balances = [
      { asset_type: 'native', balance: '100.0000000' },
      ...Array.from({ length: 60 }, (_, i) => ({ asset_type: 'credit_alphanum12', asset_code: `TOK${i}`, asset_issuer: ISSUER, balance: '0', is_authorized: true })),
      { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: ISSUER, balance: '1', is_authorized: true },
    ];
    renderDialog({ account: acct });
    fireEvent.click(screen.getByRole('radio', { name: 'Aus meinen Trustlines (61)' }));
    expect(screen.getByText(/11 weitere, bitte die Suche verfeinern/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ldex' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    fireEvent.click(options[0]);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await loadPreview();
    expect(screen.getAllByText(/≈ 1.5 LDEX/).length).toBeGreaterThan(0);
  });

  it('verlangt eine Auswahl, wenn Trustline als Ziel gewaehlt ist', async () => {
    const acct = makeAccount();
    acct.balances = [...acct.balances, { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: ISSUER, balance: '1', is_authorized: true }];
    renderDialog({ account: acct });
    fireEvent.click(screen.getByRole('radio', { name: 'Aus meinen Trustlines (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau laden' }));
    await screen.findByText('Bitte eine Trustline als Ziel-Asset auswählen.');
  });

  const many = () => Array.from({ length: 30 }, (_, i) => tokenItem(i + 1, `T${i}`));

  it('behaelt den Teilerfolg, wenn danach das Laden des Kontos scheitert', async () => {
    const { onDone } = renderDialog({ items: many() });
    await loadPreview();
    let calls = 0;
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk !== ME.publicKey) return { flags: {} };
      calls += 1;
      // 1: Frischepruefung vor dem Signieren, 2: Konto im Lock fuer Transaktion 1, 3: fuer Transaktion 2.
      if (calls >= 3) throw new Error('horizon down');
      return makeAccount();
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startAndSign();
    await screen.findByText(/Transaktion 1: 25 Einträge umgewandelt/);
    expect(screen.getByText(/Transaktion 2 mit 5 Einträgen fehlgeschlagen/)).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('zeigt ein unklares Ergebnis als unklar, nicht als fehlgeschlagen', async () => {
    hoisted.submitMock.mockRejectedValueOnce(new AmbiguousSubmitResultError('amb-hash', new Error('timeout')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog();
    await loadPreview();
    await startAndSign();
    await screen.findByText(/Ergebnis unklar.*amb-hash/);
    expect(screen.queryByText(/fehlgeschlagen:/)).not.toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('bricht ab, wenn eine ausgewaehlte Claimable Balance seit der Vorschau verschwunden ist', async () => {
    renderDialog();
    await loadPreview();
    hoisted.recordsMock.mockResolvedValue({ records: recordsFor([tokenItem(2, 'SPAMB')]) });
    await startAndSign();
    await screen.findByText(/Seit der Vorschau hat sich etwas geändert/);
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('verlangt eine neue Vorschau nach mehr als 2 Minuten', async () => {
    renderDialog();
    await loadPreview();
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 3 * 60 * 1000);
    await startAndSign();
    await screen.findByText(/älter als 2 Minuten/);
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('merkt Secrets erst nach erfolgreicher Transaktion', async () => {
    renderDialog();
    await loadPreview();
    await startAndSign();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hoisted.rememberMock).toHaveBeenCalledTimes(1));
    expect(hoisted.rememberMock.mock.invocationCallOrder[0]).toBeGreaterThan(hoisted.submitMock.mock.invocationCallOrder[0]);
  });

  it('warnt bei einem fremden Token mit Code XLM als Ziel und zeigt den Herausgeber', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Anderes Asset (CODE:Herausgeber)' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Anderes Asset (CODE:Herausgeber)' }), { target: { value: `XLM:${ISSUER}` } });
    await loadPreview();
    expect(screen.getByText(/Token, kein natives XLM/)).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(`XLM \\(${ISSUER.slice(0, 6)}`)).length).toBeGreaterThan(0);
  });

  it('legt bei Multisig keinen zweiten Job an', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => (pk === ME.publicKey ? makeAccount({ multisig: true }) : { flags: {} }));
    const fetchMock = vi.fn(async (_url, opts) => ({ ok: true, json: async () => ({ id: 'job-8', txHash: 'h', txXdrCurrent: JSON.parse(opts.body).txXdr }) }));
    vi.stubGlobal('fetch', fetchMock);
    renderDialog({ multisig: true, account: makeAccount({ multisig: true }) });
    await loadPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Als Multisig-Job vorbereiten' }));
    await screen.findByText('job-8');
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByRole('button', { name: 'Als Multisig-Job vorbereiten' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('kennzeichnet ausgeblendete Eintraege', async () => {
    renderDialog({ items: [{ ...tokenItem(1, 'SPAMA'), hidden: true }, tokenItem(2, 'SPAMB')] });
    await loadPreview();
    expect(within(row(1)).getByText('ausgeblendet')).toBeInTheDocument();
  });

  it('warnt ab 5 % Slippage', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Maximale Kursabweichung (Slippage)'), { target: { value: '5' } });
    expect(screen.getByText(/Bei 5 % Slippage kannst du deutlich weniger erhalten/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Maximale Kursabweichung (Slippage)'), { target: { value: '2' } });
    expect(screen.queryByText(/deutlich weniger erhalten/)).not.toBeInTheDocument();
  });

  it('lehnt ein selbst herausgegebenes Asset als Ziel ab', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Anderes Asset (CODE:Herausgeber)' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Anderes Asset (CODE:Herausgeber)' }), { target: { value: `MINE:${ME.publicKey}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau laden' }));
    await screen.findByText(/von deinem eigenen Konto herausgegeben/);
    expect(hoisted.pathsMock).not.toHaveBeenCalled();
  });

  it('sperrt den Start, wenn der Erloes nicht in das Limit der Ziel-Trustline passt', async () => {
    const acct = makeAccount();
    acct.balances = [...acct.balances, { asset_type: 'credit_alphanum4', asset_code: 'LDEX', asset_issuer: ISSUER, balance: '0', limit: '2', is_authorized: true }];
    hoisted.loadAccountMock.mockImplementation(async (pk) => (pk === ME.publicKey ? acct : { flags: {} }));
    renderDialog({ account: acct });
    fireEvent.click(screen.getByRole('radio', { name: 'Aus meinen Trustlines (1)' }));
    fireEvent.click(screen.getByRole('option'));
    await loadPreview();
    expect(screen.getByText(/passt nicht in das Limit deiner Trustline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /einlösen & umwandeln/ })).toBeDisabled();
  });
});



// ---- Buendel 4c: Sendeschutz im Sammel-Tausch -----------------------------------------------

const nowSec = () => Math.floor(Date.now() / 1000);
const guardEntry = (o = {}) => ({
  hash: 'a'.repeat(64), at: Date.now() - 5000, status: 'ambiguous', maxTime: nowSec() + 170, seq: '101', source: ME.publicKey,
  origin: 'payment', cause: { kind: 'network', status: null }, summary: { action: 'Etwas' }, ...o,
});
// 55 Eintraege = drei Transaktionen (25 + 25 + 5)
const fiftyFive = () => Array.from({ length: 55 }, (_, i) => tokenItem(i + 1, `T${i}`));
const startButton = () => screen.getByRole('button', { name: /einlösen & umwandeln/ });

describe('Sendeschutz (Buendel 4c): Sammel-Tausch', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('jede Transaktion einzeln geschuetzt: der Eintrag steht vor dem Submit im Speicher (Herkunft convert)', async () => {
    const during = [];
    hoisted.submitMock.mockImplementation(async () => { during.push(readAccountEntry('TESTNET', ME.publicKey)); return { hash: 'batchhash' }; });
    renderDialog({ items: Array.from({ length: 30 }, (_, i) => tokenItem(i + 1, `T${i}`)) });
    await loadPreview();
    await startAndSign();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(2));
    expect(during).toHaveLength(2);
    during.forEach((e) => expect(e).toMatchObject({ status: 'ambiguous', origin: 'convert', source: ME.publicKey }));
    expect(during[0].summary.action).toContain('Transaktion 1 von 2');
    expect(during[1].summary.action).toContain('Transaktion 2 von 2');
    expect(during[0].hash).not.toBe(during[1].hash);
    await screen.findByText(/Transaktion 2: 5 Einträge umgewandelt/);
    expect(readAccountEntry('TESTNET', ME.publicKey)).toMatchObject({ status: 'success', hash: during[1].hash });
  });

  it('unklar bei Transaktion 2 von 3: der Lauf stoppt, Transaktion 3 wird nie gesendet und angezeigt, Konto gesperrt', async () => {
    hoisted.submitMock
      .mockResolvedValueOnce({ hash: 'h1' })
      .mockRejectedValueOnce(new AmbiguousSubmitResultError('amb-hash', new TypeError('Failed to fetch')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog({ items: fiftyFive() });
    await loadPreview();
    await startAndSign();
    await screen.findByText(/Transaktion 2 mit 25 Einträgen: Ergebnis unklar.*amb-hash/);
    expect(screen.getByText(/Transaktion 1: 25 Einträge umgewandelt/)).toBeInTheDocument();
    expect(screen.getByText(/Transaktion 3 mit 5 Einträgen nicht gesendet/)).toBeInTheDocument();
    // Kein automatisches Weitersenden, auch nicht nach einer Weile.
    await new Promise((r) => setTimeout(r, 1500));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(2);
    expect(readAccountEntry('TESTNET', ME.publicKey)).toMatchObject({ status: 'ambiguous', origin: 'convert' });
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it('eindeutig abgelehnt bei Transaktion 1 von 3: Lauf stoppt, die uebrigen werden als nicht gesendet angezeigt, keine Sperre', async () => {
    const err = new Error('http 400');
    err.response = { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } };
    hoisted.submitMock.mockRejectedValueOnce(err);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog({ items: fiftyFive() });
    await loadPreview();
    await startAndSign();
    await screen.findByText(/Transaktion 1 mit 25 Einträgen fehlgeschlagen/);
    expect(screen.getByText(/Transaktion 2 mit 25 Einträgen nicht gesendet/)).toBeInTheDocument();
    expect(screen.getByText(/Transaktion 3 mit 5 Einträgen nicht gesendet/)).toBeInTheDocument();
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    expect(readAccountEntry('TESTNET', ME.publicKey)).toBeNull();
    errSpy.mockRestore();
  });

  it('Sperre durch einen anderen Tab zwischen Transaktion 1 und 2: Transaktion 2 und 3 nicht gesendet, Hinweis', async () => {
    renderDialog({ items: fiftyFive() });
    await loadPreview();
    // Waehrend Transaktion 1 laeuft, schreibt ein anderer Tab (Zahlung senden) einen unklaren Eintrag.
    hoisted.submitMock.mockReset();
    hoisted.submitMock.mockImplementationOnce(async () => {
      writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'payment', hash: 'b'.repeat(64) }));
      return { hash: 'h1' };
    });
    await startAndSign();
    await screen.findByText(/Transaktion 2 mit 25 Einträgen nicht gesendet: Nicht gesendet: Von diesem Konto ist eine Transaktion mit unklarem Status offen/);
    expect(screen.getByText(/Transaktion 3 mit 5 Einträgen nicht gesendet \(Lauf gestoppt/)).toBeInTheDocument();
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
  });

  it('offenes Ergebnis beim Oeffnen (nach Neuladen): Kasten sichtbar, Start und Job gesperrt', async () => {
    writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'convert' }));
    renderDialog({ items: fiftyFive() });
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    await loadPreview();
    expect(startButton()).toBeDisabled();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('Freigabe nur mit Horizon-Beleg', async () => {
    writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'convert' }));
    renderDialog();
    await loadPreview();
    expect(startButton()).toBeDisabled();
    fireEvent.click(screen.getByTestId('send-ambiguous-check'));
    await waitFor(() => expect(hoisted.txLookupMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('send-ambiguous-check')).not.toBeDisabled());
    expect(readAccountEntry('TESTNET', ME.publicKey)).toMatchObject({ status: 'ambiguous' });
    expect(startButton()).toBeDisabled();

    hoisted.txLookupMock.mockImplementation(async (hash) => ({ hash, successful: true }));
    fireEvent.click(screen.getByTestId('send-ambiguous-check'));
    await waitFor(() => expect(screen.queryByTestId('send-ambiguous')).toBeNull());
    expect(readAccountEntry('TESTNET', ME.publicKey)).toMatchObject({ status: 'success' });
    expect(startButton()).not.toBeDisabled();
  });

  it('Doppelklick auf Senden: genau ein Lauf, jede Transaktion einmal', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    hoisted.submitMock.mockImplementation(async () => { await gate; return { hash: 'batchhash' }; });
    renderDialog();
    await loadPreview();
    fireEvent.click(startButton());
    await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
    fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: ME.secret } });
    const buttons = screen.getAllByRole('button', { name: /^(senden|submit)$/i });
    const send = buttons[buttons.length - 1];
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    release();
    await screen.findByText(/Transaktion 1: 2 Einträge umgewandelt/);
    await new Promise((r) => setTimeout(r, 1500));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
  });

  it('offener Pin mit passender Sequence: die erste Transaktion nutzt genau die gepinnte Sequence', async () => {
    writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'payment', status: 'notApplied', pin: true, seq: '101', maxTime: nowSec() - 300 }));
    renderDialog();
    await loadPreview();
    await startAndSign();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    expect(hoisted.submitMock.mock.calls[0][1].sequence).toBe('101');
  });

  describe('Job (Multisig) baut nur ohne Sperre und mit dem Pin', () => {
    let fetchMock;
    const jobProps = () => ({ multisig: true, account: makeAccount({ multisig: true }), items: Array.from({ length: 30 }, (_, i) => tokenItem(i + 1, `T${i}`)) });
    beforeEach(() => {
      hoisted.loadAccountMock.mockImplementation(async (pk) => (pk === ME.publicKey ? makeAccount({ multisig: true }) : { flags: {} }));
      fetchMock = vi.fn(async (_url, opts) => ({ ok: true, json: async () => ({ id: 'job-7', txHash: 'h', txXdrCurrent: JSON.parse(opts.body).txXdr }) }));
      vi.stubGlobal('fetch', fetchMock);
    });
    const jobButton = () => screen.getByRole('button', { name: 'Als Multisig-Job vorbereiten' });

    it('unklarer Eintrag: Job-Knopf gesperrt', async () => {
      writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'claimable' }));
      renderDialog(jobProps());
      await loadPreview();
      expect(jobButton()).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Eintrag erscheint nach der Vorschau (anderer Tab): kein Job, Hinweistext', async () => {
      renderDialog(jobProps());
      await loadPreview();
      writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'payment' }));
      fireEvent.click(jobButton());
      await screen.findByText(/Nicht erstellt: Von diesem Konto ist eine Transaktion mit unklarem Status offen/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Pin, der nicht mehr passt: kein Job, Eintrag wieder unklar', async () => {
      renderDialog(jobProps());
      await loadPreview();
      writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'payment', status: 'notApplied', pin: true, seq: '999', maxTime: nowSec() - 300 }));
      fireEvent.click(jobButton());
      await screen.findByText(/Nicht erstellt: Die Sequence einer früheren, nicht ausgeführten Transaktion/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(readAccountEntry('TESTNET', ME.publicKey)).toMatchObject({ status: 'ambiguous', recheck: 'pinConsumed' });
    });

    it('passender Pin: der Job nutzt genau die gepinnte Sequence', async () => {
      writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'payment', status: 'notApplied', pin: true, seq: '101', maxTime: nowSec() - 300 }));
      renderDialog(jobProps());
      await loadPreview();
      fireEvent.click(jobButton());
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const tx = TransactionBuilder.fromXDR(JSON.parse(fetchMock.mock.calls[0][1].body).txXdr, Networks.TESTNET);
      expect(tx.sequence).toBe('101');
    });
  });
});


// ---- Buendel 4c-Fix: break, Pin, zwei Laeufe, Warten am Sende-Lock ------------------------------

async function holdSendLock(network = 'TESTNET') {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held;
  const started = new Promise((resolve) => { held = resolve; });
  const done = withSendLock(network, async () => { held(); await gate; });
  await started;
  return async () => { release(); await done; };
}

describe('Buendel 4c-Fix: Sammel-Tausch', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  afterEach(() => { guardSwitch.off = false; });

  it('N16: Stopp haengt nicht an der Sperre: unklar bei Transaktion 2 von 3, Transaktion 3 wird nie gesendet (Sperre unwirksam)', async () => {
    // Die Sperre des Kontos ist hier wirkungslos geschaltet. Dann verhindert nur das break der
    // Schleife, dass Transaktion 3 gesendet wird. Ohne break wuerde submit ein drittes Mal aufgerufen.
    guardSwitch.off = true;
    hoisted.submitMock
      .mockResolvedValueOnce({ hash: 'h1' })
      .mockRejectedValueOnce(new AmbiguousSubmitResultError('amb-hash', new TypeError('Failed to fetch')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog({ items: fiftyFive() });
    await loadPreview();
    await startAndSign();
    await screen.findByText(/Transaktion 2 mit 25 Einträgen: Ergebnis unklar.*amb-hash/);
    expect(screen.getByText(/Transaktion 3 mit 5 Einträgen nicht gesendet \(Lauf gestoppt/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1200));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(2);
    // Genau eine Zeile je Transaktion (kein zusaetzlicher Versuch, keine doppelte Zeile).
    expect(screen.getAllByText(/^Transaktion \d/)).toHaveLength(3);
    errSpy.mockRestore();
  });

  it('N16: eindeutig fehlgeschlagen bei Transaktion 2 von 3 (Sperre unwirksam): Transaktion 3 wird nie gesendet', async () => {
    // Im Ledger fehlgeschlagen: kein Eintrag, die Sperre haette hier nie gegriffen; nur das break stoppt.
    guardSwitch.off = true;
    const err = new Error('http 400');
    err.response = { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } };
    hoisted.submitMock.mockResolvedValueOnce({ hash: 'h1' }).mockRejectedValueOnce(err);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog({ items: fiftyFive() });
    await loadPreview();
    await startAndSign();
    await screen.findByText(/Transaktion 2 mit 25 Einträgen fehlgeschlagen/);
    expect(screen.getByText(/Transaktion 3 mit 5 Einträgen nicht gesendet \(Lauf gestoppt/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 800));
    expect(hoisted.submitMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/^Transaktion \d/)).toHaveLength(3);
    errSpy.mockRestore();
  });

  it('Pin, der nicht mehr zur Konto-Sequence passt: nichts gesendet, Transaktionen als nicht gesendet angezeigt, fruehere Transaktion wieder unklar', async () => {
    // Konto-Sequence 100, der Pin gehoert zu 999: verbraucht bzw. Konto darunter.
    writeAccountEntry('TESTNET', ME.publicKey, guardEntry({ origin: 'payment', status: 'notApplied', pin: true, seq: '999', maxTime: nowSec() - 300 }));
    renderDialog({ items: fiftyFive() });
    await loadPreview();
    await startAndSign();
    await screen.findByText(/Transaktion 1 mit 25 Einträgen nicht gesendet: Nicht gesendet: Die Sequence einer früheren, nicht ausgeführten Transaktion/);
    expect(screen.getByText(/Transaktion 2 mit 25 Einträgen nicht gesendet \(Lauf gestoppt/)).toBeInTheDocument();
    expect(screen.getByText(/Transaktion 3 mit 5 Einträgen nicht gesendet \(Lauf gestoppt/)).toBeInTheDocument();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    expect(readAccountEntry('TESTNET', ME.publicKey)).toMatchObject({ status: 'ambiguous', recheck: 'pinConsumed' });
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
  });

  it('Lauf 1 unklar -> Lauf 2 (neu geoeffnet) gesperrt -> Beleg -> Lauf 3 sendet: Zustand wirkt von Lauf zu Lauf, ohne Loeschen der skm_*-Schluessel', async () => {
    hoisted.submitMock.mockRejectedValueOnce(new AmbiguousSubmitResultError('amb-hash', new TypeError('Failed to fetch')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog();
    await loadPreview();
    await startAndSign();
    await screen.findByText(/Transaktion 1 mit 2 Einträgen: Ergebnis unklar.*amb-hash/);
    const first = readAccountEntry('TESTNET', ME.publicKey);
    expect(first).toMatchObject({ status: 'ambiguous', origin: 'convert' });
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);

    // Lauf 2: Dialog neu geoeffnet, Zustand aus Lauf 1 ist noch da und sperrt.
    cleanup();
    renderDialog();
    expect(screen.getByTestId('send-ambiguous')).toBeInTheDocument();
    await loadPreview();
    expect(startButton()).toBeDisabled();
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
    expect(readAccountEntry('TESTNET', ME.publicKey)).toEqual(first);

    // Ohne Beleg bleibt es gesperrt, mit Beleg wird frei.
    fireEvent.click(screen.getByTestId('send-ambiguous-check'));
    await waitFor(() => expect(hoisted.txLookupMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('send-ambiguous-check')).not.toBeDisabled());
    expect(startButton()).toBeDisabled();
    hoisted.txLookupMock.mockImplementation(async (hash) => ({ hash, successful: true }));
    fireEvent.click(screen.getByTestId('send-ambiguous-check'));
    await waitFor(() => expect(screen.queryByTestId('send-ambiguous')).toBeNull());
    expect(startButton()).not.toBeDisabled();

    // Lauf 3: genau einmal. Ein Eintrag weniger gewaehlt, damit es eine andere Transaktion ist (gleiche
    // Operationen in derselben Sekunde ergaeben denselben Hash).
    fireEvent.click(checkbox(2));
    await startAndSign();
    await screen.findByText(/Transaktion 1: 1 Einträge umgewandelt/);
    expect(hoisted.submitMock).toHaveBeenCalledTimes(2);
    const last = readAccountEntry('TESTNET', ME.publicKey);
    expect(last).toMatchObject({ status: 'success', origin: 'convert' });
    expect(last.hash).not.toBe(first.hash);
    errSpy.mockRestore();
  });

  describe('M4: Warten am Sende-Lock', () => {
    it('Warten wird im Lauf angezeigt; "Warten abbrechen" stoppt den Lauf, alle Transaktionen bleiben ungesendet', async () => {
      renderDialog({ items: fiftyFive() });
      await loadPreview();
      const release = await holdSendLock();
      await startAndSign();
      const waiting = await screen.findByTestId('send-lock-waiting');
      expect(waiting).toHaveTextContent(/Wartet auf einen anderen Sendevorgang/);
      expect(hoisted.submitMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('send-lock-waiting-cancel'));
      await screen.findByText(/Transaktion 1 mit 25 Einträgen nicht gesendet: Warten abgebrochen\. Nicht gesendet\./);
      expect(screen.getByText(/Transaktion 2 mit 25 Einträgen nicht gesendet \(Lauf gestoppt/)).toBeInTheDocument();
      expect(screen.getByText(/Transaktion 3 mit 5 Einträgen nicht gesendet \(Lauf gestoppt/)).toBeInTheDocument();
      await release();
      await new Promise((r) => setTimeout(r, 1500));
      expect(hoisted.submitMock).not.toHaveBeenCalled();
      expect(readAccountEntry('TESTNET', ME.publicKey)).toBeNull();
    });

    it('"Abbrechen" im Secret-Key-Dialog waehrend der Pruefung: danach wird nichts signiert und nichts gesendet', async () => {
      renderDialog();
      await loadPreview();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const loadsBefore = hoisted.loadAccountMock.mock.calls.length;
      hoisted.loadAccountMock.mockImplementationOnce(async () => { await gate; return makeAccount(); });
      await startAndSign();
      await waitFor(() => expect(hoisted.loadAccountMock).toHaveBeenCalledTimes(loadsBefore + 1));
      const cancel = screen.getAllByRole('button', { name: 'Abbrechen' });
      fireEvent.click(cancel[cancel.length - 1]);
      expect(document.querySelector('input[type="password"]')).toBeNull();
      release();
      await new Promise((r) => setTimeout(r, 1200));
      expect(hoisted.submitMock).not.toHaveBeenCalled();
      // Nach dem Abbruch wird nichts mehr geladen (kein Lock, kein Bauen).
      expect(hoisted.loadAccountMock).toHaveBeenCalledTimes(loadsBefore + 1);
      expect(readAccountEntry('TESTNET', ME.publicKey)).toBeNull();
      // Der Dialog steht wieder in der Vorschau, ein neuer Start ist moeglich.
      expect(startButton()).not.toBeDisabled();
    });

    describe('Job (Multisig)', () => {
      let fetchMock;
      const jobProps = () => ({ multisig: true, account: makeAccount({ multisig: true }), items: Array.from({ length: 30 }, (_, i) => tokenItem(i + 1, `T${i}`)) });
      beforeEach(() => {
        hoisted.loadAccountMock.mockImplementation(async (pk) => (pk === ME.publicKey ? makeAccount({ multisig: true }) : { flags: {} }));
        fetchMock = vi.fn(async (_url, opts) => ({ ok: true, json: async () => ({ id: 'job-7', txHash: 'h', txXdrCurrent: JSON.parse(opts.body).txXdr }) }));
        vi.stubGlobal('fetch', fetchMock);
      });
      afterEach(() => { vi.unstubAllGlobals(); });

      it('wartet auf den Lock: Hinweis mit "Warten abbrechen"; nach dem Abbrechen entsteht nie ein Job', async () => {
        renderDialog(jobProps());
        await loadPreview();
        const release = await holdSendLock();
        fireEvent.click(screen.getByRole('button', { name: 'Als Multisig-Job vorbereiten' }));
        expect(await screen.findByTestId('send-lock-waiting')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('send-lock-waiting-cancel'));
        await screen.findByText(/Warten abgebrochen\. Nicht erstellt\./);
        await release();
        await new Promise((r) => setTimeout(r, 1500));
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });
  });
});


// Der Sendeschutz speichert einen unklaren Ausgang pro Konto: kein Zustand zwischen den Tests.
beforeEach(() => {
  Object.keys(window.localStorage).filter((k) => k.startsWith('skm_')).forEach((k) => window.localStorage.removeItem(k));
  resetAccountSendGuardMemory();
});
