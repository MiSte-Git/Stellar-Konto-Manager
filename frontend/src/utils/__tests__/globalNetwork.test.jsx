import React from 'react';
import { act, render } from '@testing-library/react';
import { installCrossTabNetworkSync, setGlobalNetwork, useGlobalNetwork, networkFromEvent } from '../globalNetwork.js';

function Probe() {
  const [network] = useGlobalNetwork();
  return <span data-testid="net">{network}</span>;
}

describe('globalNetwork', () => {
  beforeEach(() => window.localStorage.clear());

  it('setGlobalNetwork schreibt SKM_NETWORK, SKM_HORIZON_URL und meldet den Wechsel', () => {
    const events = [];
    const listener = (e) => events.push(e.detail);
    window.addEventListener('stm-network-changed', listener);
    expect(setGlobalNetwork('TESTNET')).toBe('TESTNET');
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe('TESTNET');
    expect(window.localStorage.getItem('SKM_HORIZON_URL')).toBe('https://horizon-testnet.stellar.org');
    expect(setGlobalNetwork('PUBLIC')).toBe('PUBLIC');
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe('PUBLIC');
    expect(window.localStorage.getItem('SKM_HORIZON_URL')).toBeNull();
    window.removeEventListener('stm-network-changed', listener);
    expect(events).toEqual(['TESTNET', 'PUBLIC']);
  });

  it('unbekannte oder deaktivierte Netze ergeben PUBLIC', () => {
    expect(setGlobalNetwork('FUTURENET')).toBe('PUBLIC');
    expect(setGlobalNetwork('foo')).toBe('PUBLIC');
    expect(window.localStorage.getItem('SKM_NETWORK')).toBe('PUBLIC');
  });

  it('networkFromEvent nimmt ein gueltiges detail, sonst localStorage', () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    expect(networkFromEvent({ detail: 'PUBLIC' })).toBe('PUBLIC');
    expect(networkFromEvent({ detail: 'FUTURENET' })).toBe('TESTNET');
    expect(networkFromEvent({})).toBe('TESTNET');
  });

  it('useGlobalNetwork folgt Wechseln per Event', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('net').textContent).toBe('TESTNET');
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(getByTestId('net').textContent).toBe('PUBLIC');
  });

  it('Wechsel aus anderem Tab: ohne Bruecke kein Event, mit Bruecke ein normales stm-network-changed', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const { getByTestId } = render(<Probe />);
    const events = [];
    const listener = (e) => events.push(e.detail);
    window.addEventListener('stm-network-changed', listener);

    // Ohne installierte Bruecke reagiert der Hook nicht selbst auf storage
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'SKM_NETWORK' })); });
    expect(events).toEqual([]);
    expect(getByTestId('net').textContent).toBe('PUBLIC');

    const uninstall = installCrossTabNetworkSync();
    expect(installCrossTabNetworkSync()).toBe(uninstall); // nur einmal
    try {
      await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'SKM_NETWORK' })); });
      expect(events).toEqual(['TESTNET']);
      expect(getByTestId('net').textContent).toBe('TESTNET');
      // Andere Schluessel loesen nichts aus
      await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'recentWallets' })); });
      expect(events).toEqual(['TESTNET']);
      // localStorage.clear() im anderen Tab (key null): Standardnetz
      window.localStorage.clear();
      await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
      expect(events).toEqual(['TESTNET', 'PUBLIC']);
    } finally {
      uninstall();
      window.removeEventListener('stm-network-changed', listener);
    }
  });
});
