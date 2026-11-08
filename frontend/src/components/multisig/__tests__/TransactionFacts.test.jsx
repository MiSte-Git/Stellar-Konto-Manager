import React from 'react';
import { render, screen } from '@testing-library/react';
import TransactionFacts from '../TransactionFacts.jsx';

// F11: Memo und Adressen sind Fremdtext: links-nach-rechts, isoliert, Memo und Adressen monospace.
describe('TransactionFacts', () => {
  const details = {
    rows: [
      { key: 'source', label: 'Quellkonto', value: 'GABC', wrap: true },
      { key: 'memo', label: 'Memo', value: '"אב 123"', wrap: true, emphasis: true, warn: false },
      { key: 'fee', label: 'Fee', value: '0,00001 XLM', emphasis: true, warn: true },
    ],
  };

  it('setzt dir=ltr und unicode-bidi isolate auf jeden Wert', () => {
    render(<TransactionFacts details={details} title="Details" />);
    for (const key of ['source', 'memo', 'fee']) {
      const cell = screen.getByTestId(`job-tx-row-${key}`).querySelector('td');
      expect(cell).toHaveAttribute('dir', 'ltr');
      expect(cell.style.unicodeBidi).toBe('isolate');
    }
  });

  it('zeigt das Memo in monospace und gelb nur bei warn', () => {
    render(<TransactionFacts details={details} title="Details" />);
    expect(screen.getByTestId('job-tx-row-memo').querySelector('td').className).toContain('font-mono');
    expect(screen.getByTestId('job-tx-row-fee')).toHaveAttribute('data-warn', 'true');
    expect(screen.getByTestId('job-tx-row-memo')).not.toHaveAttribute('data-warn');
  });
});
