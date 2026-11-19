import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, Networks, Transaction } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import MultisigEditPage from '../MultisigEditPage.jsx';

// Signieren in MultisigEditPage (ADR 0012, Teilschritt 3):
// - Stelle 9: Die Erstsignatur beim Job-Anlegen mit dem gemerkten Key bleibt optional.
// - K3: Beim direkten Speichern wird ein Signierfehler angezeigt, nichts wird gesendet.
const master = Keypair.random();
const PK = master.publicKey();
const OTHER = Keypair.random().publicKey();

const hoisted = vi.hoisted(() => ({ failSigning: false, sessionSecret: '', submits: [], thresholds: null, rememberMock: vi.fn() }));
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
vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: async (pk) => {
      const acct = new Account(pk, '100');
      acct.account_id = pk;
      acct.signers = [
        { key: pk, weight: 1, type: 'ed25519_public_key' },
        { key: OTHER, weight: 1, type: 'ed25519_public_key' },
      ];
      acct.thresholds = hoisted.thresholds || { low_threshold: 1, med_threshold: 1, high_threshold: 1 };
      return acct;
    },
    submitTransaction: async (tx) => { hoisted.submits.push(tx); if (hoisted.submitError) throw hoisted.submitError; return { hash: 'h' }; },
  }),
}));
vi.mock('../../utils/stellar/fees.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveFeePerOp: async () => '100',
}));
vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: async () => hoisted.sessionSecret,
  rememberAfterSuccess: hoisted.rememberMock,
}));
vi.mock('../../components/MultisigPrepareDialog.jsx', () => ({
  default: ({ hash, jobStatus, submitReason }) => (
    <div data-testid="prepared-hash" data-status={jobStatus || ''} data-reason={submitReason || ''}>{hash}</div>
  ),
}));

const thresholdInput = (container, labelKey) => {
  const text = i18n.t(labelKey);
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent.trim().startsWith(text));
  return label?.querySelector('input');
};

async function renderAndChangeLow() {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MultisigEditPage defaultPublicKey={PK} />
    </I18nextProvider>
  );
  await screen.findByText(i18n.t('common:multisigEdit.loaded', { count: 1 }));
  await act(async () => { fireEvent.change(thresholdInput(view.container, 'multisigConfig:thresholdLow'), { target: { value: '0' } }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('common:multisigEdit.save') })); });
  return view;
}

async function createJob() {
  await renderAndChangeLow();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:actions.createMultisigJob') })); });
  await screen.findByTestId('prepared-hash');
  const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
  return { body, tx: new Transaction(body.txXdr, Networks.TESTNET) };
}

