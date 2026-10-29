import { describe, expect, it } from 'vitest';
import { Asset, Keypair } from '@stellar/stellar-sdk';
import { loadFreshState } from '../liquiditySubmit.js';
import { poolIdFor } from '../../../utils/stellar/liquidityPools.js';

const issuer = Keypair.random().publicKey();
const usd = new Asset('USD', issuer);
const eur = new Asset('EUR', issuer);
const USD_POOL = poolIdFor(Asset.native(), usd);
const EUR_POOL = poolIdFor(Asset.native(), eur);

const record = (id, code) => ({
  id,
  fee_bp: 30,
  total_trustlines: '1',
  total_shares: '10.0000000',
  reserves: [{ asset: 'native', amount: '10.0000000' }, { asset: `${code}:${issuer}`, amount: '1.0000000' }],
});
const server = (rec) => ({
  loadAccount: async () => ({ balances: [] }),
  liquidityPools: () => ({ liquidityPoolId: () => ({ call: async () => rec }) }),
});

describe('loadFreshState', () => {
  it('liefert den Pool, wenn die Antwort zur angefragten ID gehoert', async () => {
    const { pool } = await loadFreshState(server(record(USD_POOL, 'USD')), 'GABC', USD_POOL);
    expect(pool.poolId).toBe(USD_POOL);
  });

  it('wirft poolIdMismatch, wenn Horizon einen in sich gueltigen Record fuer einen anderen Pool liefert', async () => {
    await expect(loadFreshState(server(record(EUR_POOL, 'EUR')), 'GABC', USD_POOL)).rejects.toThrow('liquidityPools.poolIdMismatch');
  });
});
