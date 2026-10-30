import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import ClearInputButton from '../ClearInputButton.jsx';

describe('ClearInputButton', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('ist beschriftet, loest nicht als Submit aus und ruft onClick', () => {
    const onClick = vi.fn();
    render(<I18nextProvider i18n={i18n}><ClearInputButton onClick={onClick} /></I18nextProvider>);
    const button = screen.getByRole('button', { name: 'Eingabe löschen' });
    expect(button).toHaveAttribute('title', 'Eingabe löschen');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('absolute', 'right-1', 'rounded-full', 'w-7', 'h-7', 'md:w-6', 'md:h-6', 'bg-gray-300', 'hover:bg-red-500');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
