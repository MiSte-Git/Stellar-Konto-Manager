import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import ListTrustlines from '../ListTrustlines.jsx';
import { consumePendingTrustlineAsset, openAddTrustline, setMainMounted } from '../../utils/appNavigation.js';

const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function renderList() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ListTrustlines
        trustlines={[]}
        itemsPerPage={10}
        currentPage={0}
        sortColumn="assetCode"
        sortDirection="asc"
        onSort={() => {}}
        filters={{}}
        onFilterChange={() => {}}
        selectedTrustlines={[]}
        onToggleAll={() => {}}
        setSelectedTrustlines={() => {}}
        results={[]}
        setResults={() => {}}
        setMenuSelection={() => {}}
        menuSelection="listAll"
        setSecretKey={() => {}}
        publicKey="GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F"
        setTrustlines={() => {}}
        isProcessing={false}
        deleteProgress={null}
        setIsProcessing={() => {}}
        setDeleteProgress={() => {}}
        setInfoMessage={() => {}}
      />
    </I18nextProvider>
  );
}

describe('ListTrustlines: vorgemerktes Asset', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    setMainMounted(true);
    consumePendingTrustlineAsset();
  });
  afterEach(() => { setMainMounted(false); });

  const issuerInput = () => document.querySelector(`input[value="${ISSUER}"]`);

  it('oeffnet den Dialog vorausgefuellt und verbraucht das Asset', () => {
    openAddTrustline({ code: 'USD', issuer: ISSUER });
    renderList();
    expect(screen.getByDisplayValue('USD')).toBeInTheDocument();
    expect(issuerInput()).not.toBeNull();
    expect(consumePendingTrustlineAsset()).toBeNull();
  });

  it('oeffnet ohne Vormerkung keinen Dialog; der normale Button startet leer, auch nach einer Vorbelegung', () => {
    const view = renderList();
    expect(screen.queryByDisplayValue('USD')).toBeNull();
    view.unmount();

    openAddTrustline({ code: 'USD', issuer: ISSUER });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('trustline:add.cancel') }));
    expect(screen.queryByDisplayValue('USD')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('trustline:add.button') }));
    expect(screen.queryByDisplayValue('USD')).toBeNull();
    expect(issuerInput()).toBeNull();
  });
});
