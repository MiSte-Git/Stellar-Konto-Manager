import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import i18n from '../../../i18n.js';
import DepositDialog from '../DepositDialog.jsx';
import WithdrawDialog from '../WithdrawDialog.jsx';
import { poolIdFor } from '../../../utils/stellar/liquidityPools.js';

const hoisted = vi.hoisted(() => ({
  loadAccount: vi.fn(),
  poolCall: vi.fn(),
  submit: vi.fn(),
  collected: [],
}));

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: (id) => hoisted.loadAccount(id),
    liquidityPools: () => ({ liquidityPoolId: (id) => ({ call: () => hoisted.poolCall(id) }) }),
    feeStats: async () => { throw new Error('offline'); },
    root: async () => ({ network_passphrase: Networks.PUBLIC }),
  }),
}));

vi.mock('../../../utils/stellar/submitTransactionSafely.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTransactionSafely: (...args) => hoisted.submit(...args),
}));

// Schlanker Ersatz fuer das SecretKeyModal: liefert die vorbereiteten Signer.
vi.mock('../../SecretKeyModal.jsx', () => ({
  default: ({ onConfirm, onCancel, errorMessage }) => (
    <div data-testid="secret-modal">
      <button type="button" onClick={() => onConfirm(hoisted.collected)}>keys-ok</button>
      <button type="button" onClick={onCancel}>keys-cancel</button>
      {errorMessage && <div data-testid="modal-error">{errorMessage}</div>}
    </div>
  ),
}));

const owner = Keypair.random();
const issuer = Keypair.random().publicKey();
const usd = new Asset('USD', issuer);
const POOL_ID = poolIdFor(Asset.native(), usd);
// Asset, dessen Issuer das Konto selbst ist
const own = new Asset('OWN', owner.publicKey());
const OWN_POOL_ID = poolIdFor(Asset.native(), own);
const ownPoolRecord = () => ({
  id: OWN_POOL_ID,
  fee_bp: 30,
  total_trustlines: '2',
  total_shares: '300.0000000',
  reserves: [{ asset: 'native', amount: '1000.0000000' }, { asset: `OWN:${owner.publicKey()}`, amount: '100.0000000' }],
});

const poolRecord = (rA = '1000.0000000', rB = '100.0000000', shares = '300.0000000') => ({
  id: POOL_ID,
  fee_bp: 30,
  total_trustlines: '5',
  total_shares: shares,
  reserves: [{ asset: 'native', amount: rA }, { asset: `USD:${issuer}`, amount: rB }],
});

function makeAccount({ shares = null, usdLine = {}, thresholds = { low_threshold: 0, med_threshold: 0, high_threshold: 0 }, signers } = {}) {
  const balances = [
    { asset_type: 'native', balance: '500.0000000', selling_liabilities: '0' },
    { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: issuer, balance: '50.0000000', limit: '1000', selling_liabilities: '0', buying_liabilities: '0', is_authorized: true, ...usdLine },
  ];
  if (shares !== null) balances.push({ asset_type: 'liquidity_pool_shares', liquidity_pool_id: POOL_ID, balance: shares });
  return Object.assign(new Account(owner.publicKey(), '100'), {
    balances,
    subentry_count: shares !== null ? 3 : 1,
    num_sponsoring: 0,
    num_sponsored: 0,
    thresholds,
    signers: signers || [{ key: owner.publicKey(), weight: 1, type: 'ed25519_public_key' }],
  });
}

