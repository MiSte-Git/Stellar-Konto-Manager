import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { AmbiguousSubmitResultError } from '../../../utils/stellar/submitTransactionSafely.js';
import i18n from '../../../i18n.js';
import ClaimableBalancesPanel from '../ClaimableBalancesPanel.jsx';

const ME = {
  secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
  publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
};
const ISSUER = Keypair.random().publicKey();
const SENDER = Keypair.random().publicKey();
const id = (n) => `00000000${String(n).padStart(64, '0')}`;

const hoisted = vi.hoisted(() => ({ recordsMock: vi.fn(), loadAccountMock: vi.fn(), submitMock: vi.fn(), rememberMock: vi.fn(async () => {}) }));

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    claimableBalances: () => ({ claimant: () => ({ limit: () => ({ call: hoisted.recordsMock }) }) }),
    loadAccount: hoisted.loadAccountMock,
    root: vi.fn(async () => ({ network_passphrase: 'Test SDF Network ; September 2015' })),
    feeStats: vi.fn(async () => ({ last_ledger_base_fee: '100', fee_charged: { mode: '100' } })),
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

const COSIGNER = Keypair.random().publicKey();

function makeAccount({ multisig = false } = {}) {
  return Object.assign(new Account(ME.publicKey, '100'), {
    account_id: ME.publicKey,
    thresholds: multisig
      ? { low_threshold: 2, med_threshold: 2, high_threshold: 2 }
      : { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: multisig
      ? [{ key: ME.publicKey, weight: 1, type: 'ed25519_public_key' }, { key: COSIGNER, weight: 1, type: 'ed25519_public_key' }]
      : [{ key: ME.publicKey, weight: 1, type: 'ed25519_public_key' }],
    balances: [
      { asset_type: 'native', balance: '100.0000000' },
      { asset_type: 'credit_alphanum4', asset_code: 'FOO', asset_issuer: ISSUER, balance: '0' },
    ],
  });
}

const RECORDS = [
  { id: id(1), asset: 'native', amount: '10.0000000', sponsor: SENDER, claimants: [{ destination: ME.publicKey, predicate: { unconditional: true } }] },
  { id: id(2), asset: `FOO:${ISSUER}`, amount: '2.0000000', sponsor: SENDER, claimants: [{ destination: ME.publicKey, predicate: { unconditional: true } }] },
  { id: id(3), asset: `BAR:${ISSUER}`, amount: '3.0000000', sponsor: SENDER, claimants: [{ destination: ME.publicKey, predicate: { unconditional: true } }] },
  { id: id(4), asset: 'native', amount: '4.0000000', sponsor: SENDER, claimants: [{ destination: ME.publicKey, predicate: { abs_before_epoch: '1000' } }] },
];

function renderPanel(props = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ClaimableBalancesPanel
        publicKey={ME.publicKey}
        account={makeAccount()}
        network="TESTNET"
        available={50}
        fmt={(v) => String(v)}
        locale="de-CH"
        {...props}
      />
    </I18nextProvider>
  );
}

const itemById = (n) => screen.getAllByTestId('claimable-item').find((li) => li.getAttribute('data-claimable-id') === id(n));

async function claim(n) {
  fireEvent.click(within(itemById(n)).getByRole('button', { name: 'Einlösen' }));
  await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
  fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: ME.secret } });
  const buttons = screen.getAllByRole('button', { name: /^(senden|submit)$/i });
  fireEvent.click(buttons[buttons.length - 1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  hoisted.recordsMock.mockResolvedValue({ records: RECORDS });
  hoisted.loadAccountMock.mockImplementation(async () => makeAccount());
  hoisted.submitMock.mockResolvedValue({ hash: 'claimhash' });
});

