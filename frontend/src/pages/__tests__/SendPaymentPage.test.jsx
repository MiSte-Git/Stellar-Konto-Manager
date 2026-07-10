import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair, MuxedAccount } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import SendPaymentPage from '../SendPaymentPage.jsx';

// Covers three fixes to the federation-memo-autofill flow (fix 1):
// - K1: a recipient change must not leave a stale auto-filled memo behind, and must
//   never clobber a memo the user has taken manual control of.
// - G1: a same-tick (or later) user keystroke must survive a slow-returning federation
//   lookup - the autofill uses a functional memoVal update specifically for this.
// - M1+M2: sending must be gated behind a confirmation dialog when the current memo
//   doesn't match what the federation server expects, resolved fresh at send time.

const SENDER = {
  secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
  publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
};
const DEST_PK = Keypair.random().publicKey();
const ISSUER_PK = Keypair.random().publicKey();
const ASSET_CODE = 'FOO';
const ASSET_KEY = `${ASSET_CODE}:${ISSUER_PK}`;
const FED_WITH_MEMO = 'friend*example.com';
const FED_NO_MEMO = 'nomemo*example.com';
const FED_UNMAPPABLE = 'weird*example.com';
// A real muxed address (base G-account DEST_PK, id 42) - Operation.payment() builds a real
// XDR operation from this string, so it must decode successfully, not just look M...-shaped.
const MUXED_DEST = new MuxedAccount(new Account(DEST_PK, '0'), '42').accountId();

// Mutable boxes so individual tests can steer the mocked lookups without re-declaring
// the whole vi.mock factory (hoisted above this file's other declarations by Vitest).
const hoisted = vi.hoisted(() => ({
  loadAccountMock: vi.fn(),
  resolveOrValidateAccountMock: vi.fn(),
  getSessionSecretMock: vi.fn(),
  submitTransactionSafelyMock: vi.fn(),
}));

vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccountMock,
    feeStats: vi.fn(async () => ({ fee_charged: { mode: '100' } })),
    offers: () => ({ forAccount: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) }),
    ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) }),
  }),
  resolveOrValidateAccount: hoisted.resolveOrValidateAccountMock,
}));

vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: hoisted.getSessionSecretMock,
}));

vi.mock('../../utils/stellar/submitTransactionSafely.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTransactionSafely: hoisted.submitTransactionSafelyMock,
}));

// Builds a real stellar-sdk Account (so TransactionBuilder can use it) plus the
// Horizon fields the page reads (signers/thresholds/balances/...). extraBalances lets
// trustline tests add a credit_alphanum4 line; flags lets them set the issuer's
// AUTH_REQUIRED bit.
function makeFundedAccount(publicKey, { sequence = '100', extraBalances = [], flags = {} } = {}) {
  const account = new Account(publicKey, sequence);
  return Object.assign(account, {
    account_id: publicKey,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: [{ key: publicKey, weight: 1, type: 'ed25519_public_key' }],
    balances: [{ asset_type: 'native', balance: '10000.0000000' }, ...extraBalances],
    flags,
    subentry_count: 1,
  });
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <SendPaymentPage publicKey={SENDER.publicKey} />
    </I18nextProvider>
  );
}

// The page renders <label>Text</label> immediately followed by the actual input/select
// (wrapped in a HistoryInput/plain element) - querying via the label's parent avoids
// depending on internal component structure or needing testids.
function inputAfterLabel(labelText) {
  const label = screen.getByText(labelText, { selector: 'label' });
  return label.parentElement.querySelector('input');
}
function selectAfterLabel(labelText) {
  const label = screen.getByText(labelText, { selector: 'label' });
  return label.parentElement.querySelector('select');
}

const destInput = () => screen.getByPlaceholderText('G... oder user*domain');
const memoInput = () => inputAfterLabel('Memo');
const memoTypeSelect = () => selectAfterLabel('Memo Typ');
const amountInput = () => inputAfterLabel('Betrag');
const assetSelect = () => selectAfterLabel('Asset');
const FEDERATION_HINT_TEXT = 'Memo vom Federation-Server übernommen – kann bei Bedarf angepasst werden.';

