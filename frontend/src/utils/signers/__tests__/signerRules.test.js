// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Buffer } from 'buffer';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  SIGNER_TYPES,
  findInvalidSignerKey,
  interactiveSigners,
  interactiveWeight,
  isInteractiveSigner,
  isMultisigAccount,
  isValidSignerKey,
  signerKeyOf,
  signerTypeOf,
  singleSignerSuffices,
} from '../signerRules.js';

const G = Keypair.random().publicKey();
const G2 = Keypair.random().publicKey();
const T = StrKey.encodePreAuthTx(Buffer.alloc(32, 1));
const X = StrKey.encodeSha256Hash(Buffer.alloc(32, 2));
const P = StrKey.encodeSignedPayload(Buffer.concat([
  StrKey.decodeEd25519PublicKey(Keypair.random().publicKey()),
  Buffer.from([0, 0, 0, 4]),
  Buffer.from([9, 9, 9, 9]),
]));
const M = StrKey.encodeMed25519PublicKey(Buffer.concat([StrKey.decodeEd25519PublicKey(G), Buffer.alloc(8, 1)]));
const C = StrKey.encodeContract(Buffer.alloc(32, 3));
// gleiche Laenge und Buchstabe wie G, aber falsche Pruefsumme
const G_BAD_CHECKSUM = `${G.slice(0, -1)}${G.endsWith('A') ? 'B' : 'A'}`;

const ED = SIGNER_TYPES.ED25519;
const HASH = SIGNER_TYPES.SHA256_HASH;
const PRE = SIGNER_TYPES.PRE_AUTH_TX;
const SP = SIGNER_TYPES.SIGNED_PAYLOAD;
const UNKNOWN = SIGNER_TYPES.UNKNOWN;

describe('signerKeyOf', () => {
  it('liest alle Schreibweisen und Strings', () => {
    expect(signerKeyOf({ key: G })).toBe(G);
    expect(signerKeyOf({ public_key: G })).toBe(G);
    expect(signerKeyOf({ publicKey: G })).toBe(G);
    expect(signerKeyOf({ ed25519PublicKey: G })).toBe(G);
    expect(signerKeyOf(G)).toBe(G);
  });
  it('liefert leer statt zu werfen', () => {
    expect(signerKeyOf(null)).toBe('');
    expect(signerKeyOf(undefined)).toBe('');
    expect(signerKeyOf({})).toBe('');
    expect(signerKeyOf(42)).toBe('');
  });
});

describe('signerTypeOf: Matrix Horizon-Typ x Schluessel', () => {
  // [Horizon-Typ, Schluessel, erwarteter Typ]
  const cases = [
    // Typ und Praefix stimmen: Horizon-Typ gilt
    [ED, G, ED],
    [HASH, X, HASH],
    [PRE, T, PRE],
    [SP, P, SP],
    // ohne Horizon-Typ: aus dem Strkey, mit Pruefsumme
    [undefined, G, ED],
    [undefined, X, HASH],
    [undefined, T, PRE],
    [undefined, P, SP],
    [undefined, G_BAD_CHECKSUM, UNKNOWN],
    [undefined, M, UNKNOWN],
    [undefined, C, UNKNOWN],
    [undefined, '', UNKNOWN],
    [undefined, 'TKAPUTT', UNKNOWN],
    [undefined, 'XKAPUTT', UNKNOWN],
    [undefined, 'PKAPUTT', UNKNOWN],
    // Widerspruch zwischen Typ und Schluessel: unknown
    [ED, T, UNKNOWN],
    [ED, X, UNKNOWN],
    [ED, P, UNKNOWN],
    [HASH, G, UNKNOWN],
    [PRE, X, UNKNOWN],
    [PRE, G, UNKNOWN],
    [SP, G, UNKNOWN],
    // Typ ohne brauchbaren Schluessel
    [ED, '', UNKNOWN],
    [ED, M, UNKNOWN],
    [ED, C, UNKNOWN],
    // unbekannter Typ (z. B. ein kuenftiger PQ-Signer), egal welcher Schluessel
    ['ml_dsa_44', G, UNKNOWN],
    ['ml_dsa_44', 'MLDSA-KEY', UNKNOWN],
    ['ED25519_PUBLIC_KEY', G, UNKNOWN],
  ];
  it.each(cases)('Horizon-Typ %s, Schluessel %#: %s', (type, key, expected) => {
    expect(signerTypeOf({ key, type })).toBe(expected);
  });

  it('leerer oder fehlender Typ zaehlt als ohne Typ', () => {
    expect(signerTypeOf({ key: G, type: '' })).toBe(ED);
    expect(signerTypeOf({ key: G, type: null })).toBe(ED);
    expect(signerTypeOf(G)).toBe(ED);
    expect(signerTypeOf(null)).toBe(UNKNOWN);
  });
});

