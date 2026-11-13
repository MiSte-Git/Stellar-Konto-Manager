import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Buffer } from 'buffer';
import { Account, Keypair, Networks, StrKey, Transaction } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import MultisigEditPage from '../MultisigEditPage.jsx';

// Korrektur K1 (ADR 0012, Signer-Buendelung): Ein Signed-Payload-Signer (P-Adresse) ist kein
// bearbeitbarer Ed25519-Signer. Er darf das Speichern nicht blockieren und bleibt unveraendert.
const PK = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const PAYLOAD = Buffer.from([1, 2, 3, 4]);
const P_SIGNER = StrKey.encodeSignedPayload(Buffer.concat([
  StrKey.decodeEd25519PublicKey(Keypair.random().publicKey()),
  Buffer.from([0, 0, 0, PAYLOAD.length]),
  PAYLOAD,
]));

vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: async (pk) => {
      const acct = new Account(pk, '100');
      acct.account_id = pk;
      acct.signers = [
        { key: pk, weight: 1, type: 'ed25519_public_key' },
        { key: OTHER, weight: 1, type: 'ed25519_public_key' },
        { key: P_SIGNER, weight: 1, type: 'ed25519_signed_payload' },
      ];
      acct.thresholds = { low_threshold: 1, med_threshold: 1, high_threshold: 1 };
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

const thresholdInput = (container, labelKey) => {
  const text = i18n.t(labelKey);
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent.trim().startsWith(text));
  return label?.querySelector('input');
};
const signerInputs = (container) => Array.from(container.querySelectorAll('input')).filter((i) => i.placeholder === 'G...');

describe('MultisigEditPage: Signed-Payload-Signer (K1)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'job-1' }) }));
  });

  it('zeigt den P-Signer nicht als bearbeitbare Zeile und blockiert das Speichern nicht', async () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MultisigEditPage defaultPublicKey={PK} />
      </I18nextProvider>
    );
    // Geladen: genau ein bearbeitbarer Zusatz-Signer (OTHER), der P-Signer zaehlt nicht mit.
    await screen.findByText(i18n.t('common:multisigEdit.loaded', { count: 1 }));
    const rows = signerInputs(container);
    expect(rows.map((i) => i.value)).toEqual([OTHER]);
    expect(rows.some((i) => i.value === P_SIGNER)).toBe(false);

    await act(async () => { fireEvent.change(thresholdInput(container, 'multisigConfig:thresholdLow'), { target: { value: '0' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('common:multisigEdit.save') })); });
    expect(screen.queryByText(i18n.t('common:multisigEdit.validation.signerKeyInvalid'))).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:actions.createMultisigJob') })); });

    await screen.findByTestId('prepared-hash');
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    const tx = new Transaction(body.txXdr, Networks.TESTNET);
    // Nur die Threshold-Aenderung, keine Operation fasst irgendeinen Signer an (auch den P-Signer nicht).
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0].type).toBe('setOptions');
    expect(tx.operations[0].lowThreshold).toBe(0);
    expect(tx.operations[0].signer).toBeUndefined();
  });
});
