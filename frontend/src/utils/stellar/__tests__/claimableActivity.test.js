// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  claimedToPaymentRecord,
  createdToPaymentRecord,
  loadClaimableActivity,
  mergeActivityRecords,
} from '../claimableActivity.js';
import { normalizeActivity } from '../activity.js';

const ME = 'GCZLMFGOQMVLH352AAUEBUBATMKM7OB6GUTJQ47DOXJDYUYKXDJEZQ7B';
const OTHER = 'GBU2J5IQZGJWHGIEOBR2UPPUWFEORWFRNXVAZWJEOHTOI5E2HIKEF5JO';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const createdOp = (source, o = {}) => ({
  id: '100', paging_token: '100', type: 'create_claimable_balance', source_account: source,
  created_at: '2026-11-05T08:37:15Z', transaction_hash: 'a'.repeat(64), transaction_successful: true,
  asset: 'native', amount: '75.0000000', claimants: [{ destination: source === ME ? OTHER : ME, predicate: { unconditional: true } }],
  ...o,
});
const claimOp = (o = {}) => ({
  id: '200', paging_token: '200', type: 'claim_claimable_balance', source_account: ME, claimant: ME,
  created_at: '2026-11-05T08:45:00Z', transaction_hash: 'b'.repeat(64), transaction_successful: true, balance_id: '00000000abc',
  ...o,
});
const claimEffects = [
  { type: 'claimable_balance_claimed', asset: `FOO:${ISSUER}`, amount: '12.5000000' },
  { type: 'claimable_balance_sponsorship_removed', former_sponsor: OTHER },
];

describe('claimableActivity', () => {
  it('Anlegen durch das Konto: ausgehend an den Claimant', () => {
    const r = createdToPaymentRecord(createdOp(ME), ME);
    expect(r).toMatchObject({ from: ME, to: OTHER, amount: '75.0000000', asset_type: 'native' });
    expect(normalizeActivity(r, ME)).toMatchObject({ kind: 'claimableCreated', direction: 'out', amount: 75, counterparty: OTHER });
  });

  it('fuer das Konto angelegt (noch nicht eingeloest) erscheint nicht im Verlauf', () => {
    expect(createdToPaymentRecord(createdOp(OTHER), ME)).toBeNull();
  });

  it('Einloesen: eingehend, Betrag und Asset aus dem Effekt, Absender = frueherer Sponsor', () => {
    const r = claimedToPaymentRecord(claimOp(), ME, claimEffects);
    expect(r).toMatchObject({ from: OTHER, to: ME, amount: '12.5000000', asset_code: 'FOO', asset_issuer: ISSUER });
    expect(normalizeActivity(r, ME)).toMatchObject({ kind: 'claimableClaimed', direction: 'in', counterparty: OTHER, asset: { code: 'FOO', isNative: false } });
  });

  it('Einloesen ohne Effekt-Daten wird weggelassen', () => {
    expect(claimedToPaymentRecord(claimOp(), ME, [])).toBeNull();
  });

  it('loadClaimableActivity laedt Operationen, Effekte nur fuer eigene Einloesungen, ignoriert anderes', async () => {
    const forOperation = vi.fn(() => ({ limit: () => ({ call: async () => ({ records: claimEffects }) }) }));
    const server = {
      operations: () => ({ forAccount: () => ({ order: () => ({ limit: () => ({ join: () => ({ call: async () => ({
        records: [claimOp(), createdOp(ME), createdOp(OTHER, { id: '90', paging_token: '90' }), { id: '80', type: 'payment' }],
      }) }) }) }) }) }),
      effects: () => ({ forOperation }),
    };
    const recs = await loadClaimableActivity(server, ME);
    expect(recs.map((r) => r.type)).toEqual(['claim_claimable_balance', 'create_claimable_balance']);
    expect(forOperation).toHaveBeenCalledTimes(1);
    expect(forOperation).toHaveBeenCalledWith('200');
  });

  it('mergeActivityRecords sortiert neueste zuerst und entfernt Doppelte', () => {
    const merged = mergeActivityRecords(
      [{ id: '300', created_at: '2026-11-05T10:00:00Z' }, { id: '100', created_at: '2026-11-05T08:00:00Z' }],
      [{ id: '200', created_at: '2026-11-05T09:00:00Z' }, { id: '100', created_at: '2026-11-05T08:00:00Z' }],
    );
    expect(merged.map((r) => r.id)).toEqual(['300', '200', '100']);
  });

  it('mergeActivityRecords laesst die Reihenfolge ohne Claimable-Eintraege unveraendert', () => {
    const a = [{ id: '1', created_at: 'kaputt' }, { id: '2', created_at: '2026-11-05T09:00:00Z' }];
    expect(mergeActivityRecords(a, []).map((r) => r.id)).toEqual(['1', '2']);
  });
});

