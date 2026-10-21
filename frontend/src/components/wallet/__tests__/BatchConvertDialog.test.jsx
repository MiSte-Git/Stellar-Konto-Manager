import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { AmbiguousSubmitResultError } from '../../../utils/stellar/submitTransactionSafely.js';
import i18n from '../../../i18n.js';
import BatchConvertDialog from '../BatchConvertDialog.jsx';

const ME = {
  secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
  publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
};
const COSIGNER = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const id = (n) => `00000000${String(n).padStart(64, '0')}`;

const hoisted = vi.hoisted(() => ({ loadAccountMock: vi.fn(), submitMock: vi.fn(), pathsMock: vi.fn(), recordsMock: vi.fn(), rememberMock: vi.fn(async () => {}) }));

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccountMock,
    root: vi.fn(async () => ({ network_passphrase: 'Test SDF Network ; September 2015' })),
    feeStats: vi.fn(async () => ({ last_ledger_base_fee: '100', fee_charged: { mode: '100', p95: '100' } })),
    strictSendPaths: (src) => ({ call: () => hoisted.pathsMock(src) }),
    claimableBalances: () => ({ claimant: () => ({ limit: () => ({ call: hoisted.recordsMock }) }) }),
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
  vi.clearAllMocks();
  hoisted.loadAccountMock.mockImplementation(async (pk) => (pk === ME.publicKey ? makeAccount() : { flags: {} }));
  hoisted.pathsMock.mockImplementation(async (src) => ({ records: src.code === 'NOMKT' ? [] : [{ destination_amount: '1.5', path: [] }] }));
  hoisted.submitMock.mockResolvedValue({ hash: 'batchhash' });
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
      if (calls >= 2) throw new Error('horizon down');
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

