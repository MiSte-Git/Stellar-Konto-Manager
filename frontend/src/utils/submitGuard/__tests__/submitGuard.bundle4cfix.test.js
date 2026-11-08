// Buendel 4c-Fix: Abbruch beim Warten am Sende-Lock (M4) und Zeitlimit fuer das Laden im Lock.
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { readAccountEntry, resetAccountSendGuardMemory, writeAccountEntry } from '../accountSendGuard.js';
import { guardedSubmit, guardedUnsignedBuild, SendBlockedError } from '../guardedSubmit.js';
import { LoadTimeoutError, LOAD_IN_LOCK_TIMEOUT_MS } from '../loadTimeout.js';
import { PreSubmitCheckError } from '../../stellar/submitTransactionSafely.js';
import { withSendLock } from '../sendLock.js';

const SRC = Keypair.random();
const DEST = Keypair.random().publicKey();
const account = SRC.publicKey();

function build(seqAccount) {
  return async ({ adjustAccount }) => {
    const acc = adjustAccount ? adjustAccount(seqAccount) : seqAccount;
    const tx = new TransactionBuilder(acc, { fee: '100', networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.payment({ destination: DEST, amount: '1', asset: Asset.native() }))
      .setTimeout(60).build();
    tx.sign(SRC);
    return { tx };
  };
}
const accountObj = () => new Account(account, '100');

beforeEach(() => {
  window.localStorage.clear();
  resetAccountSendGuardMemory();
});

describe('M4: Abbruch beim Warten am Sende-Lock', () => {
  it('Abbruch waehrend des Wartens: nichts gebaut, nichts geschrieben, nichts gesendet (lockCancelled)', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let held;
    const started = new Promise((r) => { held = r; });
    const other = withSendLock('PUBLIC', async () => { held(); await gate; });
    await started;
    const controller = new AbortController();
    const submit = vi.fn();
    const buildTx = vi.fn(build(accountObj()));
    let waiting = false;
    const pending = guardedSubmit({
      network: 'PUBLIC', account, server: {}, networkPassphrase: Networks.PUBLIC, buildTx, submit,
      signal: controller.signal, onWaiting: () => { waiting = true; },
    });
    const outcome = pending.then(() => null, (e) => e);
    await vi.waitFor(() => expect(waiting).toBe(true));
    controller.abort();
    const err = await outcome;
    expect(err).toBeInstanceOf(SendBlockedError);
    expect(err.reason).toBe('lockCancelled');
    release();
    await other;
    // Auch nach Freigabe des Locks passiert nichts mehr.
    await new Promise((r) => setTimeout(r, 700));
    expect(buildTx).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toBeNull();
  });

  it('Abbruch erst waehrend des Ladens (Lock schon erteilt): kein Eintrag, kein Senden', async () => {
    const controller = new AbortController();
    const submit = vi.fn();
    const buildTx = async (args) => {
      const built = await build(accountObj())(args);
      controller.abort();
      return built;
    };
    await expect(guardedSubmit({
      network: 'PUBLIC', account, server: {}, networkPassphrase: Networks.PUBLIC, buildTx, submit, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'SendBlockedError', reason: 'lockCancelled' });
    expect(submit).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toBeNull();
  });

  it('guardedUnsignedBuild: Abbruch waehrend des Bauens liefert keine Transaktion', async () => {
    const controller = new AbortController();
    const buildFn = async (args) => {
      const built = await build(accountObj())(args);
      controller.abort();
      return built;
    };
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: buildFn, signal: controller.signal }))
      .rejects.toMatchObject({ reason: 'lockCancelled' });
  });

  it('guardedUnsignedBuild: Abbruch waehrend des Wartens', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let held;
    const started = new Promise((r) => { held = r; });
    const other = withSendLock('PUBLIC', async () => { held(); await gate; });
    await started;
    const controller = new AbortController();
    const buildFn = vi.fn(build(accountObj()));
    let waiting = false;
    const outcome = guardedUnsignedBuild({
      network: 'PUBLIC', account, build: buildFn, signal: controller.signal, onWaiting: () => { waiting = true; },
    }).then(() => null, (e) => e);
    await vi.waitFor(() => expect(waiting).toBe(true));
    controller.abort();
    expect(await outcome).toMatchObject({ reason: 'lockCancelled' });
    release();
    await other;
    expect(buildFn).not.toHaveBeenCalled();
  });
});

