// F-4: containsSecretKey liegt an einer neutralen Stelle (utils/secretKeyDetection.js), weil ihn auch die
// Eingabe-Historie braucht. batchPaymentStore.js reicht dieselbe Funktion weiter; das Verhalten ist
// unveraendert (Pruefsumme, auch ueber Trennzeichen, Opus-Review S5). Die Faelle im Detail testet
// batchPayment/__tests__/batchPaymentStore.test.js.
import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { containsSecretKey } from '../secretKeyDetection.js';
import { containsSecretKey as fromStore } from '../batchPayment/batchPaymentStore.js';

describe('secretKeyDetection (F-4)', () => {
  it('batchPaymentStore reicht dieselbe Funktion weiter', () => {
    expect(fromStore).toBe(containsSecretKey);
  });

  it('erkennt einen Secret Key, auch mit Trennzeichen; G-Adresse und falsche Pruefsumme nicht', () => {
    const kp = Keypair.random();
    const secret = kp.secret();
    expect(containsSecretKey(secret)).toBe(true);
    expect(containsSecretKey(secret.match(/.{1,4}/g).join(' '))).toBe(true);
    expect(containsSecretKey(secret.match(/.{1,7}/g).join('-'))).toBe(true);
    expect(containsSecretKey(`Notiz: ${secret} (alt)`)).toBe(true);
    expect(containsSecretKey(kp.publicKey())).toBe(false);
    const wrong = secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A');
    expect(containsSecretKey(wrong)).toBe(false);
  });
});
