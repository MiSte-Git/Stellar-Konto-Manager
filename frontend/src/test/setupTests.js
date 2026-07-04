import '@testing-library/jest-dom'
import { vi } from 'vitest'
import { Buffer } from 'buffer'
import { Buffer as NodeBuffer } from 'node:buffer'

// jsdom/Vite inject their own partial Buffer global that is incompatible with
// @stellar/stellar-sdk (Keypair, StrKey, ...). Overriding it with the real
// `buffer` package implementation (same one used elsewhere in the app, e.g.
// utils/muxed.js) fixes Keypair.fromSecret() failing under jsdom with
// "private key must be hex string or Uint8Array" even for valid secrets.
globalThis.Buffer = Buffer

// jsdom runs in its own vm context, so its Uint8Array/ArrayBuffer are separate
// constructor objects from Node's native ones. @stellar/stellar-sdk 16 signs
// exclusively through @noble/ed25519, which does a strict `instanceof
// Uint8Array` check - across this realm boundary that check fails even for a
// genuine byte array, so Keypair.fromSecret() throws "expected Uint8Array of
// length 32, got type=object" for valid secrets under jsdom. Node's own
// `node:buffer` module is always evaluated against the true native
// intrinsics (Buffer.prototype's prototype IS the native Uint8Array.prototype),
// so we recover them from there and force jsdom's realm to use the same ones.
const nativeUint8Array = Object.getPrototypeOf(NodeBuffer.prototype).constructor
globalThis.Uint8Array = nativeUint8Array
globalThis.ArrayBuffer = new nativeUint8Array(0).buffer.constructor

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
