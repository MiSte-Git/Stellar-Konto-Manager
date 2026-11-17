import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllSessionSecrets,
  getSessionSecretAccountCount,
  getSessionSecret,
  getSessionSecretCount,
  getSessionSecrets,
  getLockEpoch,
  getRememberedSecretsFor,
  getUsableSignerKeys,
  hasSessionSecrets,
  InsecureCryptoContextError,
  rememberAfterSuccess,
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
    const raw = sessionStorage.getItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`);
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

  // F-12 (Review Fable): Ein Eintrag ohne enc1:-Praefix (Klartext aus der Zeit vor der Verschluesselung) wird
  // nie im Klartext zurueckgegeben. Er gilt als nicht gemerkt und wird beim Lesen entfernt. Vorher gab
  // decryptSecret ihn unveraendert zurueck, entgegen dem Kommentar darueber.
  it('F-12: Klartext-Eintrag ohne enc1: gilt als nicht gemerkt, kein Klartext zurueck', async () => {
    sessionStorage.setItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`, JSON.stringify({ [SIGNER]: SECRET }));
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe('');
    expect(await getSessionSecrets(ACCOUNT)).toEqual({});
  });

  it('F-12: Altbestand ohne enc1: wird beim Lesen entfernt, gueltige Eintraege bleiben', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    const key = `stm.session.secrets.PUBLIC.${ACCOUNT}`;
    const map = JSON.parse(sessionStorage.getItem(key));
    const OTHER = 'GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO';
    sessionStorage.setItem(key, JSON.stringify({ ...map, [OTHER]: 'SBPLAINTEXTSECRETFROMBEFORE', [`${OTHER}x`]: 42 }));
    expect(getSessionSecretCount(ACCOUNT)).toBe(1);
    expect(hasSessionSecrets(ACCOUNT)).toBe(true);
    expect(Object.keys(JSON.parse(sessionStorage.getItem(key)))).toEqual([SIGNER]);
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe(SECRET);
    expect(await getSessionSecret(ACCOUNT, OTHER)).toBe('');
  });

  it('F-12: Map nur mit Klartext-Eintraegen wird ganz entfernt', () => {
    const key = `stm.session.secrets.PUBLIC.${ACCOUNT}`;
    sessionStorage.setItem(key, JSON.stringify({ [SIGNER]: SECRET }));
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('F-12: Klartext unter einem anderen Konto wird auch bei der Suche ueber alle Konten nicht genutzt', async () => {
    const OTHER_ACCOUNT = 'GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO';
    sessionStorage.setItem(`stm.session.secrets.PUBLIC.${OTHER_ACCOUNT}`, JSON.stringify({ [SIGNER]: SECRET }));
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe('');
    expect(getUsableSignerKeys(ACCOUNT)).toEqual([]);
  });

  it('fails safe (returns empty) for undecryptable/corrupted entries instead of throwing', async () => {
    sessionStorage.setItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`, JSON.stringify({ [SIGNER]: 'enc1:not-valid-base64-iv:not-valid-ciphertext' }));
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
      expect(sessionStorage.getItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`)).toBeNull();
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
    // Alter Eintrag ohne Netz zaehlt nicht (wird beim Laden ohnehin geloescht)
    sessionStorage.setItem('stm.session.secret.GLEGACY', 'x');
    expect(getSessionSecretAccountCount()).toBe(2);
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
    sessionStorage.setItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`, JSON.stringify({ [SIGNER]: 'enc1:AAAA:BBBB' }));
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

describe('sessionSecrets (Bindung ans Netz)', () => {
  const OTHER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
  const useNet = (id) => localStorage.setItem('SKM_NETWORK', id);

  beforeEach(() => { localStorage.setItem('SKM_NETWORK', 'PUBLIC'); });
  afterEach(() => { localStorage.removeItem('SKM_NETWORK'); vi.restoreAllMocks(); });

  it('ein auf Testnet gemerkter Key ist auf Mainnet unsichtbar und danach wieder da', async () => {
    useNet('TESTNET');
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    expect(sessionStorage.getItem(`stm.session.secrets.TESTNET.${ACCOUNT}`)).toBeTruthy();

    useNet('PUBLIC');
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe('');
    expect(await getSessionSecrets(ACCOUNT)).toEqual({});
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    expect(getSessionSecretCount(ACCOUNT)).toBe(0);
    expect(getUsableSignerKeys(ACCOUNT)).toEqual([]);
    expect(getSessionSecretAccountCount()).toBe(0);

    useNet('TESTNET');
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe(SECRET);
    expect(getSessionSecretAccountCount()).toBe(1);
  });

  it('gleiches Konto, zwei Netze: die Keys bleiben getrennt', async () => {
    useNet('PUBLIC');
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    useNet('TESTNET');
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    await setSessionSecrets(ACCOUNT, { [OTHER]: SECRET });
    expect(Object.keys(await getSessionSecrets(ACCOUNT))).toEqual([OTHER]);
    useNet('PUBLIC');
    expect(Object.keys(await getSessionSecrets(ACCOUNT))).toEqual([SIGNER]);
  });

  it('die Suche ueber andere Konten (Master unter fremdem Konto gemerkt) gilt nur im selben Netz', async () => {
    useNet('TESTNET');
    await setSessionSecrets(OTHER, { [ACCOUNT]: SECRET });
    expect(await getSessionSecret(ACCOUNT, ACCOUNT)).toBe(SECRET);
    expect(getUsableSignerKeys(ACCOUNT)).toEqual([ACCOUNT]);
    useNet('PUBLIC');
    expect(await getSessionSecret(ACCOUNT, ACCOUNT)).toBe('');
    expect(getUsableSignerKeys(ACCOUNT)).toEqual([]);
  });

  it('Merken mit anderem Ablaufnetz als dem globalen Netz speichert nichts', async () => {
    useNet('PUBLIC');
    expect(await rememberSessionSecrets(ACCOUNT, [{ keypair: fakeKeypair(SIGNER, SECRET) }], 'TESTNET')).toBe(false);
    expect(await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET }, 'TESTNET')).toBe(false);
    expect(sessionStorage.length).toBe(0);
    // passendes Netz speichert
    expect(await rememberSessionSecrets(ACCOUNT, [{ keypair: fakeKeypair(SIGNER, SECRET) }], 'PUBLIC')).toBe(true);
    expect(hasSessionSecrets(ACCOUNT)).toBe(true);
  });

  it('Netzwechsel waehrend des Verschluesselns: nichts wird gespeichert', async () => {
    useNet('PUBLIC');
    const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
      useNet('TESTNET');
      return realEncrypt(...args);
    });
    expect(await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET })).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it('Sperren loescht die Keys beider Netze', async () => {
    useNet('PUBLIC');
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    useNet('TESTNET');
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    expect(clearAllSessionSecrets()).toBe(true);
    expect(sessionStorage.getItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`)).toBeNull();
    expect(sessionStorage.getItem(`stm.session.secrets.TESTNET.${ACCOUNT}`)).toBeNull();
  });
});

