import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import ListTrustlines from '../ListTrustlines.jsx';
import { consumePendingTrustlineAsset, openAddTrustline, setMainMounted } from '../../utils/appNavigation.js';

// K3 (ADR 0012, Teilschritt 3): Ein Signierfehler beim Anlegen einer Trustline wird angezeigt,
// statt verschluckt zu werden; nichts wird gesendet.
const master = Keypair.random();
const PK = master.publicKey();
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const other = Keypair.random();
// F-15: Signer des Kontos laut Horizon und die im Key-Dialog eingegebenen Keys, je Test einstellbar.
const hoisted = vi.hoisted(() => ({ failSigning: false, submits: [], extraSigners: [], collected: null, rememberMock: vi.fn() }));
vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  rememberAfterSuccess: hoisted.rememberMock,
}));
vi.mock('../../utils/signers/signTransaction.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    attachSignatures: (tx, collected) => {
      if (hoisted.failSigning) throw new Error(orig.SIGNING_FAILED_ERROR);
      return orig.attachSignatures(tx, collected);
    },
  };
});
vi.mock('../../utils/stellar/stellarUtils.js', async (orig) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await orig()),
  getHorizonServer: () => ({
    loadAccount: async (pk) => {
      const acct = new Account(pk, '100');
      acct.signers = [{ key: pk, weight: 1, type: 'ed25519_public_key' }, ...hoisted.extraSigners];
      acct.thresholds = { low_threshold: 0, med_threshold: 0, high_threshold: 0 };
      return acct;
    },
    submitTransaction: async (tx) => { hoisted.submits.push(tx); return { hash: 'h' }; },
  }),
  loadTrustlines: async () => [],
}));
vi.mock('../../utils/stellar/fees.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveFeePerOp: async () => '100',
}));
vi.mock('../SecretKeyModal.jsx', () => ({
  default: ({ onConfirm }) => (
    <button type="button" data-testid="secret-confirm" onClick={() => onConfirm(hoisted.collected || [{ keypair: master, publicKey: PK, weight: 1 }], true)}>confirm</button>
  ),
}));

async function addTrustline() {
  openAddTrustline({ code: 'USD', issuer: ISSUER });
  render(
    <I18nextProvider i18n={i18n}>
      <ListTrustlines
        network="TESTNET"
        trustlines={[]} itemsPerPage={10} currentPage={0} sortColumn="assetCode" sortDirection="asc"
        onSort={() => {}} filters={{}} onFilterChange={() => {}} selectedTrustlines={[]} onToggleAll={() => {}}
        setSelectedTrustlines={() => {}} results={[]} setResults={() => {}} setMenuSelection={() => {}}
        menuSelection="listAll" setSecretKey={() => {}} publicKey={PK} setTrustlines={() => {}}
        isProcessing={false} deleteProgress={null} setIsProcessing={() => {}} setDeleteProgress={() => {}}
        setInfoMessage={() => {}}
      />
    </I18nextProvider>
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('trustline:add.submit') }));
  await act(async () => { fireEvent.click(await screen.findByTestId('secret-confirm')); });
}

