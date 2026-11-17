import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import SecretKeyModal from '../SecretKeyModal.jsx';
import { Buffer } from 'buffer';
import { StrKey } from '@stellar/stellar-sdk';

// Two well-known valid testnet-style keypairs (also used by tradingTransactions.test.js).
const SIGNER_A = {
  secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
  publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
};
const SIGNER_B_ZERO_WEIGHT = {
  secret: 'SBFKGXZFIZJ5U2RZTPBZ3EUCKQQGT5APKWAHGTQCJQSLD4CXIIHOVYVO',
  publicKey: 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM',
};
const NOT_A_SIGNER_SECRET = 'SB555XN5SZZCKQXVGGJH656DHDOMWDJECNESCEDUAWLJPZ2PF2SXXLCU';

function renderModal(props = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SecretKeyModal
        onConfirm={() => {}}
        onCancel={() => {}}
        signers={[
          { public_key: SIGNER_A.publicKey, weight: 1 },
          { public_key: SIGNER_B_ZERO_WEIGHT.publicKey, weight: 0 },
        ]}
        {...props}
      />
    </I18nextProvider>
  );
}

// The secret input's placeholder/button text are translated (default locale: German),
// so select by input type / bilingual text match instead of hardcoding English strings.
function typeSecret(value) {
  const input = document.querySelector('input[type="password"], input[type="text"]');
  fireEvent.change(input, { target: { value } });
  return input;
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /senden|submit/i }));
}

