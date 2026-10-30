import { Account, Keypair, MuxedAccount } from '@stellar/stellar-sdk';
import {
  BATCH_PAYMENT_STORAGE_KEY, BATCH_SENT_PREFIX, RESEND_WINDOW_MS, containsSecretKey, createEmptyRow, loadBatchRows,
  looksLikeThousandsSeparator, normalizeAmount, pruneSentLog, readSentEntry, recentSendOf, saveBatchRows,
  sentEntryKey, writeSentEntry,
} from '../batchPaymentStore.js';
import { paymentFingerprint } from '../batchPaymentLogic.js';

const SRC = Keypair.random().publicKey();
const DST = Keypair.random().publicKey();
const HASH = 'a'.repeat(64);

beforeEach(() => window.localStorage.clear());

describe('rows', () => {
  it('stores rows per network and loads them back', () => {
    saveBatchRows('PUBLIC', [createEmptyRow({ source: SRC, dest: DST, amount: '5', memoVal: 'a' })]);
    saveBatchRows('TESTNET', [createEmptyRow({ source: DST })]);
    const pub = loadBatchRows('PUBLIC');
    expect(pub).toHaveLength(1);
    expect(pub[0]).toMatchObject({ source: SRC, dest: DST, amount: '5', memoVal: 'a', assetKey: 'XLM' });
    expect(loadBatchRows('TESTNET')[0].source).toBe(DST);
  });

  it('survives broken storage content', () => {
    window.localStorage.setItem(BATCH_PAYMENT_STORAGE_KEY, '{nope');
    expect(loadBatchRows('PUBLIC')).toEqual([]);
  });
});