describe('MultisigEditPage: Signieren (Teilschritt 3)', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    hoisted.failSigning = false;
    hoisted.sessionSecret = '';
    hoisted.submits.length = 0;
    hoisted.thresholds = null;
    hoisted.rememberMock.mockReset().mockResolvedValue(true);
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'job-1' }) }));
  });

  it('Stelle 9 Gegenprobe: mit gemerktem Key wird der Job mit Erstsignatur angelegt', async () => {
    hoisted.sessionSecret = master.secret();
    const { body, tx } = await createJob();
    expect(tx.signatures).toHaveLength(1);
    expect(body.clientCollected).toEqual([{ publicKey: PK, weight: 1 }]);
  });

  it('Erstsignatur meldet das Gewicht laut aktuellem Konto, nicht das geplante Master-Gewicht', async () => {
    hoisted.sessionSecret = master.secret();
    const view = await (async () => {
      const v = render(
        <I18nextProvider i18n={i18n}>
          <MultisigEditPage defaultPublicKey={PK} />
        </I18nextProvider>
      );
      await screen.findByText(i18n.t('common:multisigEdit.loaded', { count: 1 }));
      return v;
    })();
    // Label und Eingabe sind Geschwister (MultisigConfigForm): erstes input nach dem Label.
    const masterLabel = Array.from(view.container.querySelectorAll('label'))
      .find((l) => l.textContent.trim().startsWith(i18n.t('multisigConfig:masterWeight')));
    const masterInput = masterLabel.parentElement.querySelector('input');
    await act(async () => { fireEvent.change(masterInput, { target: { value: '3' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('common:multisigEdit.save') })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:actions.createMultisigJob') })); });
    await screen.findByTestId('prepared-hash');
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.clientCollected).toEqual([{ publicKey: PK, weight: 1 }]);
    expect(body.signers.find((x) => x.publicKey === PK).weight).toBe(3);
  });

  it('Sendet das Backend beim Anlegen (Erstsignatur reicht), geht der Status mit Grund an den Dialog', async () => {
    hoisted.sessionSecret = master.secret();
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({
      id: 'job-1', status: 'submit_unclear', submittedResult: { error: 'Timeout', detail: { message: 'Timeout', extras: {} } },
    }) }));
    await createJob();
    const dialog = screen.getByTestId('prepared-hash');
    expect(dialog.dataset.status).toBe('submit_unclear');
    expect(dialog.dataset.reason).toBe('Timeout');
  });

  it('Stelle 9: scheitert die Erstsignatur, wird der Job unsigniert angelegt, ohne Fehler in der UI', async () => {
    hoisted.sessionSecret = master.secret();
    hoisted.failSigning = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { body, tx } = await createJob();
    expect(tx.signatures).toHaveLength(0);
    expect(body.clientCollected).toEqual([]);
    expect(screen.queryByText(i18n.t('errors:submitTransaction.failed.signingFailed'), { exact: false })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('K3: Signierfehler beim direkten Speichern wird angezeigt, nichts wird gesendet', async () => {
    hoisted.failSigning = true;
    await renderAndChangeLow();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:confirm.testModeButton') })); });
    const input = document.querySelector('input[type="password"]');
    await act(async () => { fireEvent.change(input, { target: { value: master.secret() } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('publicKey:submit.button') })); });
    expect(await screen.findByText(i18n.t('errors:submitTransaction.failed.signingFailed'), { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/submitTransaction\.failed/)).toBeNull();
    expect(hoisted.submits).toHaveLength(0);
    expect(hoisted.rememberMock).not.toHaveBeenCalled();
  });

  it('K3 Gegenprobe: ohne Fehler wird signiert gesendet', async () => {
    await renderAndChangeLow();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:confirm.testModeButton') })); });
    const input = document.querySelector('input[type="password"]');
    await act(async () => { fireEvent.change(input, { target: { value: master.secret() } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('publicKey:submit.button') })); });
    await screen.findByText(i18n.t('common:multisigEdit.saved', { hash: 'h' }));
    expect(hoisted.submits).toHaveLength(1);
    expect(hoisted.submits[0].signatures).toHaveLength(1);
    // Merken nach Erfolg (17.11.): Haken standardmaessig an, Netz des Ablaufs.
    await waitFor(() => expect(hoisted.rememberMock).toHaveBeenCalledTimes(1));
    const [account, collected, remember, network] = hoisted.rememberMock.mock.calls[0];
    expect(account).toBe(PK);
    expect(collected[0].keypair.publicKey()).toBe(PK);
    expect(remember).toBe(true);
    expect(network).toBe('TESTNET');
  });

  it('op_low_reserve von Horizon erscheint als Hinweis auf die Reserve, nicht als 400 Bad Request', async () => {
    const err = new Error('Transaction submission failed. Server responded: 400 Bad Request');
    err.response = { data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['op_success', 'op_low_reserve', 'op_success'] } } } };
    hoisted.submitError = err;
    try {
      await renderAndChangeLow();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:confirm.testModeButton') })); });
      const input = document.querySelector('input[type="password"]');
      await act(async () => { fireEvent.change(input, { target: { value: master.secret() } }); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('publicKey:submit.button') })); });
      expect(await screen.findByText(i18n.t('errors:submitTransaction.failed.multisig.lowReserve'))).toBeInTheDocument();
      expect(screen.queryByText(/400 Bad Request/)).toBeNull();
    } finally {
      hoisted.submitError = null;
    }
  });

  it('B1: Fehler mit Praefix (zu wenig Gewicht) erscheinen uebersetzt, nicht als roher Schluessel', async () => {
    hoisted.thresholds = { low_threshold: 1, med_threshold: 2, high_threshold: 2 };
    await renderAndChangeLow();
    // 2 von 2 ohne Redundanz: Risiko bestaetigen, sonst bleibt der Knopf gesperrt.
    await act(async () => { fireEvent.click(screen.getByLabelText(i18n.t('common:multisigEdit.risk.acknowledge'))); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:confirm.testModeButton') })); });
    // Nur der Master-Key (Gewicht 1), High verlangt 2.
    const input = document.querySelector('input[type="password"]');
    await act(async () => { fireEvent.change(input, { target: { value: master.secret() } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('publicKey:submit.button') })); });
    const first = i18n.t('errors:submitTransaction.failed.multisig.insufficientWeight').split('{{')[0].trim().slice(0, 20);
    expect(await screen.findByText(first, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/submitTransaction\.failed/)).toBeNull();
    expect(hoisted.submits).toHaveLength(0);
  });
});