// The sender always carries a FOO trustline so the asset <select> lists it as an option -
// harmless for the XLM-only K1/G1/M1+M2 tests above, needed for the trustline tests below.
const SENDER_FOO_BALANCE = { asset_type: 'credit_alphanum4', asset_code: ASSET_CODE, asset_issuer: ISSUER_PK, balance: '500.0000000', limit: '1000.0000000', is_authorized: true };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  hoisted.loadAccountMock.mockImplementation(async (pk) => (
    pk === SENDER.publicKey
      ? makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] })
      : makeFundedAccount(pk)
  ));
  hoisted.resolveOrValidateAccountMock.mockImplementation(async (input) => {
    if (input === FED_WITH_MEMO) {
      return { accountId: DEST_PK, muxedAddress: null, address: input, memo: '999', memoType: 'id' };
    }
    if (input === FED_UNMAPPABLE) {
      return { accountId: DEST_PK, muxedAddress: null, address: input, memo: 'x', memoType: 'unknown' };
    }
    if (input === FED_NO_MEMO) {
      return { accountId: DEST_PK, muxedAddress: null, address: input };
    }
    return { accountId: input, muxedAddress: null, address: input };
  });
  hoisted.getSessionSecretMock.mockResolvedValue(SENDER.secret);
  hoisted.submitTransactionSafelyMock.mockResolvedValue({ hash: 'deadbeefcafe' });
});

describe('federation memo autofill on recipient change (K1)', () => {
  it('autofills the memo from a federation lookup when the field is empty', async () => {
    renderPage();
    fireEvent.change(destInput(), { target: { value: FED_WITH_MEMO } });
    await waitFor(() => expect(memoInput().value).toBe('999'));
    // memoType/the hint are synced by a follow-up effect once memoVal itself has
    // committed, so they can land a render after the value already updated.
    await waitFor(() => expect(memoTypeSelect().value).toBe('id'));
    await waitFor(() => expect(screen.getByText(FEDERATION_HINT_TEXT)).toBeInTheDocument());
  });

  it('clears a previously auto-filled memo when the new destination has none', async () => {
    renderPage();
    fireEvent.change(destInput(), { target: { value: FED_WITH_MEMO } });
    await waitFor(() => expect(memoInput().value).toBe('999'));

    fireEvent.change(destInput(), { target: { value: FED_NO_MEMO } });
    await waitFor(() => expect(memoInput().value).toBe(''));
    // federationMemoApplied is synced by a follow-up effect once memoVal itself has
    // committed, so its removal can land a render after the value already cleared.
    await waitFor(() => expect(screen.queryByText(FEDERATION_HINT_TEXT)).not.toBeInTheDocument());
  });

  it('does not overwrite a manually edited memo when the recipient changes', async () => {
    renderPage();
    fireEvent.change(destInput(), { target: { value: FED_WITH_MEMO } });
    await waitFor(() => expect(memoInput().value).toBe('999'));

    fireEvent.change(memoInput(), { target: { value: 'my own note' } });
    expect(memoInput().value).toBe('my own note');

    // A different federation address resolves with its own memo, but the field is now
    // user-controlled and must be left alone.
    fireEvent.change(destInput(), { target: { value: FED_NO_MEMO } });
    await waitFor(() => expect(hoisted.resolveOrValidateAccountMock).toHaveBeenCalledWith(FED_NO_MEMO));
    expect(memoInput().value).toBe('my own note');
    expect(screen.queryByText(FEDERATION_HINT_TEXT)).not.toBeInTheDocument();
  });
});

describe('same-tick keystroke survives a slow federation lookup (G1)', () => {
  it('keeps a memo typed while the lookup is still pending', async () => {
    let resolveLookup;
    hoisted.resolveOrValidateAccountMock.mockImplementation((input) => {
      if (input === FED_WITH_MEMO) {
        return new Promise((resolve) => { resolveLookup = resolve; });
      }
      return Promise.resolve({ accountId: input, muxedAddress: null, address: input });
    });

    renderPage();
    fireEvent.change(destInput(), { target: { value: FED_WITH_MEMO } });
    // Lookup is still pending here - the user types their own memo before it returns.
    fireEvent.change(memoInput(), { target: { value: 'typed-before-lookup' } });

    resolveLookup({ accountId: DEST_PK, muxedAddress: null, address: FED_WITH_MEMO, memo: '999', memoType: 'id' });
    await waitFor(() => expect(hoisted.resolveOrValidateAccountMock).toHaveBeenCalled());

    // Give the resolved promise's continuation a chance to run and (incorrectly, if the
    // bug were present) overwrite the field.
    await new Promise((r) => setTimeout(r, 0));
    expect(memoInput().value).toBe('typed-before-lookup');
  });
});

