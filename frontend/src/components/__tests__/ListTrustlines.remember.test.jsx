import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import ListTrustlines from '../ListTrustlines.jsx';

// Merken nach Erfolg (17.11.): Der Haken im Key-Dialog galt beim Loeschen nicht, gemerkt wurde nie.
const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const TL_A = { assetCode: 'AAA', assetIssuer: ISSUER, assetType: 'credit_alphanum4', assetBalance: '0', limit: '1', createdAt: 'unknown' };

const hoisted = vi.hoisted(() => ({ deleteMock: vi.fn(), loadTrustlinesMock: vi.fn(), rememberMock: vi.fn(), remember: true, collected: null }));
vi.mock('../../utils/stellar/stellarUtils.js', async (orig) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await orig()),
  getHorizonServer: () => ({ loadAccount: async () => ({}) }),
  deleteTrustlinesInChunks: hoisted.deleteMock,
  loadTrustlines: hoisted.loadTrustlinesMock,
}));
vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  rememberAfterSuccess: hoisted.rememberMock,
}));
vi.mock('../SecretKeyModal.jsx', async () => {
  const { Keypair } = await import('@stellar/stellar-sdk');
  return {
    default: ({ onConfirm, network }) => (
      <button type="button" data-testid="secret-confirm" data-network={network} onClick={() => {
        const kp = Keypair.random();
        hoisted.collected = [{ keypair: kp, publicKey: kp.publicKey(), weight: 1 }];
        onConfirm(hoisted.collected, hoisted.remember);
      }}>confirm</button>
    ),
  };
});

function Harness() {
  const [trustlines, setTrustlines] = useState([TL_A]);
  const [selected, setSelected] = useState([TL_A]);
  const [processing, setProcessing] = useState(false);
  return (
    <ListTrustlines
      network="TESTNET"
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
  const button = await screen.findByTestId('secret-confirm');
  expect(button.dataset.network).toBe('TESTNET');
  await act(async () => { fireEvent.click(button); });
}

describe('ListTrustlines: Keys nach erfolgreichem Loeschen merken', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    hoisted.deleteMock.mockReset();
    hoisted.loadTrustlinesMock.mockReset().mockResolvedValue([]);
    hoisted.rememberMock.mockReset().mockResolvedValue(true);
    hoisted.remember = true;
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
  });

  it('merkt die Keys mit Haken nach Erfolg, im Netz der Ansicht', async () => {
    hoisted.deleteMock.mockResolvedValue([TL_A]);
    render(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>);
    await deleteSelected();
    await waitFor(() => expect(hoisted.rememberMock).toHaveBeenCalledTimes(1));
    expect(hoisted.rememberMock).toHaveBeenCalledWith(PK, hoisted.collected, true, 'TESTNET', expect.any(Number));
  });

  it('Haken entfernt: Helfer bekommt remember=false', async () => {
    hoisted.remember = false;
    hoisted.deleteMock.mockResolvedValue([TL_A]);
    render(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>);
    await deleteSelected();
    await waitFor(() => expect(hoisted.rememberMock).toHaveBeenCalledTimes(1));
    expect(hoisted.rememberMock.mock.calls[0][2]).toBe(false);
  });

  it('Gegenprobe: Loeschen scheitert, nichts gemerkt', async () => {
    hoisted.deleteMock.mockRejectedValue(Object.assign(new Error('http 500'), { deleted: [], total: 1 }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<I18nextProvider i18n={i18n}><Harness /></I18nextProvider>);
    await deleteSelected();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(hoisted.rememberMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
