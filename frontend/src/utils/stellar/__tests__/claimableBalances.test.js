// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import {
  buildClaimTx, claimJobTimeoutSeconds, classifyClaimableBalances, describePredicateWindow, evaluatePredicate, parseClaimableAsset,
} from '../claimableBalances.js';

const ME = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const NOW = 1_800_000_000;
const id = (n) => `00000000${String(n).padStart(64, '0')}`;

describe('evaluatePredicate', () => {
  it('unconditional, abs_before, not, and/or', () => {
    expect(evaluatePredicate({ unconditional: true }, NOW)).toBe(true);
    expect(evaluatePredicate({ abs_before_epoch: String(NOW + 10) }, NOW)).toBe(true);
    expect(evaluatePredicate({ abs_before: new Date((NOW - 10) * 1000).toISOString() }, NOW)).toBe(false);
    expect(evaluatePredicate({ not: { abs_before_epoch: String(NOW - 10) } }, NOW)).toBe(true);
    expect(evaluatePredicate({ and: [{ unconditional: true }, { abs_before_epoch: String(NOW - 1) }] }, NOW)).toBe(false);
    expect(evaluatePredicate({ or: [{ abs_before_epoch: String(NOW - 1) }, { unconditional: true }] }, NOW)).toBe(true);
  });

  it('rel_before relativ zur Erstellung, unbekannte Formen fail-closed', () => {
    expect(evaluatePredicate({ rel_before: '100' }, NOW, NOW - 50)).toBe(true);
    expect(evaluatePredicate({ rel_before: '100' }, NOW, NOW - 150)).toBe(false);
    expect(evaluatePredicate({ rel_before: '100' }, NOW, null)).toBe(false);
    expect(evaluatePredicate({ something: true }, NOW)).toBe(false);
    expect(evaluatePredicate(null, NOW)).toBe(false);
  });
});

describe('describePredicateWindow', () => {
  it('erkennt einloesbar bis und einloesbar ab', () => {
    expect(describePredicateWindow({ abs_before_epoch: '123' })).toEqual({ until: 123 });
    expect(describePredicateWindow({ not: { abs_before_epoch: '456' } })).toEqual({ from: 456 });
    expect(describePredicateWindow({ unconditional: true })).toBeNull();
  });
});

describe('parseClaimableAsset', () => {
  it('native und CODE:ISSUER', () => {
    expect(parseClaimableAsset('native')).toMatchObject({ isNative: true, code: 'XLM' });
    expect(parseClaimableAsset(`FOO:${ISSUER}`)).toMatchObject({ isNative: false, code: 'FOO', issuer: ISSUER });
    expect(parseClaimableAsset('kaputt')).toBeNull();
  });
});

describe('classifyClaimableBalances', () => {
  const account = {
    account_id: ME,
    balances: [
      { asset_type: 'native', balance: '100' },
      { asset_type: 'credit_alphanum4', asset_code: 'FOO', asset_issuer: ISSUER, balance: '0' },
    ],
  };
  const records = [
    { id: id(1), asset: 'native', amount: '5', sponsor: OTHER, claimants: [{ destination: ME, predicate: { unconditional: true } }] },
    { id: id(2), asset: `FOO:${ISSUER}`, amount: '1', claimants: [{ destination: ME, predicate: { unconditional: true } }] },
    { id: id(3), asset: `BAR:${ISSUER}`, amount: '1', claimants: [{ destination: ME, predicate: { abs_before_epoch: String(NOW - 1) } }] },
    { id: id(4), asset: 'native', amount: '9', claimants: [{ destination: OTHER, predicate: { unconditional: true } }] },
  ];

  it('nimmt nur eigene Claimant-Eintraege und erkennt Trustlines', () => {
    const items = classifyClaimableBalances(records, account, NOW);
    expect(items.map((i) => i.id)).toEqual([id(1), id(2), id(3)]);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId[id(1)]).toMatchObject({ hasTrustline: true, claimableNow: true, sponsor: OTHER });
    expect(byId[id(2)].hasTrustline).toBe(true);
    expect(byId[id(3)]).toMatchObject({ hasTrustline: false, claimableNow: false });
  });
});

describe('buildClaimTx', () => {
  const base = { fee: '100', networkPassphrase: Networks.TESTNET };
  it('nur claimClaimableBalance bei vorhandener Trustline', () => {
    const item = { id: id(1), asset: { isNative: true, code: 'XLM', issuer: '' }, hasTrustline: true, isIssuer: false };
    const tx = buildClaimTx({ ...base, account: new Account(ME, '1'), item });
    expect(tx.operations.map((o) => o.type)).toEqual(['claimClaimableBalance']);
    expect(tx.operations[0].balanceId).toBe(id(1));
  });

  it('changeTrust plus claimClaimableBalance ohne Trustline', () => {
    const item = { id: id(2), asset: { isNative: false, code: 'BAR', issuer: ISSUER }, hasTrustline: false, isIssuer: false };
    const tx = buildClaimTx({ ...base, account: new Account(ME, '1'), item });
    expect(tx.operations.map((o) => o.type)).toEqual(['changeTrust', 'claimClaimableBalance']);
    expect(tx.operations[0].line.code).toBe('BAR');
  });
});

describe('claimJobTimeoutSeconds', () => {
  it('nimmt die Einstellung, ohne Ablauf der Claimable Balance', () => {
    expect(claimJobTimeoutSeconds({ window: null }, 86400, NOW)).toBe(86400);
  });

  it('kuerzt auf die Restlaufzeit der Claimable Balance', () => {
    expect(claimJobTimeoutSeconds({ window: { until: NOW + 7200 } }, 86400, NOW)).toBe(7170);
  });

  it('liefert null, wenn fuer einen Job zu wenig Zeit bleibt', () => {
    expect(claimJobTimeoutSeconds({ window: { until: NOW + 200 } }, 86400, NOW)).toBeNull();
  });
});
