import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  PENDING_TX_PREFIX, UNREADABLE_SEEN_PREFIX, accountEntryBlocks, accountEntryKey, batchAccountBlock, findAccountPins,
  findAccountSendBlock, listUnreadableBatchKeys, pruneAccountEntries, readAccountEntry, recordUnreadableLedgerSeen,
  rememberAmbiguous, resetAccountSendGuardMemory, settleAccountBlock, settleBatchUnreadable, signedTxFor,
  writeAccountEntry,
} from '../accountSendGuard.js';
import {
  AMBIGUOUS_LEDGER_BUFFER_SECONDS, classifySubmitCause, lookupTransaction, recordMatchesHash, resolveAmbiguousDetailed,
  settleAmbiguousEntry,
} from '../ambiguousResolve.js';
import { SendBlockedError, guardedSubmit } from '../guardedSubmit.js';
import { readSentEntry, sentEntryKey, writeSentEntry } from '../../batchPayment/batchPaymentStore.js';
import { AmbiguousSubmitResultError, SubmittedTransactionFailedError } from '../../stellar/submitTransactionSafely.js';
import { txHashHex } from '../../stellar/txHash.js';

const SRC = Keypair.random();
const OTHER = Keypair.random().publicKey();
const DEST = Keypair.random().publicKey();
const H = (c) => c.repeat(64);
const nf = () => { const e = new Error('nf'); e.response = { status: 404 }; return e; };
const iso = (sec) => new Date(sec * 1000).toISOString();

function entry(o = {}) {
  return {
    hash: H('a'), at: 1000, status: 'ambiguous', maxTime: 2000, seq: '101', source: SRC.publicKey(), origin: 'payment',
    cause: { kind: 'network', status: null }, ...o,
  };
}

function fakeServer({ ledger = () => 2000 + AMBIGUOUS_LEDGER_BUFFER_SECONDS + 5, tx = () => nf(), accountSeq = '100' } = {}) {
  const calls = { tx: [], ledgers: 0, account: 0 };
  return {
    calls,
    ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => { calls.ledgers += 1; const l = ledger(calls.ledgers); if (l instanceof Error) throw l; return { records: [{ closed_at: iso(l) }] }; } }) }) }),
    transactions: () => ({ transaction: (hash) => ({ call: async () => { calls.tx.push(hash); const r = tx(hash, calls.tx.length); if (r instanceof Error) throw r; return r; } }) }),
    loadAccount: async (id) => { calls.account += 1; const s = typeof accountSeq === 'function' ? accountSeq() : accountSeq; if (s instanceof Error) throw s; return new Account(id, s); },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAccountSendGuardMemory();
});

