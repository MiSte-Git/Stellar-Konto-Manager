import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Asset, Keypair, LiquidityPoolAsset, LiquidityPoolFeeV18, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import MultisigJobDetail from '../MultisigJobDetail.jsx';
import { txHashHex } from '../../utils/stellar/txHash.js';
import { poolIdFor } from '../../utils/stellar/liquidityPools.js';

// P2.3: Multisig-Job per bumpSequence widerrufen.
const SIGNER_A = {
  secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
  publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
};
const SIGNER_B = {
  secret: 'SBFKGXZFIZJ5U2RZTPBZ3EUCKQQGT5APKWAHGTQCJQSLD4CXIIHOVYVO',
  publicKey: 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM',
};
const SOURCE = Keypair.random().publicKey();

const hoisted = vi.hoisted(() => ({
  getJobMock: vi.fn(),
  loadAccountMock: vi.fn(),
  submitMock: vi.fn(),
  rootMock: vi.fn(),
  poolMock: vi.fn(),
}));

vi.mock('../../utils/multisigApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getPendingMultisigJob: hoisted.getJobMock,
}));

vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccountMock,
    root: hoisted.rootMock,
    feeStats: vi.fn(async () => ({ last_ledger_base_fee: '100', fee_charged: { mode: '100', p95: '100' } })),
    liquidityPools: () => ({ liquidityPoolId: (id) => ({ call: () => hoisted.poolMock(id) }) }),
  }),
}));

vi.mock('../../utils/stellar/submitTransactionSafely.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTransactionSafely: hoisted.submitMock,
}));

// Job-Transaktion mit Sequence 101 (Konto stand bei Erstellung auf 100).
function jobTx(sequenceBefore = '100') {
  return new TransactionBuilder(new Account(SOURCE, sequenceBefore), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: SIGNER_A.publicKey, asset: Asset.native(), amount: '1' }))
    .setTimeout(86400)
    .build();
}

function makeJob(overrides = {}) {
  const tx = jobTx('100');
  return {
    txHash: txHashHex(tx),
    id: 'job-1',
    accountId: SOURCE,
    network: 'testnet',
    status: 'pending_signatures',
    signers: [{ publicKey: SIGNER_A.publicKey, weight: 1 }, { publicKey: SIGNER_B.publicKey, weight: 1 }],
    requiredWeight: 2,
    collectedWeight: 0,
    txXdr: tx.toXDR(),
    ...overrides,
  };
}

function horizonAccount(sequence = '100', lowThreshold = 1) {
  const acct = new Account(SOURCE, sequence);
  return Object.assign(acct, {
    account_id: SOURCE,
    thresholds: { low_threshold: lowThreshold, med_threshold: 2, high_threshold: 2 },
    signers: [
      { key: SOURCE, weight: 0, type: 'ed25519_public_key' },
      { key: SIGNER_A.publicKey, weight: 1, type: 'ed25519_public_key' },
      { key: SIGNER_B.publicKey, weight: 1, type: 'ed25519_public_key' },
    ],
  });
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MultisigJobDetail jobId="job-1" accessToken="tok" currentPublicKey={SIGNER_A.publicKey} onBack={() => {}} />
    </I18nextProvider>
  );
}

async function openSecretModal() {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Job widerrufen' }));
  const confirm = await screen.findByRole('alertdialog');
  fireEvent.click(within(confirm).getByRole('button', { name: 'Weiter zum Signieren' }));
  await waitFor(() => expect(document.querySelectorAll('input[type="password"]').length).toBeGreaterThan(0));
}

function typeSecrets(...secrets) {
  const inputs = Array.from(document.querySelectorAll('input[type="password"]'));
  secrets.forEach((sec, i) => fireEvent.change(inputs[i], { target: { value: sec } }));
}

