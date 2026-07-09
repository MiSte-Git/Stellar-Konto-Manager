import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import BalancePage from '../BalancePage.jsx';

// Covers c3: the identity-mode hint clarifying that the shown balance belongs to the
// whole underlying G-account, not just the active muxed subaddress.

const PUBLIC_KEY = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const MUXED_ADDRESS = 'MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJURAAAAAAAAAAJ2';

const hoisted = vi.hoisted(() => ({
  loadAccountMock: vi.fn(),
}));

vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccountMock,
    payments: () => ({
      forAccount: () => ({
        order: () => ({
          limit: () => ({
            join: () => ({
              call: async () => ({ records: [], next: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

function renderPage(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <BalancePage publicKey={PUBLIC_KEY} {...props} />
    </I18nextProvider>
  );
}

const HINT_TEXT = 'Dies ist der Gesamtsaldo des zugrundeliegenden G-Kontos, nicht nur dieser Unteradresse. Unteradressen haben kein eigenes, getrenntes Guthaben.';

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.loadAccountMock.mockResolvedValue({
    balances: [{ asset_type: 'native', balance: '100.0000000' }],
  });
});

describe('identity-mode total-balance hint (c3)', () => {
  it('shows the hint when a muxed address is the active account', async () => {
    renderPage({ muxedAddress: MUXED_ADDRESS });
    await waitFor(() => expect(hoisted.loadAccountMock).toHaveBeenCalled());
    expect(await screen.findByText(HINT_TEXT)).toBeInTheDocument();
  });

  it('does not show the hint for a plain G-account (no muxed address)', async () => {
    renderPage();
    await waitFor(() => expect(hoisted.loadAccountMock).toHaveBeenCalled());
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
  });
});
