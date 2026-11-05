// Test-Helfer fuer Mocks von utils/stellar/stellarUtils.js: Ergaenzt einen Mock, der
// getHorizonServer(url) ersetzt, um getHorizonServerForNetwork(network). Der liefert
// denselben Fake-Server (ueber die URL des Netzes) und merkt sich, fuer welches Netz der
// Server erzeugt wurde. So koennen Tests pruefen, dass ein Ablauf das Netz explizit
// uebergibt und es nicht aus localStorage liest.
import { horizonUrlFor } from '../config/networks.js';

export const serverNetworkCalls = [];

export function resetServerNetworkCalls() {
  serverNetworkCalls.length = 0;
}

export function withNetworkServer(mocked) {
  return {
    ...mocked,
    getHorizonServerForNetwork: (network) => {
      serverNetworkCalls.push(network);
      return mocked.getHorizonServer(horizonUrlFor(network));
    },
  };
}