function submitSecretModal() {
  const buttons = screen.getAllByRole('button', { name: /^(senden|submit)$/i });
  fireEvent.click(buttons[buttons.length - 1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getJobMock.mockImplementation(async () => makeJob());
  hoisted.loadAccountMock.mockImplementation(async () => horizonAccount('100'));
  hoisted.submitMock.mockResolvedValue({ hash: 'revokehash' });
  hoisted.rootMock.mockResolvedValue({ network_passphrase: Networks.TESTNET });
});

describe('Multisig-Job widerrufen (P2.3)', () => {
  it('zeigt vor dem Signieren Konto, Sequence und die Nebenwirkung', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Job widerrufen' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(new RegExp(`Sequenz wird auf 101 gesetzt`))).toBeInTheDocument();
    expect(within(confirm).getByText(new RegExp(SOURCE))).toBeInTheDocument();
    expect(within(confirm).getByText(/ebenfalls ungültig/)).toBeInTheDocument();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('sendet eine signierte bumpSequence-Transaktion auf die Job-Sequence', async () => {
    await openSecretModal();
    typeSecrets(SIGNER_A.secret);
    submitSecretModal();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    const tx = hoisted.submitMock.mock.calls[0][1];
    expect(tx.source).toBe(SOURCE);
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0].type).toBe('bumpSequence');
    expect(tx.operations[0].bumpTo).toBe('101');
    expect(tx.signatures).toHaveLength(1);
    await screen.findByText(/Job widerrufen\. Transaktion revokehash/);
    expect(screen.queryByRole('button', { name: 'Job widerrufen' })).not.toBeInTheDocument();
  });

  it('sendet nicht, wenn die Signer den Low-Threshold nicht erreichen', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => horizonAccount('100', 2));
    await openSecretModal();
    typeSecrets(SIGNER_A.secret);
    submitSecretModal();
    await screen.findByText(/nicht das nötige Gewicht 2/);
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('meldet einen bereits ungueltigen Job, ohne etwas zu senden', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => horizonAccount('101'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Job widerrufen' }));
    await screen.findByText(/bereits ungültig/);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('verweigert den Widerruf bei manipulierter Job-Sequence nahe dem Hoechstwert', async () => {
    const evil = jobTx('9223372036854775805');
    hoisted.getJobMock.mockImplementation(async () => makeJob({ txXdr: evil.toXDR(), txHash: txHashHex(evil) }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Job widerrufen' }));
    await screen.findByText(/passt nicht zur aktuellen Sequenz des Kontos/);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('bietet keinen Widerruf fuer Jobs in einem Endzustand an', async () => {
    hoisted.getJobMock.mockImplementation(async () => makeJob({ status: 'obsolete_seq' }));
    renderPage();
    await waitFor(() => expect(hoisted.getJobMock).toHaveBeenCalled());
    await screen.findByText(/obsolete_seq/);
    expect(screen.queryByRole('button', { name: 'Job widerrufen' })).not.toBeInTheDocument();
  });

  it('zaehlt denselben Key nur einmal (kein doppeltes Gewicht)', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => horizonAccount('100', 2));
    await openSecretModal();
    await waitFor(() => expect(document.querySelectorAll('input[type="password"]').length).toBeGreaterThanOrEqual(2));
    typeSecrets(SIGNER_A.secret, SIGNER_A.secret);
    submitSecretModal();
    await screen.findByText(/nicht das nötige Gewicht 2/);
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('sendet mit zwei verschiedenen Signern bei Low-Threshold 2', async () => {
    hoisted.loadAccountMock.mockImplementation(async () => horizonAccount('100', 2));
    await openSecretModal();
    await waitFor(() => expect(document.querySelectorAll('input[type="password"]').length).toBeGreaterThanOrEqual(2));
    typeSecrets(SIGNER_A.secret, SIGNER_B.secret);
    submitSecretModal();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    expect(hoisted.submitMock.mock.calls[0][1].signatures).toHaveLength(2);
  });

  it('sendet nichts, wenn Horizon zu einem anderen Netzwerk gehoert', async () => {
    hoisted.rootMock.mockResolvedValue({ network_passphrase: Networks.PUBLIC });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await openSecretModal();
    typeSecrets(SIGNER_A.secret);
    submitSecretModal();
    await screen.findByText(/gehört nicht zum Netzwerk dieses Jobs/);
    expect(hoisted.submitMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('sendet bei Doppelklick nur einmal', async () => {
    let release;
    hoisted.submitMock.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ hash: 'revokehash' }); }));
    await openSecretModal();
    typeSecrets(SIGNER_A.secret);
    submitSecretModal();
    submitSecretModal();
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    release();
    await screen.findByText(/Job widerrufen\. Transaktion revokehash/);
    expect(hoisted.submitMock).toHaveBeenCalledTimes(1);
  });

  it('bietet im Widerruf kein Merken des Secret Keys an', async () => {
    await openSecretModal();
    expect(screen.queryByText(/Für diese Sitzung merken|Remember for this session/i)).not.toBeInTheDocument();
  });

  it('sperrt den Widerruf bei unbekanntem Netzwerk, falschem Hash oder abweichendem Konto', async () => {
    for (const [overrides, text] of [
      [{ network: 'futurenet' }, /Netzwerk dieses Jobs ist unbekannt/],
      [{ txHash: 'deadbeef' }, /passt nicht zum gespeicherten Hash/],
      [{ accountId: SIGNER_B.publicKey }, /weicht vom Konto des Jobs ab/],
    ]) {
      hoisted.getJobMock.mockImplementation(async () => makeJob(overrides));
      const view = renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Job widerrufen' }));
      await screen.findByText(text);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      view.unmount();
    }
    expect(hoisted.loadAccountMock).not.toHaveBeenCalled();
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('verweigert den Widerruf schon bei Sequenzabstand 2', async () => {
    const tx = jobTx('101');
    hoisted.getJobMock.mockImplementation(async () => makeJob({ txXdr: tx.toXDR(), txHash: txHashHex(tx) }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Job widerrufen' }));
    await screen.findByText(/passt nicht zur aktuellen Sequenz des Kontos/);
    expect(hoisted.submitMock).not.toHaveBeenCalled();
  });

  it('sperrt den Widerruf, wenn Hash oder Konto im Job fehlen', async () => {
    for (const overrides of [{ txHash: undefined }, { accountId: undefined }]) {
      hoisted.getJobMock.mockImplementation(async () => makeJob(overrides));
      const view = renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Job widerrufen' }));
      await screen.findByText(/fehlen Hash oder Konto/);
      view.unmount();
    }
    expect(hoisted.loadAccountMock).not.toHaveBeenCalled();
  });

  it('sperrt das Signieren bei unbekannten Operationen bis zur ausdruecklichen Bestaetigung', async () => {
    const tx = new TransactionBuilder(new Account(SOURCE, '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.manageData({ name: 'x', value: 'y' }))
      .setTimeout(86400)
      .build();
    hoisted.getJobMock.mockImplementation(async () => makeJob({ txXdr: tx.toXDR(), txHash: txHashHex(tx) }));
    renderPage();
    await screen.findByText(/nicht im Klartext anzeigen kann: manageData/);
    const signButton = screen.getAllByRole('button', { name: 'Jetzt signieren' })[0];
    expect(signButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /anderweitig geprüft/ }));
    expect(signButton).not.toBeDisabled();
  });

  it('zeigt die Operationen eines Batch-Convert-Jobs im Klartext', async () => {
    const spam = new Asset('SPAM', SIGNER_B.publicKey);
    const tx = new TransactionBuilder(new Account(SOURCE, '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.claimClaimableBalance({ balanceId: `00000000${'b'.repeat(64)}` }))
      .addOperation(Operation.pathPaymentStrictSend({ sendAsset: spam, sendAmount: '5', destination: SIGNER_A.publicKey, destAsset: Asset.native(), destMin: '1', path: [] }))
      .setTimeout(86400)
      .build();
    hoisted.getJobMock.mockImplementation(async () => makeJob({ txXdr: tx.toXDR(), txHash: txHashHex(tx) }));
    renderPage();
    await screen.findByText(/^Claimable Balance einlösen/);
    const spamLabel = `SPAM (${SIGNER_B.publicKey.slice(0, 8)}…${SIGNER_B.publicKey.slice(-8)})`;
    expect(screen.getByText('Tausch')).toBeInTheDocument();
    expect(screen.getByText(`5,0 ${spamLabel}`)).toBeInTheDocument();
    expect(screen.getByText(SIGNER_A.publicKey)).toHaveClass('break-all');
    expect(screen.getByText(/Erlös an ein anderes Konto/)).toBeInTheDocument();
  });
});

describe('Fremdes Quellkonto einer Operation', () => {
  const jobFor = (tx) => makeJob({ txXdr: tx.toXDR(), txHash: txHashHex(tx) });
  const paymentTx = (opSource, txSource = SOURCE) => new TransactionBuilder(new Account(txSource, '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: SIGNER_B.publicKey, asset: Asset.native(), amount: '1', source: opSource }))
    .setTimeout(86400)
    .build();

  it('listet ein fremdes Konto wie die anderen Warnungen und markiert den Block', async () => {
    hoisted.getJobMock.mockImplementation(async () => jobFor(paymentTx(SIGNER_A.publicKey)));
    renderPage();
    const warning = await screen.findByTestId('job-foreign-sources');
    expect(warning).toHaveAttribute('role', 'alert');
    expect(warning).toHaveTextContent('von einem anderen Konto als dem Quellkonto ausgeführt');
    expect(warning).toHaveTextContent(SIGNER_A.publicKey);
    const block = screen.getByTestId('operation-block');
    expect(block).toHaveTextContent(`Quellkonto${SIGNER_A.publicKey}`);
    expect(block).toHaveTextContent('Diese Operation wird von einem anderen Konto ausgeführt.');
  });

  it('zeigt bei op.source gleich Quellkonto weder Zeile noch Warnung', async () => {
    hoisted.getJobMock.mockImplementation(async () => jobFor(paymentTx(SOURCE)));
    renderPage();
    const block = await screen.findByTestId('operation-block');
    expect(block).not.toHaveTextContent('Quellkonto');
    expect(screen.queryByTestId('job-foreign-sources')).toBeNull();
  });

  it('Fee-Bump: wertet gegen die innere Transaktion und zeigt deren Operationen', async () => {
    const inner = paymentTx(SOURCE);
    inner.sign(Keypair.fromSecret(SIGNER_A.secret));
    const bump = TransactionBuilder.buildFeeBumpTransaction(Keypair.fromSecret(SIGNER_B.secret), '2000', inner, Networks.TESTNET);
    hoisted.getJobMock.mockImplementation(async () => makeJob({ txXdr: bump.toXDR(), txHash: txHashHex(bump) }));
    renderPage();
    const block = await screen.findByTestId('operation-block');
    expect(block).toHaveTextContent('Zahlung');
    expect(block).not.toHaveTextContent('Quellkonto');
    expect(screen.queryByTestId('job-foreign-sources')).toBeNull();
  });
});

describe('Liquidity-Pool-Jobs im Job-Detail (Stufe 2b)', () => {
  const lpIssuer = Keypair.random().publicKey();
  const usd = new Asset('USD', lpIssuer);
  const POOL_ID = poolIdFor(Asset.native(), usd);
  const poolRecord = (rA = '1000.0000000', rB = '100.0000000') => ({
    id: POOL_ID,
    fee_bp: 30,
    total_trustlines: '3',
    total_shares: '300.0000000',
    reserves: [{ asset: 'native', amount: rA }, { asset: `USD:${lpIssuer}`, amount: rB }],
  });
  const lpJob = (ops, overrides = {}) => {
    const builder = new TransactionBuilder(new Account(SOURCE, '100'), { fee: '1000', networkPassphrase: Networks.TESTNET });
    ops.forEach((op) => builder.addOperation(op));
    const tx = builder.setTimeout(86400).build();
    return makeJob({ txHash: txHashHex(tx), txXdr: tx.toXDR(), ...overrides });
  };
  const depositOp = () => Operation.liquidityPoolDeposit({ liquidityPoolId: POOL_ID, maxAmountA: '10', maxAmountB: '1', minPrice: { n: 995, d: 100 }, maxPrice: { n: 1005, d: 100 } });
  const poolTrustOp = () => Operation.changeTrust({ asset: new LiquidityPoolAsset(Asset.native(), usd, LiquidityPoolFeeV18) });
  const withdrawOp = () => Operation.liquidityPoolWithdraw({ liquidityPoolId: POOL_ID, amount: '30', minAmountA: '99.5', minAmountB: '9.95' });
  const usdLabel = `USD (${lpIssuer.slice(0, 8)}…${lpIssuer.slice(-8)})`;

  it('loest die Pool-Assets aus der Pool-Trustline auf und zeigt den Kurs innerhalb der Grenzen', async () => {
    hoisted.getJobMock.mockImplementation(async () => lpJob([poolTrustOp(), depositOp()]));
    hoisted.poolMock.mockResolvedValue(poolRecord());
    renderPage();
    const title = await screen.findByText(new RegExp(`^Liquidität einzahlen in Pool XLM/USD \\(`));
    const block = title.closest('[data-testid="operation-block"]');
    expect(block).toHaveTextContent('Höchstbetrag Asset A10,0 XLM');
    expect(block).toHaveTextContent(`Höchstbetrag Asset B1,0 ${usdLabel}`);
    expect(block).toHaveTextContent(`Mindestpreis XLM/${usdLabel}9,95`);
    expect(block).toHaveTextContent(`Höchstpreis XLM/${usdLabel}10,05`);
    const state = screen.getByTestId('job-pool-state');
    await waitFor(() => expect(state).toHaveTextContent(`aktueller Kurs XLM/${usdLabel} 10. Bei diesem Stand liegt die Einzahlung innerhalb der Preisgrenzen`));
    expect(hoisted.poolMock).toHaveBeenCalledWith(POOL_ID);
  });

  it('meldet neutral, wenn der aktuelle Kurs ausserhalb der Grenzen liegt', async () => {
    hoisted.getJobMock.mockImplementation(async () => lpJob([poolTrustOp(), depositOp()]));
    hoisted.poolMock.mockResolvedValue(poolRecord('1100.0000000', '90.0000000'));
    renderPage();
    const state = await screen.findByTestId('job-pool-state');
    await waitFor(() => expect(state).toHaveTextContent('Der aktuelle Kurs liegt außerhalb der Grenzen dieser Operation. Die Transaktion würde derzeit fehlschlagen.'));
  });

  it('nimmt ohne Pool-Trustline die Assets aus Horizon und vergleicht Withdraw-Betraege mit den Mindestbetraegen', async () => {
    hoisted.getJobMock.mockImplementation(async () => lpJob([withdrawOp()]));
    hoisted.poolMock.mockResolvedValue(poolRecord('900.0000000', '111.0000000'));
    renderPage();
    const title = await screen.findByText(new RegExp('^Liquidität abheben aus Pool XLM/USD'));
    const block = title.closest('[data-testid="operation-block"]');
    expect(block).toHaveTextContent('Mindestbetrag Asset A99,5 XLM');
    expect(block).toHaveTextContent(`Mindestbetrag Asset B9,95 ${usdLabel}`);
    await waitFor(() => expect(screen.getByTestId('job-pool-state')).toHaveTextContent(`aktuell zu erwarten 90,0 XLM und 11,1 ${usdLabel}. Die Mindestbeträge dieser Operation werden nicht erreicht.`));
  });

  it('faellt bei 404 oder falscher Pool-ID auf Asset A/B zurueck, ohne abzustuerzen', async () => {
    hoisted.getJobMock.mockImplementation(async () => lpJob([withdrawOp()]));
    hoisted.poolMock.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
    const view = renderPage();
    const hint = await screen.findByText(/Pool-Assets konnten nicht geladen werden/);
    expect(hint.closest('[data-testid="operation-block"]')).toHaveTextContent('Mindestbetrag Asset A99,5 Asset A');
    expect(screen.getByTestId('job-pool-state')).toHaveTextContent('Der aktuelle Pool-Stand konnte nicht geladen werden.');
    view.unmount();

    // Horizon liefert unter der ID einen Pool mit anderen Assets (poolIdMismatch)
    hoisted.poolMock.mockResolvedValueOnce({ ...poolRecord(), reserves: [{ asset: 'native', amount: '1' }, { asset: `EUR:${lpIssuer}`, amount: '1' }] });
    renderPage();
    expect(await screen.findByText(/Pool-Assets konnten nicht geladen werden/)).toBeInTheDocument();
  });

  it('zeigt LP-Fehlercodes beim Job-Submit verstaendlich an (PHP- und Node-Form)', async () => {
    const codes = { transaction: 'tx_failed', operations: ['op_success', 'op_bad_price'] };
    hoisted.poolMock.mockResolvedValue(poolRecord());
    hoisted.getJobMock.mockImplementation(async () => lpJob([poolTrustOp(), depositOp()], {
      status: 'submitted_failed',
      submittedResult: { error: 'Transaction Failed', detail: { extras: { result_codes: codes } } },
    }));
    const view = renderPage();
    expect(await screen.findByTestId('job-submit-liquidity-error')).toHaveTextContent('außerhalb der bestätigten Preisgrenzen (op_bad_price)');
    view.unmount();

    hoisted.getJobMock.mockImplementation(async () => lpJob([withdrawOp()], {
      status: 'submitted_failed',
      submittedResult: { error: { title: 'Transaction Failed', extras: { result_codes: { transaction: 'tx_failed', operations: ['op_under_minimum'] } } } },
    }));
    renderPage();
    expect(await screen.findByTestId('job-submit-liquidity-error')).toHaveTextContent('unter den bestätigten Mindestbeträgen (op_under_minimum)');
    expect(screen.getByText(/Beim Senden ist ein Fehler aufgetreten: Transaction Failed/)).toBeInTheDocument();
  });

  it('zeigt einen Token mit dem Code XLM im Pool-Stand nie als nacktes XLM', async () => {
    const fakeXlm = new Asset('XLM', Keypair.random().publicKey());
    const fakeId = poolIdFor(fakeXlm, usd);
    const [first, second] = [fakeXlm, usd].sort((x, y) => Asset.compare(x, y));
    const reserves = [first, second].map((a, i) => ({ asset: `${a.getCode()}:${a.getIssuer()}`, amount: i === 0 ? '100.0000000' : '100.0000000' }));
    hoisted.poolMock.mockResolvedValue({ id: fakeId, fee_bp: 30, total_trustlines: '2', total_shares: '100.0000000', reserves });
    hoisted.getJobMock.mockImplementation(async () => lpJob([
      Operation.liquidityPoolWithdraw({ liquidityPoolId: fakeId, amount: '10', minAmountA: '1', minAmountB: '1' }),
    ]));
    renderPage();
    const state = await screen.findByTestId('job-pool-state');
    await waitFor(() => expect(state).toHaveTextContent('aktuell zu erwarten'));
    const issuerShort = `${fakeXlm.getIssuer().slice(0, 8)}…${fakeXlm.getIssuer().slice(-8)}`;
    expect(state).toHaveTextContent(`XLM (${issuerShort})`);
    // jedes Vorkommen von XLM traegt den Issuer
    expect(state.textContent).not.toMatch(/XLM(?! \()/);
  });

  it('nimmt keine Assets aus Horizon, wenn die Antwort zu einem anderen Pool gehoert', async () => {
    const eur = new Asset('EUR', lpIssuer);
    const eurId = poolIdFor(Asset.native(), eur);
    hoisted.getJobMock.mockImplementation(async () => lpJob([withdrawOp()]));
    // in sich gueltiger Record, aber fuer den EUR-Pool statt des angefragten USD-Pools
    hoisted.poolMock.mockResolvedValue({ ...poolRecord(), id: eurId, reserves: [{ asset: 'native', amount: '1000.0000000' }, { asset: `EUR:${lpIssuer}`, amount: '100.0000000' }] });
    renderPage();
    expect(await screen.findByText(/Pool-Assets konnten nicht geladen werden/)).not.toHaveTextContent('EUR');
    expect(screen.getByTestId('job-pool-state')).toHaveTextContent('Der aktuelle Pool-Stand konnte nicht geladen werden.');
    expect(hoisted.poolMock).toHaveBeenCalledWith(POOL_ID);
  });

  it('zeigt bei unbekanntem Job-Netz den Fallback statt dauerhaft "wird geladen"', async () => {
    hoisted.getJobMock.mockImplementation(async () => lpJob([withdrawOp()], { network: 'futurenet' }));
    renderPage();
    expect(await screen.findByText(/Pool-Assets konnten nicht geladen werden/)).toBeInTheDocument();
    expect(screen.getByTestId('job-pool-state')).not.toHaveTextContent('Pool-Daten werden geladen');
    expect(hoisted.poolMock).not.toHaveBeenCalled();
  });

  it('laedt Horizon bei einem Signatur-Update nicht erneut', async () => {
    const builder = new TransactionBuilder(new Account(SOURCE, '100'), { fee: '1000', networkPassphrase: Networks.TESTNET });
    const tx = builder.addOperation(withdrawOp()).setTimeout(86400).build();
    const unsigned = tx.toXDR();
    hoisted.poolMock.mockResolvedValue(poolRecord());
    hoisted.getJobMock.mockImplementation(async () => makeJob({ txHash: txHashHex(tx), txXdr: unsigned }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('job-pool-state')).toHaveTextContent('aktuell zu erwarten'));
    expect(hoisted.poolMock).toHaveBeenCalledTimes(1);

    // Signatur kommt hinzu: neues XDR, gleiche Transaktion
    tx.sign(Keypair.fromSecret(SIGNER_A.secret));
    hoisted.getJobMock.mockImplementation(async () => makeJob({ txHash: txHashHex(tx), txXdr: unsigned, txXdrCurrent: tx.toXDR(), collectedWeight: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(hoisted.getJobMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('job-pool-state')).toHaveTextContent('aktuell zu erwarten'));
    expect(hoisted.poolMock).toHaveBeenCalledTimes(1);
  });

  it('ordnet einen LP-Text nur zu, wenn der fehlgeschlagene Op ein LP-Op ist', async () => {
    hoisted.poolMock.mockResolvedValue(poolRecord());
    hoisted.getJobMock.mockImplementation(async () => lpJob([
      Operation.payment({ destination: SIGNER_A.publicKey, asset: Asset.native(), amount: '1' }),
      withdrawOp(),
    ], {
      status: 'submitted_failed',
      submittedResult: { error: 'Transaction Failed', detail: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded', 'op_success'] } } } },
    }));
    renderPage();
    expect(await screen.findByText(/op_underfunded/)).toBeInTheDocument();
    expect(screen.queryByTestId('job-submit-liquidity-error')).toBeNull();
  });

  it('uebersetzt Op-Codes anderer Jobs nicht als Pool-Fehler', async () => {
    hoisted.getJobMock.mockImplementation(async () => makeJob({
      status: 'submitted_failed',
      submittedResult: { error: 'Transaction Failed', detail: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } } } },
    }));
    renderPage();
    expect(await screen.findByText(/op_underfunded/)).toBeInTheDocument();
    expect(screen.queryByTestId('job-submit-liquidity-error')).toBeNull();
    expect(hoisted.poolMock).not.toHaveBeenCalled();
  });
});
