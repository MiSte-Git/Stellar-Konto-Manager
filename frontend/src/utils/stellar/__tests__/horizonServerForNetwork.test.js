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

describe('deleteTrustlinesInChunks: Netz des Ablaufs', () => {
  afterEach(() => window.localStorage.clear());

  it('signiert nach einem Wechsel in einem anderen Tab keinen weiteren Block', async () => {
    const { Account, Keypair } = await import('@stellar/stellar-sdk');
    const { deleteTrustlinesInChunks } = await import('../stellarUtils.js');
    const kp = Keypair.random();
    const issuer = Keypair.random().publicKey();
    // 101 Trustlines ohne Guthaben: zwei Bloecke (100 + 1)
    const lines = Array.from({ length: 101 }, (_, i) => ({
      asset_type: 'credit_alphanum12', asset_code: `T${i}`, asset_issuer: issuer, balance: '0', buying_liabilities: '0', selling_liabilities: '0',
    }));
    const submitted = [];
    const server = {
      serverURL: 'fake://delete-test',
      loadAccount: async (pk) => Object.assign(new Account(pk, '1'), { balances: lines }),
      operations: () => ({ forAccount: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }) }) }),
      feeStats: async () => ({ last_ledger_base_fee: '100', fee_charged: { mode: '100', p95: '100' } }),
      submitTransaction: async (tx) => {
        submitted.push(tx);
        // Nach dem ersten Block wechselt ein anderer Tab das Netz.
        window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
        return { hash: 'h1' };
      },
    };
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const trustlines = lines.map((l) => ({ assetCode: l.asset_code, assetIssuer: issuer, assetType: l.asset_type, assetBalance: '0' }));
    await expect(deleteTrustlinesInChunks({
      signerKeypairs: [kp], trustlines, accountPublicKey: kp.publicKey(), network: 'TESTNET', server, validateLiveEvery: 0,
    })).rejects.toMatchObject({ code: 'network_changed', message: 'createAccount:networkChanged.stoppedAfterPartial' });
    expect(submitted).toHaveLength(1);
  });
});