describe('federation memo mismatch confirmation before sending (M1+M2)', () => {
  async function fillFormWithMismatch() {
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '10' } });
    fireEvent.change(destInput(), { target: { value: FED_WITH_MEMO } });
    await waitFor(() => expect(memoInput().value).toBe('999'));
    // Deliberately diverge from the federation-expected memo.
    // Stays numeric so memoType 'id' (left over from the autofill) is still valid -
    // buildMemoObject would otherwise reject the memo before the mismatch check ever runs.
    fireEvent.change(memoInput(), { target: { value: '111' } });
    expect(memoInput().value).toBe('111');

    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    // Review dialog appears (cached secret -> straight past the SecretKeyModal).
    await screen.findByText('Transaktion bestätigen');
    // NB: this button's translated label ("Bist du sicher?") looks like a pre-existing
    // content mismatch unrelated to this fix; asserted as literally rendered today.
    fireEvent.click(screen.getByRole('button', { name: 'Bist du sicher?' }));
  }

  it('blocks the send and shows the mismatch dialog instead of submitting', async () => {
    await fillFormWithMismatch();
    await screen.findByText('Federation-Memo prüfen');
    expect(screen.getByText(/erwartet das Memo "999"/)).toBeInTheDocument();
    expect(screen.getByText(/dein aktuelles Memo ist "111"/)).toBeInTheDocument();
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });

  it('"Send anyway" resumes the original send despite the mismatch', async () => {
    await fillFormWithMismatch();
    await screen.findByText('Federation-Memo prüfen');
    fireEvent.click(screen.getByRole('button', { name: 'Trotzdem senden' }));
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Federation-Memo prüfen')).not.toBeInTheDocument();
  });

  it('"Apply federation memo" fixes the field without auto-resubmitting', async () => {
    await fillFormWithMismatch();
    await screen.findByText('Federation-Memo prüfen');
    fireEvent.click(screen.getByRole('button', { name: 'Federation-Memo übernehmen' }));

    expect(screen.queryByText('Federation-Memo prüfen')).not.toBeInTheDocument();
    expect(memoInput().value).toBe('999');
    // Applying the fix must not silently resend with the just-changed state.
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();

    // A second, explicit send now passes the check (memo matches) and goes straight through.
    fireEvent.click(screen.getByRole('button', { name: 'Bist du sicher?' }));
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
  });

  it('offers only "Send anyway" when the federation memo could not be mapped automatically', async () => {
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '10' } });
    fireEvent.change(destInput(), { target: { value: FED_UNMAPPABLE } });
    await waitFor(() => expect(hoisted.resolveOrValidateAccountMock).toHaveBeenCalledWith(FED_UNMAPPABLE));
    // Unmappable memo types never autofill - field stays at its default.

    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await screen.findByText('Transaktion bestätigen');
    fireEvent.click(screen.getByRole('button', { name: 'Bist du sicher?' }));

    await screen.findByText('Federation-Memo prüfen');
    expect(screen.getByText(/nicht automatisch übernommen werden konnte/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Federation-Memo übernehmen' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trotzdem senden' })).toBeInTheDocument();
  });
});