// These checks are the security-relevant gate from finding A4: only a secret key
// belonging to a registered, non-zero-weight signer may be accepted.
describe('SecretKeyModal handleConfirm (A4 - signer validation)', () => {
  it('rejects a syntactically invalid secret and does not call onConfirm', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    typeSecret('not-a-valid-secret-key');
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects a syntactically valid secret that is not one of the account signers', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    typeSecret(NOT_A_SIGNER_SECRET);
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects a registered signer whose weight is 0', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    typeSecret(SIGNER_B_ZERO_WEIGHT.secret);
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('accepts a valid, non-zero-weight signer and reports its public key + weight', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    typeSecret(SIGNER_A.secret);
    submit();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [collected] = onConfirm.mock.calls[0];
    expect(collected).toHaveLength(1);
    expect(collected[0].publicKey).toBe(SIGNER_A.publicKey);
    expect(collected[0].weight).toBe(1);
  });

  it('rejects an empty submission with no keys entered', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('SecretKeyModal: Konto, fuer das signiert wird', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('zeigt das Konto aus accountId an', () => {
    renderModal({ accountId: SIGNER_A.publicKey });
    expect(screen.getByTestId('secret-modal-account')).toHaveTextContent(SIGNER_A.publicKey);
  });

  it('nimmt sonst die id des Horizon-Kontos', () => {
    renderModal({ account: { id: SIGNER_A.publicKey, signers: [{ key: SIGNER_A.publicKey, weight: 1 }], thresholds: {} } });
    expect(screen.getByTestId('secret-modal-account')).toHaveTextContent(SIGNER_A.publicKey);
  });

  it('zeigt keinen zweiten Kontohinweis, wenn ein subtitle gesetzt ist', () => {
    renderModal({ accountId: SIGNER_A.publicKey, subtitle: 'Secret Key fuer Sender' });
    expect(screen.queryByTestId('secret-modal-account')).toBeNull();
  });
});

// Korrektur K2 und K7 (ADR 0012, Signer-Buendelung): Typfilter und eine Definition von Multisig-Konto.
describe('SecretKeyModal: Signer-Regeln aus signerRules.js (K2, K7)', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  const ed = (publicKey, weight) => ({ key: publicKey, weight, type: 'ed25519_public_key' });
  const secretInputs = () => document.querySelectorAll('input[type="password"]');
  const infoButton = () => screen.queryByText(i18n.t('secretKey:showMultisigInfo'));
  const signerLabel = () => screen.queryByText(`${i18n.t('secretKey:multisigInfo.signers')}:`);
  const backButton = () => screen.queryByRole('button', { name: i18n.t('common:option.back') });
  const thresholdHint = (threshold, requiredSigners) => screen.queryByText(
    i18n.t('secretKey:multipleSignersThresholdInfo', { threshold, requiredSigners }),
  );

  describe('K2: nur interaktive Signer zaehlen', () => {
    const HASH_SIGNER = StrKey.encodeSha256Hash(Buffer.alloc(32, 7));

    it('Hash-Signer mit hohem Gewicht zaehlt nicht in die Zahl der Eingabefelder', () => {
      renderModal({
        signers: [
          ed(SIGNER_A.publicKey, 1),
          ed(SIGNER_B_ZERO_WEIGHT.publicKey, 1),
          { key: HASH_SIGNER, weight: 5, type: 'sha256_hash' },
        ],
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
        requiredThreshold: 2,
      });
      // Zwei Ed25519-Signer mit Gewicht 1 sind noetig; der Hash-Signer (5) erreicht die Schwelle nie allein.
      expect(secretInputs()).toHaveLength(2);
    });

    it('Gegenprobe: ohne Hash-Signer bleibt es bei zwei Eingabefeldern', () => {
      renderModal({
        signers: [ed(SIGNER_A.publicKey, 1), ed(SIGNER_B_ZERO_WEIGHT.publicKey, 1)],
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
        requiredThreshold: 2,
      });
      expect(secretInputs()).toHaveLength(2);
    });
  });

  describe('K7: Regel A gilt (signers > 1 oder high > 1)', () => {
    it('F1: ein Signer, Schwellen 1/1/1: keine Multisig-Anzeige', () => {
      renderModal({
        signers: [ed(SIGNER_A.publicKey, 1)],
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        requiredThreshold: 1,
        onBackToSelection: () => {},
      });
      expect(backButton()).toBeNull();
      expect(infoButton()).toBeNull();
      expect(signerLabel()).toBeNull();
      expect(thresholdHint(1, 1)).toBeNull();
    });

    it('F2: ein Signer, med 0 und high 2: alle vier Anzeigen erscheinen', () => {
      renderModal({
        signers: [ed(SIGNER_A.publicKey, 2)],
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 2 },
        requiredThreshold: 2,
        onBackToSelection: () => {},
      });
      expect(backButton()).not.toBeNull();
      expect(infoButton()).not.toBeNull();
      expect(signerLabel()).not.toBeNull();
      expect(thresholdHint(2, 1)).not.toBeNull();
    });

    it('F2 ohne onBackToSelection: kein Zurueck-Knopf, die uebrigen Anzeigen bleiben', () => {
      renderModal({
        signers: [ed(SIGNER_A.publicKey, 2)],
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 2 },
        requiredThreshold: 2,
      });
      expect(backButton()).toBeNull();
      expect(infoButton()).not.toBeNull();
    });

    it('Gegenprobe: echtes Multisig-Konto (zwei Signer, 1/2/2) zeigt dieselben Anzeigen wie vorher', () => {
      renderModal({
        signers: [ed(SIGNER_A.publicKey, 1), ed(SIGNER_B_ZERO_WEIGHT.publicKey, 1)],
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
        requiredThreshold: 2,
        onBackToSelection: () => {},
      });
      expect(backButton()).not.toBeNull();
      expect(infoButton()).not.toBeNull();
      expect(signerLabel()).not.toBeNull();
      expect(thresholdHint(2, 2)).not.toBeNull();
    });

    it('B2: Konto noch nicht geladen (Signer bekannt, keine Schwellen): keine Multisig-Anzeige', () => {
      // Alle Aufrufer geben Schwellen aus dem geladenen Horizon-Konto; ohne sie gilt Regel A nicht.
      renderModal({
        signers: [ed(SIGNER_A.publicKey, 1), ed(SIGNER_B_ZERO_WEIGHT.publicKey, 1)],
        thresholds: null,
        onBackToSelection: () => {},
      });
      expect(backButton()).toBeNull();
      expect(infoButton()).toBeNull();
    });

    it.each([
      ['F1', { low_threshold: 1, med_threshold: 1, high_threshold: 1 }, 1],
      ['F2', { low_threshold: 0, med_threshold: 0, high_threshold: 2 }, 2],
    ])('%s: die Pruefung der eingegebenen Keys bleibt unveraendert', (_name, thresholds, weight) => {
      const onConfirm = vi.fn();
      renderModal({ onConfirm, signers: [ed(SIGNER_A.publicKey, weight)], thresholds, requiredThreshold: weight });
      typeSecret(NOT_A_SIGNER_SECRET);
      submit();
      expect(onConfirm).not.toHaveBeenCalled();
      typeSecret(SIGNER_A.secret);
      submit();
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm.mock.calls[0][0][0].publicKey).toBe(SIGNER_A.publicKey);
    });
  });
});

