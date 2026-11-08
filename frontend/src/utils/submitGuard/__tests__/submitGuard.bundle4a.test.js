// Buendel 4a: Folgerunde zum gemeinsamen Sendeschutz (N1 bis N5, Luecken aus
// review_zahlung_unklar_nach_sonnet.md) und Sendeschutz im Trading (origin 'trade').
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  UNREADABLE_SEEN_PREFIX, accountEntryKey, applyAccountPins, batchUnreadableInfo, findAccountPins, findAccountSendBlock,
  listUnreadableBatchKeys, pruneAccountEntries, pruneUnreadableSeen, readAccountEntry, rememberAmbiguous,
  resetAccountSendGuardMemory, settleAccountBlock, settleBatchUnreadable, writeAccountEntry,
} from '../accountSendGuard.js';
import {
  AMBIGUOUS_LEDGER_BUFFER_SECONDS, pinnedSendAccount, resolveAmbiguousDetailed, settleAmbiguousEntry,
} from '../ambiguousResolve.js';
import { guardedSubmit } from '../guardedSubmit.js';
import { NOT_APPLIED_RETENTION_MS, readSentEntry, sanitizeSentEntry, writeSentEntry } from '../../batchPayment/batchPaymentStore.js';
import { AmbiguousSubmitResultError } from '../../stellar/submitTransactionSafely.js';
import { txHashHex } from '../../stellar/txHash.js';

const SRC = Keypair.random();
const OTHER = Keypair.random().publicKey();
const DEST = Keypair.random().publicKey();
const H = (c) => c.repeat(64);
const DAY = 24 * 3600 * 1000;
const nf = () => { const e = new Error('nf'); e.response = { status: 404 }; return e; };
const iso = (sec) => new Date(sec * 1000).toISOString();

const entry = (o = {}) => ({
  hash: H('a'), at: 1000, status: 'ambiguous', maxTime: 2000, seq: '101', source: SRC.publicKey(), origin: 'payment',
  cause: { kind: 'network', status: null }, ...o,
});
const batchPin = (o = {}) => ({ hash: H('b'), at: Date.now(), status: 'notApplied', maxTime: 2000, seq: '105', source: SRC.publicKey(), pin: true, ...o });

function fakeServer({ ledger = () => 2000 + AMBIGUOUS_LEDGER_BUFFER_SECONDS + 5, tx = () => nf(), accountSeq = '100' } = {}) {
  return {
    ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ closed_at: iso(ledger()) }] }) }) }) }),
    transactions: () => ({ transaction: (hash) => ({ call: async () => { const r = tx(hash); if (r instanceof Error) throw r; return r; } }) }),
    loadAccount: async (id) => new Account(id, accountSeq),
  };
}

