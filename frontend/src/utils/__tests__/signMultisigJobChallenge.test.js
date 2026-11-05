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