// Gemerkte Keys belegt der Dialog selbst vor (Entscheidung 17.11.: in allen Key-Dialogen gleich).
describe('SecretKeyModal: Vorbelegung mit gemerkten Keys', () => {
  const ACCOUNT_ID = 'GAQ6JRJ4IUIXUVZRMGYUGUXFUHYYBRQTWFON4IZEHRS2RY4FCPTEEMWE';
  let sessionModule;
  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    sessionModule = await import('../../utils/sessionSecrets.js');
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.removeItem('SKM_NETWORK');
  });
  const firstInput = () => document.querySelector('input[type="password"], input[type="text"]');

  it('belegt einen unter einem anderen Konto gemerkten Signer-Key vor', async () => {
    await sessionModule.setSessionSecrets(SIGNER_A.publicKey, { [SIGNER_A.publicKey]: SIGNER_A.secret });
    renderModal({ accountId: ACCOUNT_ID });
    await vi.waitFor(() => expect(firstInput().value).toBe(SIGNER_A.secret));
  });

  it('Gegenprobe: ein gemerkter Signer mit Gewicht 0 wird nicht vorbelegt', async () => {
    await sessionModule.setSessionSecrets(ACCOUNT_ID, { [SIGNER_B_ZERO_WEIGHT.publicKey]: SIGNER_B_ZERO_WEIGHT.secret });
    renderModal({ accountId: ACCOUNT_ID });
    await new Promise((r) => setTimeout(r, 50));
    expect(firstInput().value).toBe('');
  });

  it('Gegenprobe: anderes Netz des Ablaufs, nichts vorbelegt', async () => {
    await sessionModule.setSessionSecrets(SIGNER_A.publicKey, { [SIGNER_A.publicKey]: SIGNER_A.secret });
    renderModal({ accountId: ACCOUNT_ID, network: 'testnet' });
    await new Promise((r) => setTimeout(r, 50));
    expect(firstInput().value).toBe('');
  });

  it('Merken-Haken ist standardmaessig an und wird an onConfirm gemeldet', async () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    expect(screen.getByRole('checkbox', { name: /Für diese Sitzung merken|Remember for this session/i })).toBeChecked();
    typeSecret(SIGNER_A.secret);
    submit();
    expect(onConfirm.mock.calls[0][1]).toBe(true);
  });

  it('ueberschreibt keine schon begonnene Eingabe', async () => {
    await sessionModule.setSessionSecrets(SIGNER_A.publicKey, { [SIGNER_A.publicKey]: SIGNER_A.secret });
    renderModal({ accountId: ACCOUNT_ID });
    // Entschluesseln ist asynchron: die Eingabe kommt vor der Vorbelegung.
    typeSecret('SANGEFANGEN');
    await new Promise((r) => setTimeout(r, 50));
    expect(firstInput().value).toBe('SANGEFANGEN');
  });
});

describe('SecretKeyModal: Sperre, Anzeige der Vorbelegung, nur ein Signer (Review M-2, M-9, M-10)', () => {
  const ACCOUNT_ID = 'GAQ6JRJ4IUIXUVZRMGYUGUXFUHYYBRQTWFON4IZEHRS2RY4FCPTEEMWE';
  let sessionModule;
  beforeEach(async () => {
    sessionStorage.clear();
    localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    sessionModule = await import('../../utils/sessionSecrets.js');
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.removeItem('SKM_NETWORK');
  });
  const firstInput = () => document.querySelector('input[type="password"], input[type="text"]');

  it('zeigt den Public Key des vorbelegten Keys, nicht mehr nach einer Aenderung', async () => {
    await sessionModule.setSessionSecrets(SIGNER_A.publicKey, { [SIGNER_A.publicKey]: SIGNER_A.secret });
    renderModal({ accountId: ACCOUNT_ID });
    expect(await screen.findByTestId('secret-prefilled')).toHaveTextContent(SIGNER_A.publicKey);
    expect(screen.getByTestId('secret-prefilled')).not.toHaveTextContent(SIGNER_A.secret);
    typeSecret('SANDERS');
    expect(screen.queryByTestId('secret-prefilled')).toBeNull();
  });

  it('Sperre leert vorbelegte und eingetippte Keys und zeigt einen Hinweis', async () => {
    await sessionModule.setSessionSecrets(SIGNER_A.publicKey, { [SIGNER_A.publicKey]: SIGNER_A.secret });
    const onConfirm = vi.fn();
    renderModal({ accountId: ACCOUNT_ID, onConfirm });
    await vi.waitFor(() => expect(firstInput().value).toBe(SIGNER_A.secret));
    act(() => { sessionModule.clearAllSessionSecrets(); });
    expect(firstInput().value).toBe('');
    expect(screen.getByTestId('secret-modal-locked')).toBeInTheDocument();
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Sperre vor dem Ende der Vorbelegung: keine spaete Vorbelegung', async () => {
    await sessionModule.setSessionSecrets(SIGNER_A.publicKey, { [SIGNER_A.publicKey]: SIGNER_A.secret });
    renderModal({ accountId: ACCOUNT_ID });
    act(() => { sessionModule.clearAllSessionSecrets(); });
    await new Promise((r) => setTimeout(r, 50));
    expect(firstInput().value).toBe('');
  });

  it('onlySignerKey: nur dieser Signer zaehlt, ein anderer gueltiger Signer wird abgelehnt', () => {
    const onConfirm = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <SecretKeyModal
          onConfirm={onConfirm}
          onCancel={() => {}}
          signers={[
            { public_key: SIGNER_A.publicKey, weight: 1 },
            { public_key: SIGNER_B_ZERO_WEIGHT.publicKey, weight: 2 },
          ]}
          onlySignerKey={SIGNER_B_ZERO_WEIGHT.publicKey}
        />
      </I18nextProvider>
    );
    typeSecret(SIGNER_A.secret);
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
    typeSecret(SIGNER_B_ZERO_WEIGHT.secret);
    submit();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0][0].publicKey).toBe(SIGNER_B_ZERO_WEIGHT.publicKey);
  });
});
