import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import XlmPriceTicker from '../XlmPriceTicker.jsx';
import PriceCurrencyMenu from '../PriceCurrencyMenu.jsx';
import {
  useXlmPrice,
  PRICE_CACHE_KEY,
  backoffMs,
  priceFetchDecision,
  REFRESH_MS,
  MAX_BACKOFF_MS,
} from '../../../utils/useXlmPrice.js';

function Harness() {
  const price = useXlmPrice();
  return (
    <>
      <XlmPriceTicker price={price} />
      <PriceCurrencyMenu price={price} />
    </>
  );
}

describe('XlmPriceTicker', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stellar: { eur: 0.25, eur_24h_change: 1.5, chf: 0.23, chf_24h_change: -2 },
        ripple: { eur: 0.5, eur_24h_change: 0.01, chf: 0.47, chf_24h_change: 3 },
      }),
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
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain('ripple');
    const xrpBox = screen.getByTestId('xrp-price-ticker');
    expect(xrpBox).toHaveTextContent('XRP');
    expect(xrpBox).toHaveTextContent('€');
    expect(xrpBox).toHaveTextContent('•');

    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByTestId('price-currency-button'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /CHF/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('price-currency-button')).toHaveTextContent('CHF');
    expect(await screen.findByText(/▼/)).toBeInTheDocument();
    expect(screen.getByTestId('xrp-price-ticker')).toHaveTextContent('▲');
    expect(screen.getByTestId('xrp-price-ticker')).toHaveTextContent('CHF');
    expect(window.localStorage.getItem('SKM_XLM_PRICE_PAIR')).toBe('CHF');
  });

  it('zeigt n/a, wenn der Abruf fehlschlaegt', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>
    );
    expect(await screen.findAllByText('n/a')).toHaveLength(2);
  });

  it('nutzt einen frischen Cache aus einem anderen Tab ohne Abruf', async () => {
    window.localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({
      at: Date.now(),
      data: { stellar: { eur: 0.3, eur_24h_change: 2 }, ripple: { eur: 0.6, eur_24h_change: -1 } },
      failCount: 0,
      retryAt: 0,
    }));
    render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>
    );
    expect(await screen.findByText(/▲/)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('ruft bei veraltetem Cache neu ab und schreibt den Cache', async () => {
    window.localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({
      at: Date.now() - REFRESH_MS * 2,
      data: { stellar: { eur: 0.3 } },
    }));
    render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>
    );
    expect(await screen.findByText(/▲/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const cache = JSON.parse(window.localStorage.getItem(PRICE_CACHE_KEY));
    expect(cache.data.stellar.eur).toBe(0.25);
    expect(cache.failCount).toBe(0);
  });

  it('vermerkt einen Fehler mit Wartezeit und ruft in der Wartezeit nicht ab', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const first = render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>
    );
    expect(await screen.findAllByText('n/a')).toHaveLength(2);
    const cache = JSON.parse(window.localStorage.getItem(PRICE_CACHE_KEY));
    expect(cache.failCount).toBe(1);
    expect(cache.retryAt).toBeGreaterThan(Date.now() + REFRESH_MS);
    first.unmount();

    // Zweiter Tab waehrend der Wartezeit: kein weiterer Abruf.
    globalThis.fetch.mockClear();
    render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>
    );
    expect(await screen.findAllByText('n/a')).toHaveLength(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('ruft in einem verborgenen Tab nicht ab', async () => {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      render(
        <I18nextProvider i18n={i18n}>
          <Harness />
        </I18nextProvider>
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(globalThis.fetch).not.toHaveBeenCalled();

      // Beim Sichtbarwerden wird nachgeholt.
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(await screen.findByText(/▲/)).toBeInTheDocument();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      delete document.visibilityState;
      if (desc) Object.defineProperty(Document.prototype, 'visibilityState', desc);
    }
  });
});

describe('Kursabruf-Regeln', () => {
  it('Wartezeit verdoppelt sich bis zur Obergrenze', () => {
    expect(backoffMs(1)).toBe(REFRESH_MS * 2);
    expect(backoffMs(2)).toBe(REFRESH_MS * 4);
    expect(backoffMs(3)).toBe(REFRESH_MS * 8);
    expect(backoffMs(4)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(20)).toBe(MAX_BACKOFF_MS);
  });

  it('priceFetchDecision', () => {
    const now = 1_000_000_000;
    expect(priceFetchDecision({}, now)).toBe('fetch');
    expect(priceFetchDecision({ at: now - 1000, data: {} }, now)).toBe('cache');
    expect(priceFetchDecision({ at: now - REFRESH_MS, data: {} }, now)).toBe('fetch');
    expect(priceFetchDecision({ at: now - REFRESH_MS * 5, data: {}, retryAt: now + 1 }, now)).toBe('cache');
    expect(priceFetchDecision({ retryAt: now + 1 }, now)).toBe('wait');
    expect(priceFetchDecision({ retryAt: now - 1 }, now)).toBe('fetch');
  });
});
