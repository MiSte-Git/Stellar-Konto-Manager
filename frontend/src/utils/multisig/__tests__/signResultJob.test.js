import { afterEach, describe, expect, it, vi } from 'vitest';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { JOB_INTEGRITY_ERROR, signAndMergeResultJob } from '../signResultJob.js';
import { txHashHex } from '../../stellar/txHash.js';

const signer = Keypair.random();
const source = signer.publicKey();

function buildTx(accountId = source, networkPassphrase = Networks.TESTNET) {
  return new TransactionBuilder(new Account(accountId, '100'), { fee: '100', networkPassphrase })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .setTimeout(60)
    .build();
}

function jobToSign(tx, expected = {}) {
  return {
    jobId: 'job-1',
    xdr: tx.toXDR(),
    accessToken: 'token-1',
    expectedJob: { network: 'testnet', accountId: source, txHash: txHashHex(tx), ...expected },
  };
}

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'pending_signatures' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const run = (job) => signAndMergeResultJob({ jobToSign: job, keypairs: [signer], clientCollected: [], signers: [] });

afterEach(() => vi.unstubAllGlobals());

describe('signAndMergeResultJob', () => {
  it('sendet die Signatur mit dem Token des Jobs als x-job-token (S8)', async () => {
    const fetchMock = stubFetch();
    const tx = buildTx();
    await expect(run(jobToSign(tx))).resolves.toMatchObject({ status: 'pending_signatures' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('multisig/jobs/job-1/merge-signed-xdr');
    expect(init.headers['x-job-token']).toBe('token-1');
    expect(url).not.toContain('token-1');
    const sent = TransactionBuilder.fromXDR(JSON.parse(init.body).signedXdr, Networks.TESTNET);
    expect(sent.signatures).toHaveLength(1);
    expect(txHashHex(sent)).toBe(txHashHex(tx));
  });

  it('signiert und sendet nichts, wenn der Server ein anderes XDR liefert', async () => {
    const fetchMock = stubFetch();
    const swapped = jobToSign(buildTx(Keypair.random().publicKey()));
    swapped.expectedJob.txHash = txHashHex(buildTx());
    await expect(run(swapped)).rejects.toMatchObject({ code: JOB_INTEGRITY_ERROR });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signiert nicht bei abweichender Quelle, falschem Netz, fehlenden Daten oder kaputtem XDR', async () => {
    const fetchMock = stubFetch();
    const tx = buildTx();
    const cases = [
      jobToSign(tx, { accountId: Keypair.random().publicKey() }),
      jobToSign(tx, { network: 'public' }),
      jobToSign(tx, { network: 'futurenet' }),
      { ...jobToSign(tx), expectedJob: undefined },
      { ...jobToSign(tx), xdr: 'kaputt' },
    ];
    for (const job of cases) {
      await expect(run(job)).rejects.toMatchObject({ code: JOB_INTEGRITY_ERROR });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
