import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair } from '@stellar/stellar-sdk';
import i18n from '../../../i18n.js';
import ClaimableBalancesPanel from '../ClaimableBalancesPanel.jsx';

// Sammel-Tausch: Job-Weg, Fee fuer spaeteres Einreichen und Job-Hinweise nur, wenn kein einzelner
// Signer die Medium-Schwelle erreicht (ADR 0007). Vorher reichte ein zweiter Signer (isMultisigAccount).
const ME = Keypair.random().publicKey();
const COSIGNER = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const id = (n) => `00000000${String(n).padStart(64, '0')}`;
const claimant = [{ destination: ME, predicate: { unconditional: true } }];
const RECORDS = [
  { id: id(1), asset: 'native', amount: '10.0000000', sponsor: ISSUER, claimants: claimant },
  { id: id(2), asset: `FOO:${ISSUER}`, amount: '2.0000000', sponsor: ISSUER, claimants: claimant },
];

const hoisted = vi.hoisted(() => ({ batchProps: null }));
vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../../test/horizonMock.js')).withNetworkServer({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    claimableBalances: () => ({ claimant: () => ({ limit: () => ({ call: async () => ({ records: RECORDS }) }) }) }),
    loadAccount: async () => null,
  }),
}));
vi.mock('../BatchConvertDialog.jsx', () => ({
  default: (props) => { hoisted.batchProps = props; return <div data-testid="batch-dialog" />; },
}));

function account(thresholds) {
  return Object.assign(new Account(ME, '100'), {
    account_id: ME,
    thresholds,
    signers: [{ key: ME, weight: 1, type: 'ed25519_public_key' }, { key: COSIGNER, weight: 1, type: 'ed25519_public_key' }],
    balances: [
      { asset_type: 'native', balance: '100.0000000' },
      { asset_type: 'credit_alphanum4', asset_code: 'FOO', asset_issuer: ISSUER, balance: '0' },
    ],
  });
}

async function openBatch(thresholds) {
  render(
    <I18nextProvider i18n={i18n}>
      <ClaimableBalancesPanel publicKey={ME} account={account(thresholds)} network="TESTNET" available={50} fmt={(v) => String(v)} locale="de-CH" />
    </I18nextProvider>
  );
  await screen.findByText('Claimable Balances');
  fireEvent.click(screen.getByRole('button', { name: /Batch-Convert/ }));
  await screen.findByTestId('batch-dialog');
  return hoisted.batchProps;
}

describe('ClaimableBalancesPanel: Multisig im Sammel-Tausch nur bei Bedarf', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    hoisted.batchProps = null;
  });

  it('zwei Signer, ein Signer erreicht Medium (1/1/2): kein Multisig-Weg', async () => {
    expect((await openBatch({ low_threshold: 1, med_threshold: 1, high_threshold: 2 })).multisig).toBe(false);
  });

  it('Gegenprobe: zwei Signer, Medium 2 (1/2/2): Multisig-Weg', async () => {
    expect((await openBatch({ low_threshold: 1, med_threshold: 2, high_threshold: 2 })).multisig).toBe(true);
  });
});