describe('sessionSecrets (Vorbelegung und Merken nach Erfolg)', () => {
  const OTHER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
  const OTHER_SECRET = 'SBFKGXZFIZJ5U2RZTPBZ3EUCKQQGT5APKWAHGTQCJQSLD4CXIIHOVYVO';
  beforeEach(() => { localStorage.setItem('SKM_NETWORK', 'PUBLIC'); });
  afterEach(() => { localStorage.removeItem('SKM_NETWORK'); });

  it('findet Signer-Keys, egal unter welchem Konto sie gemerkt wurden, in der Reihenfolge der Signer', async () => {
    await setSessionSecrets(SIGNER, { [SIGNER]: SECRET });
    await setSessionSecrets(OTHER, { [OTHER]: OTHER_SECRET });
    expect(await getRememberedSecretsFor(ACCOUNT, [OTHER, SIGNER])).toEqual([OTHER_SECRET, SECRET]);
  });

  it('liefert nur Keys der genannten Signer (ein gemerkter Nicht-Signer wird nicht vorbelegt)', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET, [OTHER]: OTHER_SECRET });
    expect(await getRememberedSecretsFor(ACCOUNT, [SIGNER])).toEqual([SECRET]);
    expect(await getRememberedSecretsFor(ACCOUNT, [])).toEqual([]);
    expect(await getRememberedSecretsFor(ACCOUNT, null)).toEqual([]);
  });

  it('liefert nichts, wenn das Netz des Ablaufs nicht das aktuelle ist', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    expect(await getRememberedSecretsFor(ACCOUNT, [SIGNER], 'testnet')).toEqual([]);
    expect(await getRememberedSecretsFor(ACCOUNT, [SIGNER], 'public')).toEqual([SECRET]);
    expect(await getRememberedSecretsFor(ACCOUNT, [SIGNER], 'kaputt')).toEqual([]);
  });

  it('ueberspringt unlesbare Eintraege', async () => {
    sessionStorage.setItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`, JSON.stringify({ [SIGNER]: 'enc1:xx:yy' }));
    expect(await getRememberedSecretsFor(ACCOUNT, [SIGNER])).toEqual([]);
  });

  it('rememberAfterSuccess merkt nur mit Haken', async () => {
    const collected = [{ keypair: fakeKeypair(SIGNER, SECRET) }];
    expect(await rememberAfterSuccess(ACCOUNT, collected, false)).toBe(false);
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    expect(await rememberAfterSuccess(ACCOUNT, collected, true, 'PUBLIC')).toBe(true);
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe(SECRET);
  });

  it('rememberAfterSuccess speichert nichts bei anderem Netz und wirft nie', async () => {
    const collected = [{ keypair: fakeKeypair(SIGNER, SECRET) }];
    expect(await rememberAfterSuccess(ACCOUNT, collected, true, 'testnet')).toBe(false);
    expect(await rememberAfterSuccess('', collected, true)).toBe(false);
    expect(await rememberAfterSuccess(ACCOUNT, null, true)).toBe(false);
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
  });

  it('rememberAfterSuccess meldet fehlendes Web Crypto als insecure, ohne Klartext zu speichern', async () => {
    const realSubtle = crypto.subtle;
    Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
    try {
      expect(await rememberAfterSuccess(ACCOUNT, [{ keypair: fakeKeypair(SIGNER, SECRET) }], true)).toBe('insecure');
      expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    } finally {
      Object.defineProperty(crypto, 'subtle', { value: realSubtle, configurable: true });
    }
  });
});

describe('sessionSecrets (Sperr-Epoche, Review M-1)', () => {
  beforeEach(() => { localStorage.setItem('SKM_NETWORK', 'PUBLIC'); });
  afterEach(() => { localStorage.removeItem('SKM_NETWORK'); });
  const collected = () => [{ keypair: fakeKeypair(SIGNER, SECRET) }];

  it('Sperren zaehlt die Epoche hoch', () => {
    const before = getLockEpoch();
    clearAllSessionSecrets();
    expect(getLockEpoch()).toBe(before + 1);
  });

  it('nach einer Sperre seit dem Bestaetigen merkt rememberAfterSuccess nichts', async () => {
    const epoch = getLockEpoch();
    clearAllSessionSecrets();
    expect(await rememberAfterSuccess(ACCOUNT, collected(), true, 'PUBLIC', epoch)).toBe(false);
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
  });

  it('Gegenprobe: ohne Sperre wird mit derselben Epoche gemerkt', async () => {
    const epoch = getLockEpoch();
    expect(await rememberAfterSuccess(ACCOUNT, collected(), true, 'PUBLIC', epoch)).toBe(true);
    expect(hasSessionSecrets(ACCOUNT)).toBe(true);
  });

  it('Sperre waehrend des Verschluesselns: nichts gespeichert', async () => {
    const pending = setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    clearAllSessionSecrets();
    expect(await pending).toBe(false);
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
  });

  it('vor der Sperre gelesene Eintraege sind danach nicht mehr entschluesselbar (neuer AES-Schluessel)', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    const raw = sessionStorage.getItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`);
    clearAllSessionSecrets();
    sessionStorage.setItem(`stm.session.secrets.PUBLIC.${ACCOUNT}`, raw);
    expect(await getSessionSecret(ACCOUNT, SIGNER)).toBe('');
  });

  it('Sperre waehrend der Vorbelegung: nichts vorbelegt', async () => {
    await setSessionSecrets(ACCOUNT, { [SIGNER]: SECRET });
    const pending = getRememberedSecretsFor(ACCOUNT, [SIGNER]);
    clearAllSessionSecrets();
    expect(await pending).toEqual([]);
  });
});