describe('Speicher pro Konto und Netz', () => {
  it('speichert Hash, Quellkonto, Sequence, maxTime, Netz, Zeitpunkt und Ursache, ohne Adresse im Schluessel', () => {
    expect(writeAccountEntry('PUBLIC', SRC.publicKey(), entry())).toBe(true);
    const key = accountEntryKey('PUBLIC', SRC.publicKey());
    expect(key.startsWith(`${PENDING_TX_PREFIX}PUBLIC:`)).toBe(true);
    expect(key).not.toContain(SRC.publicKey());
    const raw = JSON.parse(window.localStorage.getItem(key));
    expect(raw).toMatchObject({ hash: H('a'), source: SRC.publicKey(), seq: '101', maxTime: 2000, network: 'PUBLIC', at: 1000, cause: { kind: 'network' } });
    expect(readAccountEntry('PUBLIC', SRC.publicKey())).toMatchObject({ status: 'ambiguous', hash: H('a') });
    // Gegenprobe: anderes Netz und anderes Konto sehen den Eintrag nicht
    expect(readAccountEntry('TESTNET', SRC.publicKey())).toBeNull();
    expect(readAccountEntry('PUBLIC', OTHER)).toBeNull();
  });

  it('verwirft Felder mit Secret Keys und speichert kein XDR', () => {
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry({
      payment: { dest: DEST, amount: '5', memoType: 'text', memoVal: SRC.secret() },
      summary: { recipient: DEST, memo: `x ${SRC.secret()} y` },
      xdr: 'AAAA',
    }));
    const raw = window.localStorage.getItem(accountEntryKey('PUBLIC', SRC.publicKey()));
    expect(raw).not.toContain(SRC.secret());
    expect(raw).not.toContain('xdr');
    expect(JSON.parse(raw).payment.memoVal).toBe('');
  });

  it('unlesbarer Eintrag sperrt (fail-closed) und wird mit Zeitpunkt festgehalten', () => {
    const key = accountEntryKey('PUBLIC', SRC.publicKey());
    window.localStorage.setItem(key, '{kaputt');
    const e = readAccountEntry('PUBLIC', SRC.publicKey(), 5000);
    expect(e).toMatchObject({ status: 'ambiguous', unreadable: true, seenAt: 5000 });
    expect(JSON.parse(window.localStorage.getItem(key))).toEqual({ v: 1, status: 'unreadable', seenAt: 5000 });
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey())).toMatchObject({ kind: 'single' });
    // Eintrag eines fremden Kontos unter diesem Schluessel: ebenfalls unlesbar, sperrt
    window.localStorage.setItem(key, JSON.stringify(entry({ source: OTHER, network: 'PUBLIC' })));
    expect(readAccountEntry('PUBLIC', SRC.publicKey())?.unreadable).toBe(true);
  });

  it('Sammelzahlung unklar sperrt dasselbe Konto, nicht ein anderes; nicht ausgefuehrt sperrt nicht', () => {
    writeSentEntry('PUBLIC', 'fp1', { hash: H('b'), at: 1, status: 'ambiguous', maxTime: 2000, seq: '7', source: SRC.publicKey() });
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey())).toMatchObject({ kind: 'batch', key: sentEntryKey('PUBLIC', 'fp1') });
    expect(findAccountSendBlock('PUBLIC', OTHER)).toBeNull();
    expect(findAccountSendBlock('TESTNET', SRC.publicKey())).toBeNull();
    writeSentEntry('PUBLIC', 'fp1', { hash: H('b'), at: 1, status: 'notApplied', maxTime: 2000, seq: '7', source: SRC.publicKey() });
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey())).toBeNull();
  });

  it('Einzelzahlung unklar sperrt die Sammelzahlung fuer dieses Konto (accountEntryBlocks)', () => {
    expect(accountEntryBlocks('PUBLIC', SRC.publicKey())).toBe(false);
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry());
    expect(accountEntryBlocks('PUBLIC', SRC.publicKey())).toBe(true);
    expect(accountEntryBlocks('TESTNET', SRC.publicKey())).toBe(false);
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry({ status: 'notApplied' }));
    expect(accountEntryBlocks('PUBLIC', SRC.publicKey())).toBe(false);
  });

  it('fehlender Eintrag (Website-Daten geloescht) sperrt weiter, solange der Tab ihn kennt', () => {
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry());
    rememberAmbiguous('PUBLIC', SRC.publicKey(), readAccountEntry('PUBLIC', SRC.publicKey()));
    window.localStorage.clear();
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey())).toMatchObject({ kind: 'single', missing: true });
    expect(accountEntryBlocks('PUBLIC', SRC.publicKey())).toBe(true);
  });
});

