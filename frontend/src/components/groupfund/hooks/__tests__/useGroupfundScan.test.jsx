import { act, renderHook, waitFor } from '@testing-library/react';
import { G, TARGET, effect, payment } from '../../../../utils/stellar/__tests__/groupfundFixtures.js';
import useGroupfundScan, { clearGroupfundSessions } from '../useGroupfundScan.js';

const hoisted = vi.hoisted(() => ({ paymentPages: [], effectPages: [], responder: null, calls: [], loadAccount: vi.fn() }));

const pageAt = (pages, index) => ({ records: pages[index] || [], next: () => fetchPage('next', pages, index + 1) });

// Jeder Abruf wird gezaehlt; ein responder kann ihn zurueckhalten oder nie beantworten.
function fetchPage(kind, pages, index) {
  hoisted.calls.push(kind);
  const answer = () => pageAt(pages, index);
  return hoisted.responder ? hoisted.responder(hoisted.calls.length, answer) : Promise.resolve(answer());
}

vi.mock('../../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccount,
    payments: () => ({ forAccount: () => ({ order: () => ({ limit: () => ({ join: () => ({ call: () => fetchPage('payments', hoisted.paymentPages, 0) }) }) }) }) }),
    effects: () => ({ forAccount: () => ({ order: () => ({ limit: () => ({ call: () => Promise.resolve(pageAt(hoisted.effectPages, 0)) }) }) }) }),
  }),
}));

const STROOP = 10000000n;
const fullPage = (from) => Array.from({ length: 200 }, (_, i) => payment(from - i));
const dismissed = [];
const manual = [];
const hook = () => renderHook(() => useGroupfundScan({ accountId: G, network: 'PUBLIC', bufferStroops: 5n * STROOP, dismissed, manual }));
const ids = (result) => result.current.payments.map((p) => p.id);
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); };

// Haelt die Antworten zurueck; release gibt sie der Reihe nach frei.
function holdAnswers() {
  const held = [];
  hoisted.responder = (_n, answer) => new Promise((resolve) => { held.push(() => resolve(answer())); });
  return { held, releaseAll: () => held.splice(0).forEach((release) => release()) };
}

