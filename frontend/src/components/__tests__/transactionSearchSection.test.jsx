// Transaktionen durchsuchen: Operationen einmal laden, danach live filtern (Suchfeld, Chips, Richtung),
// sortieren, Konto-Wechsel verwirft die Liste, Secret Keys werden abgelehnt, CSV mit Formelschutz.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const load = async (total = 3) => {
  fireEvent.click(screen.getByRole('button', { name: 'Laden' }));
  await screen.findByText(`Treffer: ${total} von ${total}`);
};
const addFilter = (kind) => {
  fireEvent.click(screen.getByRole('button', { name: /Filter$/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: kind }));
};
const rowAmounts = () => [...document.querySelectorAll('section .font-mono')]
  .map((n) => n.textContent).filter((x) => /^\d+\.\d{7} XLM$/.test(x));

describe('Transaktionen durchsuchen', () => {
  it('vor dem Laden: nur Hinweis, keine Suche, nichts bei Horizon abgefragt', () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    expect(screen.getByText(/Lade zuerst die Operationen/)).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(hoisted.operations).not.toHaveBeenCalled();
  });

  it('Memo-Suchfeld filtert live, ohne neue Abfrage bei Horizon', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    const calls = hoisted.operations.mock.calls.length;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Miete' } });
    await screen.findByText('Treffer: 1 von 3');
    expect(rowAmounts()).toEqual(['3.0000000 XLM']);
    expect(hoisted.operations.mock.calls.length).toBe(calls);
  });

  it('Eingabetaste macht aus dem Memo einen Chip, zwei Memo-Chips sind ODER', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'Miete' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('');
    expect(screen.getByText('Memo: Miete')).toBeTruthy();
    fireEvent.change(box, { target: { value: '=1+1' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText('Treffer: 2 von 3');
    fireEvent.click(screen.getByRole('button', { name: 'Filter entfernen: Memo: Miete' }));
    await screen.findByText('Treffer: 1 von 3');
  });

  it('Empfaenger-Chip: Secret Key wird abgelehnt und aus dem Feld entfernt, G-Adresse filtert', async () => {
    const secret = Keypair.random().secret();
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    addFilter('Empfänger');
    const input = screen.getByRole('textbox', { name: 'Empfänger' });
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toMatch(/Secret Key/);
    expect(document.body.innerHTML).not.toContain(secret);
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: `${A} ${B}` } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Treffer: 2 von 3');
    expect(rowAmounts().sort()).toEqual(['10.0000000 XLM', '3.0000000 XLM']);
  });

  it('Empfaenger-Chip mit ungueltiger Adresse zeigt einen Fehler und aendert nichts', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    addFilter('Empfänger');
    const input = screen.getByRole('textbox', { name: 'Empfänger' });
    fireEvent.change(input, { target: { value: 'hallo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toMatch(/Keine gültige G- oder M-Adresse: hallo/);
    expect(screen.getByText('Treffer: 3 von 3')).toBeTruthy();
  });

  it('Betrag-Chip: Von bis, Summe je Asset; ungueltig oder leer wird nicht uebernommen', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    addFilter('Betrag');
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Von oder Bis/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Von' }), { target: { value: '5' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Bis' }), { target: { value: '20,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await screen.findByText('Treffer: 2 von 3');
    expect(screen.getByText('Betrag 5 – 20,5 XLM')).toBeTruthy();
    expect(screen.getByText('22.0000000 XLM (2)')).toBeTruthy();
  });

  it('Memo enthaelt nicht: schliesst Treffer aus, Operationen ohne Memo bleiben', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    addFilter('Memo enthält nicht');
    const input = screen.getByRole('textbox', { name: 'Memo enthält nicht' });
    fireEvent.change(input, { target: { value: 'Miete' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Treffer: 2 von 3');
    expect(rowAmounts()).not.toContain('3.0000000 XLM');
  });

  it('Richtung: alle Zahlungen im Test gehen vom Konto aus, Eingang zeigt keine Treffer', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    fireEvent.click(screen.getByRole('button', { name: 'Eingang' }));
    await screen.findByText('Treffer: 0 von 3');
    expect(screen.getByText('Keine Treffer. Passe die Filter an.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    await screen.findByText('Treffer: 3 von 3');
  });

  it('Sortierung nach Betrag ersetzt die Top-Liste: groesster Betrag zuerst, zweiter Klick dreht um', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    fireEvent.click(screen.getByRole('button', { name: /^Betrag/ }));
    expect(rowAmounts()).toEqual(['12.0000000 XLM', '10.0000000 XLM', '3.0000000 XLM']);
    fireEvent.click(screen.getByRole('button', { name: /^Betrag/ }));
    expect(rowAmounts()).toEqual(['3.0000000 XLM', '10.0000000 XLM', '12.0000000 XLM']);
  });

  it('CSV: exportiert die gefilterte Liste, Memo =1+1 bekommt ein \'', async () => {
    wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '=1' } });
    await screen.findByText('Treffer: 1 von 3');
    fireEvent.click(screen.getByRole('button', { name: 'CSV herunterladen' }));
    expect(exported).toHaveLength(1);
    const lines = exported[0].replace(/^\uFEFF/, '').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('created_at;tx_hash;op_id;type;dir;from;to;amount;asset_code;asset_issuer;memo');
    expect(lines[1].endsWith(';10.0000000;XLM;;\'=1+1')).toBe(true);
  });

  it('Kontowechsel verwirft die geladene Liste', async () => {
    const view = wrap(<XlmByMemoPanel publicKey={PK} />);
    await load();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Miete' } });
    view.rerender(<I18nextProvider i18n={i18n}><XlmByMemoPanel publicKey={A} /></I18nextProvider>);
    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull());
    expect(screen.getByText(/Lade zuerst die Operationen/)).toBeTruthy();
  });

  it('Ladefehler: Meldung statt Absturz, keine Suche', async () => {
    hoisted.operations.mockImplementation(() => { throw Object.assign(new Error('boom'), { status: 400 }); });
    wrap(<XlmByMemoPanel publicKey={PK} />);
    fireEvent.click(screen.getByRole('button', { name: 'Laden' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/konnten nicht geladen werden/));
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
