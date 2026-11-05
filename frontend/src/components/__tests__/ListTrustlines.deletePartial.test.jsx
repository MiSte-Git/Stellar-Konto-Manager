import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import ListTrustlines from '../ListTrustlines.jsx';

// Review N2-2: Bricht das Loeschen nach einem Block ab (z. B. Netzwechsel), muessen die schon
// geloeschten Trustlines aus Liste und Auswahl verschwinden und der Hinweis erledigt/offen nennen.
const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const TL_A = { assetCode: 'AAA', assetIssuer: ISSUER, assetType: 'credit_alphanum4', assetBalance: '0', limit: '1', createdAt: 'unknown' };
const TL_B = { assetCode: 'BBB', assetIssuer: ISSUER, assetType: 'credit_alphanum4', assetBalance: '0', limit: '1', createdAt: 'unknown' };

const hoisted = vi.hoisted(() => ({ deleteMock: vi.fn(), loadTrustlinesMock: vi.fn() }));
vi.mock('../../utils/stellar/stellarUtils.js', async (orig) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await orig()),
  // Ohne Signer-Daten ueberspringt ListTrustlines die Gewichtspruefung (Test-Keypair ist zufaellig).
  getHorizonServer: () => ({ loadAccount: async () => ({}) }),
  deleteTrustlinesInChunks: hoisted.deleteMock,
  loadTrustlines: hoisted.loadTrustlinesMock,
}));
// Secret-Key-Abfrage ersetzen: ein Klick bestaetigt mit einem Test-Keypair
vi.mock('../SecretKeyModal.jsx', async () => {
  const { Keypair } = await import('@stellar/stellar-sdk');
  return {
    default: ({ onConfirm }) => (
      <button type="button" data-testid="secret-confirm" onClick={() => {
        const kp = Keypair.random();
        onConfirm([{ keypair: kp, publicKey: kp.publicKey(), weight: 1 }]);
      }}>confirm</button>
    ),
  };
});

const state = {};
function Harness({ network }) {
  const [trustlines, setTrustlines] = useState([TL_A, TL_B]);
  const [selected, setSelected] = useState([TL_A, TL_B]);
  const [processing, setProcessing] = useState(false);
  state.trustlines = trustlines;
  state.selected = selected;
  return (
    <ListTrustlines
      network={network}
      trustlines={trustlines} itemsPerPage={10} currentPage={0} sortColumn="assetCode" sortDirection="asc"
      onSort={() => {}} filters={{}} onFilterChange={() => {}} selectedTrustlines={selected} onToggleAll={() => {}}
      setSelectedTrustlines={setSelected} results={[]} setResults={() => {}} setMenuSelection={() => {}}
      menuSelection="listAll" setSecretKey={() => {}} publicKey={PK} setTrustlines={setTrustlines}
      isProcessing={processing} deleteProgress={null} setIsProcessing={setProcessing} setDeleteProgress={() => {}}
      setInfoMessage={() => {}}
    />
  );
}

async function deleteSelected() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  fireEvent.click(screen.getAllByRole('button', { name: i18n.t('trustline:delete') })[0]);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('multisig:confirm.testModeButton') }));
  await act(async () => { fireEvent.click(await screen.findByTestId('secret-confirm')); });
}

describe('ListTrustlines: Abbruch nach einem Teil der Bloecke (N2-2)', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    hoisted.deleteMock.mockReset();
    hoisted.loadTrustlinesMock.mockReset();
    window.localStorage.clear();
  });

  it('Netzwechsel nach dem ersten Block: Geloeschte aus Liste und Auswahl, Hinweis mit erledigt und offen', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET'); // inzwischen gewechselt
    hoisted.deleteMock.mockRejectedValue(Object.assign(
      new Error('createAccount:networkChanged.stoppedAfterPartial'),
      { code: 'network_changed', deleted: [{ ...TL_A, txId: 'tx1' }], total: 2 },
    ));
    render(<I18nextProvider i18n={i18n}><Harness network="PUBLIC" /></I18nextProvider>);
    await deleteSelected();

    const partial = i18n.t('trustline:deleted.partial', { done: 1, total: 2, open: 1 });
    expect((await screen.findAllByText(partial)).length).toBeGreaterThan(0);
    await waitFor(() => expect(state.trustlines).toEqual([TL_B]));
    expect(state.selected).toEqual([TL_B]);
    // Nach dem Netzwechsel nicht aus dem neuen Netz nachladen (das macht main.jsx)
    expect(hoisted.loadTrustlinesMock).not.toHaveBeenCalled();
  });

  it('gleiches Netz: nach dem Teilerfolg zusaetzlich frisch laden', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    hoisted.deleteMock.mockRejectedValue(Object.assign(new Error('http 500'), { deleted: [TL_A], total: 2 }));
    hoisted.loadTrustlinesMock.mockResolvedValue([TL_B]);
    render(<I18nextProvider i18n={i18n}><Harness network="PUBLIC" /></I18nextProvider>);
    await deleteSelected();
    await waitFor(() => expect(hoisted.loadTrustlinesMock).toHaveBeenCalledTimes(1));
    expect(state.trustlines).toEqual([TL_B]);
    expect(state.selected).toEqual([TL_B]);
  });
});