describe('recipient trustline preflight before sending (a5)', () => {
  const authorizedFooBalance = {
    asset_type: 'credit_alphanum4',
    asset_code: ASSET_CODE,
    asset_issuer: ISSUER_PK,
    balance: '0.0000000',
    limit: '1000.0000000',
    is_authorized: true,
  };
  const unauthorizedFooBalance = { ...authorizedFooBalance, is_authorized: false };

  async function selectAsset() {
    await waitFor(() => {
      const values = Array.from(assetSelect().options).map((o) => o.value);
      expect(values).toContain(ASSET_KEY);
    });
    fireEvent.change(assetSelect(), { target: { value: ASSET_KEY } });
  }

  async function fillAndConfirm({ withAsset = true, dest = DEST_PK } = {}) {
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '10' } });
    if (withAsset) await selectAsset();
    fireEvent.change(destInput(), { target: { value: dest } });
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await screen.findByText('Transaktion bestätigen');
    fireEvent.click(screen.getByRole('button', { name: 'Bist du sicher?' }));
  }

  it('blocks sending when the recipient has no trustline for the asset', async () => {
    await fillAndConfirm();
    await screen.findByText(/hat noch keine Trustline für FOO/);
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });

  it('blocks sending when the trustline exists but the issuer has not authorized it', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) return makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [unauthorizedFooBalance] });
      if (pk === ISSUER_PK) return makeFundedAccount(pk, { flags: { auth_required: true } });
      return makeFundedAccount(pk);
    });
    await fillAndConfirm();
    await screen.findByText(/diese ist aber vom Emittenten noch nicht autorisiert/);
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });

  it('lets an authorized trustline through', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) return makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [authorizedFooBalance] });
      return makeFundedAccount(pk);
    });
    await fillAndConfirm();
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
  });

  it('skips the check entirely for native XLM', async () => {
    await fillAndConfirm({ withAsset: false });
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
  });

  it('does not block on a not-yet-activated destination - the existing activation path handles it instead', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) return makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
      if (pk === DEST_PK) {
        const err = new Error('Not Found');
        err.response = { status: 404 };
        throw err;
      }
      return makeFundedAccount(pk);
    });
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '10' } });
    await selectAsset();
    fireEvent.change(destInput(), { target: { value: DEST_PK } });
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    // The pre-existing non-XLM/unfunded-destination guard lives in runPreflight, which
    // already blocks before the review dialog even opens - so this new check never even
    // gets a chance to run for this destination, exactly as intended ("no new block").
    await screen.findByText('Zielkonto ist nicht aktiv. Bitte zuerst XLM zur Aktivierung senden oder Asset auf XLM wechseln.');
    expect(screen.queryByText('Transaktion bestätigen')).not.toBeInTheDocument();
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });

  it('does not hard-block when the check itself fails (Horizon unreachable)', async () => {
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '10' } });
    await selectAsset();
    fireEvent.change(destInput(), { target: { value: DEST_PK } });
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    // Review dialog opens normally - runPreflight's own destExists check for DEST_PK
    // succeeded here, using the still-default (always-funded) mock from beforeEach.
    await screen.findByText('Transaktion bestätigen');

    // Now arm a mock that fails exactly once for DEST_PK - the single loadAccount call
    // checkRecipientTrustlineStatus makes when "Bestätigen" is clicked below. Any later
    // DEST_PK call (buildPaymentTx's own destExists check) succeeds again, simulating a
    // transient Horizon hiccup rather than a genuinely missing/unauthorized trustline.
    let armedCalls = 0;
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) return makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
      if (pk === DEST_PK) {
        armedCalls += 1;
        if (armedCalls === 1) throw new Error('Network Error'); // no .response -> not a 404
        return makeFundedAccount(pk, { extraBalances: [authorizedFooBalance] });
      }
      return makeFundedAccount(pk);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Bist du sicher?' }));
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not block a payment to the asset issuer itself (redemption/burn) (K1)', async () => {
    // The issuer holds no trustline on its own asset (protocol-valid) - the default mock
    // for ISSUER_PK below reflects that (no FOO balance), same as the no_trustline case
    // would otherwise trigger if the issuer weren't special-cased.
    await fillAndConfirm({ dest: ISSUER_PK });
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
  });

  it('blocks on an unauthorized trustline even when the issuer currently has no AUTH_REQUIRED flag (M2)', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) return makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [unauthorizedFooBalance] });
      // Issuer explicitly does NOT have AUTH_REQUIRED set. stellar-core still rejects the
      // payment based on the trustline's own is_authorized flag - gating on the issuer's
      // current flag (as the pre-M2 implementation did) would have wrongly let this through.
      return makeFundedAccount(pk, { flags: { auth_required: false } });
    });
    await fillAndConfirm();
    await screen.findByText(/diese ist aber vom Emittenten noch nicht autorisiert/);
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });

  it('resets the review dialog\'s busy state after a hard block (G2)', async () => {
    await fillAndConfirm(); // default DEST_PK has no FOO trustline -> no_trustline block
    await screen.findByText(/hat noch keine Trustline für FOO/);
    // If reviewProcessing stayed stuck at true, the button would still read "Verarbeite..."
    // (and every button in the dialog, including Cancel, would stay disabled) - this query
    // only succeeds if the busy state was actually released.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bist du sicher?' })).not.toBeDisabled());
  });
});

