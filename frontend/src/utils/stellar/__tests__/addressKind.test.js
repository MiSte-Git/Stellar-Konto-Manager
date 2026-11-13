// Kontotyp zentral (Plan Signer-Buendelung, Schritt b1): addressType.js ist die einzige Stelle,
// die den Typ einer Adresse bestimmt. Die Umstellung ist verhaltensneutral: Die Referenzen
// unten sind die Implementierungen vor der Umstellung (Stand 420c8fb), wortgleich, und die
// neuen Funktionen muessen fuer jede Eingabe dasselbe liefern bzw. denselben Fehler werfen.
import { describe, it, expect } from 'vitest';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  ADDRESS_KINDS,
  CONTRACT_ADDRESS_ERROR,
  INVALID_ADDRESS_ERROR,
  assertSupportedAddress,
  baseAccountOf,
  classifyStellarAddress,
  hasClassicAccountPrefix,
  isClassicAccount,
  isClassicAccountSyntax,
  isPaymentDestination,
  parseStellarAddress,
} from '../addressType.js';
import {
  extractBasePublicKeyFromMuxed,
  extractMuxedIdFromAddress,
  isValidAccountId,
} from '../stellarUtils.js';

// --- Testvektoren ---------------------------------------------------------------------------
const KP = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(1));
const G = KP.publicKey();
const RAW_G = StrKey.decodeEd25519PublicKey(G);
const muxed = (idBytes) => StrKey.encodeMed25519PublicKey(new Uint8Array([...RAW_G, ...idBytes]));
const M0 = muxed([0, 0, 0, 0, 0, 0, 0, 0]);
const M7 = muxed([0, 0, 0, 0, 0, 0, 0, 7]);
const MMAX = muxed([255, 255, 255, 255, 255, 255, 255, 255]);
// Gleiche Vektoren wie addressType.test.js / test/assets/federationCases.json
const C = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const W = 'WADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOAAAAAAAAAAAFIH4U';
const S = KP.secret();
const T = StrKey.encodePreAuthTx(new Uint8Array(32).fill(2));
const X = StrKey.encodeSha256Hash(new Uint8Array(32).fill(3));
// Signed Payload: 32 Byte Key, Laenge (4), 4 Byte Payload
const P = StrKey.encodeSignedPayload(new Uint8Array([...RAW_G, 0, 0, 0, 4, 9, 9, 9, 9]));
const G_BAD = G.slice(0, -1) + (G.endsWith('A') ? 'B' : 'A');
const M_BAD = M7.slice(0, -1) + (M7.endsWith('A') ? 'B' : 'A');

const CASES = [
  // label, input, kind, baseAccountId, muxedId
  ['G', G, 'account', G, null],
  ['M mit ID 0', M0, 'muxed', G, '0'],
  ['M mit ID 7', M7, 'muxed', G, '7'],
  ['M mit maximaler ID', MMAX, 'muxed', G, '18446744073709551615'],
  ['C', C, 'contract', null, null],
  ['W', W, 'muxedContract', null, null],
  ['S (Secret Key)', S, 'invalid', null, null],
  ['T (Pre-Auth)', T, 'invalid', null, null],
  ['X (Hash)', X, 'invalid', null, null],
  ['P (Signed Payload)', P, 'invalid', null, null],
  ['G mit falscher Pruefsumme', G_BAD, 'invalid', null, null],
  ['M mit falscher Pruefsumme', M_BAD, 'invalid', null, null],
  ['G mit Leerzeichen', ` ${G}`, 'invalid', null, null],
  ['G kleingeschrieben', G.toLowerCase(), 'invalid', null, null],
  ['leer', '', 'invalid', null, null],
  ['null', null, 'invalid', null, null],
  ['undefined', undefined, 'invalid', null, null],
  ['Zahl', 123, 'invalid', null, null],
  ['String-Objekt', new String(G), 'invalid', null, null],
  ['Objekt', { publicKey: G }, 'invalid', null, null],
];

