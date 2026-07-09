import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, Keypair } from '@stellar/stellar-sdk';
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
const FED_WITH_MEMO = 'friend*example.com';
const FED_NO_MEMO = 'nomemo*example.com';
const FED_UNMAPPABLE = 'weird*example.com';

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
// Horizon fields the page reads (signers/thresholds/balances/...).
function makeFundedAccount(publicKey, sequence = '100') {
  const account = new Account(publicKey, sequence);
  return Object.assign(account, {
    account_id: publicKey,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: [{ key: publicKey, weight: 1, type: 'ed25519_public_key' }],
    balances: [{ asset_type: 'native', balance: '10000.0000000' }],
    flags: {},
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
const FEDERATION_HINT_TEXT = 'Memo vom Federation-Server übernommen – kann bei Bedarf angepasst werden.';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  hoisted.loadAccountMock.mockImplementation(async (pk) => makeFundedAccount(pk));
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