describe('Aufloesung ueber Horizon (gleiche Regeln wie Sammelzahlung)', () => {
  const account = SRC.publicKey();
  const block = () => findAccountSendBlock('PUBLIC', account);

  it('angewendet: success, Felder bleiben fuer Anzeige und Vermerk', async () => {
    writeAccountEntry('PUBLIC', account, entry({ payment: { dest: DEST, amount: '5' } }));
    const srv = fakeServer({ tx: (hash) => ({ hash, successful: true }) });
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: srv, maxValiditySeconds: 180 });
    expect(res.outcome).toBe('success');
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'success', payment: { dest: DEST } });
    expect(block()).toBeNull();
  });

  it('Horizon nicht erreichbar: bleibt gesperrt (unknown)', async () => {
    writeAccountEntry('PUBLIC', account, entry());
    const srv = fakeServer({ ledger: () => new Error('down'), tx: () => new Error('down') });
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: srv, maxValiditySeconds: 180 });
    expect(res.outcome).toBe('unknown');
    expect(block()).toMatchObject({ kind: 'single' });
  });

  it('noch gueltig laut Ledger-Zeit (auch wenn die lokale Uhr weit voraus ist): pending, gesperrt', async () => {
    writeAccountEntry('PUBLIC', account, entry());
    const srv = fakeServer({ ledger: () => 1990 });
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: srv, maxValiditySeconds: 180 });
    expect(res.outcome).toBe('pending');
    expect(block()).not.toBeNull();
  });

  it('abgelaufen, Sequence genau die naechste: notApplied mit Pin', async () => {
    writeAccountEntry('PUBLIC', account, entry());
    const srv = fakeServer({ accountSeq: '100' });
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: srv, maxValiditySeconds: 180, resolve: (a) => resolveAmbiguousDetailed({ ...a, sleep: async () => {} }) });
    expect(res.outcome).toBe('expired');
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'notApplied', pin: true, seq: '101' });
    expect(block()).toBeNull();
  });

  it('Sammelzahlungs-Eintrag wird mit deren Regeln geklaert und dort geschrieben', async () => {
    writeSentEntry('PUBLIC', 'fp1', { hash: H('b'), at: 1, status: 'ambiguous', maxTime: 2000, seq: '101', source: account });
    const srv = fakeServer({ tx: (hash) => ({ hash, successful: true }) });
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: srv, maxValiditySeconds: 180 });
    expect(res.outcome).toBe('success');
    expect(readSentEntry('PUBLIC', 'fp1')).toMatchObject({ status: 'success', hash: H('b') });
  });

  it('unlesbar ohne Hash: erst frei, wenn zwei Ledger nach seenAt + Gueltigkeit + Puffer liegen', async () => {
    window.localStorage.setItem(accountEntryKey('PUBLIC', account), 'x');
    readAccountEntry('PUBLIC', account, 1000 * 1000);
    // M1: Beim Erkennen war Horizon erreichbar, Ledger-Zeit ebenfalls 1000 s. Ohne sie haelt
    // die erste Pruefung die Ledger-Zeit fest (eigener Test unten).
    expect(recordUnreadableLedgerSeen('PUBLIC', account, block(), 1000)).toBe(1000);
    const limit = 1000 + 180 + AMBIGUOUS_LEDGER_BUFFER_SECONDS;
    const early = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: fakeServer({ ledger: () => limit - 1 }), maxValiditySeconds: 180, sleep: async () => {} });
    expect(early.outcome).toBe('pending');
    expect(block()).not.toBeNull();
    // Zweiter Knoten hinkt: bleibt gesperrt
    const lag = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: fakeServer({ ledger: (n) => (n === 1 ? limit + 5 : limit - 5) }), maxValiditySeconds: 180, sleep: async () => {} });
    expect(lag.outcome).toBe('pending');
    const sleeps = [];
    const ok = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: fakeServer({ ledger: () => limit + 5 }), maxValiditySeconds: 180, sleep: async (ms) => { sleeps.push(ms); } });
    expect(ok.outcome).toBe('expired');
    expect(sleeps).toEqual([30000]);
    expect(block()).toBeNull();
  });

  it('unlesbar mit lesbarem Hash, im Ledger erfolgreich: angewendet', async () => {
    window.localStorage.setItem(accountEntryKey('PUBLIC', account), JSON.stringify({ hash: H('c'), status: 'ambiguous' }));
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ unreadable: true, hash: H('c') });
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: block(), server: fakeServer({ tx: (hash) => ({ hash, successful: true }) }), maxValiditySeconds: 180 });
    expect(res.outcome).toBe('success');
    expect(block()).toBeNull();
  });

  it('settleAmbiguousEntry aendert nichts, wenn ein anderer Tab den Eintrag inzwischen ersetzt hat', async () => {
    let stored = entry();
    const write = vi.fn((e) => { stored = e; });
    const res = await settleAmbiguousEntry({
      server: null, read: () => stored, write,
      resolve: async () => { stored = entry({ hash: H('d') }); return { outcome: 'expired', hash: H('a') }; },
    });
    expect(res.outcome).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('N1 und N2 im gemeinsamen Code', () => {
  it('N1: Konto-Sequence weit unter der gespeicherten (Testnet-Reset): kein Pin, strenger Pfad', async () => {
    const sleeps = [];
    const srv = fakeServer({ accountSeq: '5' });
    const res = await resolveAmbiguousDetailed({ server: srv, entry: entry({ seq: '101' }), sleep: async (ms) => { sleeps.push(ms); } });
    expect(res.outcome).toBe('expired');
    expect(sleeps).toEqual([30000]);
    // Gegenprobe: genau die naechste Sequence -> Pin
    const res2 = await resolveAmbiguousDetailed({ server: fakeServer({ accountSeq: '100' }), entry: entry({ seq: '101' }), sleep: async () => {} });
    expect(res2.outcome).toBe('expiredPinned');
  });

  it('N2: Fee-Bump mit dieser inneren Transaktion zaehlt als gefunden', async () => {
    const inner = H('e');
    const record = { hash: H('f'), successful: true, inner_transaction: { hash: inner } };
    expect(recordMatchesHash(record, inner)).toBe(true);
    expect(recordMatchesHash({ hash: H('f'), inner_transaction: { hash: H('1') } }, inner)).toBe(false);
    const srv = fakeServer({ tx: () => record });
    expect(await lookupTransaction(srv, inner)).toBe('success');
  });
});

describe('classifySubmitCause', () => {
  it('unterscheidet Netzwerkfehler, Zeitueberschreitung und Serverantwort', () => {
    expect(classifySubmitCause(new TypeError('Failed to fetch'))).toEqual({ kind: 'network', status: null });
    expect(classifySubmitCause(Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' }))).toEqual({ kind: 'timeout', status: null });
    expect(classifySubmitCause({ response: { status: 504 } })).toEqual({ kind: 'timeout', status: 504 });
    expect(classifySubmitCause({ response: { status: 503 } })).toEqual({ kind: 'server', status: 503 });
  });
});

describe('guardedSubmit', () => {
  const account = SRC.publicKey();
  function build(seqAccount = new Account(account, '100')) {
    return async ({ adjustAccount }) => {
      const acc = adjustAccount ? adjustAccount(seqAccount) : seqAccount;
      const tx = new TransactionBuilder(acc, { fee: '100', networkPassphrase: Networks.PUBLIC })
        .addOperation(Operation.payment({ destination: DEST, amount: '1', asset: Asset.native() }))
        .setTimeout(180).build();
      tx.sign(SRC);
      return { tx, meta: {} };
    };
  }
  const ambiguous = (tx) => new AmbiguousSubmitResultError(txHashHex(tx), new TypeError('Failed to fetch'), { request: { url: 'x' }, lookups: [] });

  it('schreibt vor dem Submit einen unklaren Eintrag und nach Erfolg success', async () => {
    let seenDuringSubmit = null;
    const res = await guardedSubmit({
      network: 'PUBLIC', account, server: {}, networkPassphrase: Networks.PUBLIC, buildTx: build(),
      submit: async (_s, tx) => { seenDuringSubmit = readAccountEntry('PUBLIC', account); return { hash: txHashHex(tx) }; },
    });
    expect(seenDuringSubmit).toMatchObject({ status: 'ambiguous', hash: res.hash, seq: '101' });
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'success', hash: res.hash });
    expect(signedTxFor('PUBLIC', account, res.hash)).toBeNull();
  });

  it('unklar: Eintrag mit Ursache, signierte Transaktion nur im Arbeitsspeicher, danach gesperrt', async () => {
    let hash = '';
    await expect(guardedSubmit({
      network: 'PUBLIC', account, server: {}, networkPassphrase: Networks.PUBLIC, buildTx: build(),
      submit: async (_s, tx) => { hash = txHashHex(tx); throw ambiguous(tx); },
    })).rejects.toBeInstanceOf(AmbiguousSubmitResultError);
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'ambiguous', hash, cause: { kind: 'network' } });
    expect(signedTxFor('PUBLIC', account, hash)?.xdr).toBeTruthy();
    expect(JSON.stringify(window.localStorage)).not.toContain(signedTxFor('PUBLIC', account, hash).xdr);
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(), submit })).rejects.toMatchObject({ reason: 'blocked' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('eindeutig abgelehnt: vorheriger Stand wird wiederhergestellt', async () => {
    const err = Object.assign(new Error('bad'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_insufficient_balance' } } } } });
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(), submit: async () => { throw err; } })).rejects.toBe(err);
    expect(readAccountEntry('PUBLIC', account)).toBeNull();
  });

  it('Sammelzahlung unklar fuer dieses Konto: sendet nicht', async () => {
    writeSentEntry('PUBLIC', 'fp', { hash: H('b'), at: 1, status: 'ambiguous', maxTime: 2000, seq: '7', source: account });
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(), submit })).rejects.toBeInstanceOf(SendBlockedError);
    expect(submit).not.toHaveBeenCalled();
  });

  // Eintraege mit aktuellem Zeitpunkt: nicht ausgefuehrte Eintraege aelter als 30 Tage werden
  // vor dem Senden aufgeraeumt (F5). Ein Pin gilt nur bei Konto-Sequence genau Pin - 1 (F7).
  const pinEntry = (o = {}) => entry({ status: 'notApplied', pin: true, at: Date.now(), ...o });

  it('nach notApplied mit Pin: neue Transaktion nutzt genau die gespeicherte Sequence und merkt den alten Hash', async () => {
    writeAccountEntry('PUBLIC', account, pinEntry({ seq: '105' }));
    let sent = null;
    await guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(new Account(account, '104')), submit: async (_s, tx) => { sent = tx; return {}; } });
    expect(sent.sequence).toBe('105');
    // Sequence verbraucht: Pin erledigt, Eintrag ist der neue Erfolg
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'success', seq: '105' });
  });

  it('F7: Konto-Sequence weit unter dem Pin: sendet nicht, fruehere Transaktion wieder unklar (strenger Pfad)', async () => {
    writeAccountEntry('PUBLIC', account, pinEntry({ seq: '105' }));
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(new Account(account, '100')), submit })).rejects.toMatchObject({ reason: 'pinConsumed' });
    expect(submit).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'ambiguous', hash: H('a'), recheck: 'pinConsumed' });
  });

  it('Pin verbraucht: sendet nicht, fruehere Transaktion wieder unklar', async () => {
    writeAccountEntry('PUBLIC', account, pinEntry({ seq: '101' }));
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(new Account(account, '101')), submit })).rejects.toMatchObject({ reason: 'pinConsumed' });
    expect(submit).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'ambiguous', hash: H('a') });
  });

  it('Pin abgelehnt (tx_bad_seq): fruehere Transaktion wieder unklar, mit Hash', async () => {
    writeAccountEntry('PUBLIC', account, pinEntry({ seq: '101' }));
    const err = { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } } };
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(), submit: async () => { throw err; } })).rejects.toMatchObject({ reason: 'badSeq' });
    expect(readAccountEntry('PUBLIC', account)).toMatchObject({ status: 'ambiguous', hash: H('a'), recheck: 'badSeq' });
  });

  it('ohne beschreibbaren Speicher wird nicht gesendet', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const submit = vi.fn();
    try {
      await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(), submit })).rejects.toMatchObject({ reason: 'storageUnavailable' });
    } finally {
      spy.mockRestore();
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it('wartet auf einen anderen Sendevorgang (gleicher Lock wie die Sammelzahlung) und laesst sich abbrechen', async () => {
    window.localStorage.setItem('skm_batch_send_lock_v1:skm-batch-send-PUBLIC', JSON.stringify({ owner: 'other', at: Date.now() }));
    const controller = new AbortController();
    const onWaiting = vi.fn(() => controller.abort());
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: build(), submit, onWaiting, signal: controller.signal })).rejects.toMatchObject({ reason: 'lockCancelled' });
    expect(onWaiting).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

