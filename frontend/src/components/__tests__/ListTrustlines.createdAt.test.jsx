import React from 'react';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import ListTrustlines from '../ListTrustlines.jsx';
import { formatLocalDateTime } from '../../utils/datetime.js';

// Regression 13.11.: loadTrustlines liefert fuer aeltere Trustlines createdAt als Text unknown.
// Die Tabelle zeigte dafuer Invalid Date. Jetzt: gueltiges Datum oder Hinweis, nie Invalid Date.
const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const base = { assetIssuer: ISSUER, assetType: 'credit_alphanum4', assetBalance: '1', limit: '10' };
const ISO = '2026-11-13T09:11:22Z';

vi.mock('../../utils/stellar/stellarUtils.js', async (orig) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await orig()),
  getHorizonServer: () => ({ loadAccount: async () => ({}) }),
}));

function renderList(trustlines, sortDirection = 'asc') {
  return render(
    <I18nextProvider i18n={i18n}>
      <ListTrustlines
        network="PUBLIC" trustlines={trustlines} itemsPerPage={10} currentPage={0}
        sortColumn="createdAt" sortDirection={sortDirection}
        onSort={() => {}} filters={{}} onFilterChange={() => {}} selectedTrustlines={[]} onToggleAll={() => {}}
        setSelectedTrustlines={() => {}} results={[]} setResults={() => {}} setMenuSelection={() => {}}
        menuSelection="listAll" setSecretKey={() => {}} publicKey={PK} setTrustlines={() => {}}
        isProcessing={false} deleteProgress={null} setIsProcessing={() => {}} setDeleteProgress={() => {}}
        setInfoMessage={() => {}}
      />
    </I18nextProvider>,
  );
}

describe('ListTrustlines: Erstellungsdatum', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('zeigt nie Invalid Date: unknown, leer und Muell ergeben den Hinweis, ISO ein Datum', () => {
    renderList([
      { ...base, assetCode: 'AAA', createdAt: 'unknown' },
      { ...base, assetCode: 'BBB', createdAt: undefined },
      { ...base, assetCode: 'CCC', createdAt: 'kein-datum' },
      { ...base, assetCode: 'DDD', createdAt: ISO },
    ]);
    expect(screen.queryByText(/Invalid Date/i)).toBeNull();
    expect(screen.getAllByText(i18n.t('errors:asset.creationDateUnknown')).length).toBe(3);
    expect(screen.getByText(formatLocalDateTime(ISO))).toBeTruthy();
  });

  it('Sortieren nach Datum mit unbekannten Eintraegen bricht nicht ab', () => {
    renderList([
      { ...base, assetCode: 'AAA', createdAt: 'unknown' },
      { ...base, assetCode: 'DDD', createdAt: ISO },
    ], 'desc');
    const rows = screen.getAllByRole('row').map((r) => r.textContent);
    expect(rows.findIndex((t) => t.includes('DDD'))).toBeLessThan(rows.findIndex((t) => t.includes('AAA')));
  });
});
