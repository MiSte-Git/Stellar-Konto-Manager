// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  NETWORKS,
  ENABLED_NETWORK_IDS,
  normalizeNetworkId,
  isNetworkEnabled,
  getNetworkConfig,
  horizonUrlFor,
  passphraseFor,
  friendbotUrlFor,
  networkIdForPassphrase,
  readStoredNetworkId,
} from '../networks.js';

describe('Netzwerk-Registry', () => {
  afterEach(() => window.localStorage.clear());

  it('hat die offiziellen Passphrasen', () => {
    expect(NETWORKS.PUBLIC.passphrase).toBe('Public Global Stellar Network ; September 2015');
    expect(NETWORKS.TESTNET.passphrase).toBe('Test SDF Network ; September 2015');
    expect(NETWORKS.FUTURENET.passphrase).toBe('Test SDF Future Network ; October 2022');
  });

  it('aktiviert nur PUBLIC und TESTNET, Futurenet ist vorbereitet', () => {
    expect(ENABLED_NETWORK_IDS).toEqual(['PUBLIC', 'TESTNET']);
    expect(isNetworkEnabled('FUTURENET')).toBe(false);
    expect(NETWORKS.FUTURENET.horizonUrl).toBe('https://horizon-futurenet.stellar.org');
  });

  it('normalisiert Schreibweisen und Aliase', () => {
    expect(normalizeNetworkId('testnet')).toBe('TESTNET');
    expect(normalizeNetworkId(' public ')).toBe('PUBLIC');
    expect(normalizeNetworkId('publicnet')).toBe('PUBLIC');
    expect(normalizeNetworkId('futurenet')).toBe('FUTURENET');
    expect(normalizeNetworkId('quatsch')).toBeNull();
    expect(normalizeNetworkId(null)).toBeNull();
  });

  it('faellt bei unbekanntem Netz auf PUBLIC zurueck (bisheriges Verhalten)', () => {
    expect(getNetworkConfig(undefined).id).toBe('PUBLIC');
    expect(horizonUrlFor('xyz')).toBe('https://horizon.stellar.org');
    expect(horizonUrlFor('testnet')).toBe('https://horizon-testnet.stellar.org');
    expect(passphraseFor('TESTNET')).toBe(NETWORKS.TESTNET.passphrase);
  });

  it('liefert Friendbot nur fuer Testnetze', () => {
    expect(friendbotUrlFor('TESTNET')).toBe('https://friendbot.stellar.org');
    expect(friendbotUrlFor('FUTURENET')).toBe('https://friendbot-futurenet.stellar.org');
    expect(() => friendbotUrlFor('PUBLIC')).toThrow('friendbot.unavailable:PUBLIC');
  });

  it('erkennt das Netz anhand der Passphrase', () => {
    expect(networkIdForPassphrase('Test SDF Future Network ; October 2022')).toBe('FUTURENET');
    expect(networkIdForPassphrase('unbekannt')).toBeNull();
  });

  it('liest nur aktivierte Netze aus localStorage', () => {
    expect(readStoredNetworkId()).toBe('PUBLIC');
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    expect(readStoredNetworkId()).toBe('TESTNET');
    window.localStorage.setItem('SKM_NETWORK', 'FUTURENET');
    expect(readStoredNetworkId()).toBe('PUBLIC');
  });
});