describe('pre-submit checks also cover the collect-locally multisig path (M1)', () => {
  const unauthorizedFooBalance = {
    asset_type: 'credit_alphanum4',
    asset_code: ASSET_CODE,
    asset_issuer: ISSUER_PK,
    balance: '0.0000000',
    limit: '1000.0000000',
    is_authorized: false,
  };

  async function selectAsset() {
    await waitFor(() => {
      const values = Array.from(assetSelect().options).map((o) => o.value);
      expect(values).toContain(ASSET_KEY);
    });
    fireEvent.change(assetSelect(), { target: { value: ASSET_KEY } });
  }

  // Drives the account into the "collect all signatures locally" branch: pick the "local"
  // option in the multisig confirm modal, then submit the secret key modal that follows.
  // high_threshold > 1 makes isMultisigAccount() true without a second signer; med_threshold
  // stays at 1 so the sender's own (already-known) secret alone meets the payment threshold.
  async function driveToCollectLocallySubmit() {
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '10' } });
    await selectAsset();
    fireEvent.change(destInput(), { target: { value: DEST_PK } });

    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await screen.findByText('Alle Signaturen lokal eingeben & direkt senden');
    fireEvent.click(screen.getByRole('radio', { name: /Alle Signaturen lokal eingeben/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Weiter' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    const secretHeading = await screen.findByText('Geben Sie den Quell-Geheimschlüssel (S-Key) ein');
    const modal = secretHeading.parentElement;
    fireEvent.change(within(modal).getByPlaceholderText('z.B.'), { target: { value: SENDER.secret } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Senden' }));
  }

  beforeEach(() => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      return makeFundedAccount(pk);
    });
  });

  it('trustline check blocks the direct submitPayment call this path used to skip', async () => {
    // DEST_PK carries no FOO balance (default makeFundedAccount) -> no_trustline.
    await driveToCollectLocallySubmit();
    await screen.findByText(/hat noch keine Trustline für FOO/);
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });

  it('memo mismatch dialog also gates this path, and "send anyway" resumes it', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [{ ...unauthorizedFooBalance, is_authorized: true }] });
      return makeFundedAccount(pk);
    });
    hoisted.resolveOrValidateAccountMock.mockImplementation(async (input) => {
      if (input === DEST_PK) return { accountId: DEST_PK, muxedAddress: null, address: input, memo: '42', memoType: 'id' };
      return { accountId: input, muxedAddress: null, address: input };
    });

    await driveToCollectLocallySubmit();
    await screen.findByText('Federation-Memo prüfen');
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Trotzdem senden' }));
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
  });

  it('lets the payment through once trustline and memo both check out', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [{ ...unauthorizedFooBalance, is_authorized: true }] });
      return makeFundedAccount(pk);
    });
    await driveToCollectLocallySubmit();
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
  });
});