describe('ListTrustlines: Signierfehler beim Anlegen (K3)', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    setMainMounted(true);
    consumePendingTrustlineAsset();
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    hoisted.failSigning = false;
    hoisted.submits.length = 0;
    hoisted.extraSigners = [];
    hoisted.collected = null;
    hoisted.rememberMock.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    setMainMounted(false);
    window.localStorage.removeItem('SKM_NETWORK');
  });

  it('zeigt den Fehler uebersetzt und sendet nichts', async () => {
    hoisted.failSigning = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await addTrustline();
    const text = i18n.t('errors:submitTransaction.failed.signingFailed');
    expect((await screen.findAllByText(text, { exact: false })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/submitTransaction\.failed/)).toBeNull();
    expect(hoisted.submits).toHaveLength(0);
    err.mockRestore();
  });

  it('Gegenprobe: ohne Fehler wird mit genau einer Signatur gesendet', async () => {
    await addTrustline();
    await waitFor(() => expect(hoisted.submits).toHaveLength(1));
    expect(hoisted.submits[0].signatures).toHaveLength(1);
    // Merken nach Erfolg (17.11.): Haken wird an den Helfer weitergegeben, im Netz der Ansicht.
    await waitFor(() => expect(hoisted.rememberMock).toHaveBeenCalledTimes(1));
    expect(hoisted.rememberMock.mock.calls[0][0]).toBe(PK);
    expect(hoisted.rememberMock.mock.calls[0][2]).toBe(true);
    expect(hoisted.rememberMock.mock.calls[0][3]).toBe('TESTNET');
  });

  it('Gegenprobe Merken: Signierfehler, nichts gemerkt', async () => {
    hoisted.failSigning = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await addTrustline();
    await screen.findAllByText(i18n.t('errors:submitTransaction.failed.signingFailed'), { exact: false });
    expect(hoisted.rememberMock).not.toHaveBeenCalled();
    err.mockRestore();
  });

  // F-15 (Review Fable): Angehaengt werden nur Signaturen von Keys mit Gewicht (collectEffectiveSigners aus
  // jobRevocation.js), wie in den anderen Sendewegen. Vorher wurde jeder eingegebene Key signiert; ein Key
  // ohne Gewicht fuehrte zu tx_bad_auth_extra statt zu einer klaren Meldung.
  it('F-15: Key mit Gewicht 0 wird nicht signiert, der Key mit Gewicht schon', async () => {
    hoisted.extraSigners = [{ key: other.publicKey(), weight: 0, type: 'ed25519_public_key' }];
    hoisted.collected = [{ keypair: master, publicKey: PK, weight: 1 }, { keypair: other, publicKey: other.publicKey(), weight: 0 }];
    await addTrustline();
    await waitFor(() => expect(hoisted.submits).toHaveLength(1));
    expect(hoisted.submits[0].signatures).toHaveLength(1);
  });

  it('F-15: nur der Key mit Gewicht 0 eingegeben: nichts signiert, nichts gesendet', async () => {
    // Zusammen mit dem Fall davor: Die eine Signatur dort stammt vom Key mit Gewicht.
    hoisted.extraSigners = [{ key: other.publicKey(), weight: 0, type: 'ed25519_public_key' }];
    hoisted.collected = [{ keypair: other, publicKey: other.publicKey(), weight: 0 }];
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await addTrustline();
    expect((await screen.findAllByText(i18n.t('errors:submitTransaction.failed.multisig.noKeysProvided'), { exact: false })).length).toBeGreaterThan(0);
    expect(hoisted.submits).toHaveLength(0);
    err.mockRestore();
  });

  it('F-15: Key, der kein Signer des Kontos ist, wird nicht signiert', async () => {
    hoisted.collected = [{ keypair: master, publicKey: PK, weight: 1 }, { keypair: other, publicKey: other.publicKey(), weight: 1 }];
    await addTrustline();
    await waitFor(() => expect(hoisted.submits).toHaveLength(1));
    expect(hoisted.submits[0].signatures).toHaveLength(1);
  });

  it('F-15 Gegenprobe: zweiter Key mit Gewicht wird mitsigniert', async () => {
    hoisted.extraSigners = [{ key: other.publicKey(), weight: 1, type: 'ed25519_public_key' }];
    hoisted.collected = [{ keypair: master, publicKey: PK, weight: 1 }, { keypair: other, publicKey: other.publicKey(), weight: 1 }];
    await addTrustline();
    await waitFor(() => expect(hoisted.submits).toHaveLength(1));
    expect(hoisted.submits[0].signatures).toHaveLength(2);
  });

  it('F-15: derselbe Key zweimal eingegeben wird nur einmal signiert', async () => {
    hoisted.collected = [{ keypair: master, publicKey: PK, weight: 1 }, { keypair: master, publicKey: PK, weight: 1 }];
    await addTrustline();
    await waitFor(() => expect(hoisted.submits).toHaveLength(1));
    expect(hoisted.submits[0].signatures).toHaveLength(1);
  });
});
