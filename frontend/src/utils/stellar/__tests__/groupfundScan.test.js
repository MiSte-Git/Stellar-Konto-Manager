import { describe, expect, it, vi } from 'vitest';
import { advanceScan, createScanState, isFeedLimitReached, loadScanAccount } from '../groupfundScan.js';
import { G, effect, payment } from './groupfundFixtures.js';

function feed(pages) {
  const toPage = (index) => ({ records: pages[index] || [], next: async () => toPage(index + 1) });
  return { order: () => ({ limit: () => ({ join: () => ({ call: async () => toPage(0) }), call: async () => toPage(0) }) }) };
}
const fullPage = (build) => Array.from({ length: 200 }, (_, i) => build(i));

function fakeServer(paymentPages, effectPages) {
  return {
    loadAccount: vi.fn(async () => ({ balances: [{ asset_type: 'native', balance: '12.5000000' }], last_modified_ledger: 99 })),
    payments: () => ({ forAccount: () => feed(paymentPages) }),
    effects: () => ({ forAccount: () => feed(effectPages) }),
  };
}

describe('Groupfund-Scan', () => {
  it('liest Saldo und Ledger-Stand', async () => {
    const scan = createScanState(G);
    await loadScanAccount(scan, fakeServer([], []));
    expect(scan.currentStroops).toBe(125000000n);
    expect(scan.snapshotLedger).toBe(99);
  });

  it('laesst beide Feeds gleichauf laufen und endet bei einer kurzen Seite', async () => {
    const payments = [fullPage((i) => payment(5000 - i)), [payment(100)]];
    const effects = [[effect(4000, 'account_credited', '1.0000000')]];
    const scan = createScanState(G);
    const server = fakeServer(payments, effects);
    expect(await advanceScan(scan, server)).toBe(true);
    expect(scan.payments).toHaveLength(200);
    expect(scan.paymentsDone).toBe(false);
    expect(await advanceScan(scan, server)).toBe(true);
    expect(scan.effectsDone).toBe(true);
    expect(await advanceScan(scan, server)).toBe(true);
    expect(scan.payments).toHaveLength(201);
    expect(scan.paymentsDone).toBe(true);
    expect(await advanceScan(scan, server)).toBe(false);
    expect(scan.pages).toBe(3);
  });

  it('holt den Feed nach, der weniger weit zurueckreicht', async () => {
    const scan = createScanState(G);
    const server = fakeServer([fullPage((i) => payment(9000 - i))], [fullPage((i) => effect(8000 - i, 'account_credited', '1.0000000'))]);
    await advanceScan(scan, server);
    await advanceScan(scan, server);
    expect(scan.effects).toHaveLength(200);
    await advanceScan(scan, server);
    expect(scan.payments.length).toBeGreaterThan(0);
    expect(scan.pages).toBe(3);
  });

  it('zaehlt Seiten je Feed und meldet das Limit des naechsten Feeds', async () => {
    const scan = createScanState(G);
    const server = fakeServer([fullPage((i) => payment(9000 - i)), fullPage((i) => payment(8000 - i))], [fullPage((i) => effect(9500 - i, 'account_credited', '1.0000000'))]);
    expect(isFeedLimitReached(scan, 1)).toBe(false);
    await advanceScan(scan, server);
    expect(scan.feedPages).toEqual({ payments: 1, effects: 0 });
    expect(isFeedLimitReached(scan, 1)).toBe(false);
    await advanceScan(scan, server);
    expect(scan.feedPages).toEqual({ payments: 1, effects: 1 });
    expect(isFeedLimitReached(scan, 1)).toBe(true);
    expect(isFeedLimitReached(scan, 2)).toBe(false);
  });

  it('bricht bei abgebrochenem Signal ab', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(advanceScan(createScanState(G), fakeServer([], []), controller.signal)).rejects.toMatchObject({ isAborted: true });
  });

  it('uebergeht eine schon uebernommene Seite ohne Fehler, keine doppelten Datensaetze', async () => {
    const scan = createScanState(G);
    const server = fakeServer([fullPage((i) => payment(9000 - i))], []);
    await Promise.all([advanceScan(scan, server), advanceScan(scan, server)]);
    expect(scan.payments).toHaveLength(200);
    expect(new Set(scan.payments.map((p) => p.id)).size).toBe(200);
    expect(scan.pages).toBe(1);
  });

  it('verwirft eine Antwort, die nach dem Abbruch eintrifft', async () => {
    const controller = new AbortController();
    const scan = createScanState(G);
    const server = fakeServer([fullPage((i) => payment(9000 - i))], []);
    const running = advanceScan(scan, server, controller.signal);
    controller.abort();
    await expect(running).rejects.toMatchObject({ isAborted: true });
    expect(scan.payments).toHaveLength(0);
    expect(scan.paymentsPage).toBeNull();
  });
});