describe('pre-submit checks also cover the XDR export path (G3)', () => {
  const unauthorizedFooBalance = {
    asset_type: 'credit_alphanum4',
    asset_code: ASSET_CODE,
    asset_issuer: ISSUER_PK,
    balance: '0.0000000',
    limit: '1000.0000000',
    is_authorized: false,
  };

  async function selectAsset() {
    await waitFor(() => {
      const values = Array.from(assetSelect().options).map((o) => o.value);
      expect(values).toContain(ASSET_KEY);
    });
    fireEvent.change(assetSelect(), { target: { value: ASSET_KEY } });
  }

  beforeEach(() => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      return makeFundedAccount(pk);
    });
  });

  // Drives the account into the multisig confirm modal, picks "XDR exportieren" and clicks
  // through - exercising handleExportXdr via the same confirm-modal entry point a real user
  // would use, rather than calling the handler directly.
  async function driveToXdrExport() {
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '10' } });
    await selectAsset();
    fireEvent.change(destInput(), { target: { value: DEST_PK } });

    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await screen.findByText('XDR exportieren (nicht senden)');
    fireEvent.click(screen.getByRole('radio', { name: /XDR exportieren/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Weiter' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
  }

  it('blocks the export when the recipient has no trustline for the asset', async () => {
    // DEST_PK carries no FOO balance (default makeFundedAccount) -> no_trustline.
    await driveToXdrExport();
    await screen.findByText(/hat noch keine Trustline für FOO/);
    expect(screen.queryByText('XDR vorbereitet (nicht gesendet)')).not.toBeInTheDocument();
  });

  it('blocks the export when the trustline exists but the issuer has not authorized it', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [unauthorizedFooBalance] });
      return makeFundedAccount(pk);
    });
    await driveToXdrExport();
    await screen.findByText(/diese ist aber vom Emittenten noch nicht autorisiert/);
    expect(screen.queryByText('XDR vorbereitet (nicht gesendet)')).not.toBeInTheDocument();
  });

  it('a federation memo mismatch opens the confirmation dialog instead of exporting immediately', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [{ ...unauthorizedFooBalance, is_authorized: true }] });
      return makeFundedAccount(pk);
    });
    hoisted.resolveOrValidateAccountMock.mockImplementation(async (input) => {
      if (input === DEST_PK) return { accountId: DEST_PK, muxedAddress: null, address: input, memo: '42', memoType: 'id' };
      return { accountId: input, muxedAddress: null, address: input };
    });

    await driveToXdrExport();
    await screen.findByText('Federation-Memo prüfen');
    expect(screen.queryByText('XDR vorbereitet (nicht gesendet)')).not.toBeInTheDocument();
  });

  it('"Send anyway" after a memo mismatch triggers the export, not submitPayment', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [{ ...unauthorizedFooBalance, is_authorized: true }] });
      return makeFundedAccount(pk);
    });
    hoisted.resolveOrValidateAccountMock.mockImplementation(async (input) => {
      if (input === DEST_PK) return { accountId: DEST_PK, muxedAddress: null, address: input, memo: '42', memoType: 'id' };
      return { accountId: input, muxedAddress: null, address: input };
    });

    await driveToXdrExport();
    await screen.findByText('Federation-Memo prüfen');
    fireEvent.click(screen.getByRole('button', { name: 'Trotzdem senden' }));

    await screen.findByText('XDR vorbereitet (nicht gesendet)');
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });

  it('"Apply federation memo" updates the form without auto-exporting', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [{ ...unauthorizedFooBalance, is_authorized: true }] });
      return makeFundedAccount(pk);
    });
    hoisted.resolveOrValidateAccountMock.mockImplementation(async (input) => {
      if (input === DEST_PK) return { accountId: DEST_PK, muxedAddress: null, address: input, memo: '42', memoType: 'id' };
      return { accountId: input, muxedAddress: null, address: input };
    });

    await driveToXdrExport();
    await screen.findByText('Federation-Memo prüfen');
    fireEvent.click(screen.getByRole('button', { name: 'Federation-Memo übernehmen' }));

    expect(screen.queryByText('Federation-Memo prüfen')).not.toBeInTheDocument();
    expect(screen.queryByText('XDR vorbereitet (nicht gesendet)')).not.toBeInTheDocument();
    expect(memoInput().value).toBe('42');
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });

  it('lets the export through once trustline and memo both check out', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) {
        const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
        acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
        return acct;
      }
      if (pk === DEST_PK) return makeFundedAccount(pk, { extraBalances: [{ ...unauthorizedFooBalance, is_authorized: true }] });
      return makeFundedAccount(pk);
    });
    await driveToXdrExport();
    await screen.findByText('XDR vorbereitet (nicht gesendet)');
    expect(hoisted.submitTransactionSafelyMock).not.toHaveBeenCalled();
  });
});

