import React from 'react';
import { render, screen } from '@testing-library/react';
import { formatAmountWithUnit, formatPoolAmount } from '../formatPoolAmount.js';
import { FactList, FactRow } from '../LiquidityDialogShell.jsx';
import { toStroops } from '../../../utils/stellar/liquidityPools.js';

describe('formatPoolAmount', () => {
  it('zeigt immer mindestens eine Nachkommastelle, damit Tausender- und Dezimaltrenner eindeutig sind', () => {
    expect(formatPoolAmount(toStroops('1111'), 'de')).toBe('1.111,0');
    expect(formatPoolAmount(toStroops('1.111'), 'de')).toBe('1,111');
    expect(formatPoolAmount(toStroops('1111'), 'en')).toBe('1,111.0');
    // Apostroph-Zeichen haengt von der ICU-Version ab (' oder ’)
    expect(formatPoolAmount(toStroops('1111'), 'de-CH')).toMatch(/^1['’]111\.0$/);
    expect(formatPoolAmount(0n, 'de')).toBe('0,0');
    expect(formatPoolAmount(toStroops('0.0000001'), 'de')).toBe('0,0000001');
  });

  it('haengt die Einheit an', () => {
    expect(formatAmountWithUnit(toStroops('1111'), 'XLM', 'de')).toBe('1.111,0 XLM');
  });
});

describe('FactRow / FactList', () => {
  it('zeigt Label, Zusatzzeile und Wert; Zahlen ohne break-all, nur wrap-Werte duerfen umbrechen', () => {
    render(
      <FactList rows={[
        ['Erwartete Pool Shares', '30,0 Pool Shares', { hint: 'Richtwert' }],
        false,
        ['Pool-ID', 'a'.repeat(64), { wrap: true }],
      ]} />
    );
    const amount = screen.getByText('30,0 Pool Shares');
    expect(amount.tagName).toBe('DD');
    expect(amount.className).not.toContain('break-all');
    expect(amount.className).toContain('sm:whitespace-nowrap');
    expect(amount.className).toContain('sm:text-right');
    expect(screen.getByText('Richtwert').closest('dt')).toHaveTextContent('Erwartete Pool SharesRichtwert');
    expect(screen.getByText('a'.repeat(64)).className).toContain('break-all');
    expect(screen.getAllByRole('definition')).toHaveLength(2);
  });

  it('stapelt auf schmalen Breiten und setzt ab sm Label links, Wert rechts', () => {
    const { container } = render(<dl><FactRow label="Fee" value="0,00002 XLM" /></dl>);
    const row = container.querySelector('dl > div');
    expect(row.className).toContain('flex-col');
    expect(row.className).toContain('sm:flex-row');
    expect(row.className).toContain('sm:justify-between');
  });
});
