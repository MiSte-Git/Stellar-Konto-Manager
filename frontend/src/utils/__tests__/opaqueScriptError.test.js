import { describe, it, expect } from 'vitest';
import { isOpaqueScriptError } from '../opaqueScriptError.js';

describe('isOpaqueScriptError', () => {
  it('erkennt den maskierten Fehler fremder Skripte', () => {
    expect(isOpaqueScriptError('Script error.', '', 0, 0, null)).toBe(true);
    expect(isOpaqueScriptError('Script error', undefined, undefined, undefined, undefined)).toBe(true);
  });

  it('laesst echte Fehler mit Quelle oder Error-Objekt durch', () => {
    expect(isOpaqueScriptError('Script error.', 'https://skm.steei.de/assets/index.js', 12, 3, null)).toBe(false);
    expect(isOpaqueScriptError('Script error.', '', 0, 0, new Error('x'))).toBe(false);
    expect(isOpaqueScriptError('TypeError: x is undefined', '', 0, 0, null)).toBe(false);
  });
});
