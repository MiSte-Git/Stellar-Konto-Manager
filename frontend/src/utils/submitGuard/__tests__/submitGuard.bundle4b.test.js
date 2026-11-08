// Buendel 4b: Gueltigkeit zentral (M1), Job und XDR-Export mit derselben Sperre (M2),
// Aufraeumen nur fuer das aktive Netz und unter dem Lock.
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  MAX_SEND_VALIDITY_SECONDS, accountEntryKey, findAccountSendBlock, pruneAccountEntries, readAccountEntry,
  recordUnreadableLedgerSeen, resetAccountSendGuardMemory, settleAccountBlock, settleBatchUnreadable, writeAccountEntry,
} from '../accountSendGuard.js';
import { guardedSubmit, guardedUnsignedBuild, SendBlockedError } from '../guardedSubmit.js';
import { tryWithSendLock, withSendLock } from '../sendLock.js';
import { BATCH_SUBMIT_TIMEOUT_SECONDS } from '../../batchPayment/batchPaymentLogic.js';
import {
  NOT_APPLIED_RETENTION_MS, pruneSentLog, readSentEntry, sentEntryKey, writeSentEntry,
} from '../../batchPayment/batchPaymentStore.js';

const SRC = Keypair.random();
const DEST = Keypair.random().publicKey();
const H = (c) => c.repeat(64);
const DAY = 24 * 3600 * 1000;
const account = SRC.publicKey();
const iso = (sec) => new Date(sec * 1000).toISOString();
const entry = (o = {}) => ({
  hash: H('a'), at: 1000, status: 'ambiguous', maxTime: 2000, seq: '101', source: account, origin: 'payment', ...o,
});
const pinEntry = (o = {}) => entry({ status: 'notApplied', pin: true, seq: '105', at: Date.now(), ...o });

function ledgerServer(closedSec) {
  return { ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ closed_at: iso(closedSec()) }] }) }) }) }) };
}

