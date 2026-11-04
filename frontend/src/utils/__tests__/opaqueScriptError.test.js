import { describe, it, expect } from 'vitest';
import { isOpaqueScriptError, isForeignScriptError } from '../opaqueScriptError.js';

const PREFIX = 'https://skm.steei.de/assets/';

describe('isOpaqueScriptError', () => {
  it('erkennt den maskierten Fehler fremder Skripte', () => {
    expect(isOpaqueScriptError('Script error.', '', 0, 0, null)).toBe(true);
    expect(isOpaqueScriptError('Script error', undefined, undefined, undefined, undefined)).toBe(true);
  });

  it('laesst echte Fehler mit Quelle oder Error-Objekt durch', () => {
    expect(isOpaqueScriptError('Script error.', `${PREFIX}index.js`, 12, 3, null)).toBe(false);
    expect(isOpaqueScriptError('Script error.', '', 0, 0, new Error('x'))).toBe(false);
    expect(isOpaqueScriptError('TypeError: x is undefined', '', 0, 0, null)).toBe(false);
  });
});

describe('isForeignScriptError', () => {
  it('eingeschleuster Code (Quelle ist die Seite selbst, z. B. Brave Wallet) gilt als fremd', () => {
    const error = new TypeError("undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')");
    error.stack = 'global code@https://skm.steei.de/multisig/jobs:1:16';
    expect(isForeignScriptError({
      message: `TypeError: ${error.message}`, source: 'https://skm.steei.de/multisig/jobs', lineno: 1, colno: 16, error, assetPrefix: PREFIX,
    })).toBe(true);
  });

  it('Fehler aus den eigenen Dateien werden weiter angezeigt', () => {
    expect(isForeignScriptError({ message: 'TypeError: x', source: `${PREFIX}index-abc.js`, lineno: 1, colno: 2, error: null, assetPrefix: PREFIX })).toBe(false);
    const error = new Error('boom');
    error.stack = `Error: boom\n    at f (${PREFIX}chunk-1.js:3:4)`;
    expect(isForeignScriptError({ message: 'Error: boom', source: '', lineno: 0, colno: 0, error, assetPrefix: PREFIX })).toBe(false);
  });

  it('im Dev-Modus wird alles ausser dem maskierten Fehler angezeigt', () => {
    expect(isForeignScriptError({ message: 'TypeError: x', source: 'http://localhost:5173/src/main.jsx', lineno: 1, colno: 1, error: null, assetPrefix: PREFIX, dev: true })).toBe(false);
    expect(isForeignScriptError({ message: 'Script error.', source: '', lineno: 0, colno: 0, error: null, assetPrefix: PREFIX, dev: true })).toBe(true);
  });
});