// --- Referenzen: Stand vor der Umstellung (wortgleich) ----------------------------------------
const OLD = {
  // stellarUtils.js
  isValidAccountId(input) {
    if (!input) return false;
    return StrKey.isValidEd25519PublicKey(input) || StrKey.isValidMed25519PublicKey(input);
  },
  extractBasePublicKeyFromMuxed(muxedAddress) {
    if (!StrKey.isValidMed25519PublicKey(muxedAddress)) {
      throw new Error('resolveOrValidatePublicKey.invalid');
    }
    const raw = StrKey.decodeMed25519PublicKey(muxedAddress);
    const ed25519 = raw.subarray(0, -8);
    return StrKey.encodeEd25519PublicKey(ed25519);
  },
  extractMuxedIdFromAddress(muxedAddress) {
    if (!StrKey.isValidMed25519PublicKey(muxedAddress)) {
      throw new Error('resolveOrValidatePublicKey.invalid');
    }
    const raw = StrKey.decodeMed25519PublicKey(muxedAddress);
    const idBytes = raw.subarray(-8);
    let id = 0n;
    for (const b of idBytes) {
      id = (id << 8n) + BigInt(b);
    }
    return id.toString(10);
  },
  // components/trading/assetSearchUtils.js
  STELLAR_PUBLIC_KEY_RE: /^G[A-Z2-7]{55}$/,
  // stellarUtils.js sumIncomingXLMByMemo (nur fuer String-Eingaben, siehe Test unten)
  xlmByMemoAccountInvalid(accountId) {
    return !accountId || !accountId.startsWith('G');
  },
  // jobRevocation.js getJobSequenceInfo (Quellkonto)
  jobSource(rawSource) {
    let source = String(rawSource);
    if (StrKey.isValidMed25519PublicKey(source)) {
      const raw = StrKey.decodeMed25519PublicKey(source);
      source = StrKey.encodeEd25519PublicKey(raw.subarray(0, -8));
    }
    if (!StrKey.isValidEd25519PublicKey(source)) return null;
    return source;
  },
  // verifyJobTransaction.js muxedSource
  muxedSource(rawSource) {
    return StrKey.isValidMed25519PublicKey(rawSource) ? rawSource : '';
  },
  // batchPaymentStore.js stripPublicKeys
  stripMatch(t) {
    if (StrKey.isValidEd25519PublicKey(t) || StrKey.isValidMed25519PublicKey(t)) return ' ';
    const g = t.slice(0, 56);
    return StrKey.isValidEd25519PublicKey(g) ? ` ${t.slice(56)}` : t;
  },
  // transactionSearch.js parseRecipient (Adressteil)
  recipientKind(tok) {
    if (StrKey.isValidEd25519PublicKey(tok)) return 'G';
    if (StrKey.isValidMed25519PublicKey(tok)) return 'M';
    return null;
  },
};

function outcome(fn, input) {
  try {
    return { value: fn(input) };
  } catch (e) {
    return { error: e?.message };
  }
}

describe('Vektoren', () => {
  it('G mit falscher Pruefsumme ist wirklich ungueltig, aber syntaktisch eine G-Adresse', () => {
    expect(StrKey.isValidEd25519PublicKey(G_BAD)).toBe(false);
    expect(OLD.STELLAR_PUBLIC_KEY_RE.test(G_BAD)).toBe(true);
    expect(StrKey.isValidMed25519PublicKey(M_BAD)).toBe(false);
    expect([S, T, X, P].map((v) => v[0])).toEqual(['S', 'T', 'X', 'P']);
  });
});

describe('ADDRESS_KINDS', () => {
  it('enthaelt genau die Werte von classifyStellarAddress', () => {
    expect(ADDRESS_KINDS).toEqual({ ACCOUNT: 'account', MUXED: 'muxed', CONTRACT: 'contract', MUXED_CONTRACT: 'muxedContract', INVALID: 'invalid' });
    expect(Object.isFrozen(ADDRESS_KINDS)).toBe(true);
  });
});

