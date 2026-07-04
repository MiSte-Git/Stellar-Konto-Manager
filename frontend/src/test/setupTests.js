import '@testing-library/jest-dom'
import { vi } from 'vitest'
import { Buffer } from 'buffer'

// jsdom/Vite inject their own partial Buffer global that is incompatible with
// @stellar/stellar-sdk (Keypair, StrKey, ...). Overriding it with the real
// `buffer` package implementation (same one used elsewhere in the app, e.g.
// utils/muxed.js) fixes Keypair.fromSecret() failing under jsdom with
// "private key must be hex string or Uint8Array" even for valid secrets.
globalThis.Buffer = Buffer

// Basic window and i18n mocks if needed
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