function build(account, seqAccount) {
  return async ({ adjustAccount }) => {
    const acc = adjustAccount ? adjustAccount(seqAccount) : seqAccount;
    const tx = new TransactionBuilder(acc, { fee: '100', networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.payment({ destination: DEST, amount: '1', asset: Asset.native() }))
      .setTimeout(60).build();
    tx.sign(SRC);
    return { tx, meta: {} };
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAccountSendGuardMemory();
});

describe('N1: 30 Tage ab Vergabe des Pins, Aufraeumen nach dem Lesen der Pins', () => {
  it('die Aufloesung haelt den Zeitpunkt der Klaerung (settledAt) fest, at bleibt der Zeitpunkt des Sendens', async () => {
    const old = Date.now() - 29 * DAY;
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry({ at: old }));
    const before = Date.now();
    const res = await settleAmbiguousEntry({
      server: fakeServer({ accountSeq: '100' }),
      read: () => readAccountEntry('PUBLIC', SRC.publicKey()),
      write: (e) => writeAccountEntry('PUBLIC', SRC.publicKey(), e),
      resolve: async () => ({ outcome: 'expiredPinned', hash: H('a') }),
    });
    expect(res.outcome).toBe('expired');
    const stored = readAccountEntry('PUBLIC', SRC.publicKey());
    expect(stored).toMatchObject({ status: 'notApplied', pin: true, at: old });
    expect(stored.settledAt).toBeGreaterThanOrEqual(before);
  });

  it('ein vor 35 Tagen gesendeter, eben geklaerter Pin bleibt stehen; nach 31 Tagen ab Klaerung wird er entfernt', () => {
    const now = Date.now();
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry({ status: 'notApplied', pin: true, at: now - 35 * DAY, settledAt: now - 1000 }));
    pruneAccountEntries(now);
    expect(readAccountEntry('PUBLIC', SRC.publicKey())).toMatchObject({ pin: true });
    pruneAccountEntries(now + NOT_APPLIED_RETENTION_MS - 1000);
    expect(readAccountEntry('PUBLIC', SRC.publicKey())).not.toBeNull();
    pruneAccountEntries(now + 31 * DAY);
    expect(readAccountEntry('PUBLIC', SRC.publicKey())).toBeNull();
  });

  it('Alteintrag ohne settledAt zaehlt ab dem Senden (wie bisher)', () => {
    const now = Date.now();
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry({ status: 'notApplied', pin: true, at: now - 31 * DAY }));
    expect(readAccountEntry('PUBLIC', SRC.publicKey()).settledAt).toBeUndefined();
    pruneAccountEntries(now);
    expect(readAccountEntry('PUBLIC', SRC.publicKey())).toBeNull();
  });

  it('settledAt bleibt nur bei nicht ausgefuehrten Eintraegen erhalten', () => {
    expect(sanitizeSentEntry({ hash: H('a'), at: 1, status: 'notApplied', settledAt: 5 }).settledAt).toBe(5);
    expect(sanitizeSentEntry({ hash: H('a'), at: 1, status: 'success', settledAt: 5 }).settledAt).toBeUndefined();
    expect(sanitizeSentEntry({ hash: H('a'), at: 1, status: 'notApplied', settledAt: 'x' }).settledAt).toBeUndefined();
  });

  it('guardedSubmit liest die Pins vor dem Aufraeumen: ein eben ablaufender Pin gilt fuer dieses Senden noch', async () => {
    const account = SRC.publicKey();
    const now = Date.now();
    // Laut Frist (31 Tage ab Klaerung) aufzuraeumen, wird aber vor dem Aufraeumen gelesen. Die
    // Konto-Sequence passt nicht zum Pin (100 statt 104): mit gelesenem Pin wird nicht gesendet
    // (strenger Pfad); wuerde zuerst aufgeraeumt, ginge die Zahlung ohne Pin mit Sequence 101 raus.
    writeAccountEntry('PUBLIC', account, entry({ status: 'notApplied', pin: true, seq: '105', at: now - 40 * DAY, settledAt: now - 31 * DAY }));
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(account, new Account(account, '100')), submit }))
      .rejects.toMatchObject({ reason: 'pinConsumed' });
    expect(submit).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'ambiguous', recheck: 'pinConsumed' });
  });

  it('Pin der Sammelzahlung: gleiche Regel im Sende-Protokoll', () => {
    const now = Date.now();
    writeSentEntry('PUBLIC', 'fp', batchPin({ at: now - 35 * DAY, settledAt: now - 1000 }));
    pruneAccountEntries(now);
    expect(readSentEntry('PUBLIC', 'fp')).toMatchObject({ status: 'notApplied', pin: true });
  });
});

describe('N3: Konto-Sequence unter dem Pin geht in die strenge Pruefung', () => {
  it('nur genau pin - 1 nutzt den Pin; darunter und darueber ist gesperrt', () => {
    const acc = (s) => new Account(SRC.publicKey(), s);
    expect(pinnedSendAccount({ account: acc('104'), source: SRC.publicKey(), pinSeq: '105' })).toMatchObject({ pinned: true });
    expect(pinnedSendAccount({ account: acc('103'), source: SRC.publicKey(), pinSeq: '105' })).toEqual({ consumed: true, behind: true });
    expect(pinnedSendAccount({ account: acc('100'), source: SRC.publicKey(), pinSeq: '105' })).toEqual({ consumed: true, behind: true });
    expect(pinnedSendAccount({ account: acc('105'), source: SRC.publicKey(), pinSeq: '105' })).toEqual({ consumed: true });
  });

  it('zwei Pins mit verschiedener Sequence: passt einer nicht, wird nicht gesendet (fail-closed)', () => {
    const loaded = new Account(SRC.publicKey(), '104');
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry({ status: 'notApplied', pin: true, seq: '105', at: Date.now() }));
    writeSentEntry('PUBLIC', 'fpOther', batchPin({ seq: '107', hash: H('c') }));
    const pins = findAccountPins('PUBLIC', SRC.publicKey());
    expect(pins).toHaveLength(2);
    const res = applyAccountPins({ loaded, source: SRC.publicKey(), pins });
    expect(res.blocked).toHaveLength(1);
    expect(res.blocked[0].entry.seq).toBe('107');
    expect(res.account).toBeUndefined();
  });

  it('Pin aus der Sammelzahlung, neue Zahlung wird unklar: der Pin-Eintrag bleibt stehen (kein Verlust)', async () => {
    const account = SRC.publicKey();
    writeSentEntry('PUBLIC', 'fpPin', batchPin());
    let built = null;
    await expect(guardedSubmit({
      network: 'PUBLIC', account, server: {},
      buildTx: async (a) => { built = await build(account, new Account(account, '104'))(a); return built; },
      submit: async () => { throw new AmbiguousSubmitResultError(txHashHex(built.tx), new TypeError('Failed to fetch'), { request: { url: 'x' }, lookups: [] }); },
    })).rejects.toBeInstanceOf(AmbiguousSubmitResultError);
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'ambiguous', seq: '105' });
    expect(readSentEntry('PUBLIC', 'fpPin')).toMatchObject({ status: 'notApplied', pin: true });
    expect(findAccountSendBlock('PUBLIC', account)).toMatchObject({ kind: 'single' });
  });
});

