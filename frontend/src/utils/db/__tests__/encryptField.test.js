import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptField } from '../indexedDbClient.js';

// encryptField() is otherwise only reachable through IndexedDB-backed calls
// (bulkUpsertPayments etc.), and this project has no IndexedDB polyfill for
// jsdom - so this covers only the crypto-unavailable guard, which returns
// before ever touching IndexedDB. Full round-trip encryption is exercised
// indirectly whenever the app runs against a real browser.
describe('encryptField fails closed when crypto.subtle is unavailable', () => {
  let realSubtle;
  beforeEach(() => {
    realSubtle = crypto.subtle;
    // Simulates a non-secure origin (e.g. plain http over a LAN IP).
    Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(crypto, 'subtle', { value: realSubtle, configurable: true });
  });

  it('throws error.cache.insecureContext instead of returning the plaintext memo', async () => {
    await expect(encryptField('a private memo')).rejects.toThrow('error.cache.insecureContext');
  });

  it('still returns empty string for an empty value without needing crypto at all', async () => {
    await expect(encryptField('')).resolves.toBe('');
  });
});