function build(seqAccount, timeout = 60) {
  return async ({ adjustAccount }) => {
    const acc = adjustAccount ? adjustAccount(seqAccount) : seqAccount;
    const tx = new TransactionBuilder(acc, { fee: '100', networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.payment({ destination: DEST, amount: '1', asset: Asset.native() }))
      .setTimeout(timeout).build();
    tx.sign(SRC);
    return { tx };
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAccountSendGuardMemory();
});

describe('M1: eine Gueltigkeit fuer alle Sendewege', () => {
  it('die Obergrenze deckt die Sammelzahlung (und Zahlung senden) ab', () => {
    expect(MAX_SEND_VALIDITY_SECONDS).toBeGreaterThanOrEqual(BATCH_SUBMIT_TIMEOUT_SECONDS);
    expect(MAX_SEND_VALIDITY_SECONDS).toBeGreaterThanOrEqual(180);
  });

  it('unlesbarer Eintrag aus "Zahlung senden": 130 s nach dem Erkennen bleibt das Konto gesperrt (auch fuer das Trading)', async () => {
    window.localStorage.setItem(accountEntryKey('PUBLIC', account), '{kaputt');
    const block = findAccountSendBlock('PUBLIC', account);
    const seenSec = block.entry.seenAt / 1000;
    recordUnreadableLedgerSeen('PUBLIC', account, block, seenSec);
    // Aufruf ohne jede seitenspezifische Gueltigkeit (wie der Hook im Trading): keine 60 s mehr.
    const res = await settleAccountBlock({
      network: 'PUBLIC', account, block: findAccountSendBlock('PUBLIC', account),
      server: ledgerServer(() => seenSec + 130), sleep: async () => {},
    });
    expect(res.outcome).toBe('pending');
    expect(findAccountSendBlock('PUBLIC', account)).toMatchObject({ kind: 'single' });
  });

  it('erst nach Erkennen + Gueltigkeit + Puffer (zwei Abfragen) wird freigegeben', async () => {
    window.localStorage.setItem(accountEntryKey('PUBLIC', account), '{kaputt');
    const block = findAccountSendBlock('PUBLIC', account);
    const seenSec = block.entry.seenAt / 1000;
    recordUnreadableLedgerSeen('PUBLIC', account, block, seenSec);
    const res = await settleAccountBlock({
      network: 'PUBLIC', account, block: findAccountSendBlock('PUBLIC', account),
      server: ledgerServer(() => seenSec + MAX_SEND_VALIDITY_SECONDS + 61), sleep: async () => {}, strictDelayMs: 0,
    });
    expect(res.outcome).toBe('expired');
    expect(findAccountSendBlock('PUBLIC', account)).toBeNull();
  });

  it('Sammelzahlung: unlesbarer Eintrag gilt ebenfalls mit der zentralen Gueltigkeit', async () => {
    const key = `skm_batch_sent_v1:PUBLIC:${'f'.repeat(64)}`;
    window.localStorage.setItem(key, '{kaputt');
    const block = findAccountSendBlock('PUBLIC', account);
    const seenSec = block.entry.seenAt / 1000;
    const info = (await import('../accountSendGuard.js')).batchUnreadableInfo(key);
    recordUnreadableLedgerSeen('PUBLIC', account, { kind: 'batchUnreadable', entry: info }, seenSec);
    const res = await settleBatchUnreadable({ key, server: ledgerServer(() => seenSec + 130), sleep: async () => {} });
    expect(res.outcome).toBe('pending');
  });

  it('guardedSubmit sendet nichts mit laengerer Gueltigkeit als die Obergrenze (kein Eintrag, kein Submit)', async () => {
    const submit = vi.fn();
    await expect(guardedSubmit({
      network: 'PUBLIC', account, server: {}, buildTx: build(new Account(account, '100'), MAX_SEND_VALIDITY_SECONDS + 300), submit,
    })).rejects.toMatchObject({ reason: 'validityTooLong' });
    expect(submit).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toBeNull();
  });

  it('Gegenprobe: genau die Obergrenze (Zahlung senden, 180 s) wird gesendet', async () => {
    const submit = vi.fn(async () => ({ hash: 'x' }));
    await guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(new Account(account, '100'), MAX_SEND_VALIDITY_SECONDS), submit });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe('M2: Job und XDR bauen nur ohne Sperre, mit Pin', () => {
  it('unklarer Eintrag des Kontos: nicht gebaut', async () => {
    writeAccountEntry('PUBLIC', account, entry());
    const buildFn = vi.fn();
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn }))
      .rejects.toMatchObject({ name: 'SendBlockedError', reason: 'blocked' });
    expect(buildFn).not.toHaveBeenCalled();
  });

  it('unklarer Eintrag der Sammelzahlung (anderes Quellkonto-Eintrag mit diesem Konto): nicht gebaut', async () => {
    writeSentEntry('PUBLIC', 'fp', entry({ hash: H('b') }));
    const buildFn = vi.fn();
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn })).rejects.toMatchObject({ reason: 'blocked' });
    expect(buildFn).not.toHaveBeenCalled();
  });

  it('unlesbarer Eintrag: nicht gebaut', async () => {
    window.localStorage.setItem(accountEntryKey('PUBLIC', account), 'x');
    const buildFn = vi.fn();
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn })).rejects.toMatchObject({ reason: 'blocked' });
    expect(buildFn).not.toHaveBeenCalled();
  });

  it('offener Pin, der nicht mehr passt: nichts gebaut, fruehere Transaktion wieder unklar', async () => {
    writeAccountEntry('PUBLIC', account, pinEntry());
    let adjusted = false;
    const buildFn = async ({ adjustAccount }) => { adjusted = true; adjustAccount(new Account(account, '100')); return { tx: {} }; };
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn })).rejects.toMatchObject({ reason: 'pinConsumed' });
    expect(adjusted).toBe(true);
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'ambiguous', recheck: 'pinConsumed' });
    expect(findAccountSendBlock('PUBLIC', account)).not.toBeNull();
  });

  it('Pin aus der Sammelzahlung, passende Sequence: die Transaktion bekommt genau die Pin-Sequence', async () => {
    writeSentEntry('PUBLIC', 'fpPin', pinEntry({ hash: H('b') }));
    const built = await guardedUnsignedBuild({ network: 'PUBLIC', account, build: build(new Account(account, '104')) });
    expect(built.tx.sequence).toBe('105');
    expect(readSentEntry('PUBLIC', 'fpPin')).toMatchObject({ status: 'notApplied', pin: true }); // nichts verbraucht oder aufgeraeumt
  });

  it('Pin vorhanden, aber vom Aufrufer nicht angewendet: nie ohne Pin bauen', async () => {
    writeAccountEntry('PUBLIC', account, pinEntry());
    const buildFn = async () => ({ tx: {} });
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn })).rejects.toMatchObject({ reason: 'pinConsumed' });
  });

  it('waehrend des Bauens schreibt ein anderer Tab einen unklaren Eintrag: Ergebnis wird verworfen', async () => {
    const buildFn = async () => { writeAccountEntry('PUBLIC', account, entry()); return { tx: {} }; };
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn })).rejects.toBeInstanceOf(SendBlockedError);
  });

  it('ohne Sperre und ohne Pin wird gebaut', async () => {
    const built = await guardedUnsignedBuild({ network: 'PUBLIC', account, build: build(new Account(account, '100')) });
    expect(built.tx.sequence).toBe('101');
  });

  it('Speicher nicht beschreibbar: nicht gebaut (fail-closed)', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      const buildFn = vi.fn();
      await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn })).rejects.toMatchObject({ reason: 'storageUnavailable' });
      expect(buildFn).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('D: Aufraeumen nur fuer das aktive Netz, nur unter dem Lock', () => {
  const old = (o) => pinEntry({ settledAt: Date.now() - NOT_APPLIED_RETENTION_MS - DAY, at: Date.now() - 40 * DAY, ...o });

  it('pruneAccountEntries(network) laesst Eintraege anderer Netze stehen', () => {
    writeAccountEntry('PUBLIC', account, old());
    writeAccountEntry('TESTNET', account, old());
    pruneAccountEntries(Date.now(), [], 'PUBLIC');
    expect(readAccountEntry('PUBLIC', account)).toBeNull();
    expect(readAccountEntry('TESTNET', account)).toMatchObject({ status: 'notApplied', pin: true });
  });

  it('guardedSubmit raeumt nur sein Netz auf', async () => {
    writeAccountEntry('TESTNET', account, old());
    await guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(new Account(account, '100')), submit: async () => ({ hash: 'x' }) });
    expect(readAccountEntry('TESTNET', account)).toMatchObject({ status: 'notApplied' });
  });

  it('pruneSentLog(network) laesst andere Netze stehen', () => {
    writeSentEntry('PUBLIC', 'a', old({ hash: H('c') }));
    writeSentEntry('TESTNET', 'a', old({ hash: H('c') }));
    pruneSentLog(Date.now(), 'PUBLIC');
    expect(window.localStorage.getItem(sentEntryKey('PUBLIC', 'a'))).toBeNull();
    expect(window.localStorage.getItem(sentEntryKey('TESTNET', 'a'))).not.toBeNull();
  });

  it('tryWithSendLock: frei -> laeuft; belegt -> laeuft nicht und wartet nicht', async () => {
    const free = await tryWithSendLock('PUBLIC', async () => 42);
    expect(free).toEqual({ ran: true, value: 42 });
    let release;
    const gate = new Promise((r) => { release = r; });
    const holder = withSendLock('PUBLIC', async () => { await gate; });
    await new Promise((r) => setTimeout(r, 300)); // Lock ist gesetzt
    const fn = vi.fn();
    const busy = await tryWithSendLock('PUBLIC', fn);
    expect(busy).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
    release();
    await holder;
  });

  it('tryWithSendLock reicht Fehler aus fn weiter', async () => {
    await expect(tryWithSendLock('PUBLIC', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

// ---- Buendel 4b-Fix: Bauen von Job/XDR unter dem Sende-Lock (N10), Web-Locks-Zweig ----------

// Minimaler Ersatz fuer navigator.locks (jsdom hat keine Web Locks): exklusiv pro Name,
// ifAvailable und signal wie in der echten API (abgebrochenes Warten wirft AbortError).
function installFakeLocks() {
  const held = new Set();
  const abort = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
  const locks = {
    request: vi.fn(async (name, optsOrCb, maybeCb) => {
      const opts = typeof optsOrCb === 'function' ? {} : optsOrCb;
      const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
      if (opts.signal?.aborted) throw abort();
      if (opts.ifAvailable && held.has(name)) return cb(null);
      while (held.has(name)) {
        await new Promise((r) => setTimeout(r, 5));
        if (opts.signal?.aborted) throw abort();
      }
      held.add(name);
      try { return await cb({ name }); } finally { held.delete(name); }
    }),
  };
  Object.defineProperty(window.navigator, 'locks', { value: locks, configurable: true });
  return locks;
}
const removeFakeLocks = () => { delete window.navigator.locks; };

// Beide Zweige von withSendLock (Web Locks vorhanden / nicht vorhanden) mit denselben Erwartungen.
describe.each([
  ['localStorage-Fallback (kein navigator.locks)', () => {}, () => {}],
  ['Web Locks (navigator.locks)', installFakeLocks, removeFakeLocks],
])('Sende-Lock: %s', (_name, setup, teardown) => {
  beforeEach(() => { setup(); });
  afterEach(() => { teardown(); });

  it('tryWithSendLock: frei laeuft, belegt laeuft nicht und wartet nicht, Fehler aus fn gehen durch', async () => {
    expect(await tryWithSendLock('PUBLIC', async () => 42)).toEqual({ ran: true, value: 42 });
    let release;
    const gate = new Promise((r) => { release = r; });
    const holder = withSendLock('PUBLIC', async () => { await gate; });
    await new Promise((r) => setTimeout(r, 300));
    const fn = vi.fn();
    expect(await tryWithSendLock('PUBLIC', fn)).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
    release();
    await holder;
    await expect(tryWithSendLock('PUBLIC', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('withSendLock: zweiter Aufruf wartet, onWaiting wird gerufen, signal bricht das Warten ab', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const holder = withSendLock('PUBLIC', async () => { await gate; });
    await new Promise((r) => setTimeout(r, 300));
    const controller = new AbortController();
    const onWaiting = vi.fn();
    const fn = vi.fn();
    const waiting = withSendLock('PUBLIC', fn, { signal: controller.signal, onWaiting });
    await new Promise((r) => setTimeout(r, 700));
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled();
    release();
    await holder;
  });

  it('N10: guardedUnsignedBuild wartet auf einen Sendevorgang im selben Netz und sieht danach dessen Eintrag (kein Bauen zwischen Pruefung und Schreiben)', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    // Sendevorgang eines anderen Tabs: haelt den Lock, schreibt seinen Eintrag vor dem POST.
    const sender = withSendLock('PUBLIC', async () => {
      await gate;
      writeAccountEntry('PUBLIC', account, entry());
    });
    await new Promise((r) => setTimeout(r, 300));
    const buildFn = vi.fn(async () => ({ tx: {} }));
    const onWaiting = vi.fn();
    const pending = guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn, onWaiting });
    pending.catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    expect(buildFn).not.toHaveBeenCalled();
    expect(onWaiting).toHaveBeenCalledTimes(1);
    release();
    await sender;
    await expect(pending).rejects.toMatchObject({ name: 'SendBlockedError', reason: 'blocked' });
    expect(buildFn).not.toHaveBeenCalled();
  });

  it('N10: ohne Eintrag baut guardedUnsignedBuild nach dem Warten und gibt den Lock danach wieder frei', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const sender = withSendLock('PUBLIC', async () => { await gate; });
    await new Promise((r) => setTimeout(r, 300));
    const pending = guardedUnsignedBuild({ network: 'PUBLIC', account, build: build(new Account(account, '100')) });
    release();
    await sender;
    expect((await pending).tx.sequence).toBe('101');
    // Lock frei: ein weiterer Aufruf (auch nach einem Fehler beim Bauen) wartet nicht.
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: async () => { throw new Error('boom'); } })).rejects.toThrow('boom');
    expect(await tryWithSendLock('PUBLIC', async () => 1)).toEqual({ ran: true, value: 1 });
  });

  it('N10: Abbruch beim Warten ist lockCancelled, es wird nichts gebaut', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const sender = withSendLock('PUBLIC', async () => { await gate; });
    await new Promise((r) => setTimeout(r, 300));
    const controller = new AbortController();
    const buildFn = vi.fn();
    const pending = guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 700));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'SendBlockedError', reason: 'lockCancelled' });
    expect(buildFn).not.toHaveBeenCalled();
    release();
    await sender;
  });

  it('N10: anderes Netz hat einen eigenen Lock, guardedUnsignedBuild wartet dort nicht', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const sender = withSendLock('TESTNET', async () => { await gate; });
    await new Promise((r) => setTimeout(r, 300));
    const built = await guardedUnsignedBuild({ network: 'PUBLIC', account, build: build(new Account(account, '100')) });
    expect(built.tx.sequence).toBe('101');
    release();
    await sender;
  });
});
