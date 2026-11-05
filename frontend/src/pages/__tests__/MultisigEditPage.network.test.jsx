import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, Networks, Transaction } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import MultisigEditPage from '../MultisigEditPage.jsx';
import { setGlobalNetwork } from '../../utils/globalNetwork.js';
import { resetServerNetworkCalls, serverNetworkCalls } from '../../test/horizonMock.js';

const PK = Keypair.random().publicKey();
const TESTNET_SIGNER = Keypair.random().publicKey();

// Je Netz ein anderes Konto: Testnet mit einem Zusatz-Signer und Thresholds 1/1/1,
// Mainnet ohne Zusatz-Signer mit 0/0/0 (oder gar nicht vorhanden).
const hoisted = vi.hoisted(() => ({ loads: [], publicMissing: false, delayTestnet: null }));
vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await importOriginal()),
  getHorizonServer: (url) => ({
    loadAccount: async (pk) => {
      const isTest = String(url).includes('testnet');
      hoisted.loads.push(isTest ? 'TESTNET' : 'PUBLIC');
      if (isTest && hoisted.delayTestnet) await hoisted.delayTestnet;
      if (!isTest && hoisted.publicMissing) throw new Error('Not Found');
      const acct = new Account(pk, '100');
      acct.account_id = pk;
      if (isTest) {
        acct.signers = [
          { key: pk, weight: 1, type: 'ed25519_public_key' },
          { key: TESTNET_SIGNER, weight: 1, type: 'ed25519_public_key' },
        ];
        acct.thresholds = { low_threshold: 1, med_threshold: 1, high_threshold: 1 };
      } else {
        acct.signers = [{ key: pk, weight: 1, type: 'ed25519_public_key' }];
        acct.thresholds = { low_threshold: 0, med_threshold: 0, high_threshold: 0 };
      }
      return acct;
    },
    submitTransaction: async () => ({ hash: 'h' }),
  }),
}));
vi.mock('../../utils/stellar/fees.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveFeePerOp: async () => '100',
}));
vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: async () => '',
}));
vi.mock('../../components/MultisigPrepareDialog.jsx', () => ({
  default: ({ hash }) => <div data-testid="prepared-hash">{hash}</div>,
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MultisigEditPage defaultPublicKey={PK} />
    </I18nextProvider>
  );
}

const thresholdInput = (container, labelKey) => {
  const text = i18n.t(labelKey);
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent.trim().startsWith(text));
  return label?.querySelector('input');
};
const signerInputs = (container) => Array.from(container.querySelectorAll('input')).filter((i) => i.placeholder === 'G...');
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const loadedText = (count) => i18n.t('common:multisigEdit.loaded', { count });

