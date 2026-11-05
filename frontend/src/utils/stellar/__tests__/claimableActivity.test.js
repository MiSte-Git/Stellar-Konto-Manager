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
