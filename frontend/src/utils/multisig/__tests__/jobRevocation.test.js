// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Account, Keypair, MuxedAccount, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildJobRevocationTx, checkRevocationSequence, collectEffectiveSigners, getJobSequenceInfo, isJobSequenceConsumed, parseJobNetwork } from '../jobRevocation.js';

const kp = Keypair.random();

function jobTx(source, sequenceBefore = '100') {
  return new TransactionBuilder(new Account(source, sequenceBefore), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .setTimeout(3600)
    .build();
}

describe('getJobSequenceInfo', () => {
  it('liest Quellkonto und Sequence der Job-Transaktion', () => {
    expect(getJobSequenceInfo(jobTx(kp.publicKey(), '100'))).toEqual({ sourceAccountId: kp.publicKey(), sequence: '101' });
  });

  it('wandelt eine M-Adresse als Quelle in die G-Adresse um', () => {
    const muxed = new MuxedAccount(new Account(kp.publicKey(), '100'), '7');
    const tx = new TransactionBuilder(muxed, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
      .setTimeout(60)
      .build();
    expect(getJobSequenceInfo(tx)?.sourceAccountId).toBe(kp.publicKey());
  });

  it('nimmt bei einem Fee-Bump die innere Transaktion', () => {
    const inner = jobTx(kp.publicKey(), '200');
    inner.sign(kp);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), '1000', inner, Networks.TESTNET);
    expect(getJobSequenceInfo(feeBump)).toEqual({ sourceAccountId: kp.publicKey(), sequence: '201' });
  });

  it('liefert null fuer ungueltige Eingaben', () => {
    expect(getJobSequenceInfo(null)).toBeNull();
    expect(getJobSequenceInfo({})).toBeNull();
  });
});

describe('isJobSequenceConsumed', () => {
  it('folgt der Backend-Regel: Job tot, sobald Konto-Sequence >= Job-Sequence', () => {
    expect(isJobSequenceConsumed('100', '101')).toBe(false);
    expect(isJobSequenceConsumed('101', '101')).toBe(true);
    expect(isJobSequenceConsumed('150', '101')).toBe(true);
    expect(isJobSequenceConsumed('9223372036854775806', '9223372036854775807')).toBe(false);
  });

  it('wertet unlesbare Werte nicht als verbraucht', () => {
    expect(isJobSequenceConsumed('abc', '101')).toBe(false);
    expect(isJobSequenceConsumed(undefined, '101')).toBe(false);
  });
});

describe('buildJobRevocationTx', () => {
  it('baut genau eine bumpSequence-Operation auf die Job-Sequence', () => {
    const tx = buildJobRevocationTx({
      account: new Account(kp.publicKey(), '100'),
      jobSequence: '500',
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    });
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0].type).toBe('bumpSequence');
    expect(tx.operations[0].bumpTo).toBe('500');
    expect(tx.source).toBe(kp.publicKey());
    expect(tx.sequence).toBe('101');
    expect(Number(tx.timeBounds.maxTime)).toBeGreaterThan(0);
  });
});

describe('checkRevocationSequence', () => {
  it('erlaubt den normalen Fall: Job-Sequence = Konto-Sequence + 1', () => {
    expect(checkRevocationSequence('100', '101')).toBe('ok');
    expect(checkRevocationSequence('100', '1100')).toBe('ok');
  });

  it('meldet bereits verbrauchte Jobs', () => {
    expect(checkRevocationSequence('101', '101')).toBe('consumed');
  });

  it('verweigert manipulierte Sequences weit ueber dem Konto (Schutz vor Konto-Sperre)', () => {
    expect(checkRevocationSequence('100', '1101')).toBe('too_far');
    expect(checkRevocationSequence('100', '9223372036854775806')).toBe('too_far');
  });

  it('meldet unlesbare Werte als invalid', () => {
    expect(checkRevocationSequence('abc', '101')).toBe('invalid');
    expect(checkRevocationSequence(null, '101')).toBe('invalid');
  });
});

describe('collectEffectiveSigners', () => {
  const a = Keypair.random();
  const b = Keypair.random();
  const horizon = [
    { key: a.publicKey(), weight: 1, type: 'ed25519_public_key' },
    { key: b.publicKey(), weight: 0, type: 'ed25519_public_key' },
  ];

  it('zaehlt jeden Key einmal, Gewicht aus Horizon, Gewicht 0 faellt weg', () => {
    const res = collectEffectiveSigners([
      { keypair: a, weight: 99 },
      { keypair: a, weight: 99 },
      { keypair: b, weight: 5 },
      { keypair: Keypair.random(), weight: 5 },
    ], horizon);
    expect(res.weight).toBe(1);
    expect(res.signers).toHaveLength(1);
  });
});

describe('parseJobNetwork', () => {
  it('kennt nur testnet und public, alles andere ist unbekannt', () => {
    expect(parseJobNetwork('testnet')).toBe('testnet');
    expect(parseJobNetwork('TESTNET')).toBe('testnet');
    expect(parseJobNetwork('public')).toBe('public');
    expect(parseJobNetwork('mainnet')).toBe('public');
    expect(parseJobNetwork('futurenet')).toBeNull();
    expect(parseJobNetwork(undefined)).toBeNull();
  });
});
