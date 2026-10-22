import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';

const ME = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const FRIEND = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const FAKE = 'GD5KJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZVKM';
const H = (c) => c.repeat(64);

const records = [
  { id: '1', type: 'payment', from: FAKE, to: ME, amount: '0.0000001', asset_type: 'native', transaction_hash: H('a'), created_at: '2026-10-14T10:00:00Z', transaction: { memo_type: 'text', memo: 'claim​ reward at gift.example.com' } },
  { id: '2', type: 'payment', from: ME, to: FRIEND, amount: '25', asset_type: 'native', transaction_hash: H('b'), created_at: '2026-10-13T10:00:00Z', transaction: { memo_type: 'none' } },
  { id: '3', type: 'payment', from: FRIEND, to: ME, amount: '10', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: FRIEND, transaction_hash: H('c'), created_at: '2026-10-12T10:00:00Z', transaction: { memo_type: 'text', memo: 'Miete' } },
  { id: '4', type: 'payment', from: FRIEND, to: ME, amount: '3', asset_type: 'credit_alphanum4', asset_code: 'XLM', asset_issuer: FRIEND, transaction_hash: H('d'), created_at: '2026-10-11T10:00:00Z', transaction: { memo_type: 'text', memo: 'x' } },
];

vi.mock('../../utils/stellar/stellarUtils.js', () => {
  const chain = { forAccount: () => chain, order: () => chain, limit: () => chain, join: () => chain, call: async () => ({ records, next: null }) };
  return {
    getHorizonServer: () => ({
      loadAccount: async () => ({ balances: [] }),
      payments: () => chain,
      transactions: () => ({ transaction: () => ({ call: async () => ({ memo: '' }) }) }),
    }),
    extractMuxedIdFromAddress: () => '',
  };
});

const settings = { decimalsMode: 'auto', explorers: [{ key: 'bad', name: 'Bad', txTemplate: 'javascript:alert({tx})' }], defaultExplorerKey: 'bad' };
vi.mock('../../utils/useSettings.js', () => ({ useSettings: () => settings }));

import BalancePage from '../BalancePage.jsx';

function renderIt() {
  return render(
    <I18nextProvider i18n={i18n}>
      <BalancePage publicKey={ME} />
    </I18nextProvider>
  );
}

function paymentRows(container) {
  return [...container.querySelectorAll('#payments tbody tr')];
}

describe('BalancePage Warnhinweise', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('blendet Kleinstzahlungen standardmaessig aus und kann sie einblenden', async () => {
    const { container } = renderIt();
    expect(await screen.findByText('Miete')).toBeInTheDocument();
    expect(paymentRows(container)).toHaveLength(3);
    expect(screen.getByText(/1 Kleinstzahlung ausgeblendet/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('activity-notices')).getByRole('button', { name: 'Anzeigen' }));
    expect(paymentRows(container)).toHaveLength(4);
    expect(window.localStorage.getItem('SKM_HIDE_DUST')).toBe('0');
  });

  it('zeigt Badges, bereinigt Memos und setzt keine unsicheren Explorer-Links', async () => {
    window.localStorage.setItem('SKM_HIDE_DUST', '0');
    const { container } = renderIt();
    const memo = await screen.findByText('claim reward at gift.example.com');
    expect(memo).toBeInTheDocument();
    const row = memo.closest('tr');
    expect(within(row).getByTestId('activity-url')).toBeInTheDocument();
    expect(within(row).getByTestId('activity-dust')).toBeInTheDocument();
    expect(within(row).getByTestId('activity-lookalike')).toBeInTheDocument();
    expect(screen.getByText(/Mindestens ein Absender/)).toBeInTheDocument();
    expect(screen.getAllByTestId('activity-fake-native')).toHaveLength(1);
    container.querySelectorAll('#payments a').forEach((a) => {
      expect(a.getAttribute('href') || '').not.toMatch(/^javascript:/i);
    });
  });
});
