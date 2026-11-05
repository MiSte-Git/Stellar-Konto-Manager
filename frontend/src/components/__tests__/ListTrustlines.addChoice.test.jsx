import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import ListTrustlines from '../ListTrustlines.jsx';
import { consumePendingTrustlineAsset, openAddTrustline, setMainMounted } from '../../utils/appNavigation.js';
import { resetServerNetworkCalls, serverNetworkCalls } from '../../test/horizonMock.js';

const hoisted = vi.hoisted(() => ({ account: null }));
vi.mock('../../utils/stellar/stellarUtils.js', async (orig) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await orig()),
  getHorizonServer: () => ({ loadAccount: async () => hoisted.account }),
}));

const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const SECOND = 'GDXN5EJZNIP3PVL2MLICK5ARFPBYVD7KMHZTCM56ADHB7CECJRHTJY4L';

function renderList(extra = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ListTrustlines
        trustlines={[]} itemsPerPage={10} currentPage={0} sortColumn="assetCode" sortDirection="asc"
        onSort={() => {}} filters={{}} onFilterChange={() => {}} selectedTrustlines={[]} onToggleAll={() => {}}
        setSelectedTrustlines={() => {}} results={[]} setResults={() => {}} setMenuSelection={() => {}}
        menuSelection="listAll" setSecretKey={() => {}} publicKey={PK} setTrustlines={() => {}}
        isProcessing={false} deleteProgress={null} setIsProcessing={() => {}} setDeleteProgress={() => {}}
        setInfoMessage={() => {}}
        {...extra}
      />
    </I18nextProvider>
  );
}

async function submitAdd() {
  openAddTrustline({ code: 'USD', issuer: ISSUER });
  renderList();
  // Kontodaten (Signer/Thresholds) sind asynchron geladen, bevor abgeschickt wird.
  await new Promise((r) => setTimeout(r, 0));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('trustline:add.submit') }));
}

describe('ListTrustlines: Trustline anlegen, Signierweg', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => { setMainMounted(true); consumePendingTrustlineAsset(); });
  afterEach(() => { setMainMounted(false); });

  it('Multisig-Konto: fragt zuerst, ob lokal signiert oder ein Job angelegt wird', async () => {
    hoisted.account = {
      signers: [{ key: PK, weight: 1 }, { key: SECOND, weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
    };
    await submitAdd();
    expect(await screen.findByRole('button', { name: i18n.t('multisig:confirm.prepareButton') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('multisig:confirm.testModeButton') })).toBeInTheDocument();
  });

  it('Einzelkonto: geht wie bisher direkt zur Secret-Key-Eingabe', async () => {
    hoisted.account = { signers: [{ key: PK, weight: 1 }], thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 } };
    await submitAdd();
    expect(screen.queryByRole('button', { name: i18n.t('multisig:confirm.prepareButton') })).toBeNull();
  });
});

describe('ListTrustlines: Netz kommt von main.jsx', () => {
  afterEach(() => window.localStorage.removeItem('SKM_NETWORK'));

  it('laedt Signer und Thresholds mit dem heruntergereichten Netz, nicht aus localStorage', async () => {
    resetServerNetworkCalls();
    hoisted.account = { signers: [{ key: PK, weight: 1 }], thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 } };
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    renderList({ network: 'TESTNET' });
    await new Promise((r) => setTimeout(r, 0));
    expect(serverNetworkCalls).toEqual(['TESTNET']);
  });
});
