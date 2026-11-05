import React from 'react';
import { act, render } from '@testing-library/react';
import { setGlobalNetwork, useGlobalNetwork, networkFromEvent } from '../globalNetwork.js';

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

  it('useGlobalNetwork folgt Wechseln per Event und aus anderen Tabs', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('net').textContent).toBe('TESTNET');
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(getByTestId('net').textContent).toBe('PUBLIC');
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'SKM_NETWORK' })); });
    expect(getByTestId('net').textContent).toBe('TESTNET');
  });
});
