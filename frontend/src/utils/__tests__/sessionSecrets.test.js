import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionSecrets,
  getSessionSecret,
  getSessionSecretCount,
  getSessionSecrets,
  hasSessionSecrets,
  InsecureCryptoContextError,
  rememberSessionSecrets,
  setSessionSecrets,
} from '../sessionSecrets.js';

const ACCOUNT = 'GAQ6JRJ4IUIXUVZRMGYUGUXFUHYYBRQTWFON4IZEHRS2RY4FCPTEEMWE';
const SIGNER = 'GCS4NBTUAKPAHVQRK75HHKHETH4MJ7IHIDNV3NTVYSZS2ZOCEKHC4ML4';
const SECRET = 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y';

function fakeKeypair(publicKey, secret) {
  return { publicKey: () => publicKey, secret: () => secret };
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
});

describe('sessionSecrets (hardened storage)', () => {
  it('encrypts the value at rest - the raw sessionStorage entry never contains the plaintext secret', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    const raw = sessionStorage.getItem(`stm.session.secrets.${ACCOUNT}`);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain('enc1:');
  });

  it('round-trips a stored secret back to plaintext via getSessionSecret', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    const decrypted = await getSessionSecret(ACCOUNT, SIGNER);
    expect(decrypted).toBe(SECRET);
  });

  it('getSessionSecrets decrypts every entry in the map', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET, [ACCOUNT]: SECRET });
    const map = await getSessionSecrets(ACCOUNT);
    expect(map).toEqual({ [SIGNER]: SECRET, [ACCOUNT]: SECRET });
  });

  it('hasSessionSecrets/getSessionSecretCount work without decrypting (sync)', async () => {
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    expect(getSessionSecretCount(ACCOUNT)).toBe(0);
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    expect(hasSessionSecrets(ACCOUNT)).toBe(true);
    expect(getSessionSecretCount(ACCOUNT)).toBe(1);
  });

  it('clearSessionSecrets removes the stored map', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    expect(hasSessionSecrets(ACCOUNT)).toBe(true);
    clearSessionSecrets(ACCOUNT);
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe('');
  });

  it('rememberSessionSecrets merges collected keypairs into the encrypted map', async () => {
    await rememberSessionSecrets(ACCOUNT, [{ keypair: fakeKeypair(SIGNER, SECRET) }]);
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe(SECRET);
    expect(getSessionSecretCount(ACCOUNT)).toBe(1);
  });

  it('treats a legacy plaintext map entry as pass-through (pre-encryption migration)', async () => {
    sessionStorage.setItem(`stm.session.secrets.${ACCOUNT}`, JSON.stringify({ [SIGNER]: SECRET }));
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe(SECRET);
  });

  it('fails safe (returns empty) for undecryptable/corrupted entries instead of throwing', async () => {
    sessionStorage.setItem(`stm.session.secrets.${ACCOUNT}`, JSON.stringify({ [SIGNER]: 'enc1:not-valid-base64-iv:not-valid-ciphertext' }));
    await expect(getSessionSecret(ACCOUNT, SIGNER)).resolves.toBe('');
  });

  it('setSessionSecrets with an empty map clears the entry', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    const result = await setSessionSecrets(ACCOUNT, {});
    expect(result).toBe(false);
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
  });

  describe('fail-closed when crypto.subtle is unavailable (non-secure origin)', () => {
    let realSubtle;
    beforeEach(() => {
      realSubtle = crypto.subtle;
      // Simulates a non-secure origin (e.g. plain http over a LAN IP), where
      // the Web Crypto API's subtle property is not exposed at all.
      Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
    });
    afterEach(() => {
      Object.defineProperty(crypto, 'subtle', { value: realSubtle, configurable: true });
    });

    it('setSessionSecrets throws InsecureCryptoContextError instead of storing the secret in plaintext', async () => {
      await expect(setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET })).rejects.toBeInstanceOf(InsecureCryptoContextError);
      expect(sessionStorage.getItem(`stm.session.secrets.${ACCOUNT}`)).toBeNull();
    });

    it('rememberSessionSecrets propagates the same error instead of silently no-op-ing', async () => {
      await expect(rememberSessionSecrets(ACCOUNT, [{ keypair: fakeKeypair(SIGNER, SECRET) }]))
        .rejects.toBeInstanceOf(InsecureCryptoContextError);
      expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    });
  });
});
