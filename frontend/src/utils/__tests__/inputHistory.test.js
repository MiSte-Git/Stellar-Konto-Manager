// F-4 (Review Fable): Die Eingabe-Historie (TEXT_INPUT_HISTORY_KEYS) speichert keinen Secret Key. Vorher
// schrieb "Zahlung senden" einen ins Empfaenger- oder Memo-Feld eingefuegten Secret Key beim Verlassen des
// Feldes ungeprueft ins localStorage, und er erschien als Vorschlag.
// - writeHistoryArray laesst Eintraege mit Secret Key weg (Strings und Objekte wie in recentWallets).
// - readHistoryArray filtert den Altbestand und schreibt die bereinigte Liste einmal zurueck, ohne Event.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  INPUT_HISTORY_CHANGED_EVENT, PAYMENT_MEMO_HISTORY_KEY, PAYMENT_RECIPIENT_HISTORY_KEY, RECENT_WALLETS_KEY,
  TEXT_INPUT_HISTORY_KEYS, readHistoryArray, writeHistoryArray,
} from '../inputHistory.js';
import { loadRecentWalletsFromStorage } from '../recentWallets.js';

const kp = Keypair.random();
const SECRET = kp.secret();
const G = kp.publicKey();
const SPACED = SECRET.match(/.{1,4}/g).join(' ');
const DASHED = SECRET.match(/.{1,7}/g).join('-');
const WRONG_CHECKSUM = SECRET.slice(0, -1) + (SECRET.endsWith('A') ? 'B' : 'A');
const stored = (key) => JSON.parse(window.localStorage.getItem(key) || 'null');

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('writeHistoryArray (F-4)', () => {
  it.each(TEXT_INPUT_HISTORY_KEYS)('%s: kein Eintrag mit Secret Key, auch mit Leerzeichen oder Bindestrichen', (key) => {
    writeHistoryArray(key, ['Miete Mai', SECRET, SPACED, DASHED, `Key: ${SECRET}`, G]);
    expect(stored(key)).toEqual(['Miete Mai', G]);
  });

  it('Objekt-Eintraege (recentWallets) mit Secret Key fallen weg, mit G-Adresse bleiben sie', () => {
    writeHistoryArray(RECENT_WALLETS_KEY, [{ publicKey: SECRET, isTestnet: true }, { publicKey: G, isTestnet: false }]);
    expect(stored(RECENT_WALLETS_KEY)).toEqual([{ publicKey: G, isTestnet: false }]);
  });

  it('Gegenprobe: G-Adresse, Memo, Betrag und S-aehnlicher String mit falscher Pruefsumme bleiben', () => {
    writeHistoryArray(PAYMENT_MEMO_HISTORY_KEY, [G, 'Rechnung 42', '12.5', WRONG_CHECKSUM]);
    expect(stored(PAYMENT_MEMO_HISTORY_KEY)).toEqual([G, 'Rechnung 42', '12.5', WRONG_CHECKSUM]);
  });
});

describe('readHistoryArray (F-4): Altbestand', () => {
  it('filtert Secret Keys und schreibt die bereinigte Liste einmal zurueck, ohne Event', () => {
    window.localStorage.setItem(PAYMENT_RECIPIENT_HISTORY_KEY, JSON.stringify([G, SECRET, 'Miete', SPACED]));
    const events = vi.fn();
    window.addEventListener(INPUT_HISTORY_CHANGED_EVENT, events);
    try {
      expect(readHistoryArray(PAYMENT_RECIPIENT_HISTORY_KEY)).toEqual([G, 'Miete']);
      expect(stored(PAYMENT_RECIPIENT_HISTORY_KEY)).toEqual([G, 'Miete']);
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      expect(readHistoryArray(PAYMENT_RECIPIENT_HISTORY_KEY)).toEqual([G, 'Miete']);
      expect(setItem).not.toHaveBeenCalled();
      expect(events).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(INPUT_HISTORY_CHANGED_EVENT, events);
    }
  });

  it('Gegenprobe: ohne Secret Key wird nichts zurueckgeschrieben', () => {
    window.localStorage.setItem(PAYMENT_MEMO_HISTORY_KEY, JSON.stringify([G, 'Rechnung 42', WRONG_CHECKSUM]));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    expect(readHistoryArray(PAYMENT_MEMO_HISTORY_KEY)).toEqual([G, 'Rechnung 42', WRONG_CHECKSUM]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('recentWallets: loadRecentWalletsFromStorage liest ueber dieselbe Bereinigung', () => {
    window.localStorage.setItem(RECENT_WALLETS_KEY, JSON.stringify([SECRET, { publicKey: SECRET }, G, { publicKey: G, isTestnet: true }]));
    expect(loadRecentWalletsFromStorage()).toEqual([{ publicKey: G, isTestnet: false }, { publicKey: G, isTestnet: true }]);
    expect(stored(RECENT_WALLETS_KEY)).toEqual([G, { publicKey: G, isTestnet: true }]);
  });
});

describe('recentWallets: Schreiben ueber writeHistoryArray (F-4)', () => {
  it('main.jsx und useRecentWalletOptions.js schreiben recentWallets nicht mehr direkt per setItem', async () => {
    const fs = await import('node:fs');
    for (const file of ['../../main.jsx', '../useRecentWalletOptions.js']) {
      const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/localStorage\.setItem\('recentWallets'/);
      expect(source, file).toMatch(/writeHistoryArray\(RECENT_WALLETS_KEY/);
    }
  });
});