describe('MultisigEditPage: Netz kommt aus dem globalen Netz', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    window.localStorage.clear();
    hoisted.loads.length = 0;
    hoisted.publicMissing = false;
    hoisted.delayTestnet = null;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'job-1' }) }));
  });

  it('hat keinen eigenen Netzschalter, zeigt das globale Netz und folgt einem Wechsel', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container } = renderPage();
    await screen.findByText(loadedText(1));
    expect(container.querySelector('input[name="network"]')).toBeNull();
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(screen.getByTestId('multisig-edit-network-badge').textContent).toBe(i18n.t('common:badges.testnet'));
    expect(screen.getByTestId('multisig-edit-network').textContent).toContain(i18n.t('common:multisigEdit.networkHint'));

    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(screen.getByTestId('multisig-edit-network-badge').textContent).toBe(i18n.t('common:badges.mainnet'));
    await screen.findByText(loadedText(0));
    expect(hoisted.loads).toEqual(['TESTNET', 'PUBLIC']);
  });

  it('baut die Transaktion mit der Passphrase des globalen Netzes und legt den Job dort an', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container } = renderPage();
    await screen.findByText(loadedText(1));
    // Low 1 -> 0: aendert nur Thresholds, ohne Lockout-Risiko (kein Bestaetigungshaken noetig)
    await act(async () => { fireEvent.change(thresholdInput(container, 'multisigConfig:thresholdLow'), { target: { value: '0' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('common:multisigEdit.save') })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:actions.createMultisigJob') })); });

    const hash = (await screen.findByTestId('prepared-hash')).textContent;
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.network).toBe('testnet');
    expect(toHex(new Transaction(body.txXdr, Networks.TESTNET).hash())).toBe(hash);
    expect(toHex(new Transaction(body.txXdr, Networks.PUBLIC).hash())).not.toBe(hash);
  });

  it('Server mit dem Netz der Seite; Wechsel in einem anderen Tab waehrend des Baus: kein Job', async () => {
    resetServerNetworkCalls();
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container } = renderPage();
    await screen.findByText(loadedText(1));
    await act(async () => { fireEvent.change(thresholdInput(container, 'multisigConfig:thresholdLow'), { target: { value: '0' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('common:multisigEdit.save') })); });
    let release;
    hoisted.delayTestnet = new Promise((r) => { release = r; });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:actions.createMultisigJob') })); });
    // Anderer Tab wechselt, das Event ist hier noch nicht angekommen.
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });

    await screen.findByText(i18n.t('createAccount:networkChanged.funderAborted'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(serverNetworkCalls.length).toBeGreaterThan(0);
    expect(serverNetworkCalls.every((n) => n === 'TESTNET')).toBe(true);
  });

  it('globaler Wechsel bei offener Seite: Eingaben verworfen, Konto aus dem neuen Netz geladen', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container } = renderPage();
    await screen.findByText(loadedText(1));
    expect(signerInputs(container).map((i) => i.value)).toEqual([TESTNET_SIGNER]);
    // Eingaben fuer Testnet aendern und Bestaetigungsdialog oeffnen
    await act(async () => { fireEvent.change(thresholdInput(container, 'multisigConfig:thresholdMed'), { target: { value: '2' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('common:multisigEdit.save') })); });
    expect(screen.getByRole('button', { name: i18n.t('multisig:actions.createMultisigJob') })).toBeInTheDocument();

    await act(async () => { setGlobalNetwork('PUBLIC'); });
    await screen.findByText(loadedText(0));
    expect(screen.queryByRole('button', { name: i18n.t('multisig:actions.createMultisigJob') })).toBeNull();
    expect(signerInputs(container)).toEqual([]);
    expect(thresholdInput(container, 'multisigConfig:thresholdMed').value).toBe('0');
    expect(screen.getByTestId('multisig-edit-network-notice').textContent).toBe(i18n.t('common:multisigEdit.networkChanged'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('Konto fehlt im neuen Netz: Eingaben des alten Netzes bleiben nicht stehen', async () => {
    hoisted.publicMissing = true;
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container } = renderPage();
    await screen.findByText(loadedText(1));
    await act(async () => { fireEvent.change(thresholdInput(container, 'multisigConfig:thresholdHigh'), { target: { value: '2' } }); });
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    await screen.findByText('Not Found');
    expect(signerInputs(container)).toEqual([]);
    expect(thresholdInput(container, 'multisigConfig:thresholdHigh').value).toBe('0');
  });

  it('spaet eintreffendes Konto aus dem alten Netz ueberschreibt nichts', async () => {
    let release;
    hoisted.delayTestnet = new Promise((resolve) => { release = resolve; });
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container } = renderPage();
    await waitFor(() => expect(hoisted.loads).toEqual(['TESTNET']));
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    await screen.findByText(loadedText(0));
    await act(async () => { release(); await Promise.resolve(); });
    expect(signerInputs(container)).toEqual([]);
    expect(screen.queryByText(loadedText(1))).toBeNull();
  });

  it('bricht ab, wenn das gespeicherte Netz nicht mehr zur Seite passt', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { container } = renderPage();
    await screen.findByText(loadedText(1));
    // Low 1 -> 0: aendert nur Thresholds, ohne Lockout-Risiko (kein Bestaetigungshaken noetig)
    await act(async () => { fireEvent.change(thresholdInput(container, 'multisigConfig:thresholdLow'), { target: { value: '0' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('common:multisigEdit.save') })); });
    // Netz geaendert, ohne dass diese Seite ein Event bekam
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:actions.createMultisigJob') })); });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain(i18n.t('common:multisigEdit.networkChanged'));
  });
});