describe('N4: Abbruch der Klaerung', () => {
  const stuck = () => fakeServer({ accountSeq: '50' }); // Sequence weit darunter: strenger Pfad mit 30 s Wartezeit

  it('resolveAmbiguousDetailed bricht mitten in der Wartezeit mit AbortError ab', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const started = Date.now();
    await expect(resolveAmbiguousDetailed({ server: stuck(), entry: entry(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('bereits abgebrochen: gar keine Abfrage', async () => {
    const controller = new AbortController();
    controller.abort();
    const server = stuck();
    server.transactions = vi.fn();
    await expect(resolveAmbiguousDetailed({ server, entry: entry(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.transactions).not.toHaveBeenCalled();
  });

  it('abgebrochene Klaerung schreibt nichts: der Eintrag bleibt unklar und sperrt weiter', async () => {
    const account = SRC.publicKey();
    writeAccountEntry('PUBLIC', account, entry());
    const controller = new AbortController();
    const write = vi.fn();
    setTimeout(() => controller.abort(), 10);
    await expect(settleAmbiguousEntry({
      server: stuck(), signal: controller.signal, write,
      read: () => readAccountEntry('PUBLIC', account),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(write).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'ambiguous', hash: H('a') });
    expect(findAccountSendBlock('PUBLIC', account)).toMatchObject({ kind: 'single' });
  });

  it('Abbruch nach fertiger Abfrage, aber vor dem Schreiben: wird verworfen, nichts geschrieben', async () => {
    const controller = new AbortController();
    const write = vi.fn();
    await expect(settleAmbiguousEntry({
      server: {}, signal: controller.signal, write,
      read: () => entry(),
      resolve: async () => { controller.abort(); return { outcome: 'expired', hash: H('a') }; },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(write).not.toHaveBeenCalled();
  });
});

describe('N5: verwaiste Seitenvermerke unlesbarer Eintraege', () => {
  const brokenKey = `skm_batch_sent_v1:PUBLIC:${'f'.repeat(64)}`;
  const sideKey = `${UNREADABLE_SEEN_PREFIX}${brokenKey}`;

  it('entfernt den Vermerk nur, wenn der Eintrag sicher fehlt', () => {
    window.localStorage.setItem(brokenKey, '{kaputt');
    expect(batchUnreadableInfo(brokenKey)).toMatchObject({ unreadable: true });
    expect(window.localStorage.getItem(sideKey)).not.toBeNull();
    pruneUnreadableSeen();
    expect(window.localStorage.getItem(sideKey)).not.toBeNull(); // Eintrag da: im Zweifel behalten
    window.localStorage.removeItem(brokenKey);
    pruneUnreadableSeen();
    expect(window.localStorage.getItem(sideKey)).toBeNull();
  });

  it('fremde Schluessel mit demselben Praefix bleiben (kein Sammelzahlungs-Schluessel)', () => {
    window.localStorage.setItem(`${UNREADABLE_SEEN_PREFIX}anderes`, '{}');
    pruneUnreadableSeen();
    expect(window.localStorage.getItem(`${UNREADABLE_SEEN_PREFIX}anderes`)).toBe('{}');
  });

  it('pruneAccountEntries raeumt mit auf', () => {
    window.localStorage.setItem(sideKey, JSON.stringify({ v: 1, digest: 'x', seenAt: 1 }));
    pruneAccountEntries();
    expect(window.localStorage.getItem(sideKey)).toBeNull();
  });
});

describe('Luecken aus dem Review: N2, N6, M1', () => {
  const account = SRC.publicKey();

  it('N2 (zweiter Tab): fehlt ein bekannter unklarer Eintrag, sperrt "Eintrag fehlt" bis zur Klaerung (fail-closed)', () => {
    // Dieser Tab kennt den Eintrag eines anderen Tabs, der ihn danach wieder entfernt.
    writeAccountEntry('PUBLIC', account, entry());
    rememberAmbiguous('PUBLIC', account, readAccountEntry('PUBLIC', account));
    window.localStorage.removeItem(accountEntryKey('PUBLIC', account));
    expect(findAccountSendBlock('PUBLIC', account)).toMatchObject({ kind: 'single', missing: true });
  });

  it('N6: alter Sammelzahlungs-Eintrag ohne Quellkonto sperrt das Konto nicht, ein Eintrag mit unbekanntem Schluessel schon', () => {
    window.localStorage.setItem(`skm_batch_sent_v1:PUBLIC:${'e'.repeat(64)}`, JSON.stringify({ hash: H('d'), at: 1, status: 'ambiguous', maxTime: 2000 }));
    expect(findAccountSendBlock('PUBLIC', account)).toBeNull();
    // Netz nicht aus dem Schluessel lesbar: auch ein lesbarer unklarer Eintrag sperrt alle Netze.
    window.localStorage.setItem('skm_batch_sent_v1:altform', JSON.stringify({ hash: H('d'), at: 1, status: 'ambiguous', maxTime: 2000, seq: '5', source: OTHER }));
    expect(listUnreadableBatchKeys('PUBLIC')).toEqual(['skm_batch_sent_v1:altform']);
    expect(listUnreadableBatchKeys('TESTNET')).toEqual(['skm_batch_sent_v1:altform']);
    expect(findAccountSendBlock('PUBLIC', account)).toMatchObject({ kind: 'batchUnreadable' });
  });

  it('M1: laesst sich die Ledger-Zeit nicht speichern, bleibt der unlesbare Eintrag gesperrt (nie frueh frei)', async () => {
    window.localStorage.setItem(accountEntryKey('PUBLIC', account), 'x');
    readAccountEntry('PUBLIC', account, 1000 * 1000);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      const res = await settleAccountBlock({
        network: 'PUBLIC', account, block: findAccountSendBlock('PUBLIC', account),
        server: fakeServer({ ledger: () => 99999 }), maxValiditySeconds: 180, sleep: async () => {},
      });
      expect(res.outcome).toBe('pending');
    } finally {
      spy.mockRestore();
    }
    expect(findAccountSendBlock('PUBLIC', account)).toMatchObject({ kind: 'single' });
  });

  it('M1 (Sammelzahlung): gleiches Verhalten beim unlesbaren Eintrag der Sammelzahlung', async () => {
    const key = `skm_batch_sent_v1:PUBLIC:${'f'.repeat(64)}`;
    window.localStorage.setItem(key, '{kaputt');
    expect(batchUnreadableInfo(key, 1000 * 1000)).toMatchObject({ unreadable: true });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      const res = await settleBatchUnreadable({ key, server: fakeServer({ ledger: () => 99999 }), maxValiditySeconds: 180, sleep: async () => {} });
      expect(res.outcome).toBe('pending');
    } finally {
      spy.mockRestore();
    }
    expect(window.localStorage.getItem(key)).toBe('{kaputt');
  });
});

describe('Trading: Herkunft trade im gemeinsamen Eintrag', () => {
  it('ein Eintrag mit origin trade und Aktion sperrt das Konto wie eine Zahlung', async () => {
    const account = SRC.publicKey();
    let built = null;
    await expect(guardedSubmit({
      network: 'PUBLIC', account, server: {},
      buildTx: async (a) => { built = await build(account, new Account(account, '100'))(a); return built; },
      entryData: () => ({ origin: 'trade', summary: { action: 'Swap: 5 XLM gegen mindestens 1 USDC' } }),
      submit: async () => { throw new AmbiguousSubmitResultError(txHashHex(built.tx), new TypeError('Failed to fetch'), { request: { url: 'x' }, lookups: [] }); },
    })).rejects.toBeInstanceOf(AmbiguousSubmitResultError);
    const stored = readAccountEntry('PUBLIC', account);
    expect(stored).toMatchObject({ status: 'ambiguous', origin: 'trade', summary: { action: 'Swap: 5 XLM gegen mindestens 1 USDC' } });
    expect(findAccountSendBlock('PUBLIC', account)).toMatchObject({ kind: 'single' });
    // Zahlung senden und Sammelzahlung sehen dieselbe Sperre; ein zweiter Versand wird abgewiesen.
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(account, new Account(account, '100')), submit }))
      .rejects.toMatchObject({ reason: 'blocked' });
    expect(submit).not.toHaveBeenCalled();
  });
});
