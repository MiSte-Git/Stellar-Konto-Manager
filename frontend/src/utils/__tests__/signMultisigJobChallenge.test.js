// @vitest-environment node
import { Keypair } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signMultisigJobChallenge } from '../multisigApi.js';

const kp = Keypair.random();
const nonce = Buffer.from('0123456789abcdef0123456789abcdef');
const challenge = nonce.toString('base64');

describe('signMultisigJobChallenge', () => {
  it('signiert fuer das Token skm:token: plus Nonce, nie die Nonce allein', () => {
    const sig = Buffer.from(signMultisigJobChallenge(kp.secret(), challenge, 'token'), 'base64');
    expect(kp.verify(Buffer.concat([Buffer.from('skm:token:'), nonce]), sig)).toBe(true);
    expect(kp.verify(nonce, sig)).toBe(false);
  });

  it('bindet die Signatur mit Zweck an die Aktion', () => {
    const sig = Buffer.from(signMultisigJobChallenge(kp.secret(), challenge, 'decline'), 'base64');
    expect(kp.verify(Buffer.concat([Buffer.from('skm:decline:'), nonce]), sig)).toBe(true);
    expect(kp.verify(Buffer.concat([Buffer.from('skm:token:'), nonce]), sig)).toBe(false);
    expect(kp.verify(nonce, sig)).toBe(false);
  });

  it('signiert fuer das Loeschen mit eigenem Zweck delete', () => {
    const sig = Buffer.from(signMultisigJobChallenge(kp.secret(), challenge, 'delete'), 'base64');
    expect(kp.verify(Buffer.concat([Buffer.from('skm:delete:'), nonce]), sig)).toBe(true);
    expect(kp.verify(Buffer.concat([Buffer.from('skm:token:'), nonce]), sig)).toBe(false);
    expect(kp.verify(Buffer.concat([Buffer.from('skm:decline:'), nonce]), sig)).toBe(false);
    expect(kp.verify(nonce, sig)).toBe(false);
  });

  it('wirft ohne oder mit leerem Zweck', () => {
    expect(() => signMultisigJobChallenge(kp.secret(), challenge)).toThrow(/invalid_challenge_purpose/);
    expect(() => signMultisigJobChallenge(kp.secret(), challenge, '')).toThrow(/invalid_challenge_purpose/);
  });

  it('wirft bei unbekanntem Zweck', () => {
    expect(() => signMultisigJobChallenge(kp.secret(), challenge, 'tx')).toThrow(/invalid_challenge_purpose/);
    expect(() => signMultisigJobChallenge(kp.secret(), challenge, 'Token')).toThrow(/invalid_challenge_purpose/);
  });
});

// Fester Vektor, den beide Backends annehmen (test/assets/challenge-vector.json, Korrektur K5):
// die Ausgabe hier ist genau das, was test/signerAuth.test.js und .php pruefen.
describe('signMultisigJobChallenge: fester Vektor fuer die Backends', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const vector = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../../test/assets/challenge-vector.json', import.meta.url)), 'utf8'));
  it('liefert genau die Signatur aus dem Vektor (Standard-base64 mit Padding)', () => {
    const sig = signMultisigJobChallenge(vector.secret, vector.nonce, vector.purpose);
    expect(sig).toBe(vector.signature);
    expect(sig).toMatch(/^[A-Za-z0-9+/]{86}==$/);
  });
});

// F-6 (Review Fable): Die Nonce wird nur als strikte base64 mit genau 32 Byte angenommen (gleiche Strenge wie
// K5 im Backend: Laenge durch 4 teilbar, nur Standardalphabet, Padding nur am Ende, kanonisch). Sonst Fehler
// ohne Signatur. Grund: ADR 0004 sagt, keine signierte Nachricht sei 32 Byte lang. Das gilt nur bei einer
// 32-Byte-Nonce; mit 22 Byte waere skm:token: plus Nonce genau 32 Byte, so lang wie ein Transaktions-Hash.
describe('signMultisigJobChallenge: Nonce genau 32 Byte, strikte base64 (F-6)', () => {
  const b64 = (n) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256)).toString('base64');
  const valid = b64(32);
  // 32 Byte = 43 Zeichen plus =; vom letzten Datenzeichen tragen nur die oberen 4 Bit Daten. Unterstes Bit
  // setzen: dieselben Bytes beim Dekodieren, aber nicht die kanonische Form.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const nonCanonical = (s) => `${s.slice(0, 42)}${ALPHABET[ALPHABET.indexOf(s[42]) | 1]}=`;

  it('sanity: die Varianten unterscheiden sich wirklich von der gueltigen Nonce', () => {
    expect(nonCanonical(valid)).not.toBe(valid);
    expect(Buffer.from(nonCanonical(valid), 'base64')).toEqual(Buffer.from(valid, 'base64'));
    expect(valid.replace(/\+/g, '-').replace(/\//g, '_')).not.toBe(valid);
  });

  it('Gegenprobe: 32 Byte strikte base64 wird signiert', () => {
    const sig = Buffer.from(signMultisigJobChallenge(kp.secret(), valid, 'token'), 'base64');
    expect(kp.verify(Buffer.concat([Buffer.from('skm:token:'), Buffer.from(valid, 'base64')]), sig)).toBe(true);
  });

  it('22 Byte (mit skm:token: genau 32 Byte) wird nicht signiert', () => {
    expect(Buffer.concat([Buffer.from('skm:token:'), Buffer.from(b64(22), 'base64')]).length).toBe(32);
    expect(() => signMultisigJobChallenge(kp.secret(), b64(22), 'token')).toThrow(/multisig\.jobs\.invalid_challenge$/);
  });

  it.each([
    ['31 Byte', b64(31)],
    ['33 Byte', b64(33)],
    ['leer', ''],
    ['mit Leerzeichen', `${valid.slice(0, 20)} ${valid.slice(20)}`],
    ['mit Zeilenumbruch am Ende', `${valid}\n`],
    ['ohne Padding', valid.replace(/=+$/, '')],
    ['base64url', valid.replace(/\+/g, '-').replace(/\//g, '_')],
    ['nicht kanonisch (Fuellbit gesetzt)', nonCanonical(valid)],
    ['Padding in der Mitte', `${valid.slice(0, 8)}==${valid.slice(10)}`],
    ['kein String', 12345],
  ])('%s wird nicht signiert', (_name, value) => {
    expect(() => signMultisigJobChallenge(kp.secret(), value, 'token')).toThrow(/multisig\.jobs\.invalid_challenge$/);
  });

  it('auch base64url-taugliche 32 Byte ohne + und / gehen, solange Standard-base64', () => {
    const plain = Buffer.alloc(32, 0).toString('base64');
    expect(() => signMultisigJobChallenge(kp.secret(), plain, 'delete')).not.toThrow();
  });
});