describe.each(CASES)('%s', (_label, input, kind, base, muxedId) => {
  it('classifyStellarAddress', () => {
    expect(classifyStellarAddress(input)).toBe(kind);
  });

  it('parseStellarAddress', () => {
    const valid = kind !== 'invalid';
    expect(parseStellarAddress(input)).toEqual({ kind, address: valid ? input : '', baseAccountId: base, muxedId });
  });

  it('baseAccountOf', () => {
    expect(baseAccountOf(input)).toBe(base);
  });

  it('isClassicAccount', () => {
    expect(isClassicAccount(input)).toBe(kind === 'account');
  });

  it('isPaymentDestination', () => {
    expect(isPaymentDestination(input)).toBe(kind === 'account' || kind === 'muxed');
  });

  it('assertSupportedAddress (Standard G und M)', () => {
    const result = outcome(assertSupportedAddress, input);
    if (kind === 'account' || kind === 'muxed') expect(result.value).toEqual(parseStellarAddress(input));
    else if (kind === 'contract' || kind === 'muxedContract') expect(result.error).toBe(CONTRACT_ADDRESS_ERROR);
    else expect(result.error).toBe(INVALID_ADDRESS_ERROR);
  });

  it('isClassicAccountSyntax wie die alte Regex', () => {
    expect(isClassicAccountSyntax(input)).toBe(OLD.STELLAR_PUBLIC_KEY_RE.test(input));
  });

  it('Wrapper in stellarUtils: gleiche Rueckgabe und gleiche Fehler wie vorher', () => {
    expect(outcome(isValidAccountId, input)).toEqual(outcome(OLD.isValidAccountId, input));
    expect(outcome(extractBasePublicKeyFromMuxed, input)).toEqual(outcome(OLD.extractBasePublicKeyFromMuxed, input));
    expect(outcome(extractMuxedIdFromAddress, input)).toEqual(outcome(OLD.extractMuxedIdFromAddress, input));
  });

  it('umgestellte Aufrufer: gleiche Ergebnisse wie die alten Ausdruecke', () => {
    if (typeof input === 'string') {
      // getJobSequenceInfo, verifyJobTransaction, stripPublicKeys, parseRecipient
      expect(baseAccountOf(String(input))).toBe(OLD.jobSource(input));
      expect(classifyStellarAddress(input) === ADDRESS_KINDS.MUXED ? input : '').toBe(OLD.muxedSource(input));
      const strip = (t) => (isPaymentDestination(t) ? ' ' : (isClassicAccount(t.slice(0, 56)) ? ` ${t.slice(56)}` : t));
      expect(strip(input)).toBe(OLD.stripMatch(input));
      expect(strip(`${input}ABC`)).toBe(OLD.stripMatch(`${input}ABC`));
      const k = classifyStellarAddress(input);
      expect(k === 'account' ? 'G' : k === 'muxed' ? 'M' : null).toBe(OLD.recipientKind(input));
    }
  });
});

describe('isClassicAccountSyntax', () => {
  it.each([
    ['G plus 55 Zeichen ohne Pruefsumme', `G${'A'.repeat(55)}`],
    ['G plus 54 Zeichen', `G${'A'.repeat(54)}`],
    ['G plus 56 Zeichen', `G${'A'.repeat(56)}`],
    ['Ziffer 1 (kein Base32)', `G${'1'.repeat(55)}`],
    ['nur G', 'G'],
  ])('%s wie die alte Regex', (_l, input) => {
    expect(isClassicAccountSyntax(input)).toBe(OLD.STELLAR_PUBLIC_KEY_RE.test(input));
  });

  it('G mit falscher Pruefsumme bleibt syntaktisch gueltig (wie heute)', () => {
    expect(isClassicAccountSyntax(G_BAD)).toBe(true);
  });
});

describe('hasClassicAccountPrefix (xlmByMemo)', () => {
  it.each([G, G_BAD, 'G', 'Gxyz', M7, C, '', 'g'])('%s wie startsWith', (input) => {
    expect(!input || !hasClassicAccountPrefix(input)).toBe(OLD.xlmByMemoAccountInvalid(input));
  });

  it('kein String ergibt false statt TypeError', () => {
    expect(hasClassicAccountPrefix(123)).toBe(false);
    expect(hasClassicAccountPrefix(null)).toBe(false);
  });
});

describe('assertSupportedAddress mit erlaubten Typen', () => {
  it('nur G: M ist ungueltig, C bleibt Contract-Fehler', () => {
    expect(assertSupportedAddress(G, ['account']).kind).toBe('account');
    expect(() => assertSupportedAddress(M7, ['account'])).toThrow(INVALID_ADDRESS_ERROR);
    expect(() => assertSupportedAddress(C, ['account'])).toThrow(CONTRACT_ADDRESS_ERROR);
  });

  it('Contract ausdruecklich erlaubt', () => {
    expect(assertSupportedAddress(C, ['contract'])).toEqual({ kind: 'contract', address: C, baseAccountId: null, muxedId: null });
  });
});
