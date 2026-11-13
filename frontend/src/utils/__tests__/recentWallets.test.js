// Kontenliste: normalizeStoredWallet und loadRecentWalletsFromStorage an einer Stelle (vorher je
// eine Kopie in main.jsx und useRecentWalletOptions.js). Die Referenz unten ist die alte Kopie,
// wortgleich (Stand 420c8fb). Kein Kontotyp-Feld wird gespeichert oder ergaenzt.
import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { loadRecentWalletsFromStorage, normalizeStoredWallet, walletLookupKey } from '../recentWallets.js';
import { extractBasePublicKeyFromMuxed } from '../stellar/stellarUtils.js';

function oldNormalizeStoredWallet(entry) {
  if (typeof entry === 'string') {
    return { publicKey: entry, isTestnet: false };
  }
  if (!entry || typeof entry !== 'object') return null;
  const pk = entry.publicKey || entry.address || entry.value || '';
  if (!pk) return null;
  return { publicKey: pk, isTestnet: typeof entry.isTestnet === 'boolean' ? entry.isTestnet : undefined };
}

function oldLoadRecentWalletsFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem('recentWallets') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(oldNormalizeStoredWallet).filter(Boolean);
  } catch {
    return [];
  }
}

// main.jsx/useRecentWalletOptions.js vor der Umstellung (Label- und Netzsuche)
function oldLookupKey(publicKey) {
  let baseKey = publicKey;
  if (baseKey && baseKey.startsWith('M')) {
    try {
      baseKey = extractBasePublicKeyFromMuxed(baseKey);
    } catch {
      baseKey = publicKey;
    }
  }
  return baseKey;
}

const G = Keypair.random().publicKey();
const M = StrKey.encodeMed25519PublicKey(new Uint8Array([...StrKey.decodeEd25519PublicKey(G), 0, 0, 0, 0, 0, 0, 1, 2]));
const C = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';

const ENTRIES = [
  G,
  M,
  '',
  'Mkaputt',
  { publicKey: G, isTestnet: true },
  { publicKey: M, isTestnet: false },
  { publicKey: G },
  { address: G, isTestnet: 'ja' },
  { value: M },
  { publicKey: '', address: '', value: '' },
  { isTestnet: true },
  {},
  null,
  undefined,
  42,
  true,
  [G],
];

describe('normalizeStoredWallet', () => {
  it.each(ENTRIES.map((e) => [JSON.stringify(e) ?? String(e), e]))('%s wie die alte Kopie', (_l, entry) => {
    expect(normalizeStoredWallet(entry)).toEqual(oldNormalizeStoredWallet(entry));
  });

  it('ergaenzt kein Kontotyp-Feld', () => {
    expect(Object.keys(normalizeStoredWallet({ publicKey: M, isTestnet: true, kind: 'muxed' }))).toEqual(['publicKey', 'isTestnet']);
    expect(normalizeStoredWallet(G)).toEqual({ publicKey: G, isTestnet: false });
  });
});

describe('loadRecentWalletsFromStorage', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['gemischt alt und neu', JSON.stringify(ENTRIES.filter((e) => e !== undefined))],
    ['leer', null],
    ['kein Array', JSON.stringify({ publicKey: G })],
    ['kaputtes JSON', '[{'],
  ])('%s wie die alte Kopie', (_l, raw) => {
    if (raw !== null) localStorage.setItem('recentWallets', raw);
    expect(loadRecentWalletsFromStorage()).toEqual(oldLoadRecentWalletsFromStorage());
  });

  it('liest nur, schreibt nichts zurueck', () => {
    const raw = JSON.stringify([G, { publicKey: M }]);
    localStorage.setItem('recentWallets', raw);
    loadRecentWalletsFromStorage();
    expect(localStorage.getItem('recentWallets')).toBe(raw);
  });
});

describe('walletLookupKey', () => {
  it.each([G, M, C, '', 'Mkaputt', 'M', 'Gkaputt', undefined])('%s wie der alte Ausdruck', (input) => {
    expect(walletLookupKey(input)).toBe(oldLookupKey(input));
  });

  it('M-Adresse ergibt das Basiskonto', () => {
    expect(walletLookupKey(M)).toBe(G);
  });
});