// Regression 13.11.: LP-Einzahlung erschien in der Aktivitaet gar nicht bzw. im Explorer nur als
// Aktion ohne Betrag. Jetzt mit beiden Betraegen.
const POOL = 'ab'.repeat(32);
const depositOp = (o = {}) => ({
  id: '300', paging_token: '300', type: 'liquidity_pool_deposit', source_account: ME,
  created_at: '2026-11-13T08:13:57Z', transaction_hash: 'c'.repeat(64), transaction_successful: true,
  liquidity_pool_id: POOL,
  reserves_max: [{ asset: 'native', amount: '100.0000000' }, { asset: `LDEX:${ISSUER}`, amount: '4000000.0000000' }],
  reserves_deposited: [{ asset: 'native', amount: '32.9000000' }, { asset: `LDEX:${ISSUER}`, amount: '3197655.5217000' }],
  shares_received: '10255.9000000',
  ...o,
});
const withdrawOp = (o = {}) => ({
  id: '400', paging_token: '400', type: 'liquidity_pool_withdraw', source_account: ME,
  created_at: '2026-11-13T09:00:00Z', transaction_hash: 'd'.repeat(64), transaction_successful: true,
  liquidity_pool_id: POOL, shares: '100.0000000',
  reserves_received: [{ asset: 'native', amount: '0.3600000' }, { asset: `LDEX:${ISSUER}`, amount: '37140.0000000' }],
  ...o,
});

describe('Liquidity-Pool-Aktivitaet', () => {
  it('Einzahlung: ausgehend, beide eingezahlten Betraege, nicht die Hoechstwerte', async () => {
    const { poolToPaymentRecord } = await import('../claimableActivity.js');
    const item = normalizeActivity(poolToPaymentRecord(depositOp(), ME), ME);
    expect(item).toMatchObject({ kind: 'poolDeposit', direction: 'out', amount: null, poolId: POOL, shares: 10255.9 });
    expect(item.poolAmounts).toEqual([
      { amount: 32.9, asset: { code: 'XLM', issuer: '', isNative: true } },
      { amount: 3197655.5217, asset: { code: 'LDEX', issuer: ISSUER, isNative: false } },
    ]);
    expect(item.asset).toEqual({ code: 'LDEX', issuer: ISSUER, isNative: false });
  });

  it('Abhebung: eingehend mit den erhaltenen Betraegen', async () => {
    const { poolToPaymentRecord } = await import('../claimableActivity.js');
    const item = normalizeActivity(poolToPaymentRecord(withdrawOp(), ME), ME);
    expect(item).toMatchObject({ kind: 'poolWithdraw', direction: 'in', shares: 100 });
    expect(item.poolAmounts.map((p) => p.amount)).toEqual([0.36, 37140]);
  });

  it('fremde Pool-Operation wird nicht uebernommen, fehlende Betraege brechen nicht', async () => {
    const { poolToPaymentRecord } = await import('../claimableActivity.js');
    expect(poolToPaymentRecord(depositOp({ source_account: OTHER }), ME)).toBeNull();
    const item = normalizeActivity(poolToPaymentRecord(depositOp({ reserves_deposited: undefined, transaction_successful: false }), ME), ME);
    expect(item).toMatchObject({ kind: 'poolDeposit', successful: false, poolAmounts: [] });
  });

  it('loadClaimableActivity liefert Pool-Operationen ohne Effekt-Abfrage', async () => {
    const forOperation = vi.fn();
    const server = {
      operations: () => ({ forAccount: () => ({ order: () => ({ limit: () => ({ join: () => ({ call: async () => ({
        records: [withdrawOp(), depositOp()],
      }) }) }) }) }) }),
      effects: () => ({ forOperation }),
    };
    const recs = await loadClaimableActivity(server, ME);
    expect(recs.map((r) => r.type)).toEqual(['liquidity_pool_withdraw', 'liquidity_pool_deposit']);
    expect(forOperation).not.toHaveBeenCalled();
  });
});