describe('isInteractiveSigner / interactiveSigners / interactiveWeight', () => {
  const signers = [
    { key: G, weight: 1, type: ED },
    { key: G2, weight: 2 }, // ohne Typ, aus dem Strkey
    { key: X, weight: 9, type: HASH },
    { key: T, weight: 9, type: PRE },
    { key: P, weight: 9, type: SP },
    { key: G, weight: 9, type: HASH }, // Widerspruch
    { key: 'MLDSA', weight: 9, type: 'ml_dsa_44' },
    { key: Keypair.random().publicKey(), weight: 0, type: ED },
  ];

  it('nur Ed25519 darf interaktiv signieren', () => {
    expect(signers.map(isInteractiveSigner)).toEqual([true, true, false, false, false, false, false, true]);
  });

  it('Gegenprobe: Hash-, Pre-Auth-, Signed-Payload-, Widerspruchs- und unbekannte Signer zaehlen nie, egal wie hoch das Gewicht ist', () => {
    const res = interactiveSigners(signers);
    expect(res).toEqual([
      { publicKey: G, weight: 1, type: ED },
      { publicKey: G2, weight: 2, type: ED },
    ]);
    expect(interactiveWeight(signers)).toBe(3);
    expect(interactiveWeight(signers.filter((s) => s.type !== ED && s.key !== G2))).toBe(0);
  });

  it.each([0, 1, 255])('Gewicht %i: nur Gewicht > 0 zaehlt', (weight) => {
    expect(interactiveSigners([{ key: G, weight, type: ED }])).toHaveLength(weight > 0 ? 1 : 0);
    expect(interactiveWeight([{ key: G, weight, type: ED }])).toBe(weight);
  });

  it('keine Liste: leer, kein Fehler', () => {
    expect(interactiveSigners(null)).toEqual([]);
    expect(interactiveWeight(undefined)).toBe(0);
  });
});

describe('isValidSignerKey / findInvalidSignerKey', () => {
  it('nur G mit Pruefsumme ist ein Signer-Schluessel', () => {
    expect(isValidSignerKey(G)).toBe(true);
    expect(isValidSignerKey(` ${G} `)).toBe(true);
    [M, C, T, X, P, G_BAD_CHECKSUM, '', null, undefined, 'S'.padEnd(56, 'A')].forEach((k) => {
      expect(isValidSignerKey(k)).toBe(false);
    });
  });
  it('findInvalidSignerKey gibt die erste ungueltige, nicht leere Eingabe zurueck', () => {
    expect(findInvalidSignerKey([{ key: G }, { key: '  ' }, { key: P }, { key: M }])).toBe(P);
    expect(findInvalidSignerKey([G, G2])).toBeNull();
    expect(findInvalidSignerKey(null)).toBeNull();
  });
});

describe('isMultisigAccount (Regel A)', () => {
  const ed = (key, weight = 1) => ({ key, weight, type: ED });
  it('mehr als ein Signer oder High-Schwelle > 1', () => {
    expect(isMultisigAccount({ signers: [ed(G), ed(G2)], thresholds: { high: 1 } })).toBe(true);
    expect(isMultisigAccount({ signers: [ed(G, 2)], thresholds: { high_threshold: 2 } })).toBe(true);
  });
  it('F1 und F2 aus dem Plan (9.3)', () => {
    // F1: ein Signer, med 1, high 1: kein Multisig
    expect(isMultisigAccount({ signers: [ed(G)], thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 } })).toBe(false);
    // F2: ein Signer, med 0, high 2: Multisig
    expect(isMultisigAccount({ signers: [ed(G, 2)], thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 2 } })).toBe(true);
  });
  it('zaehlt alle Signer-Typen mit (Hash-Signer macht ein Konto zum Multisig-Konto)', () => {
    expect(isMultisigAccount({ signers: [ed(G), { key: X, weight: 1, type: HASH }], thresholds: { high: 1 } })).toBe(true);
  });
  it('ohne Konto, Signer oder Schwellen: false', () => {
    expect(isMultisigAccount(null)).toBe(false);
    expect(isMultisigAccount({ signers: [ed(G), ed(G2)] })).toBe(false);
    expect(isMultisigAccount({ thresholds: { high: 5 } })).toBe(false);
  });
});

describe('singleSignerSuffices', () => {
  const account = (signers) => ({ signers, thresholds: {} });
  it('ein Ed25519-Signer mit genug Gewicht genuegt', () => {
    expect(singleSignerSuffices(account([{ key: G, weight: 2, type: ED }, { key: G2, weight: 1, type: ED }]), 2)).toBe(true);
    expect(singleSignerSuffices(account([{ key: G, weight: 1, type: ED }, { key: G2, weight: 1, type: ED }]), 2)).toBe(false);
  });
  it('Gegenprobe: Hash- und Pre-Auth-Signer zaehlen nie', () => {
    const signers = [
      { key: G, weight: 1, type: ED },
      { key: X, weight: 255, type: HASH },
      { key: T, weight: 255, type: PRE },
      { key: P, weight: 255, type: SP },
    ];
    expect(singleSignerSuffices(account(signers), 2)).toBe(false);
  });
  it('Schwelle 0 oder keine Schwelle: immer ausreichend', () => {
    expect(singleSignerSuffices(account([]), 0)).toBe(true);
    expect(singleSignerSuffices(account([]), undefined)).toBe(true);
  });
});

// Gemeinsame Fixture mit Node und PHP (test/assets/signer-types.json, ADR 0003).
describe('signerTypeOf gegen die gemeinsame Fixture', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const fixture = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../../../test/assets/signer-types.json', import.meta.url)), 'utf8'));
  it.each(fixture.cases.map((c) => [c.label, c]))('%s', (_label, c) => {
    const signer = c.type === null ? { key: c.key } : { key: c.key, type: c.type };
    expect(signerTypeOf(signer)).toBe(c.expected);
    expect(isInteractiveSigner(signer)).toBe(c.interactive);
  });
});
