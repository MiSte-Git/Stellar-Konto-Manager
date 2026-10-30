import { describe, expect, it } from 'vitest';
import { Account, Keypair, MuxedAccount, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { decodeJobTransaction, verifyJobTransaction } from '../verifyJobTransaction.js';
import { txHashHex } from '../../stellar/txHash.js';

const source = Keypair.random().publicKey();

function buildTx(account = new Account(source, '100'), networkPassphrase = Networks.TESTNET) {
  return new TransactionBuilder(account, { fee: '100', networkPassphrase })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .setTimeout(60)
    .build();
}

function jobFor(tx, overrides = {}) {
  return { network: 'testnet', accountId: source, txHash: txHashHex(tx), txXdrCurrent: tx.toXDR(), ...overrides };
}

const codes = (job) => verifyJobTransaction(job, decodeJobTransaction(job)).issues.map((i) => i.code);

describe('verifyJobTransaction', () => {
  it('akzeptiert eine passende Transaktion', () => {
    const job = jobFor(buildTx());
    const result = verifyJobTransaction(job, decodeJobTransaction(job));
    expect(result).toMatchObject({ ok: true, issues: [], network: 'testnet', sourceAccountId: source, muxedSource: '' });
  });

  it('nennt bei abweichender Quelle beide Adressen', () => {
    const other = Keypair.random().publicKey();
    const job = jobFor(buildTx(), { accountId: other });
    expect(verifyJobTransaction(job, decodeJobTransaction(job)).issues).toEqual([{ code: 'account_mismatch', expected: other, actual: source }]);
  });

  it('vergleicht bei einer M-Adresse das Basiskonto', () => {
    const tx = buildTx(new MuxedAccount(new Account(source, '100'), '7'));
    const job = jobFor(tx);
    expect(verifyJobTransaction(job, decodeJobTransaction(job))).toMatchObject({ ok: true, sourceAccountId: source, muxedSource: tx.source });
  });

  it('nimmt bei einem Fee-Bump die innere Transaktion', () => {
    const inner = buildTx();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), '1000', inner, Networks.TESTNET);
    expect(codes(jobFor(feeBump))).toEqual([]);
  });

  it('nennt bei falschem Hash beide Werte, Grossschreibung zaehlt nicht', () => {
    const tx = buildTx();
    expect(codes(jobFor(tx, { txHash: txHashHex(tx).toUpperCase() }))).toEqual([]);
    const job = jobFor(tx, { txHash: 'A'.repeat(64) });
    expect(verifyJobTransaction(job, decodeJobTransaction(job)).issues).toEqual([{ code: 'hash_mismatch', expected: 'a'.repeat(64), actual: txHashHex(tx) }]);
  });

  it('erkennt ein Mainnet-XDR, das als Testnet-Job ausgegeben wird', () => {
    const mainnetTx = buildTx(new Account(source, '100'), Networks.PUBLIC);
    expect(codes(jobFor(mainnetTx, { network: 'testnet' }))).toEqual(['hash_mismatch']);
  });

  it('wertet ein unbekanntes Netz als Fehler, nie still als Mainnet', () => {
    const tx = buildTx(new Account(source, '100'), Networks.PUBLIC);
    for (const network of ['futurenet', '', undefined]) {
      expect(codes(jobFor(tx, { network }))).toEqual(['network_unknown']);
    }
  });

  it('meldet fehlende Job-Daten und nicht dekodierbares XDR', () => {
    const tx = buildTx();
    expect(codes(jobFor(tx, { txHash: '' }))).toEqual(['missing_job_data']);
    expect(codes(jobFor(tx, { accountId: undefined }))).toEqual(['missing_job_data']);
    expect(codes(jobFor(tx, { txXdrCurrent: 'kaputt' }))).toEqual(['undecodable']);
    expect(verifyJobTransaction(null, null).ok).toBe(false);
  });
});
