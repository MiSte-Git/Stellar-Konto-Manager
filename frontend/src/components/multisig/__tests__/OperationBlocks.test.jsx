import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import OperationBlocks from '../OperationBlocks.jsx';

const ADDRESS = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const block = (overrides = {}) => ({
  type: 'payment',
  title: 'Zahlung',
  rows: [
    { key: 'amount', label: 'Betrag', value: '1,0 XLM', emphasis: true },
    { key: 'destination', label: 'Empfänger', value: ADDRESS, wrap: true },
  ],
  warnings: [],
  ...overrides,
});

const renderBlocks = (blocks) => render(<I18nextProvider i18n={i18n}><OperationBlocks blocks={blocks} /></I18nextProvider>);

describe('OperationBlocks', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('nummeriert die Bloecke und zeigt Titel und Tabelle mit Label und Wert', () => {
    renderBlocks([block(), block({ type: 'createAccount', title: 'Konto erstellen' })]);
    const [first, second] = screen.getAllByTestId('operation-block');
    expect(first).toHaveTextContent('1. Zahlung');
    expect(second).toHaveTextContent('2. Konto erstellen');
    const row = within(first).getByRole('row', { name: /Empfänger/ });
    expect(row).toHaveTextContent(ADDRESS);
    expect(within(first).getByRole('columnheader', { name: 'Feld' })).toBeInTheDocument();
    expect(within(first).getByRole('columnheader', { name: 'Wert' })).toBeInTheDocument();
  });

  it('bricht Adressen ueberall um, Betraege nur an Wortgrenzen; feste Tabellenbreite gegen horizontales Scrollen', () => {
    renderBlocks([block()]);
    expect(screen.getByText(ADDRESS)).toHaveClass('break-all');
    expect(screen.getByText('1,0 XLM')).not.toHaveClass('break-all');
    expect(screen.getByText('1,0 XLM')).toHaveClass('font-semibold');
    expect(screen.getByRole('table')).toHaveClass('table-fixed', 'w-full');
  });

  it('zeigt Warnungen im Warnstil, unbekannte Operationen im Fehlerstil', () => {
    renderBlocks([
      block({ warnings: ['Diese Operation wird von einem anderen Konto ausgeführt.'] }),
      block({ type: 'manageData', title: 'Unbekannte Operation: manageData', warnings: ['Nicht im Klartext.'] }),
      block({ type: 'bumpSequence' }),
    ]);
    const [warn, unknown, normal] = screen.getAllByTestId('operation-block');
    expect(warn).toHaveClass('border-amber-300');
    expect(within(warn).getByTestId('operation-block-warnings')).toHaveTextContent('anderen Konto ausgeführt');
    expect(unknown).toHaveClass('border-red-300');
    expect(normal).toHaveClass('border-gray-200');
    expect(within(normal).queryByTestId('operation-block-warnings')).toBeNull();
  });

  it('behaelt beim Nachladen den DOM-Knoten eines Blocks', () => {
    const blocks = [block()];
    const view = renderBlocks(blocks);
    const before = screen.getByTestId('operation-block');
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <OperationBlocks blocks={[block({ title: 'Zahlung neu', rows: [{ key: 'amount', label: 'Betrag', value: '2,0 XLM' }] })]} />
      </I18nextProvider>
    );
    expect(screen.getByTestId('operation-block')).toBe(before);
    expect(before).toHaveTextContent('Zahlung neu');
  });
});
