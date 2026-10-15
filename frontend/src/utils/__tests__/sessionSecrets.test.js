import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSessionSecret,
  getSessionSecretCount,
  getSessionSecrets,
  getUsableSignerKeys,
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

describe('sessionSecrets (lock / status helpers)', () => {
  const OTHER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';

  it('counts accounts with stored secrets without touching plaintext', async () => {
    const { getSessionSecretAccountCount } = await import('../sessionSecrets.js');
    expect(getSessionSecretAccountCount()).toBe(0);
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    await setSessionSecrets(OTHER, { [OTHER]: SECRET });
    expect(getSessionSecretAccountCount()).toBe(2);
    // legacy key counts too
    sessionStorage.setItem('stm.session.secret.GLEGACY', 'x');
    expect(getSessionSecretAccountCount()).toBe(3);
  });

  it('clearAllSessionSecrets wipes every account and leaves unrelated keys alone', async () => {
    const { clearAllSessionSecrets, getSessionSecretAccountCount } = await import('../sessionSecrets.js');
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    await setSessionSecrets(OTHER, { [OTHER]: SECRET });
    sessionStorage.setItem('stm.currentAccount', ACCOUNT);
    expect(clearAllSessionSecrets()).toBe(true);
    expect(getSessionSecretAccountCount()).toBe(0);
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    expect(hasSessionSecrets(OTHER)).toBe(false);
    expect(sessionStorage.getItem('stm.currentAccount')).toBe(ACCOUNT);
    expect(clearAllSessionSecrets()).toBe(false);
  });

  it('setSessionSecrets and rememberSessionSecrets emit the change event themselves, without secrets', async () => {
    const seen = [];
    const handler = (e) => seen.push(e.detail);
    window.addEventListener('stm-session-secret-changed', handler);
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    await rememberSessionSecrets(OTHER, [{ keypair: fakeKeypair(OTHER, SECRET) }]);
    await setSessionSecrets(ACCOUNT, {});
    window.removeEventListener('stm-session-secret-changed', handler);
    expect(seen).toEqual([{ publicKey: ACCOUNT }, { publicKey: OTHER }, { publicKey: ACCOUNT }]);
    expect(JSON.stringify(seen)).not.toContain(SECRET);
  });

  it('does not count empty or malformed entries that only share the prefix', async () => {
    const { getSessionSecretAccountCount } = await import('../sessionSecrets.js');
    sessionStorage.setItem('stm.session.secrets.GEMPTY', '{}');
    sessionStorage.setItem('stm.session.secrets.GBROKEN', 'not-json');
    sessionStorage.setItem('stm.session.secrets.', JSON.stringify({ [SIGNER]: 'enc1:x:y' }));
    expect(getSessionSecretAccountCount()).toBe(0);
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    expect(getSessionSecretAccountCount()).toBe(1);
  });
});

describe('sessionSecrets (signer lookup across accounts)', () => {
  const MULTI = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';

  it('finds a signer key remembered under another account (multisig job of another account)', async () => {
    // ACCOUNT's own key, remembered while ACCOUNT itself was loaded
    await setSessionSecrets(ACCOUNT, { [ACCOUNT]: SECRET });
    // job of MULTI, signed by ACCOUNT: lookup under MULTI must still find it
    expect(await getSessionSecret(MULTI, ACCOUNT)).toBe(SECRET);
  });

  it('finds the own key of an account remembered under a multisig account', async () => {
    await setSessionSecrets(MULTI, { [ACCOUNT]: SECRET });
    expect(await getSessionSecret(ACCOUNT, ACCOUNT)).toBe(SECRET);
    expect(getUsableSignerKeys(ACCOUNT)).toEqual([ACCOUNT]);
  });

  it('getUsableSignerKeys lists the account map plus the own key from elsewhere, without duplicates', async () => {
    expect(getUsableSignerKeys(ACCOUNT)).toEqual([]);
    expect(getUsableSignerKeys('')).toEqual([]);
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    await setSessionSecrets(MULTI, { [ACCOUNT]: SECRET });
    expect(getUsableSignerKeys(ACCOUNT).sort()).toEqual([ACCOUNT, SIGNER].sort());
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET, [ACCOUNT]: SECRET });
    expect(getUsableSignerKeys(ACCOUNT).sort()).toEqual([ACCOUNT, SIGNER].sort());
  });

  it('does not borrow co-signer keys of other accounts for the account itself', async () => {
    await setSessionSecrets(MULTI, { [SIGNER]: SECRET });
    expect(getUsableSignerKeys(ACCOUNT)).toEqual([]);
    expect(await getSessionSecret(ACCOUNT, ACCOUNT)).toBe('');
  });
});

describe('sessionSecrets (page load)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('purges leftover secrets from a previous load (reload, duplicated tab, legacy plaintext)', async () => {
    sessionStorage.setItem(`stm.session.secrets.${ACCOUNT}`, JSON.stringify({ [SIGNER]: 'enc1:AAAA:BBBB' }));
    sessionStorage.setItem(`stm.session.secret.${ACCOUNT}`, SECRET);
    sessionStorage.setItem('SKM_PREV_PATH', '/de/');
    vi.resetModules();
    const fresh = await import('../sessionSecrets.js');
    expect(fresh.hasSessionSecrets(ACCOUNT)).toBe(false);
    expect(fresh.getSessionSecretAccountCount()).toBe(0);
    expect(await fresh.getSessionSecret(ACCOUNT, ACCOUNT)).toBe('');
    expect(sessionStorage.getItem('SKM_PREV_PATH')).toBe('/de/');
  });
});
