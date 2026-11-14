// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Buffer } from 'buffer';
import { Keypair } from '@stellar/stellar-sdk';
import { assertKeypairFor, keypairFromSecret, signChallengeMessage } from '../keyMaterial.js';
import { signMultisigJobChallenge } from '../../multisigApi.js';

// Fester Testschluessel (auch in SecretKeyModal.test.jsx und tradingTransactions.test.js).
const SECRET = 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y';
const PUBLIC = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';

// Fehlermeldung des SDK fuer eine Eingabe, zum Vergleich (verhaltensneutral).
function sdkError(input) {
  try {
    Keypair.fromSecret(input);
  } catch (e) {
    return e;
  }
  return null;
}

describe('keypairFromSecret', () => {
  it('liefert das Keypair zum Secret, mit privatem Schluessel', () => {
    const kp = keypairFromSecret(SECRET);
    expect(kp.publicKey()).toBe(PUBLIC);
    expect(kp.canSign()).toBe(true);
    expect(kp.secret()).toBe(SECRET);
  });

  it.each([
    ['leer', ''],
    ['Muell', 'kein-secret'],
    ['G-Adresse statt Secret', PUBLIC],
    ['falsche Pruefsumme', `${SECRET.slice(0, -1)}${SECRET.endsWith('A') ? 'B' : 'A'}`],
    ['mit Leerzeichen', ` ${SECRET} `],
    ['undefined', undefined],
    ['null', null],
  ])('Gegenprobe %s: wirft genau wie Keypair.fromSecret', (_name, input) => {
    const expected = sdkError(input);
    expect(expected).not.toBeNull();
    expect(() => keypairFromSecret(input)).toThrow(expected.message);
    let actual;
    try { keypairFromSecret(input); } catch (e) { actual = e; }
    expect(actual.constructor).toBe(expected.constructor);
  });
});

describe('assertKeypairFor', () => {
  it('passt: wirft nicht', () => {
    expect(() => assertKeypairFor(keypairFromSecret(SECRET), PUBLIC)).not.toThrow();
  });
  it('Gegenprobe anderer Public Key: secretKey.mismatch', () => {
    expect(() => assertKeypairFor(keypairFromSecret(SECRET), Keypair.random().publicKey())).toThrow('secretKey.mismatch');
  });
});

describe('signChallengeMessage', () => {
  it('signiert die Nachricht wie keypair.sign (64 Byte, pruefbar)', () => {
    const kp = keypairFromSecret(SECRET);
    const message = Buffer.from('skm:token:abc', 'utf8');
    const sig = signChallengeMessage(kp, message);
    expect(sig.length).toBe(64);
    expect(Buffer.from(sig).equals(Buffer.from(Keypair.fromSecret(SECRET).sign(message)))).toBe(true);
    expect(Keypair.fromPublicKey(PUBLIC).verify(message, Buffer.from(sig))).toBe(true);
  });

  it('Gegenprobe: Signatur passt nicht zu einer anderen Nachricht', () => {
    const kp = keypairFromSecret(SECRET);
    const sig = signChallengeMessage(kp, Buffer.from('skm:token:abc'));
    expect(Keypair.fromPublicKey(PUBLIC).verify(Buffer.from('skm:delete:abc'), Buffer.from(sig))).toBe(false);
  });
});

describe('signMultisigJobChallenge nach der Umstellung', () => {
  it('gleiche Ausgabe wie vorher (Ed25519 ist deterministisch): base64 der Signatur ueber skm:<zweck>: plus Nonce', () => {
    const nonce = Buffer.alloc(32, 5).toString('base64');
    const expected = Buffer.from(
      Keypair.fromSecret(SECRET).sign(Buffer.concat([Buffer.from('skm:decline:', 'utf8'), Buffer.from(nonce, 'base64')])),
    ).toString('base64');
    const actual = signMultisigJobChallenge(SECRET, nonce, 'decline');
    expect(actual).toBe(expected);
    expect(actual).toHaveLength(88);
  });
});