// ---- Nachbesserung review_zahlung_unklar_sonnet.md ---------------------------------------

function buildFor(account, seqAccount) {
  return async ({ adjustAccount }) => {
    const acc = adjustAccount ? adjustAccount(seqAccount) : seqAccount;
    const tx = new TransactionBuilder(acc, { fee: '100', networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.payment({ destination: DEST, amount: '1', asset: Asset.native() }))
      .setTimeout(180).build();
    tx.sign(SRC);
    return { tx, meta: {} };
  };
}
const batchPin = (o = {}) => ({ hash: H('b'), at: Date.now(), status: 'notApplied', maxTime: 2000, seq: '105', source: SRC.publicKey(), pin: true, ...o });

describe('F1: Pin gilt fuer das Konto, in beiden Sendewegen', () => {
  const account = SRC.publicKey();

  it('findAccountPins findet Pins aus beiden Speichern, nur fuer dieses Konto und Netz', () => {
    writeAccountEntry('PUBLIC', account, entry({ status: 'notApplied', pin: true, at: Date.now(), seq: '105' }));
    writeSentEntry('PUBLIC', 'fpPin', batchPin());
    writeSentEntry('PUBLIC', 'fpOther', batchPin({ source: OTHER }));
    writeSentEntry('PUBLIC', 'fpNoPin', batchPin({ pin: false }));
    expect(findAccountPins('PUBLIC', account).map((p) => p.store).sort()).toEqual(['account', 'batch']);
    expect(findAccountPins('TESTNET', account)).toEqual([]);
  });

  it('Pin der Sammelzahlung: Zahlung senden nutzt genau diese Sequence, danach ist der Pin erledigt', async () => {
    writeSentEntry('PUBLIC', 'fpPin', batchPin());
    let sent = null;
    await guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: buildFor(account, new Account(account, '104')), submit: async (_s, tx) => { sent = tx; return {}; } });
    expect(sent.sequence).toBe('105');
    expect(readSentEntry('PUBLIC', 'fpPin')).toMatchObject({ status: 'notApplied' });
    expect(readSentEntry('PUBLIC', 'fpPin').pin).toBeUndefined();
  });

  it('Pin der Sammelzahlung passt nicht (verbraucht): Zahlung senden sendet nicht, Eintrag der Sammelzahlung wieder unklar', async () => {
    writeSentEntry('PUBLIC', 'fpPin', batchPin());
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: buildFor(account, new Account(account, '105')), submit }))
      .rejects.toMatchObject({ reason: 'pinConsumed' });
    expect(submit).not.toHaveBeenCalled();
    expect(readSentEntry('PUBLIC', 'fpPin')).toMatchObject({ status: 'ambiguous', hash: H('b') });
    expect(findAccountSendBlock('PUBLIC', account)).toMatchObject({ kind: 'batch' });
  });

  it('Pin der Sammelzahlung, Netz lehnt ab (tx_bad_seq): eigener Eintrag zurueckgesetzt, Eintrag der Sammelzahlung wieder unklar', async () => {
    writeSentEntry('PUBLIC', 'fpPin', batchPin());
    const err = { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } } };
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: buildFor(account, new Account(account, '104')), submit: async () => { throw err; } }))
      .rejects.toMatchObject({ reason: 'badSeq' });
    expect(readAccountEntry('PUBLIC', account)).toBeNull();
    expect(readSentEntry('PUBLIC', 'fpPin')).toMatchObject({ status: 'ambiguous', hash: H('b') });
  });

  it('im Ledger fehlgeschlagen verbraucht die Sequence: Pin erledigt', async () => {
    writeSentEntry('PUBLIC', 'fpPin', batchPin());
    const failed = new SubmittedTransactionFailedError(H('c'), { result_xdr: 'kaputt' });
    await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: buildFor(account, new Account(account, '104')), submit: async () => { throw failed; } }))
      .rejects.toBe(failed);
    expect(readSentEntry('PUBLIC', 'fpPin').pin).toBeUndefined();
  });

  it('Aufloesung eines anderen Eintrags mit derselben Sequence (angewendet) erledigt den Pin', async () => {
    writeSentEntry('PUBLIC', 'fpPin', batchPin());
    writeSentEntry('PUBLIC', 'fpAmb', { hash: H('d'), at: Date.now(), status: 'ambiguous', maxTime: 2000, seq: '105', source: account });
    const srv = fakeServer({ tx: (hash) => (hash === H('d') ? { hash, successful: true } : nf()) });
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: findAccountSendBlock('PUBLIC', account), server: srv, maxValiditySeconds: 180 });
    expect(res.outcome).toBe('success');
    expect(readSentEntry('PUBLIC', 'fpPin').pin).toBeUndefined();
  });
});

