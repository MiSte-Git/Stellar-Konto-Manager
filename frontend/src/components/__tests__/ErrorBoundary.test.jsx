import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import i18n from '../../i18n.js';
import ErrorBoundary from '../ErrorBoundary.jsx';

function Boom() { throw new Error('Renderfehler im Test'); }
function Host() {
  const { t } = useTranslation(['common']);
  return <ErrorBoundary t={t}><Boom /></ErrorBoundary>;
}

describe('ErrorBoundary', () => {
  it('warnt vor verlorenen Schluesseln, Neuladen nur nach Bestaetigung, kein Secret im Speicher', async () => {
    await i18n.changeLanguage('de');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    const idbOpen = window.indexedDB ? vi.spyOn(window.indexedDB, 'open') : null;
    const orig = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...orig, reload } });
    render(<I18nextProvider i18n={i18n}><Host /></I18nextProvider>);
    expect(screen.getByTestId('error-boundary-keys-warning').textContent).toMatch(/nicht gesichert/);
    const btn = screen.getByTestId('error-boundary-reload');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('error-boundary-ack'));
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(reload).toHaveBeenCalledTimes(1);
    // Kein Secret im Speicher: Der Fehlerpfad schreibt weder in Web Storage noch in IndexedDB.
    expect(setLocal).not.toHaveBeenCalled();
    if (idbOpen) expect(idbOpen).not.toHaveBeenCalled();
    setLocal.mockRestore();
    idbOpen?.mockRestore();
    Object.defineProperty(window, 'location', { configurable: true, value: orig });
  });
});
