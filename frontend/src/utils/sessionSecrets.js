const MAP_PREFIX = 'stm.session.secrets.';
const LEGACY_PREFIX = 'stm.session.secret.';

function readMap(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getSessionSecrets(accountPublicKey) {
  if (!accountPublicKey) return {};
  const mapKey = `${MAP_PREFIX}${accountPublicKey}`;
  const fromMap = readMap(mapKey);
  if (fromMap) return fromMap;
  try {
    const legacy = sessionStorage.getItem(`${LEGACY_PREFIX}${accountPublicKey}`);
    if (legacy) return { [accountPublicKey]: legacy };
  } catch { /* noop */ }
  return {};
}

export function hasSessionSecrets(accountPublicKey) {
  const map = getSessionSecrets(accountPublicKey);
  return Object.keys(map).length > 0;
}

export function getSessionSecretCount(accountPublicKey) {
  const map = getSessionSecrets(accountPublicKey);
  return Object.keys(map).length;
}

export function getSessionSecret(accountPublicKey, signerPublicKey) {
  if (!accountPublicKey || !signerPublicKey) return '';
  const map = getSessionSecrets(accountPublicKey);
  return map[signerPublicKey] || '';
}

export function setSessionSecrets(accountPublicKey, secretsMap) {
  if (!accountPublicKey) return false;
  const entries = Object.entries(secretsMap || {}).filter(([pk, sec]) => pk && sec);
  const mapKey = `${MAP_PREFIX}${accountPublicKey}`;
  try {
    if (!entries.length) {
      sessionStorage.removeItem(mapKey);
      sessionStorage.removeItem(`${LEGACY_PREFIX}${accountPublicKey}`);
      return false;
    }
    const next = Object.fromEntries(entries);
    sessionStorage.setItem(mapKey, JSON.stringify(next));
    sessionStorage.removeItem(`${LEGACY_PREFIX}${accountPublicKey}`);
    return true;
  } catch {
    return false;
  }
}

export function rememberSessionSecrets(accountPublicKey, collected) {
  if (!accountPublicKey) return false;
  const next = {};
  for (const entry of (collected || [])) {
    const kp = entry?.keypair;
    const pk = kp?.publicKey?.();
    const sec = kp?.secret?.();
    if (pk && sec) next[pk] = sec;
  }
  if (!Object.keys(next).length) return false;
  const current = getSessionSecrets(accountPublicKey);
  return setSessionSecrets(accountPublicKey, { ...current, ...next });
}

export function clearSessionSecrets(accountPublicKey) {
  if (!accountPublicKey) return false;
  try {
    sessionStorage.removeItem(`${MAP_PREFIX}${accountPublicKey}`);
    sessionStorage.removeItem(`${LEGACY_PREFIX}${accountPublicKey}`);
    return true;
  } catch {
    return false;
  }
}