describe('F2: unlesbare Eintraege der Sammelzahlung sperren jedes Konto im Netz', () => {
  const brokenKey = (net = 'PUBLIC') => `skm_batch_sent_v1:${net}:${'f'.repeat(64)}`;

  it('sperrt Zahlung senden fuer alle Konten im Netz des Eintrags, nicht im anderen Netz', async () => {
    window.localStorage.setItem(brokenKey(), '{kaputt');
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey())).toMatchObject({ kind: 'batchUnreadable', key: brokenKey() });
    expect(findAccountSendBlock('PUBLIC', OTHER)).toMatchObject({ kind: 'batchUnreadable' });
    expect(findAccountSendBlock('TESTNET', SRC.publicKey())).toBeNull();
    expect(batchAccountBlock('PUBLIC', OTHER)).toBe('logUnreadable');
    const submit = vi.fn();
    await expect(guardedSubmit({ network: 'PUBLIC', account: OTHER, server: {}, buildTx: buildFor(OTHER, new Account(OTHER, '1')), submit }))
      .rejects.toMatchObject({ reason: 'blocked' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('Netz unbekannt: sperrt alle Netze; die Schreibprobe zaehlt nicht', () => {
    window.localStorage.setItem('skm_batch_sent_v1:probe', '1');
    expect(listUnreadableBatchKeys('PUBLIC')).toEqual([]);
    window.localStorage.setItem('skm_batch_sent_v1:kaputt', '{x');
    expect(listUnreadableBatchKeys('PUBLIC')).toEqual(['skm_batch_sent_v1:kaputt']);
    expect(listUnreadableBatchKeys('TESTNET')).toEqual(['skm_batch_sent_v1:kaputt']);
  });

  it('Ausweg wie bei Zahlung senden: zeitliche Freigabe ueber die Ledger-Zeit, Eintrag danach entfernt', async () => {
    window.localStorage.setItem(brokenKey(), '{kaputt');
    const blk = findAccountSendBlock('PUBLIC', SRC.publicKey());
    const seenSec = blk.entry.seenAt / 1000;
    recordUnreadableLedgerSeen('', '', blk, seenSec);
    const limit = seenSec + 180 + AMBIGUOUS_LEDGER_BUFFER_SECONDS;
    const early = await settleBatchUnreadable({ key: brokenKey(), server: fakeServer({ ledger: () => limit - 1 }), maxValiditySeconds: 180, sleep: async () => {} });
    expect(early.outcome).toBe('pending');
    const ok = await settleBatchUnreadable({ key: brokenKey(), server: fakeServer({ ledger: () => limit + 5 }), maxValiditySeconds: 180, sleep: async () => {} });
    expect(ok.outcome).toBe('expired');
    expect(window.localStorage.getItem(brokenKey())).toBeNull();
    expect(window.localStorage.getItem(`${UNREADABLE_SEEN_PREFIX}${brokenKey()}`)).toBeNull();
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey())).toBeNull();
  });

  it('lesbarer Hash im Ledger: sofort frei; ueber den Hook-Weg settleAccountBlock', async () => {
    window.localStorage.setItem(brokenKey(), JSON.stringify({ hash: H('e'), status: 'kaputt' }));
    const blk = findAccountSendBlock('PUBLIC', SRC.publicKey());
    expect(blk.entry.hash).toBe(H('e'));
    const res = await settleAccountBlock({ network: 'PUBLIC', account: SRC.publicKey(), block: blk, server: fakeServer({ tx: (hash) => ({ hash, successful: true }) }), maxValiditySeconds: 180, batchMaxValiditySeconds: 180 });
    expect(res.outcome).toBe('success');
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey())).toBeNull();
  });

  it('anderer unlesbarer Inhalt unter demselben Schluessel gilt als neu erkannt', () => {
    window.localStorage.setItem(brokenKey(), '{a');
    const first = findAccountSendBlock('PUBLIC', SRC.publicKey()).entry;
    window.localStorage.setItem(`${UNREADABLE_SEEN_PREFIX}${brokenKey()}`, JSON.stringify({ v: 1, digest: first.digest, seenAt: 1 }));
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey()).entry.seenAt).toBe(1);
    window.localStorage.setItem(brokenKey(), '{b');
    expect(findAccountSendBlock('PUBLIC', SRC.publicKey()).entry.seenAt).toBeGreaterThan(1);
  });
});