describe('muxedActivationCapture hint surfaces on every result path (G4)', () => {
  // Muxed destination whose base G-account is not yet funded - buildPaymentTx's
  // !destExists branch adds the extra 1-stroop payment operation to capture the muxed ID,
  // and returns meta.muxedActivationCapture = true regardless of which handler called it.
  function armUnfundedMuxedDestination() {
    hoisted.resolveOrValidateAccountMock.mockImplementation(async (input) => {
      if (input === MUXED_DEST) return { accountId: DEST_PK, muxedAddress: MUXED_DEST, address: input };
      return { accountId: input, muxedAddress: null, address: input };
    });
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) return makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
      if (pk === DEST_PK) {
        const err = new Error('Not Found');
        err.response = { status: 404 };
        throw err;
      }
      return makeFundedAccount(pk);
    });
  }

  it('shows the hint on the "sent" result after a direct (non-multisig) send', async () => {
    armUnfundedMuxedDestination();
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '1' } });
    fireEvent.change(destInput(), { target: { value: MUXED_DEST } });
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await screen.findByText('Transaktion bestätigen');
    fireEvent.click(screen.getByRole('button', { name: 'Bist du sicher?' }));
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
    // Renders both in the standalone success card and inside the result dialog - either is
    // proof the hint made it through, so assert on presence rather than a single match.
    await waitFor(() => expect(screen.getAllByText(/Muxed-ID ebenfalls on-chain/).length).toBeGreaterThan(0));
  });

  it('does not show the hint on the "sent" result for a plain (non-muxed) activation', async () => {
    hoisted.loadAccountMock.mockImplementation(async (pk) => {
      if (pk === SENDER.publicKey) return makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
      if (pk === DEST_PK) {
        const err = new Error('Not Found');
        err.response = { status: 404 };
        throw err;
      }
      return makeFundedAccount(pk);
    });
    renderPage();
    fireEvent.change(amountInput(), { target: { value: '1' } });
    fireEvent.change(destInput(), { target: { value: DEST_PK } });
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await screen.findByText('Transaktion bestätigen');
    fireEvent.click(screen.getByRole('button', { name: 'Bist du sicher?' }));
    await waitFor(() => expect(hoisted.submitTransactionSafelyMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Das Zielkonto wurde aktiviert.')).toBeInTheDocument();
    expect(screen.queryByText(/Muxed-ID ebenfalls on-chain/)).not.toBeInTheDocument();
  });

  describe('via the multisig confirm modal (job + XDR export)', () => {
    beforeEach(() => {
      hoisted.resolveOrValidateAccountMock.mockImplementation(async (input) => {
        if (input === MUXED_DEST) return { accountId: DEST_PK, muxedAddress: MUXED_DEST, address: input };
        return { accountId: input, muxedAddress: null, address: input };
      });
      hoisted.loadAccountMock.mockImplementation(async (pk) => {
        if (pk === SENDER.publicKey) {
          const acct = makeFundedAccount(pk, { extraBalances: [SENDER_FOO_BALANCE] });
          acct.thresholds = { low_threshold: 0, med_threshold: 1, high_threshold: 2 };
          return acct;
        }
        if (pk === DEST_PK) {
          const err = new Error('Not Found');
          err.response = { status: 404 };
          throw err;
        }
        return makeFundedAccount(pk);
      });
    });

    async function driveToConfirmModal(radioName) {
      renderPage();
      // Unlike the other describe blocks above, this flow never touches the asset <select>
      // (native XLM), so nothing else forces a wait for the sender's accountInfo to load -
      // without it, "Senden" can fire before isMultisig (derived from accountInfo) flips
      // true, taking the single-sig review-dialog branch instead of opening this modal.
      await waitFor(() => expect(hoisted.loadAccountMock).toHaveBeenCalledWith(SENDER.publicKey));
      fireEvent.change(amountInput(), { target: { value: '1' } });
      fireEvent.change(destInput(), { target: { value: MUXED_DEST } });
      fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
      await screen.findByText('XDR exportieren (nicht senden)');
      fireEvent.click(screen.getByRole('radio', { name: radioName }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Weiter' })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    }

    it('XDR export result dialog shows the two-operations hint', async () => {
      await driveToConfirmModal(/XDR exportieren/);
      await screen.findByText('XDR vorbereitet (nicht gesendet)');
      expect(screen.getByText(/kostet entsprechend zwei Operationsgebühren/)).toBeInTheDocument();
    });

    it('multisig job result dialog shows the two-operations hint', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ id: 'job-123', txHash: 'deadbeefcafe', txXdrCurrent: 'AAAAAA==' }),
      }));
      vi.stubGlobal('fetch', fetchMock);
      try {
        await driveToConfirmModal(/Multisig-Job erstellen/);
        await screen.findByText('Multisig-Job wurde erstellt. Die Transaktion wurde noch nicht gesendet.');
        expect(screen.getByText(/kostet entsprechend zwei Operationsgebühren/)).toBeInTheDocument();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