describe('secret key filter', () => {
  const secret = Keypair.random().secret();
  const spaced = `${secret.slice(0, 20)} ${secret.slice(20)}`;

  it.each([
    ['exact', secret],
    ['with prefix', `key: ${secret}`],
    ['with suffix', `${secret} bitte`],
    ['with a space inside', spaced],
    ['lowercase', secret.toLowerCase()],
    ['with hyphens', secret.match(/.{1,4}/g).join('-')],
    ['with zero-width spaces', secret.split('').join('\u200b')],
    ['with LRM', secret.split('').join('\u200e')],
    ['with RLM', secret.split('').join('\u200f')],
    ['with bidi embedding', `\u202a${secret.slice(0, 10)}\u202a${secret.slice(10)}`],
    ['with invisible operator', secret.split('').join('\u2063')],
    ['with variation selector', secret.split('').join('\ufe0f')],
    ['with combining grapheme joiner', secret.split('').join('\u034f')],
    ['with colons', secret.match(/.{1,8}/g).join(':')],
    ['with commas', secret.match(/.{1,8}/g).join(',')],
    ['with slashes', secret.match(/.{1,8}/g).join('/')],
    ['with pipes', secret.match(/.{1,8}/g).join('|')],
    ["with apostrophes", secret.match(/.{1,8}/g).join("'")],
    ['with stars', secret.match(/.{1,8}/g).join('*')],
    ['with parentheses', `(${secret.slice(0, 20)})(${secret.slice(20)})`],
    ['with equals, hash and at', secret.match(/.{1,6}/g).join('=#@')],
    ['with bullets and middle dots', secret.match(/.{1,6}/g).join('•·')],
    ['with ? ! $ % >', secret.match(/.{1,5}/g).join('?!$%>')],
    ['in full width', secret.replace(/[A-Z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))],
  ])('detects a secret key %s', (_n, value) => {
    expect(containsSecretKey(value)).toBe(true);
  });

  it('does not treat asset keys as secrets', () => {
    for (let i = 0; i < 200; i += 1) {
      const issuer = Keypair.random().publicKey();
      for (const code of ['USDC', 'SSLX', 'S', 'XLMS', 'AQUA']) {
        expect(containsSecretKey(`${code}:${issuer}`)).toBe(false);
      }
    }
    saveBatchRows('PUBLIC', [createEmptyRow({ assetKey: `USDC:${SRC}` })]);
    expect(loadBatchRows('PUBLIC')[0].assetKey).toBe(`USDC:${SRC}`);
  });

  it('does not treat addresses with a label or text around them as secrets', () => {
    for (let i = 0; i < 1000; i += 1) {
      const g = Keypair.random().publicKey();
      const m = new MuxedAccount(new Account(g, '0'), String(i)).accountId();
      expect(containsSecretKey(`${g} (Konto A)`)).toBe(false);
      expect(containsSecretKey(`${g} thanks`)).toBe(false);
      expect(containsSecretKey(`${g}ABC`)).toBe(false);
      expect(containsSecretKey(`Konto: ${m} danke`)).toBe(false);
    }
  });

  it('still finds a secret next to an address or with a label', () => {
    const g = Keypair.random().publicKey();
    expect(containsSecretKey(`${g} ${secret}`)).toBe(true);
    expect(containsSecretKey(`${g}${secret}`)).toBe(true);
    expect(containsSecretKey(`Mein Key: ${secret}`)).toBe(true);
  });

  it('accepts long valid federation addresses but finds a secret inside one', () => {
    expect(containsSecretKey('alice*stellar-federation-service-for-business-payments-and-more.example.com')).toBe(false);
    expect(containsSecretKey('john*lobstr.co')).toBe(false);
    expect(containsSecretKey(`${secret}*evil.example`)).toBe(true);
    expect(containsSecretKey(`x*${secret.toLowerCase()}.example`)).toBe(true);
  });

  it('does not treat G or M addresses as secrets', () => {
    for (let i = 0; i < 50; i += 1) {
      const g = Keypair.random().publicKey();
      const m = new MuxedAccount(new Account(g, '0'), String(i)).accountId();
      expect(containsSecretKey(g)).toBe(false);
      expect(containsSecretKey(m)).toBe(false);
    }
  });

  it('never persists any field containing a secret', () => {
    saveBatchRows('PUBLIC', [createEmptyRow({ id: secret, source: secret, dest: spaced, memoVal: `x ${secret}`, amount: secret, assetKey: secret })]);
    const raw = window.localStorage.getItem(BATCH_PAYMENT_STORAGE_KEY);
    expect(raw.replace(/\s/g, '')).not.toContain(secret);
    const row = loadBatchRows('PUBLIC')[0];
    expect(row).toMatchObject({ source: '', dest: '', memoVal: '', amount: '', assetKey: 'XLM' });
  });

  it('drops secret-looking values that are already in storage', () => {
    window.localStorage.setItem(BATCH_PAYMENT_STORAGE_KEY, JSON.stringify({ version: 1, networks: { PUBLIC: [{ id: 'x', memoVal: `k ${secret}` }] } }));
    expect(loadBatchRows('PUBLIC')[0].memoVal).toBe('');
  });

  it('stores the sent log under a hash, never with addresses in clear text', () => {
    const fp = JSON.stringify(['PUBLIC', SRC, DST]);
    writeSentEntry('PUBLIC', fp, { hash: HASH, at: Date.now(), status: 'success' });
    const all = JSON.stringify({ ...window.localStorage });
    expect(all).not.toContain(SRC);
    expect(all).not.toContain(DST);
    expect(sentEntryKey('PUBLIC', fp)).toMatch(/^skm_batch_sent_v1:PUBLIC:[0-9a-f]{64}$/);
  });
});

describe('amounts', () => {
  it('normalizes amounts', () => {
    expect(normalizeAmount('12,50')).toBe('12.5');
    expect(normalizeAmount("1'000")).toBe('1000');
    expect(normalizeAmount('0012')).toBe('12');
    expect(normalizeAmount('0.0000001')).toBe('0.0000001');
    expect(normalizeAmount('0')).toBeNull();
    expect(normalizeAmount('1.12345678')).toBeNull();
    expect(normalizeAmount('-1')).toBeNull();
    expect(normalizeAmount('abc')).toBeNull();
    expect(normalizeAmount('922337203685.4775807')).toBe('922337203685.4775807');
    expect(normalizeAmount('922337203685.4775808')).toBeNull();
  });
  it('flags a likely thousands separator', () => {
    expect(looksLikeThousandsSeparator('1.000')).toBe(true);
    expect(looksLikeThousandsSeparator('12.500.000')).toBe(true);
    expect(looksLikeThousandsSeparator('1.5')).toBe(false);
    expect(looksLikeThousandsSeparator('1,000')).toBe(false);
  });
});

