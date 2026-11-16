// isTestnetAccount: erst Mainnet, Testnet nur, wenn das Konto dort sicher nicht existiert.
// Vorher fragte es beide Netze parallel, und jedes Mainnet-Konto erzeugte einen 404 bei Horizon Testnet.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORKS } from '../../../config/networks.js';

const hoisted = vi.hoisted(() => ({ calls: [], answer: {} }));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const orig = await importOriginal();
  class Server {
    constructor(url) { this.url = url; }
    accounts() {
      return {
        accountId: (id) => ({
          call: async () => {
            hoisted.calls.push(this.url);
            const a = hoisted.answer[this.url];
            if (a === 'found') return { id };
            if (a === '404') throw Object.assign(new Error('nf'), { response: { status: 404 } });
            throw new Error('network');
          },
        }),
      };
    }
  }
  return { ...orig, Horizon: { ...orig.Horizon, Server } };
});

const { isTestnetAccount } = await import('../accountUtils.js');
const MAIN = NETWORKS.PUBLIC.horizonUrl;
const TEST = NETWORKS.TESTNET.horizonUrl;
const PK = 'GD4HFE6CEEPT6GTFAMSPUFAOC6WOYXZ5I5GZN3XVIJZCIUO2A5EXKYXG';

beforeEach(() => { hoisted.calls.length = 0; hoisted.answer = {}; });

describe('isTestnetAccount', () => {
  it('Mainnet-Konto: false, ohne Abfrage bei Horizon Testnet', async () => {
    hoisted.answer = { [MAIN]: 'found', [TEST]: '404' };
    expect(await isTestnetAccount(PK)).toBe(false);
    expect(hoisted.calls).toEqual([MAIN]);
  });

  it('Mainnet nicht erreichbar: false, ohne Abfrage bei Horizon Testnet', async () => {
    hoisted.answer = { [MAIN]: 'error', [TEST]: 'found' };
    expect(await isTestnetAccount(PK)).toBe(false);
    expect(hoisted.calls).toEqual([MAIN]);
  });

  it('nur im Testnet: true, Testnet erst nach dem Mainnet-404', async () => {
    hoisted.answer = { [MAIN]: '404', [TEST]: 'found' };
    expect(await isTestnetAccount(PK)).toBe(true);
    expect(hoisted.calls).toEqual([MAIN, TEST]);
  });

  it('in keinem Netz oder Testnet nicht erreichbar: false', async () => {
    hoisted.answer = { [MAIN]: '404', [TEST]: '404' };
    expect(await isTestnetAccount(PK)).toBe(false);
    hoisted.answer = { [MAIN]: '404', [TEST]: 'error' };
    expect(await isTestnetAccount(PK)).toBe(false);
  });
});
