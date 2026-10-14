import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import XlmPriceTicker from '../XlmPriceTicker.jsx';
import { useXlmPrice } from '../../../utils/useXlmPrice.js';

function Harness() {
  const price = useXlmPrice();
  return <XlmPriceTicker price={price} />;
}

describe('XlmPriceTicker', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { eur: 0.25, eur_24h_change: 1.5, chf: 0.23, chf_24h_change: -2 } }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('zeigt Kurs und 24h-Veraenderung und merkt sich die Waehrung', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>
    );
    expect(await screen.findByText(/▲/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain('api.coingecko.com');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'CHF' } });
    expect(await screen.findByText(/▼/)).toBeInTheDocument();
    expect(window.localStorage.getItem('SKM_XLM_PRICE_PAIR')).toBe('CHF');
  });

  it('zeigt n/a, wenn der Abruf fehlschlaegt', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>
    );
    expect(await screen.findByText('n/a')).toBeInTheDocument();
  });
});