describe('sent log', () => {
  it('writes, reads and deletes entries immediately', () => {
    expect(writeSentEntry('PUBLIC', 'fp1', { hash: HASH, at: 1, status: 'ambiguous', maxTime: 1234 })).toBe(true);
    expect(readSentEntry('PUBLIC', 'fp1')).toEqual({ hash: HASH, at: 1, status: 'ambiguous', maxTime: 1234 });
    expect(readSentEntry('TESTNET', 'fp1')).toBeNull();
    writeSentEntry('PUBLIC', 'fp1', null);
    expect(readSentEntry('PUBLIC', 'fp1')).toBeNull();
  });

  it('keeps one storage key per payment, so writers never overwrite each other', () => {
    writeSentEntry('PUBLIC', 'fp1', { hash: HASH, at: Date.now(), status: 'success' });
    writeSentEntry('PUBLIC', 'fp2', { hash: HASH, at: Date.now(), status: 'success' });
    expect(readSentEntry('PUBLIC', 'fp1')).not.toBeNull();
    expect(readSentEntry('PUBLIC', 'fp2')).not.toBeNull();
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith(BATCH_SENT_PREFIX))).toHaveLength(2);
  });

  it('works for M-address destinations of any shape', () => {
    let count = 0;
    for (let i = 0; i < 200; i += 1) {
      const m = new MuxedAccount(new Account(Keypair.random().publicKey(), '0'), String(i)).accountId();
      const fp = paymentFingerprint({ network: 'PUBLIC', row: createEmptyRow({ source: SRC, amount: '1' }), destination: m });
      expect(writeSentEntry('PUBLIC', fp, { hash: HASH, at: Date.now(), status: 'ambiguous' })).toBe(true);
      expect(readSentEntry('PUBLIC', fp)).not.toBeNull();
      if (/S/.test(m.slice(1, 14))) count += 1;
    }
    expect(count).toBeGreaterThan(0); // Faelle mit S am Anfang sind wirklich dabei
  });

  it('is independent of the row list', () => {
    writeSentEntry('PUBLIC', 'fp1', { hash: HASH, at: Date.now(), status: 'success' });
    saveBatchRows('PUBLIC', []);
    expect(readSentEntry('PUBLIC', 'fp1')).not.toBeNull();
  });

  it('prunes old successful entries but keeps unclear ones', () => {
    const now = Date.now();
    writeSentEntry('PUBLIC', 'old', { hash: HASH, at: now - 8 * 24 * 3600 * 1000, status: 'success' });
    writeSentEntry('PUBLIC', 'new', { hash: HASH, at: now, status: 'success' });
    writeSentEntry('PUBLIC', 'amb', { hash: HASH, at: 0, status: 'ambiguous' });
    pruneSentLog(now);
    expect(readSentEntry('PUBLIC', 'old')).toBeNull();
    expect(readSentEntry('PUBLIC', 'new')).not.toBeNull();
    expect(readSentEntry('PUBLIC', 'amb')).not.toBeNull();
  });

  it('treats ambiguous as recent forever and success only within the window', () => {
    const now = Date.now();
    expect(recentSendOf({ hash: HASH, at: now - 1000, status: 'success' }, now)).toBeTruthy();
    expect(recentSendOf({ hash: HASH, at: now - RESEND_WINDOW_MS - 1, status: 'success' }, now)).toBeNull();
    expect(recentSendOf({ hash: HASH, at: 0, status: 'ambiguous' }, now)).toBeTruthy();
    expect(recentSendOf(null, now)).toBeNull();
  });
});
