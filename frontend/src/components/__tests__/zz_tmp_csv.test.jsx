// F6 (review_runde1_opus.md): Je CSV-Panel ein Test, dass fremde Texte durch csvLine
// laufen. Ein Memo "=1+1" muss als "'=1+1" ankommen, ein Memo mit dem fremden
// Trennzeichen (F1) gequotet. Faellt ein Panel auf ein rohes join() zurueck, schlaegt
// der jeweilige Test fehl.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import ResultModal from '../ResultModal.jsx';
import InvestedTokensPanel from '../InvestedTokensPanel.jsx';
import XlmByMemoPanel from '../XlmByMemoPanel.jsx';

const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';

const hoisted = vi.hoisted(() => ({
  groupfund: vi.fn(),
  operations: vi.fn(),
}));

vi.mock('../../utils/stellar/investmentUtils', () => ({
  fetchAccountCreatedAt: vi.fn(async () => ''),
  fetchGroupfundByMemo: hoisted.groupfund,
  fetchInvestedPerToken: vi.fn(async () => ({ items: [] })),
}));

// Kleiner Horizon-Ersatz: ledgers() fuer InvestedTokensPanel, operations() fuer den
// Export in XlmByMemoPanel.
vi.mock('../../utils/stellar/stellarUtils', async (importOriginal) => {
  const chain = (result) => {
    const builder = { forAccount: () => builder, order: () => builder, limit: () => builder, cursor: () => builder, call: async () => result() };
    return builder;
  };
  return {
    ...(await importOriginal()),
    getHorizonServer: () => ({
      ledgers: () => chain(() => ({ records: [] })),
      operations: () => chain(hoisted.operations),
      transactions: () => chain(() => ({ records: [] })),
    }),
  };
});

vi.mock('../../utils/db/indexedDbClient', () => ({ getNewestCreatedAt: vi.fn(async () => '') }));

let exported;
beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  exported = [];
  vi.stubGlobal('Blob', class {
    constructor(parts) { exported.push(parts.join('')); }
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wrap = (ui) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('CSV-Exporte schuetzen fremde Texte (F1, F6)', () => {
  it('ResultModal: Asset-Code =1+1 bekommt ein \', Issuer mit ; wird gequotet', () => {
    wrap(<ResultModal deletedTrustlines={[{ assetCode: '=1+1', assetIssuer: 'x;=2+2', txId: 'abc' }]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Als CSV speichern' }));
    expect(exported).toHaveLength(1);
    expect(exported[0].split('\n')[1]).toBe('\'=1+1,"x;=2+2",abc');
  });

  it('InvestedTokensPanel: Memo =1+1 bekommt ein \', Memo mit ; wird gequotet', async () => {
    hoisted.groupfund.mockResolvedValue({
      items: [
        { group: '=1+1', occurrences: 1, totalAmount: 5, topDestination: '', sample: { created_at: '2024-01-02T03:04:05Z' } },
        { group: 'x;=2+2', occurrences: 2, totalAmount: 1, topDestination: '', sample: null },
      ],
    });
    wrap(<InvestedTokensPanel publicKey={PK} />);
    fireEvent.click(screen.getByRole('button', { name: 'Laden' }));
    await waitFor(() => expect(hoisted.groupfund).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Laden' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Als CSV speichern' }));
    expect(exported).toHaveLength(1);
    const lines = exported[0].split('\n');
    expect(lines).toContain('\'=1+1,1,5.0000000,,,2024-01-02T03:04:05.000Z,NO,NO');
    expect(lines).toContain('"x;=2+2",2,1.0000000,,,,NO,NO');
  });

  it('XlmByMemoPanel: Memo =1+1 bekommt ein \', Memo mit , wird im ;-Export gequotet', async () => {
    const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const op = (id, memo) => ({
      id, type: 'payment', from: 'GSENDER', to: PK, amount: '1.0000000', asset_type: 'native',
      created_at: createdAt, transaction_hash: `h${id}`, transaction: { memo },
    });
    hoisted.operations.mockReturnValue({ records: [op('1', '=1+1'), op('2', 'x,=2+2')] });
    wrap(<XlmByMemoPanel publicKey={PK} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alle Operationen exportieren' }));
    await waitFor(() => expect(exported).toHaveLength(1));
    console.log('EXPORT>>', JSON.stringify(exported[0]).slice(0,600));
    const lines = exported[0].replace(/^\uFEFF/, '').split('\n');
    const memoOf = (line) => line.split(';').slice(17).join(';');
    expect(memoOf(lines[1])).toBe('\'=1+1;tx');
    expect(memoOf(lines[2])).toBe('"x,=2+2";tx');
  });
});