describe('Zeitlimit fuers Laden im Lock (nie fuer den POST)', () => {
  it('ein Standardwert ist gesetzt', () => {
    expect(LOAD_IN_LOCK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LOAD_IN_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(60 * 1000);
  });

  it('haengendes Laden: nach dem Limit PreSubmitCheckError, nichts gesendet, kein Eintrag, Lock wieder frei', async () => {
    const submit = vi.fn();
    const hanging = () => new Promise(() => {});
    const err = await guardedSubmit({
      network: 'PUBLIC', account, server: {}, networkPassphrase: Networks.PUBLIC, buildTx: hanging, submit, buildTimeoutMs: 50,
    }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(LoadTimeoutError);
    expect(err).toBeInstanceOf(PreSubmitCheckError);
    expect(err.message).toBe('submitTransaction.failed:loadTimeout');
    expect(submit).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toBeNull();
    // Der Lock ist frei: ein weiterer Versuch laeuft sofort.
    const next = await guardedSubmit({
      network: 'PUBLIC', account, server: {}, networkPassphrase: Networks.PUBLIC, buildTx: build(accountObj()), submit: async () => ({ hash: 'ok' }), buildTimeoutMs: 5000,
    });
    expect(next.res).toEqual({ hash: 'ok' });
  });

  it('ein nach dem Limit fertig werdendes Laden sendet nichts und kann einen Pin nicht mehr veraendern', async () => {
    const submit = vi.fn();
    const pin = {
      hash: 'a'.repeat(64), at: Date.now(), status: 'notApplied', pin: true, maxTime: Math.floor(Date.now() / 1000) - 300, seq: '999', source: account, origin: 'payment',
    };
    expect(writeAccountEntry('PUBLIC', account, pin)).toBe(true);
    let lateErr = null;
    const slow = async ({ adjustAccount }) => {
      await new Promise((r) => setTimeout(r, 200));
      // Der Pin (999) passt nicht zur Sequence 100: das wuerde ihn wieder als unklar fuehren.
      try { adjustAccount(accountObj()); } catch (e) { lateErr = e; }
      return build(accountObj())({ adjustAccount: null });
    };
    await expect(guardedSubmit({
      network: 'PUBLIC', account, server: {}, networkPassphrase: Networks.PUBLIC, buildTx: slow, submit, buildTimeoutMs: 30,
    })).rejects.toBeInstanceOf(LoadTimeoutError);
    await new Promise((r) => setTimeout(r, 400));
    expect(lateErr).toBeInstanceOf(LoadTimeoutError);
    expect(submit).not.toHaveBeenCalled();
    // Der Pin steht unveraendert da (nicht durch das zu spaete adjustAccount veraendert).
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'notApplied', pin: true, seq: '999' });
  });

  it('guardedUnsignedBuild: haengendes Bauen endet mit LoadTimeoutError', async () => {
    await expect(guardedUnsignedBuild({ network: 'PUBLIC', account, build: () => new Promise(() => {}), buildTimeoutMs: 50 }))
      .rejects.toBeInstanceOf(LoadTimeoutError);
  });

  it('der POST hat kein Limit von uns: ein langsames submit wird abgewartet', async () => {
    const submit = vi.fn(async () => { await new Promise((r) => setTimeout(r, 200)); return { hash: 'slow' }; });
    const res = await guardedSubmit({
      network: 'PUBLIC', account, server: {}, networkPassphrase: Networks.PUBLIC, buildTx: build(accountObj()), submit, buildTimeoutMs: 50,
    });
    expect(res.res).toEqual({ hash: 'slow' });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
