// @vitest-environment node
import { Keypair } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signMultisigJobChallenge } from '../multisigApi.js';

const kp = Keypair.random();
const nonce = Buffer.from('0123456789abcdef0123456789abcdef');
const challenge = nonce.toString('base64');

describe('signMultisigJobChallenge', () => {
  it('signiert ohne Zweck die Nonce allein (Token)', () => {
    const sig = Buffer.from(signMultisigJobChallenge(kp.secret(), challenge), 'base64');
    expect(kp.verify(nonce, sig)).toBe(true);
  });

  it('bindet die Signatur mit Zweck an die Aktion', () => {
    const sig = Buffer.from(signMultisigJobChallenge(kp.secret(), challenge, 'decline'), 'base64');
    expect(kp.verify(Buffer.concat([Buffer.from('skm:decline:'), nonce]), sig)).toBe(true);
    expect(kp.verify(nonce, sig)).toBe(false);
  });
});
