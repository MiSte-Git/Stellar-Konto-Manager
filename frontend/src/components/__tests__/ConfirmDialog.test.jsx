import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import { useConfirmDialog } from '../useConfirmDialog.jsx';

function Host({ onResult }) {
  const { confirm, dialog } = useConfirmDialog();
  return (
    <div>
      <button type="button" onClick={async () => onResult(await confirm({ message: 'Wirklich?' }))}>go</button>
      {dialog}
    </div>
  );
}

const setup = () => {
  const results = [];
  render(<I18nextProvider i18n={i18n}><Host onResult={(v) => results.push(v)} /></I18nextProvider>);
  return results;
};

describe('ConfirmDialog', () => {
  it('Ja liefert true, Abbrechen, X und Escape liefern false', async () => {
    const results = setup();
    for (const action of [
      () => fireEvent.click(screen.getByTestId('confirm-dialog-ok')),
      () => fireEvent.click(screen.getByTestId('confirm-dialog-cancel')),
      () => fireEvent.click(screen.getByTestId('confirm-dialog-x')),
      () => fireEvent.keyDown(window, { key: 'Escape' }),
    ]) {
      await act(async () => { fireEvent.click(screen.getByText('go')); });
      expect(screen.getByTestId('confirm-dialog').textContent).toContain('Wirklich?');
      await act(async () => { action(); });
      expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    }
    expect(results).toEqual([true, false, false, false]);
  });
});
