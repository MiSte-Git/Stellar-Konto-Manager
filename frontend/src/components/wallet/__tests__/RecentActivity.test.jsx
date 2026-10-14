import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';

const call = vi.fn();
vi.mock('../../../utils/stellar/stellarUtils.js', () => {
  const chain = { forAccount: () => chain, order: () => chain, limit: () => chain, join: () => chain, call: (...a) => call(...a) };
  return { getHorizonServer: () => ({ payments: () => chain }) };
});

const settings = { explorers: [], defaultExplorerKey: '' };
vi.mock('../../../utils/useSettings.js', () => ({ useSettings: () => settings }));

import RecentActivity from '../RecentActivity.jsx';

const ME = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const FRIEND = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const FAKE = 'GD5KJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZVKM';

const H = (c) => c.repeat(64);
const records = [
  { id: '1', type: 'payment', from: FAKE, to: ME, amount: '0.0000001', asset_type: 'native', transaction_hash: H('a'), created_at: '2026-10-14T10:00:00Z', transaction: { memo_type: 'text', memo: '<img src=x onerror=alert(1)> claim reward at gift.example.com' } },
  { id: '2', type: 'payment', from: ME, to: FRIEND, amount: '25', asset_type: 'native', transaction_hash: H('b'), created_at: '2026-10-13T10:00:00Z', transaction: { memo_type: 'none' } },
  { id: '3', type: 'payment', from: FRIEND, to: ME, amount: '10', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: FRIEND, transaction_hash: H('c'), created_at: '2026-10-12T10:00:00Z', transaction: { memo_type: 'text', memo: 'Miete' } },
  // kaputtes Datum und ungueltiger Hash duerfen nicht crashen und keinen Link erzeugen
  { id: '4', type: 'payment', from: FRIEND, to: ME, amount: '3', asset_type: 'credit_alphanum4', asset_code: 'XLM', asset_issuer: FRIEND, transaction_hash: '../login', created_at: 'kein-datum', transaction: { memo_type: 'none' } },
];

function renderIt() {
  return render(
    <I18nextProvider i18n={i18n}>
      <RecentActivity publicKey={ME} network="PUBLIC" locale="de-CH" fmt={(n) => String(n)} onShowAll={() => {}} />
    </I18nextProvider>
  );
}

describe('RecentActivity', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    window.localStorage.clear();
    call.mockReset();
    call.mockResolvedValue({ records });
    settings.explorers = [];
    settings.defaultExplorerKey = '';
  });

  it('blendet Kleinstzahlungen standardmaessig aus und kann sie einblenden', async () => {
    renderIt();
    expect(await screen.findByText(/Miete/)).toBeInTheDocument();
    expect(screen.getAllByTestId('activity-item')).toHaveLength(3);
    expect(screen.getByText(/1 Kleinstzahlung ausgeblendet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anzeigen' }));
    expect(screen.getAllByTestId('activity-item')).toHaveLength(4);
  });

  it('rendert Memos nur als Text und warnt vor aehnlichen Adressen', async () => {
    window.localStorage.setItem('SKM_HIDE_DUST', '0');
    const { container } = renderIt();
    expect(await screen.findByText(/claim reward/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    const badge = screen.getByTestId('activity-lookalike');
    expect(badge).toBeInTheDocument();
    const row = badge.closest('[data-testid="activity-item"]');
    expect(within(row).getByTitle(FAKE)).toBeInTheDocument();
    expect(screen.getByText(/Mindestens ein Absender/)).toBeInTheDocument();
    expect(screen.getByTestId('activity-url')).toBeInTheDocument();
    expect(screen.getByTestId('activity-fake-native')).toBeInTheDocument();
  });

  it('setzt Explorer-Links nur fuer http(s)', async () => {
    settings.explorers = [{ key: 'bad', txTemplate: 'javascript:alert({tx})' }];
    settings.defaultExplorerKey = 'bad';
    const { container, unmount } = renderIt();
    await screen.findByText(/Miete/);
    expect(container.querySelector('a')).toBeNull();
    unmount();

    settings.explorers = [{ key: 'se', txTemplate: 'https://stellar.expert/explorer/public/tx/{tx}' }];
    settings.defaultExplorerKey = 'se';
    renderIt();
    await screen.findByText(/Miete/);
    const links = screen.getAllByRole('link');
    // 3 sichtbare Eintraege, aber nur 2 gueltige Hashes -> 2 Links
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `https://stellar.expert/explorer/public/tx/${H('b')}`);
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