describe('F3: Abfrage waehrend des eigenen Submits', () => {
  it('nach eindeutiger Ablehnung keine Sperre "Eintrag fehlt"', async () => {
    const account = SRC.publicKey();
    let during = null;
    const err = Object.assign(new Error('bad'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } } });
    await expect(guardedSubmit({
      network: 'PUBLIC', account, server: {}, buildTx: buildFor(account, new Account(account, '100')),
      submit: async () => { during = findAccountSendBlock('PUBLIC', account); throw err; },
    })).rejects.toBe(err);
    expect(during).toMatchObject({ kind: 'single', sending: true });
    expect(findAccountSendBlock('PUBLIC', account)).toBeNull();
    expect(accountEntryBlocks('PUBLIC', account)).toBe(false);
  });
});

describe('F4 und M1: unlesbarer Eintrag von Zahlung senden', () => {
  const account = SRC.publicKey();
  const key = () => accountEntryKey('PUBLIC', account);

  it('F4: lesbarer Hash, im Ledger fehlgeschlagen: Sperre aufgehoben, Ergebnis fehlgeschlagen', async () => {
    window.localStorage.setItem(key(), JSON.stringify({ hash: H('c'), status: 'ambiguous' }));
    const blk = findAccountSendBlock('PUBLIC', account);
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: blk, server: fakeServer({ tx: (hash) => ({ hash, successful: false }) }), maxValiditySeconds: 180 });
    expect(res.outcome).toBe('failed');
    expect(findAccountSendBlock('PUBLIC', account)).toBeNull();
  });

  it('M1: ohne Ledger-Zeit haelt die erste Pruefung sie fest und bleibt gesperrt', async () => {
    window.localStorage.setItem(key(), 'x');
    readAccountEntry('PUBLIC', account, 1000 * 1000);
    // Lokal waere die Grenze 1240 s; der Ledger meldet 5000 s, das gilt jetzt als erstes Erkennen.
    const res = await settleAccountBlock({ network: 'PUBLIC', account, block: findAccountSendBlock('PUBLIC', account), server: fakeServer({ ledger: () => 5000 }), maxValiditySeconds: 180, sleep: async () => {} });
    expect(res.outcome).toBe('pending');
    expect(JSON.parse(window.localStorage.getItem(key()))).toMatchObject({ seenAt: 1000 * 1000, ledgerSeenAt: 5000 });
  });

  it('M1: Rechneruhr zurueckgestellt (lokales seenAt zu frueh): Grenze aus der Ledger-Zeit', async () => {
    window.localStorage.setItem(key(), 'x');
    readAccountEntry('PUBLIC', account, 1000 * 1000);
    recordUnreadableLedgerSeen('PUBLIC', account, findAccountSendBlock('PUBLIC', account), 1500);
    // Nur lokal: frei ab 1240 s. Mit Ledger-Zeit: erst ab 1740 s.
    const mid = await settleAccountBlock({ network: 'PUBLIC', account, block: findAccountSendBlock('PUBLIC', account), server: fakeServer({ ledger: () => 1300 }), maxValiditySeconds: 180, sleep: async () => {} });
    expect(mid.outcome).toBe('pending');
    expect(mid.clearAt).toBe((1500 + 180 + AMBIGUOUS_LEDGER_BUFFER_SECONDS) * 1000);
    const ok = await settleAccountBlock({ network: 'PUBLIC', account, block: findAccountSendBlock('PUBLIC', account), server: fakeServer({ ledger: () => 1745 }), maxValiditySeconds: 180, sleep: async () => {} });
    expect(ok.outcome).toBe('expired');
  });
});