function wrap(node) {
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

const renderDeposit = (props = {}) => wrap(
  <DepositDialog poolId={POOL_ID} firstAsset={null} publicKey={owner.publicKey()} network="PUBLIC" onClose={vi.fn()} onDone={vi.fn()} {...props} />
);
const renderWithdraw = (props = {}) => wrap(
  <WithdrawDialog poolId={POOL_ID} publicKey={owner.publicKey()} network="PUBLIC" onClose={vi.fn()} onDone={vi.fn()} {...props} />
);

async function enterDeposit(value) {
  await screen.findByLabelText(/^Betrag XLM/);
  fireEvent.change(screen.getByLabelText(/^Betrag XLM/), { target: { value } });
}

describe('DepositDialog', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    hoisted.loadAccount.mockReset();
    hoisted.poolCall.mockReset();
    hoisted.submit.mockReset();
    hoisted.collected = [{ keypair: owner }];
    hoisted.poolCall.mockResolvedValue(poolRecord());
    hoisted.loadAccount.mockImplementation(async () => makeAccount());
  });

  it('berechnet die Gegenseite, zeigt Hinweis und Operationen und sendet in der richtigen Reihenfolge', async () => {
    hoisted.submit.mockResolvedValue({ hash: 'abc123' });
    const onDone = vi.fn();
    renderDeposit({ onDone });
    await enterDeposit('10');
    expect(screen.getByTestId('deposit-risk')).toHaveTextContent('Impermanent Loss');
    const dialog = screen.getByTestId('deposit-dialog');
    expect(dialog).toHaveTextContent(/Einzahlung USD.*\(höchstens\)\s*1(?!\d)/);
    expect(dialog).toHaveTextContent('Zusätzliche Mindestreserve1 XLM');

    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    const ops = screen.getByTestId('liquidity-ops');
    expect(ops).toHaveTextContent('Trustline für Pool XLM/USD');
    expect(ops).toHaveTextContent('Liquidität einzahlen in Pool');

    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    await screen.findByTestId('liquidity-success');
    expect(hoisted.submit).toHaveBeenCalledTimes(1);
    const tx = hoisted.submit.mock.calls[0][1];
    expect(tx.operations.map((op) => op.type)).toEqual(['changeTrust', 'liquidityPoolDeposit']);
    expect(tx.operations[1]).toMatchObject({ liquidityPoolId: POOL_ID, maxAmountA: '10.0000000', maxAmountB: '1.0000000' });
    expect(tx.signatures).toHaveLength(1);
    expect(onDone).toHaveBeenCalled();
  });

  it('zeigt die Nutzerreihenfolge (USD zuerst) mit invertiertem Preis', async () => {
    renderDeposit({ firstAsset: usd });
    await screen.findByLabelText(/^Betrag USD/);
    expect(screen.getByTestId('deposit-dialog')).toHaveTextContent('Aktueller Pool-Preis USD/XLM0,1');
  });

  it('bricht ab und zeigt neue Werte, wenn sich der Preis vor dem Signieren aendert', async () => {
    renderDeposit();
    await enterDeposit('10');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    hoisted.poolCall.mockResolvedValue(poolRecord('1100.0000000', '90.0000000'));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('außerhalb der bestätigten Grenzen');
    expect(hoisted.submit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('liquidity-ops')).toBeNull();
    // neue Gegenseite nach neuem Kurs: 10 * 90/1100 = 0.8181819 (aufgerundet)
    expect(screen.getByTestId('deposit-dialog')).toHaveTextContent('0,8181819');
  });

  it('bricht bei zu wenig gesammeltem Gewicht ab, ohne zu senden', async () => {
    hoisted.loadAccount.mockImplementation(async () => makeAccount({ thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 } }));
    renderDeposit();
    await enterDeposit('10');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    expect(await screen.findByTestId('modal-error')).toHaveTextContent('Benötigt: 2, vorhanden: 1');
    expect(hoisted.submit).not.toHaveBeenCalled();
  });

  it('sendet bei Doppelklick nur einmal', async () => {
    let resolveSubmit;
    hoisted.submit.mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    renderDeposit();
    await enterDeposit('10');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    const ok = await screen.findByText('keys-ok');
    await act(async () => { fireEvent.click(ok); fireEvent.click(ok); });
    await waitFor(() => expect(hoisted.submit).toHaveBeenCalledTimes(1));
    await act(async () => { resolveSubmit({ hash: 'h' }); });
    expect(hoisted.submit).toHaveBeenCalledTimes(1);
  });

  it('zeigt ein unklares Ergebnis wie im Trading und sendet nicht erneut', async () => {
    const { AmbiguousSubmitResultError } = await import('../../../utils/stellar/submitTransactionSafely.js');
    hoisted.submit.mockRejectedValue(new AmbiguousSubmitResultError('deadbeef'));
    renderDeposit();
    await enterDeposit('10');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    expect(await screen.findByTestId('liquidity-ambiguous')).toHaveTextContent('deadbeef');
    expect(screen.queryByTestId('secret-modal')).toBeNull();
  });

  it('zeigt Clawback auf der Trustline als Info und sperrt das Einzahlen nicht', async () => {
    hoisted.loadAccount.mockImplementation(async () => makeAccount({ usdLine: { is_clawback_enabled: true } }));
    renderDeposit();
    await enterDeposit('10');
    expect(screen.getByTestId('liquidity-infos')).toHaveTextContent('Clawback aktiv. Der Issuer kann Beträge zurückfordern, auch Auszahlungen aus dem Pool.');
    expect(screen.queryByTestId('liquidity-problems')).toBeNull();
    expect(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' })).toBeEnabled();
  });

  it('nennt die erwarteten Shares als Richtwert, nicht als Mindestwert', async () => {
    renderDeposit();
    await enterDeposit('10');
    const dialog = screen.getByTestId('deposit-dialog');
    expect(dialog).toHaveTextContent('Erwartete Pool Shares (Richtwert, kann bei Kursbewegung innerhalb der Slippage niedriger ausfallen)');
    expect(dialog).not.toHaveTextContent('mindestens');
  });

  it('zahlt als Issuer des eigenen Assets ohne Trustline dafuer ein', async () => {
    hoisted.poolCall.mockResolvedValue(ownPoolRecord());
    hoisted.submit.mockResolvedValue({ hash: 'own1' });
    renderDeposit({ poolId: OWN_POOL_ID });
    await enterDeposit('10');
    expect(screen.queryByTestId('liquidity-problems')).toBeNull();
    // kein Issuer-Flags-Request fuer das eigene Asset: nur das Laden des Kontos selbst
    await act(async () => {});
    expect(hoisted.loadAccount).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    await screen.findByTestId('liquidity-success');
    const tx = hoisted.submit.mock.calls[0][1];
    // nur die Pool-Trustline, kein changeTrust fuer OWN
    expect(tx.operations.map((op) => op.line?.getAssetType?.() || op.type)).toEqual(['liquidity_pool_shares', 'liquidityPoolDeposit']);
    expect(tx.operations[1]).toMatchObject({ liquidityPoolId: OWN_POOL_ID, maxAmountA: '10.0000000', maxAmountB: '1.0000000' });
  });

  it('laedt Issuer-Flags fuer ein fremdes Asset ohne Trustline weiterhin', async () => {
    hoisted.loadAccount.mockImplementation(async (id) => (id === owner.publicKey()
      ? Object.assign(makeAccount(), { balances: makeAccount().balances.filter((b) => b.asset_type === 'native') })
      : { flags: {} }));
    renderDeposit();
    await enterDeposit('10');
    await waitFor(() => expect(hoisted.loadAccount).toHaveBeenCalledWith(issuer));
  });

  it('meldet inkonsistente Pool-Daten (Pool-ID passt nicht zu den Assets) als Ladefehler', async () => {
    hoisted.poolCall.mockResolvedValue({ ...poolRecord(), id: 'b'.repeat(64) });
    renderDeposit();
    expect(await screen.findByText(/passen nicht zur Pool-ID/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Betrag XLM/)).toBeNull();
  });

  it('sperrt Schliessen waehrend des Sendens', async () => {
    let resolveSubmit;
    hoisted.submit.mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    renderDeposit();
    await enterDeposit('10');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    await waitFor(() => expect(hoisted.submit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeDisabled();
    await act(async () => { resolveSubmit({ hash: 'h' }); });
    await screen.findByTestId('liquidity-success');
    expect(screen.getAllByRole('button', { name: 'Schließen' })[0]).toBeEnabled();
  });

  it.each([
    ['Erfolg', (resolve) => resolve({ hash: 'bg-ok' }), { type: 'success', hash: 'bg-ok' }],
    ['unklarer Status', async (resolve, reject) => {
      const { AmbiguousSubmitResultError } = await import('../../../utils/stellar/submitTransactionSafely.js');
      reject(new AmbiguousSubmitResultError('bg-hash'));
    }, { type: 'ambiguous', hash: 'bg-hash' }],
    ['Fehler', (resolve, reject) => reject(Object.assign(new Error('rejected'), {
      response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_success', 'op_bad_price'] } } } },
    })), { type: 'error', message: expect.stringContaining('op_bad_price') }],
  ])('meldet das Ergebnis (%s) an die Seite, wenn der Dialog waehrend des Submits abgebaut wird', async (_label, settle, expected) => {
    let resolveSubmit;
    let rejectSubmit;
    hoisted.submit.mockImplementation(() => new Promise((resolve, reject) => { resolveSubmit = resolve; rejectSubmit = reject; }));
    const onBackgroundResult = vi.fn();
    const onDone = vi.fn();
    const view = renderDeposit({ onBackgroundResult, onDone });
    await enterDeposit('10');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    await waitFor(() => expect(hoisted.submit).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { await settle(resolveSubmit, rejectSubmit); });
    await waitFor(() => expect(onBackgroundResult).toHaveBeenCalledWith({ ...expected, network: 'PUBLIC', publicKey: owner.publicKey() }));
    expect(onBackgroundResult).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('sperrt leere Pools', async () => {
    hoisted.poolCall.mockResolvedValue(poolRecord('0.0000000', '0.0000000', '0.0000000'));
    renderDeposit();
    expect(await screen.findByText(/Pool eröffnen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Weiter: Operationen prüfen' })).toBeNull();
  });

  it('verwirft eine laufende Signatur, wenn der Dialog geschlossen wird', async () => {
    let resolvePool;
    const view = renderDeposit();
    await enterDeposit('10');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    hoisted.poolCall.mockImplementation(() => new Promise((resolve) => { resolvePool = resolve; }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    // Konto-/Netzwechsel: die Seite unmountet den Dialog
    view.unmount();
    await act(async () => { resolvePool(poolRecord()); });
    expect(hoisted.submit).not.toHaveBeenCalled();
  });

  it('meldet nichts an die Seite, wenn vor dem Senden abgebaut wurde', async () => {
    let resolvePool;
    const onBackgroundResult = vi.fn();
    const view = renderDeposit({ onBackgroundResult });
    await enterDeposit('10');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    hoisted.poolCall.mockImplementation(() => new Promise((resolve) => { resolvePool = resolve; }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    view.unmount();
    await act(async () => { resolvePool(poolRecord()); });
    expect(hoisted.submit).not.toHaveBeenCalled();
    expect(onBackgroundResult).not.toHaveBeenCalled();
  });
});

describe('WithdrawDialog', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    hoisted.loadAccount.mockReset();
    hoisted.poolCall.mockReset();
    hoisted.submit.mockReset();
    hoisted.collected = [{ keypair: owner }];
    hoisted.poolCall.mockResolvedValue(poolRecord());
    hoisted.loadAccount.mockImplementation(async () => makeAccount({ shares: '30.0000000' }));
    hoisted.submit.mockResolvedValue({ hash: 'w1' });
  });

  async function pickPercent(p) {
    fireEvent.click(await screen.findByRole('button', { name: `${p} %` }));
  }

  it('entfernt bei 100 % standardmaessig die Pool-Trustline', async () => {
    renderWithdraw();
    await pickPercent('100');
    const box = screen.getByRole('checkbox');
    expect(box).toBeChecked();
    expect(screen.getByTestId('withdraw-dialog')).toHaveTextContent('1 XLM Mindestreserve frei');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    expect(screen.getByTestId('liquidity-ops')).toHaveTextContent('Trustline für Pool XLM/USD');
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    await screen.findByTestId('liquidity-success');
    const tx = hoisted.submit.mock.calls[0][1];
    expect(tx.operations.map((op) => op.type)).toEqual(['liquidityPoolWithdraw', 'changeTrust']);
    // 30 von 300 Shares: 100 XLM / 10 USD, minus 0,5 %
    expect(tx.operations[0]).toMatchObject({ amount: '30.0000000', minAmountA: '99.5000000', minAmountB: '9.9500000' });
  });

  it('laesst die Trustline bei 100 % ohne Haken stehen', async () => {
    renderWithdraw();
    await pickPercent('100');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    await screen.findByTestId('liquidity-success');
    expect(hoisted.submit.mock.calls[0][1].operations.map((op) => op.type)).toEqual(['liquidityPoolWithdraw']);
  });

  it('bietet die Entfernung bei Teilabhebung nicht an', async () => {
    renderWithdraw();
    await pickPercent('50');
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    expect(screen.getByTestId('liquidity-ops')).not.toHaveTextContent('Trustline');
  });

  it('bricht ab, wenn die Auszahlung nach neuem Stand unter den Mindestbetraegen laege', async () => {
    renderWithdraw();
    await pickPercent('50');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    hoisted.poolCall.mockResolvedValue(poolRecord('900.0000000', '111.0000000'));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('unter den bestätigten Mindestbeträgen');
    expect(hoisted.submit).not.toHaveBeenCalled();
  });

  it('hebt als Issuer des eigenen Assets ohne Trustline dafuer ab', async () => {
    hoisted.poolCall.mockResolvedValue(ownPoolRecord());
    hoisted.loadAccount.mockImplementation(async () => {
      const acc = makeAccount();
      acc.balances.push({ asset_type: 'liquidity_pool_shares', liquidity_pool_id: OWN_POOL_ID, balance: '30.0000000' });
      return acc;
    });
    renderWithdraw({ poolId: OWN_POOL_ID });
    await pickPercent('100');
    expect(screen.queryByTestId('liquidity-problems')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter: Operationen prüfen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signieren und senden' }));
    await act(async () => { fireEvent.click(await screen.findByText('keys-ok')); });
    await screen.findByTestId('liquidity-success');
    const tx = hoisted.submit.mock.calls[0][1];
    expect(tx.operations.map((op) => op.type)).toEqual(['liquidityPoolWithdraw', 'changeTrust']);
    expect(tx.operations[0]).toMatchObject({ liquidityPoolId: OWN_POOL_ID, amount: '30.0000000', minAmountA: '99.5000000', minAmountB: '9.9500000' });
  });
});
