import { getHorizonServer, getHorizonServerForNetwork } from '../stellarUtils.js';
import { horizonUrlFor } from '../../../config/networks.js';

// Review Netzwechsel N2: getHorizonServer(Mainnet-URL) gilt als Default-Aufruf und nimmt
// das Netz aus localStorage. getHorizonServerForNetwork haelt sich an das uebergebene Netz.
const urlOf = (server) => String(server.serverURL);

describe('getHorizonServerForNetwork', () => {
  afterEach(() => window.localStorage.clear());

  it('PUBLIC bleibt PUBLIC, auch wenn localStorage TESTNET zeigt', () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    expect(urlOf(getHorizonServerForNetwork('PUBLIC'))).not.toContain('testnet');
  });

  it('TESTNET bleibt TESTNET, auch wenn localStorage PUBLIC zeigt', () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    expect(urlOf(getHorizonServerForNetwork('TESTNET'))).toContain('horizon-testnet.stellar.org');
  });

  it('Hintergrund: der Default-Pfad folgt localStorage (darum die eigene Variante)', () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    expect(urlOf(getHorizonServer(horizonUrlFor('PUBLIC')))).toContain('horizon-testnet.stellar.org');
  });
});
