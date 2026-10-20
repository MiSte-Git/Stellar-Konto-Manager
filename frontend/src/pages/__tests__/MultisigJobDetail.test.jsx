import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import MultisigJobDetail from '../MultisigJobDetail.jsx';

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
    txHash: tx.hash().toString('hex'),
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
    hoisted.getJobMock.mockImplementation(async () => makeJob({ txXdr: evil.toXDR(), txHash: evil.hash().toString('hex') }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Job widerrufen' }));
    await screen.findByText(/ungewöhnlich weit über der aktuellen Sequenz/);
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
});
