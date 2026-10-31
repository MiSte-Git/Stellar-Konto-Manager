import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import MultisigJobList from '../MultisigJobList.jsx';
import { needsSignatureFrom } from '../../utils/multisig/jobSigningState.js';

const ME = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const OTHER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const FOREIGN_ACCOUNT = 'GCZLMFGOQMVLH352AAUEBUBATMKM7OB6GUTJQ47DOXJDYUYKXDJEZQ7B';

const job = (id, o = {}) => ({
  id,
  txHash: `${id}hash`,
  accountId: FOREIGN_ACCOUNT,
  status: 'pending_signatures',
  signers: [{ publicKey: ME, weight: 1 }, { publicKey: OTHER, weight: 1 }],
  collectedSigners: [],
  createdAt: '2026-10-31T12:00:00Z',
  ...o,
});

describe('needsSignatureFrom', () => {
  it('nur wartende Jobs, bei denen ich Signer mit Gewicht bin und noch nicht signiert habe', () => {
    expect(needsSignatureFrom(job('a'), ME)).toBe(true);
    expect(needsSignatureFrom(job('a', { collectedSigners: [{ publicKey: ME }] }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a', { status: 'ready_to_submit' }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a', { status: 'expired' }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a', { signers: [{ publicKey: ME, weight: 0 }] }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a', { signers: [{ publicKey: OTHER, weight: 1 }] }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a'), '')).toBe(false);
  });
});

describe('MultisigJobList: Filter', () => {
  const urls = [];
  beforeEach(() => {
    urls.length = 0;
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    vi.spyOn(window, 'fetch').mockImplementation(async (url) => {
      urls.push(String(url));
      const list = String(url).includes('signer=')
        ? [job('fremd-offen'), job('fremd-signiert', { collectedSigners: [{ publicKey: ME }] })]
        : [job('eigen-abgelaufen', { accountId: ME, status: 'expired' })];
      return { ok: true, json: async () => list };
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const renderList = () => render(
    <I18nextProvider i18n={i18n}>
      <MultisigJobList publicKey={ME} onBack={() => {}} onOpenDetail={() => {}} />
    </I18nextProvider>
  );

  it('zeigt mit "nur noch signieren" die Jobs fremder Konten, auch ohne die zweite Checkbox, und ohne missingSigners vom Backend', async () => {
    renderList();
    const assigned = screen.getByRole('checkbox', { name: /Auch Aufträge, bei denen ich Signer bin/ });
    fireEvent.click(assigned);
    expect(assigned).not.toBeChecked();
    await waitFor(() => expect(screen.getByText(/eigen-abgel/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /Nur Aufträge, die ich noch signieren muss/ }));
    await waitFor(() => expect(screen.getByText(/fremd-offen/)).toBeInTheDocument());
    expect(screen.queryByText(/fremd-signiert/)).toBeNull();
    expect(screen.queryByText(/eigen-abgel/)).toBeNull();
    expect(urls.some((u) => u.includes(`signer=${ME}`))).toBe(true);
    expect(assigned).toBeChecked();
    expect(assigned).toBeDisabled();
  });

  it('bietet kein Loeschen aller Testnet-Jobs mehr an', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText(/eigen-abgel/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Testnet-Jobs löschen/ })).toBeNull();
  });
});