describe('F5: Aufraeumen', () => {
  it('entfernt nicht ausgefuehrte Eintraege (auch mit Pin) nach 30 Tagen, unklare nie', () => {
    const day = 24 * 3600 * 1000;
    const now = Date.now();
    writeAccountEntry('PUBLIC', SRC.publicKey(), entry({ status: 'notApplied', pin: true, at: now - 31 * day }));
    writeAccountEntry('PUBLIC', OTHER, entry({ source: OTHER, status: 'notApplied', at: now - 29 * day }));
    const third = Keypair.random().publicKey();
    writeAccountEntry('PUBLIC', third, entry({ source: third, status: 'ambiguous', at: now - 90 * day }));
    pruneAccountEntries(now);
    expect(readAccountEntry('PUBLIC', SRC.publicKey())).toBeNull();
    expect(readAccountEntry('PUBLIC', OTHER)).not.toBeNull();
    expect(readAccountEntry('PUBLIC', third)).not.toBeNull();
  });
});

describe('guardedSubmit: Speicher und Lock', () => {
  const account = SRC.publicKey();

  it('Schreibprobe geht, Eintrag nicht (Quota): kein Submit', async () => {
    const orig = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(k, v) {
      if (String(k).startsWith(PENDING_TX_PREFIX)) throw new Error('quota');
      return orig.call(this, k, v);
    });
    const submit = vi.fn();
    try {
      await expect(guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: buildFor(account, new Account(account, '100')), submit }))
        .rejects.toMatchObject({ reason: 'storageUnavailable' });
    } finally {
      spy.mockRestore();
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it('Lock geht waehrend des Bauens verloren (localStorage-Lock): concurrent, kein Submit', async () => {
    const submit = vi.fn();
    const build = buildFor(account, new Account(account, '100'));
    await expect(guardedSubmit({
      network: 'PUBLIC', account, server: {}, submit,
      buildTx: async (a) => {
        window.localStorage.setItem('skm_batch_send_lock_v1:skm-batch-send-PUBLIC', JSON.stringify({ owner: 'other', at: Date.now() }));
        return build(a);
      },
    })).rejects.toMatchObject({ reason: 'concurrent' });
    expect(submit).not.toHaveBeenCalled();
    expect(readAccountEntry('PUBLIC', account)).toBeNull();
  });

  it('zwei gleichzeitige Sendevorgaenge (localStorage-Lock): der zweite wartet und ist nach unklarem Ausgang gesperrt', async () => {
    const submit = vi.fn(async (_s, tx) => { await new Promise((r) => setTimeout(r, 50)); throw ambiguousFor(tx); });
    const run = () => guardedSubmit({ network: 'PUBLIC', account, server: {}, buildTx: buildFor(account, new Account(account, '100')), submit });
    const [a, b] = await Promise.allSettled([run(), run()]);
    expect(submit).toHaveBeenCalledTimes(1);
    const reasons = [a, b].map((r) => (r.reason instanceof SendBlockedError ? r.reason.reason : r.reason?.name));
    expect(reasons.sort()).toEqual(['AmbiguousSubmitResultError', 'blocked']);
  });
});
const ambiguousFor = (tx) => new AmbiguousSubmitResultError(txHashHex(tx), new TypeError('Failed to fetch'));
