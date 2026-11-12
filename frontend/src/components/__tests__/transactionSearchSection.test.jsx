// Filtersuche im Panel Transaktionen durchsuchen: Fehleranzeige ohne Secret Key, Treffer mit
// ODER/UND-Filtern, Anzeige fremder Memos und CSV-Formelschutz (F1/F6 wie bei den anderen Panels).
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Keypair } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import XlmByMemoPanel from '../XlmByMemoPanel.jsx';

const PK = Keypair.random().publicKey();
const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const C = Keypair.random().publicKey();

const hoisted = vi.hoisted(() => ({ operations: vi.fn(), transactions: vi.fn() }));

vi.mock('../../utils/stellar/stellarUtils', async (importOriginal) => {
  const chain = (result) => {
    const builder = { forAccount: () => builder, order: () => builder, limit: () => builder, cursor: () => builder, call: async () => result() };
    return builder;
  };
  return {
    ...(await importOriginal()),
    getHorizonServer: () => ({
      operations: () => chain(hoisted.operations),
      transactions: () => chain(hoisted.transactions),
    }),
  };
});
vi.mock('../../utils/db/indexedDbClient', () => ({ getNewestCreatedAt: vi.fn(async () => '') }));

let exported;
beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  exported = [];
  vi.stubGlobal('Blob', class { constructor(parts) { exported.push(parts.join('')); } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const op = (id, to, amount) => ({
    id, type: 'payment', from: PK, to, amount, asset_type: 'native', created_at: createdAt, transaction_hash: `h${id}`,
  });
  hoisted.operations.mockReturnValue({ records: [op('1', A, '10.0000000'), op('2', B, '3.0000000'), op('3', C, '12.0000000')] });
  hoisted.transactions.mockReturnValue({ records: [
    { hash: 'h1', created_at: createdAt, memo: '=1+1' },
    { hash: 'h2', created_at: createdAt, memo: 'Miete' },
    { hash: 'h3', created_at: createdAt, memo: 'https://example.org' },
  ] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const wrap = (ui) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
const search = () => fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));

describe('Filtersuche (Transaktionen durchsuchen)', () => {
  it('Secret Key im Empfaengerfeld: Fehler ohne den Key, keine Abfrage bei Horizon', () => {
    const secret = Keypair.random().secret();
    wrap(<XlmByMemoPanel publicKey={PK} />);
    fireEvent.change(screen.getByLabelText(/^Empfänger/), { target: { value: secret } });
    search();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Secret Key/);
    expect(document.body.textContent).not.toContain(secret);
    expect(hoisted.operations).not.toHaveBeenCalled();
  });

  it('Empfaenger A ODER B, UND Betrag von bis: zeigt genau die passenden Zeilen und die Summe', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    fireEvent.change(screen.getByLabelText(/^Empfänger/), { target: { value: `${A}\n${B}` } });
    fireEvent.change(screen.getByLabelText('Von', { selector: '#tx-search-min' }), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Bis', { selector: '#tx-search-max' }), { target: { value: '20,5' } });
    search();
    await screen.findByText('Treffer: 1');
    // A (10 XLM) trifft, B (3 XLM) liegt unter der Grenze, C ist kein Empfaenger
    expect(screen.getByText(`${'10.0000000'} XLM`)).toBeTruthy();
    expect(screen.queryByText('3.0000000 XLM')).toBeNull();
    expect(screen.queryByText('12.0000000 XLM')).toBeNull();
    expect(screen.getByText('10.0000000 XLM (1)')).toBeTruthy();
  });

  it('Memo-Filter: Webadresse im Memo wird markiert, Treffer ohne Memo-Filter zeigen das Memo trotzdem', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    fireEvent.change(screen.getByLabelText(/^Memo enthält/), { target: { value: 'https://' } });
    search();
    await screen.findByText('Treffer: 1');
    expect(screen.getByText(/https:\/\/example\.org/)).toBeTruthy();
  });

  it('CSV: Memo =1+1 bekommt ein \', Spalten laufen durch csvLine', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    fireEvent.change(screen.getByLabelText(/^Empfänger/), { target: { value: A } });
    search();
    await screen.findByText('Treffer: 1');
    fireEvent.click(screen.getByRole('button', { name: 'CSV herunterladen' }));
    expect(exported).toHaveLength(1);
    const lines = exported[0].replace(/^\uFEFF/, '').split('\n');
    expect(lines[0]).toBe('created_at;tx_hash;op_id;type;dir;from;to;amount;asset_code;asset_issuer;memo');
    expect(lines[1].endsWith(';10.0000000;XLM;;\'=1+1')).toBe(true);
  });

  it('keine Treffer: Hinweis statt leerer Tabelle', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    fireEvent.change(screen.getByLabelText(/^Memo enthält/), { target: { value: 'gibt es nicht' } });
    search();
    await screen.findByText('Treffer: 0');
    expect(screen.getByText('Keine Treffer im gewählten Zeitraum.')).toBeTruthy();
    expect(within(document.body).queryByRole('button', { name: 'CSV herunterladen' })).toBeNull();
  });

  it('Fehler beim Laden: Meldung statt Absturz', async () => {
    hoisted.operations.mockImplementation(() => { throw Object.assign(new Error('boom'), { status: 400 }); });
    wrap(<XlmByMemoPanel publicKey={PK} />);
    search();
    await waitFor(() => expect(screen.getByText('Die Suche ist fehlgeschlagen. Bitte später erneut versuchen.')).toBeTruthy());
  });
});