describe('useGroupfundScan', () => {
  beforeEach(() => {
    clearGroupfundSessions();
    hoisted.responder = null;
    hoisted.calls = [];
    hoisted.paymentPages = [fullPage(9000), fullPage(8000), [payment(100)]];
    hoisted.effectPages = [];
    hoisted.loadAccount.mockReset();
    hoisted.loadAccount.mockImplementation(async () => ({ balances: [{ asset_type: 'native', balance: '50.0000000' }], subentry_count: 0 }));
  });

  it('gleichzeitiger Start: zwei Abrufe ueberlappen wirklich, trotzdem keine Dubletten', async () => {
    const { held, releaseAll } = holdAnswers();
    const { result } = hook();
    await act(async () => { result.current.start({ rounds: 1 }); });
    await flush();
    expect(held).toHaveLength(1);
    await act(async () => { result.current.start({ rounds: 1 }); });
    await flush();
    // Der zweite Lauf wartet nicht: Beide Abrufe derselben Seite sind offen.
    expect(held).toHaveLength(2);
    hoisted.responder = null;
    await act(async () => { releaseAll(); });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(ids(result)).toHaveLength(401);
    expect(new Set(ids(result)).size).toBe(401);
  });

  it('haengende Anfrage, Abbrechen, Neu laden: Der neue Scan startet trotzdem', async () => {
    hoisted.responder = (n, answer) => (n === 1 ? new Promise(() => {}) : Promise.resolve(answer()));
    const { result } = hook();
    await act(async () => { result.current.start({ rounds: 1 }); });
    await flush();
    await act(async () => { result.current.cancel(); });
    expect(result.current.status).toBe('aborted');
    await act(async () => { await result.current.refresh(); });
    expect(hoisted.calls.length).toBeGreaterThan(1);
    expect(result.current.status).toBe('done');
    expect(ids(result)).toHaveLength(401);
  });

  it('haengende Anfrage ohne Abbrechen: Ein neuer Start laeuft ebenfalls durch', async () => {
    hoisted.responder = (n, answer) => (n === 1 ? new Promise(() => {}) : Promise.resolve(answer()));
    const { result } = hook();
    await act(async () => { result.current.start({ rounds: 1 }); });
    await flush();
    await act(async () => { await result.current.start({ rounds: 1 }); });
    expect(result.current.status).toBe('done');
  });

  it('Neu laden waehrend eines Laufs: Die alte Antwort landet nicht in der neuen Session', async () => {
    const { releaseAll } = holdAnswers();
    const { result } = hook();
    await act(async () => { result.current.start({ rounds: 1 }); });
    await flush();
    hoisted.paymentPages = [[payment(100)]];
    hoisted.responder = null;
    await act(async () => { await result.current.refresh(); });
    expect(ids(result)).toHaveLength(1);
    await act(async () => { releaseAll(); });
    await flush();
    expect(ids(result)).toHaveLength(1);
    expect(result.current.status).toBe('done');
  });

  it('Remount mit spaet eintreffender Antwort: keine Dubletten im gemeinsamen Stand', async () => {
    const { releaseAll } = holdAnswers();
    const first = hook();
    await act(async () => { first.result.current.start({ rounds: 1 }); });
    await flush();
    first.unmount();
    hoisted.responder = null;
    const second = hook();
    await act(async () => { await second.result.current.start({ rounds: 1 }); });
    expect(ids(second.result)).toHaveLength(401);
    await act(async () => { releaseAll(); });
    await flush();
    expect(ids(second.result)).toHaveLength(401);
    expect(new Set(ids(second.result)).size).toBe(401);
    expect(second.result.current.status).toBe('done');
  });

  it('zeigt den Abbruch sofort und verwirft die spaete Antwort', async () => {
    const { releaseAll } = holdAnswers();
    const { result } = hook();
    await act(async () => { result.current.start({ rounds: 1 }); });
    await flush();
    await act(async () => { result.current.cancel(); });
    expect(result.current.status).toBe('aborted');
    await act(async () => { releaseAll(); });
    await flush();
    expect(result.current.status).toBe('aborted');
    expect(result.current.payments).toHaveLength(0);
  });

  it('ein nach dem Abbrechen endender Lauf ueberschreibt aborted nicht mit done', async () => {
    hoisted.paymentPages = [[payment(100)]];
    const { releaseAll } = holdAnswers();
    const { result } = hook();
    await act(async () => { result.current.start({ rounds: 1 }); });
    await flush();
    await act(async () => { result.current.cancel(); });
    hoisted.responder = null;
    await act(async () => { releaseAll(); });
    await flush();
    expect(result.current.status).toBe('aborted');
  });

  it('endet ohne Abbruch normal mit done', async () => {
    hoisted.paymentPages = [[payment(100)]];
    const { result } = hook();
    await act(async () => { await result.current.start({ rounds: 1 }); });
    expect(result.current.status).toBe('done');
  });

  it('eine schon uebernommene Seite gilt nicht als Abbruch', async () => {
    // Zwei Instanzen teilen sich den Stand, keine bricht die andere ab.
    const { held, releaseAll } = holdAnswers();
    const first = hook();
    const second = hook();
    await act(async () => { first.result.current.start({ rounds: 1 }); });
    await flush();
    await act(async () => { second.result.current.start({ rounds: 1 }); });
    await flush();
    expect(held).toHaveLength(2);
    hoisted.responder = null;
    await act(async () => { releaseAll(); });
    await waitFor(() => {
      expect(first.result.current.status).toBe('done');
      expect(second.result.current.status).toBe('done');
    });
    expect(new Set(ids(first.result)).size).toBe(ids(first.result).length);
    expect(ids(first.result)).toHaveLength(401);
  });

  it('Neu laden behaelt die gewuenschte Rundenzahl', async () => {
    const reset = (ledger) => payment(ledger, { from: G, to: TARGET, amount: '90.0000000' });
    hoisted.paymentPages = [[reset(30), reset(20)]];
    hoisted.effectPages = [[effect(30, 'account_debited', '90.0000000'), effect(25, 'account_credited', '90.0000000'), effect(20, 'account_debited', '90.0000000')]];
    hoisted.loadAccount.mockImplementation(async () => ({ balances: [{ asset_type: 'native', balance: '3.0000000' }], subentry_count: 0 }));
    const { result } = hook();
    await act(async () => { await result.current.start({ rounds: 2 }); });
    expect(result.current.analysis.boundaries).toHaveLength(2);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.analysis.boundaries).toHaveLength(2);
  });
});