describe('ClaimableBalancesPanel (P1.5)', () => {
  it('zeigt XLM und Assets mit Trustline, Assets ohne Trustline eingeklappt', async () => {
    renderPanel();
    await screen.findByText('Claimable Balances');
    expect(screen.getAllByTestId('claimable-item')).toHaveLength(3);
    expect(screen.queryByText('BAR')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anzeigen' }));
    expect(await screen.findByText('BAR')).toBeInTheDocument();
    expect(screen.getByText(/Für diese Assets besteht keine Trustline/)).toBeInTheDocument();
    expect(screen.queryByText(/Betrugsversuche/)).not.toBeInTheDocument();
  });

  it('nicht einloesbare Eintraege haben einen gesperrten Knopf', async () => {
    renderPanel();
    await screen.findByText('Claimable Balances');
    expect(within(itemById(4)).getByRole('button', { name: 'Einlösen' })).toBeDisabled();
  });

  it('loest XLM mit genau einer claimClaimableBalance-Operation ein', async () => {
    const onClaimed = vi.fn();
    renderPanel({ onClaimed });
    await screen.findByText('Claimable Balances');
    await claim(1);
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    const tx = hoisted.submitMock.mock.calls[0][1];
    expect(tx.operations.map((o) => o.type)).toEqual(['claimClaimableBalance']);
    expect(tx.operations[0].balanceId).toBe(id(1));
    expect(tx.signatures).toHaveLength(1);
    await screen.findByText(/eingelöst\. Transaktion claimhash/);
    expect(onClaimed).toHaveBeenCalled();
  });

  it('legt beim Einloesen ohne Trustline die Trustline in derselben Transaktion an', async () => {
    renderPanel();
    await screen.findByText('Claimable Balances');
    fireEvent.click(screen.getByRole('button', { name: 'Anzeigen' }));
    await screen.findByText('BAR');
    await claim(3);
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    const tx = hoisted.submitMock.mock.calls[0][1];
    expect(tx.operations.map((o) => o.type)).toEqual(['changeTrust', 'claimClaimableBalance']);
  });

  it('verhindert das Einloesen ohne Trustline, wenn die Reserve nicht reicht', async () => {
    renderPanel({ available: 0.2 });
    await screen.findByText('Claimable Balances');
    fireEvent.click(screen.getByRole('button', { name: 'Anzeigen' }));
    await screen.findByText('BAR');
    fireEvent.click(within(itemById(3)).getByRole('button', { name: 'Einlösen' }));
    await screen.findByText(/werden 0.5 XLM Reserve benötigt/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('blendet Eintraege aus und merkt sich das pro Konto und Netzwerk', async () => {
    const view = renderPanel();
    await screen.findByText('Claimable Balances');
    fireEvent.click(within(itemById(1)).getByRole('button', { name: 'Ausblenden' }));
    expect(screen.getAllByTestId('claimable-item')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Ausgeblendete anzeigen (1)' })).toBeInTheDocument();
    view.unmount();
    renderPanel();
    await screen.findByText('Claimable Balances');
    expect(screen.getAllByTestId('claimable-item')).toHaveLength(2);
  });

  it('zeigt den Abschnitt auch ohne Claimable Balances, mit Anzahl 0', async () => {
    hoisted.recordsMock.mockResolvedValue({ records: [] });
    renderPanel();
    await waitFor(() => expect(hoisted.recordsMock).toHaveBeenCalled());
    const section = await screen.findByTestId('wallet-home-claimable');
    expect(within(section).getByText('0')).toBeInTheDocument();
    expect(screen.getByTestId('claimable-empty')).toHaveTextContent('Keine Claimable Balances vorhanden.');
    expect(screen.queryByRole('button', { name: /Batch-Convert/ })).not.toBeInTheDocument();
  });

  it('bietet bei Einzelsignatur-Konten keinen Job an', async () => {
    renderPanel();
    await screen.findByText('Claimable Balances');
    expect(screen.queryByRole('button', { name: 'Als Multisig-Job vorbereiten' })).not.toBeInTheDocument();
  });

  describe('Multisig-Konto', () => {
    let fetchMock;
    beforeEach(() => {
      hoisted.loadAccountMock.mockImplementation(async () => makeAccount({ multisig: true }));
      fetchMock = vi.fn(async (_url, opts) => ({
        ok: true,
        json: async () => ({ id: 'job-9', txHash: 'jobhash', txXdrCurrent: JSON.parse(opts.body).txXdr }),
      }));
      vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('legt einen Job mit unsignierter Claim-Transaktion, Schnell-Gebuehr und langer Gueltigkeit an', async () => {
      renderPanel({ account: makeAccount({ multisig: true }) });
      await screen.findByText('Claimable Balances');
      fireEvent.click(within(itemById(1)).getByRole('button', { name: 'Als Multisig-Job vorbereiten' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, opts] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('multisig/jobs');
      const body = JSON.parse(opts.body);
      expect(body).toMatchObject({ network: 'testnet', accountId: ME.publicKey, createdBy: 'local' });
      const tx = TransactionBuilder.fromXDR(body.txXdr, Networks.TESTNET);
      expect(tx.operations.map((o) => o.type)).toEqual(['claimClaimableBalance']);
      expect(tx.signatures).toHaveLength(0);
      expect(Number(tx.fee)).toBeGreaterThanOrEqual(1000);
      expect(Number(tx.timeBounds.maxTime) - Math.floor(Date.now() / 1000)).toBeGreaterThan(3600);
      await screen.findByText('Transaktion für Multisig vorbereitet');
      expect(screen.getByText('job-9')).toBeInTheDocument();
      expect(hoisted.submitMock).not.toHaveBeenCalled();
    });

    it('verweist bei zu wenig lokalem Gewicht auf den Job-Weg', async () => {
      renderPanel({ account: makeAccount({ multisig: true }) });
      await screen.findByText('Claimable Balances');
      await claim(1);
      await screen.findByText(/Bereite stattdessen einen Multisig-Job vor/);
      expect(hoisted.submitMock).not.toHaveBeenCalled();
    });
  });

  it('sperrt Eintraege mit nicht freigegebener Trustline und nennt den Grund', async () => {
    const acct = makeAccount();
    acct.balances[1] = { ...acct.balances[1], is_authorized: false };
    hoisted.loadAccountMock.mockImplementation(async () => acct);
    renderPanel({ account: acct });
    await screen.findByText('Claimable Balances');
    expect(within(itemById(2)).getByRole('button', { name: 'Einlösen' })).toBeDisabled();
    expect(within(itemById(2)).getByText(/nicht freigegeben/)).toBeInTheDocument();
  });

  it('merkt Secrets erst nach erfolgreichem Einloesen', async () => {
    hoisted.submitMock.mockRejectedValueOnce(Object.assign(new Error('http 400'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } } }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel();
    await screen.findByText('Claimable Balances');
    await claim(1);
    await waitFor(() => expect(hoisted.submitMock).toHaveBeenCalledTimes(1));
    await screen.findAllByText(/Einlösen fehlgeschlagen/);
    expect(hoisted.rememberMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('schliesst nach unklarem Ergebnis den Dialog und laedt neu statt erneut zu senden', async () => {
    hoisted.submitMock.mockRejectedValueOnce(new AmbiguousSubmitResultError('amb-hash', new Error('timeout')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onClaimed = vi.fn();
    renderPanel({ onClaimed });
    await screen.findByText('Claimable Balances');
    await claim(1);
    await screen.findByText(/Ergebnis ist unklar.*amb-hash/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(onClaimed).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

