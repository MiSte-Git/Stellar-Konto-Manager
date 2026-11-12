import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { findSessionSigner } from '../sessionSigner.js';
import { setSessionSecrets } from '../sessionSecrets.js';

const master = Keypair.random();
const other = Keypair.random();
const ACCOUNT = master.publicKey();
const ed = (kp, weight) => ({ key: kp.publicKey(), weight, type: 'ed25519_public_key' });

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { sessionStorage.clear(); });

describe('findSessionSigner', () => {
  it('nichts gemerkt: leere Liste', async () => {
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: [ed(master, 1)], requiredWeight: 1 })).toEqual([]);
  });

  it('gemerkter Master-Key mit genug Gewicht: genau dieser Signer im Format des Key-Dialogs', async () => {
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: master.secret() });
    const res = await findSessionSigner({ accountId: ACCOUNT, signers: [ed(master, 2)], requiredWeight: 2 });
    expect(res).toHaveLength(1);
    expect(res[0].publicKey).toBe(ACCOUNT);
    expect(res[0].weight).toBe(2);
    expect(res[0].keypair.publicKey()).toBe(ACCOUNT);
  });

  it('Gegenprobe: Gewicht reicht nicht (1 von 2): leer, der Dialog fragt', async () => {
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: master.secret() });
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: [ed(master, 1), ed(other, 1)], requiredWeight: 2 })).toEqual([]);
  });

  it('Gegenprobe: Key steht nicht mehr in der Signer-Liste oder hat Gewicht 0: leer', async () => {
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: master.secret() });
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: [ed(other, 1)], requiredWeight: 1 })).toEqual([]);
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: [ed(master, 0), ed(other, 1)], requiredWeight: 0 })).toEqual([]);
  });

  it('Schwelle 0 (Konto ohne Schwellen): Signer mit Gewicht > 0 genuegt', async () => {
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: master.secret() });
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: [ed(master, 1)], requiredWeight: 0 })).toHaveLength(1);
  });

  it('anderer gemerkter Signer des Kontos mit genug Gewicht wird genommen, wenn der Master nicht reicht', async () => {
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: master.secret(), [other.publicKey()]: other.secret() });
    const res = await findSessionSigner({ accountId: ACCOUNT, signers: [ed(master, 0), ed(other, 3)], requiredWeight: 2 });
    expect(res).toHaveLength(1);
    expect(res[0].publicKey).toBe(other.publicKey());
  });

  it('Master-Key, der unter einem anderen Konto gemerkt wurde, zaehlt fuer sein eigenes Konto', async () => {
    const elsewhere = Keypair.random().publicKey();
    await setSessionSecrets(elsewhere, { [ACCOUNT]: master.secret() });
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: [ed(master, 1)], requiredWeight: 1 })).toHaveLength(1);
  });

  it('Hash- und Pre-Auth-Signer zaehlen nicht, kaputter Eintrag stuerzt nicht ab', async () => {
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: 'SKAPUTT' });
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: [ed(master, 1)], requiredWeight: 1 })).toEqual([]);
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: master.secret() });
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: [{ key: ACCOUNT, weight: 5, type: 'sha256_hash' }], requiredWeight: 1 })).toEqual([]);
  });

  it('ohne Konto oder ohne Signer-Liste: leer', async () => {
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: master.secret() });
    expect(await findSessionSigner({ accountId: '', signers: [ed(master, 1)], requiredWeight: 1 })).toEqual([]);
    expect(await findSessionSigner({ accountId: ACCOUNT, signers: undefined, requiredWeight: 1 })).toEqual([]);
  });
});
