import { describe, expect, it } from 'vitest';
import { computeJobSigningState } from '../jobSigningState.js';

const A = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const B = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const C = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const accountSigners = [
  { key: A, weight: 1, type: 'ed25519_public_key' },
  { key: B, weight: 2, type: 'ed25519_public_key' },
  { key: C, weight: 0, type: 'ed25519_public_key' },
  { key: 'TPREAUTH', weight: 1, type: 'preauth_tx' },
];

describe('computeJobSigningState', () => {
  it('ohne Signaturen: gesammelt 0, alle aktiven ed25519-Signer fehlen', () => {
    expect(computeJobSigningState({ accountSigners, requiredWeight: 2 })).toEqual({
      required: 2,
      collected: 0,
      missingSigners: [{ publicKey: A, weight: 1 }, { publicKey: B, weight: 2 }],
    });
  });

  it('zaehlt gesammelte Signer mit dem Gewicht laut Konto (Objekte oder Strings)', () => {
    const state = computeJobSigningState({ accountSigners, requiredWeight: 3, collectedSigners: [{ publicKey: B, weight: 99 }] });
    expect(state.collected).toBe(2);
    expect(state.missingSigners).toEqual([{ publicKey: A, weight: 1 }]);
    expect(computeJobSigningState({ accountSigners, requiredWeight: 3, collectedSigners: [A, B] }).missingSigners).toEqual([]);
  });

  it('ignoriert Signer, die nicht zum Konto gehoeren', () => {
    expect(computeJobSigningState({ accountSigners, requiredWeight: 2, collectedSigners: [C, 'GFREMD'] }).collected).toBe(0);
  });
});
