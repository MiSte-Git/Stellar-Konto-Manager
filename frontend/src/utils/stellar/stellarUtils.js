import {
  Horizon,
  StrKey,
  FederationServer,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Asset
} from '@stellar/stellar-sdk';

// 🌐 Horizon-Serverinstanz für das aktuelle Netzwerk (DEV: Proxy verwenden)
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL;

// Simple retry helper for Horizon 429 rate limits
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
async function withHorizonRetry(fn, { retries = 3, baseDelay = 1200, maxDelay = 30000 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const status = e?.response?.status || e?.status;
      if (status === 429 && attempt < retries) {
        // Respect Retry-After / X-RateLimit-Reset style headers if present
        let headerDelayMs = 0;
        try {
          const h = e?.response?.headers;
          const getHeader = (name) => {
            if (!h) return null;
            if (typeof h.get === 'function') return h.get(name);
            const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
            return key ? h[key] : null;
          };
          const ra = parseFloat(getHeader('retry-after') || getHeader('Retry-After') || '0');
          if (!Number.isNaN(ra) && ra > 0) {
            headerDelayMs = Math.min(maxDelay, Math.round(ra * 1000));
          } else {
            // Some proxies expose x-ratelimit-reset as seconds until reset or as epoch seconds
            const resetValRaw = getHeader('x-ratelimit-reset') || getHeader('X-RateLimit-Reset');
            if (resetValRaw) {
              const resetVal = parseFloat(resetValRaw);
              if (!Number.isNaN(resetVal) && resetVal > 0) {
                // Heuristic: treat small numbers as seconds-until-reset; large as epoch seconds
                if (resetVal < 1e6) {
                  headerDelayMs = Math.min(maxDelay, Math.round(resetVal * 1000));
                } else {
                  const nowSec = Date.now() / 1000;
                  const delta = Math.max(0, resetVal - nowSec);
                  headerDelayMs = Math.min(maxDelay, Math.round(delta * 1000));
                }
              }
            }
          }
        } catch { /* noop */ }

        const backoffMs = Math.min(maxDelay, Math.round(baseDelay * Math.pow(2, attempt)));
        const jitter = Math.floor(Math.random() * 400);
        const delay = Math.max(backoffMs, headerDelayMs) + jitter;
        try { console.warn('[SKM] Horizon 429 – retrying in', delay, 'ms'); } catch { /* noop */ }
        await sleep(delay);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}
// In-memory light cache + de-dup for loadAccount and feeStats
const _accountCache = new Map(); // key => { ts, data }
const _inflightAccount = new Map(); // key => Promise

async function loadAccountCached(server, publicKey, { ttlMs = 15000 } = {}) {
  const baseUrl = (server?.serverURL && String(server.serverURL)) || 'unknown';
  const key = `${baseUrl}::${publicKey}`;
  const now = Date.now();
  const cached = _accountCache.get(key);
  if (cached && now - cached.ts < ttlMs) {
    return cached.data;
  }
  if (_inflightAccount.has(key)) {
    return _inflightAccount.get(key);
  }
  const p = (async () => {
    try {
      const data = await withHorizonRetry(() => server.loadAccount(publicKey), { retries: 5, baseDelay: 1500 });
      _accountCache.set(key, { ts: Date.now(), data });
      return data;
    } finally {
      _inflightAccount.delete(key);
    }
  })();
  _inflightAccount.set(key, p);
  return p;
}

function resolveHorizonUrl(url) {
  // Global/Dev-Override: Hauptschalter über LocalStorage (SKM_NETWORK) oder explizite URL (SKM_HORIZON_URL)
  let base = url || HORIZON_URL || 'https://horizon.stellar.org';
  try {
    const lsUrl = window?.localStorage?.getItem('SKM_HORIZON_URL');
    const lsNet = window?.localStorage?.getItem('SKM_NETWORK'); // 'PUBLIC' | 'TESTNET'

    // Treat calls that pass the default (or nothing) as "not explicit" → network selection wins
    const isDefault = (url == null) || String(url) === String(HORIZON_URL);

    if (isDefault) {
      // Network is the source of truth on startup
      if (lsNet === 'TESTNET') base = 'https://horizon-testnet.stellar.org';
      else base = 'https://horizon.stellar.org';
      // Ignore SKM_HORIZON_URL when using the default path to avoid stale overrides across reloads
    } else if (!url && lsUrl) {
      // Only consider custom override when caller did not pass any url AND we are not in default-path check
      base = lsUrl;
    }

    if (typeof window !== 'undefined') {
      try { console.debug('[SKM] resolveHorizonUrl →', base, '(net=', lsNet || 'PUBLIC', ')'); } catch { /* noop */ }
    }
  } catch { /* noop */ }

  const isDev = typeof window !== 'undefined' && window.location && /^http:\/\/(localhost|127\.0\.1|127\.0\.0\.1)/.test(window.location.origin);
  // Wenn wir im Dev auf localhost laufen und Standard-Horizon verwenden, über den Vite-Proxy gehen
  if (isDev && (base === 'https://horizon.stellar.org' || base === 'https://horizon.stellar.org/')) {
    return (window.location.origin || 'http://localhost:5173') + '/horizon';
  }
  // Falls in .env bereits '/horizon' steht, in eine absolute URL umwandeln
  if (typeof base === 'string' && base.startsWith('/')) {
    // Allow override via SKM_HORIZON_URL; if set, prefer that instead of proxy
    try {
      const lsUrl2 = window?.localStorage?.getItem('SKM_HORIZON_URL');
      if (lsUrl2) return lsUrl2;
    } catch { /* noop */ }
    return (window?.location?.origin || 'http://localhost:5173') + base;
  }
  return base;
}
function allowHttpFor(resolvedUrl) {
  return typeof resolvedUrl === 'string' && resolvedUrl.startsWith('http://');
}
const RESOLVED_URL = resolveHorizonUrl(HORIZON_URL);
// Hinweis: Für konsistenten Umgang wird eine neue Instanz via getHorizonServer() erzeugt.

/**
 * Gibt eine neue Horizon-Instanz zurück (z.B. für Testnet)
 * @param {string} url - Optionale URL, sonst Standard aus Umgebungsvariable
 * @returns {Server} - Horizon-Serverinstanz
 */
export function getHorizonServer(url = HORIZON_URL) {
  const resolved = resolveHorizonUrl(url);
  return new Horizon.Server(resolved, { allowHttp: allowHttpFor(resolved) });
}

/**
 * Wandelt eine Federation-Adresse (user*domain.tld) in einen Public Key um
 * @param {string} federationAddress - z.B. user*lobstr.co
 * @returns {Promise<string>} - Der zugehörige Public Key (G...)
 * @throws {Error} - Wenn keine account_id gefunden wird
 */
export async function resolveFederationAddress(federationAddress) {
  // Use domain discovery per SEP-2 via stellar.toml → FEDERATION_SERVER.
  // The static FederationServer.resolve() performs discovery for the provided address domain.
  const response = await FederationServer.resolve(federationAddress);
  if (!response?.account_id) throw new Error('error.noFederationId');
  return response.account_id;
}

/**
 * Holt alle Trustlines eines Accounts vom Horizon-Server
 * @param {string} publicKey - G... Public Key
 * @returns {Promise<Array>} - Liste der Trustlines mit Asset-Infos
 * @throws {Error} - Wenn ungültig oder nicht abrufbar
 */
export async function loadTrustlines(publicKey, serverOverride, options = {}) {
  const { includeOps = true, ttlMs = 10000 } = options;
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('resolveOrValidatePublicKey.invalid');
  }

  try {
    const server = serverOverride || getHorizonServer();
    // Apply gentle retry/backoff for rate limits
    const account = await loadAccountCached(server, publicKey, { ttlMs });
    const balances = account.balances.filter(b => b.asset_type !== 'native');

    // Optional: Hole zusätzlich die Change-Trust-Operationen für createdAt (mit Retry, kleinere Page) – best effort
    let changeTrustOps = [];
    if (includeOps) {
      try {
        const operations = await withHorizonRetry(
          () => server
            .operations()
            .forAccount(publicKey)
            .order('desc')
            .limit(100)
            .call(),
          { retries: 3, baseDelay: 1200 }
        );
        changeTrustOps = operations.records.filter(
          op => op.type === 'change_trust' && op.trustor === publicKey
        );
      } catch {
        try { console.warn('[SKM] change_trust ops fetch failed; proceeding without createdAt'); } catch { /* noop */ }
        changeTrustOps = [];
      }
    }

    return balances.map(asset => {
      const changeOp = changeTrustOps.find(op =>
        op.asset_code === asset.asset_code &&
        op.asset_issuer === asset.asset_issuer
      );
      return {
        assetCode: asset.asset_code,
        assetIssuer: asset.asset_issuer,
        assetType: asset.asset_type,
        assetBalance: asset.balance,
        limit: asset.limit,
        buyingLiabilities: asset.buying_liabilities,
        sellingLiabilities: asset.selling_liabilities,
        isAuthorized: asset.is_authorized,
        isAuthorizedToMaintainLiabilities: asset.is_authorized_to_maintain_liabilities,
        createdAt: includeOps ? (changeOp?.created_at || 'unknown') : undefined,
      };
    });
  } catch (error) {
    console.error('Error loading trustlines:', error);
    const status = error?.response?.status || error?.status;
    if (status === 404) {
      throw new Error('error.loadTrustlinesNotFound');
    }
    if (status === 429) {
      throw new Error('error.rateLimited');
    }
    throw new Error('error.loadTrustlines');
  }
}

/**
 * Prüft, ob ein Secret Key zum erwarteten Public Key gehört
 * @param {string} secretKey - Secret Key (S...)
 * @param {string} expectedPublicKey - Erwarteter öffentlicher Key (G...)
 * @throws {Error} - Wenn Schlüssel nicht zusammenpassen
 */
export function assertKeyPairMatch(secretKey, expectedPublicKey) {
  const keypair = Keypair.fromSecret(secretKey);
  const derivedPublicKey = keypair.publicKey();
  if (derivedPublicKey !== expectedPublicKey) {
    throw new Error('secretKey.mismatch');
  }
}

/**
 * Prüft und löst Eingabe in Federation-Adresse oder Public Key auf
 * @param {string} input - Federation-Adresse oder Public Key
 * @returns {Promise<string>} - Gültiger öffentlicher Schlüssel (G...)
 * @throws {Error} - Bei leerer oder ungültiger Eingabe
 */
export async function resolveOrValidatePublicKey(input) {
  const resolved = await resolveOrValidateAccount(input);
  return resolved.accountId;
}

export function isValidAccountId(input) {
  if (!input) return false;
  return StrKey.isValidEd25519PublicKey(input) || StrKey.isValidMed25519PublicKey(input);
}

export function extractBasePublicKeyFromMuxed(muxedAddress) {
  if (!StrKey.isValidMed25519PublicKey(muxedAddress)) {
    throw new Error('resolveOrValidatePublicKey.invalid');
  }
  const raw = StrKey.decodeMed25519PublicKey(muxedAddress);
  const ed25519 = raw.subarray(0, -8);
  return StrKey.encodeEd25519PublicKey(ed25519);
}

export function extractMuxedIdFromAddress(muxedAddress) {
  if (!StrKey.isValidMed25519PublicKey(muxedAddress)) {
    throw new Error('resolveOrValidatePublicKey.invalid');
  }
  const raw = StrKey.decodeMed25519PublicKey(muxedAddress);
  const idBytes = raw.subarray(-8);
  let id = 0n;
  for (const b of idBytes) {
    id = (id << 8n) + BigInt(b);
  }
  return id.toString(10);
}

export async function resolveOrValidateAccount(input) {
  if (!input) throw new Error('resolveOrValidatePublicKey.empty');
  let value = input;
  if (value.includes('*')) {
    value = await resolveFederationAddress(value);
  }
  if (StrKey.isValidEd25519PublicKey(value)) {
    return { accountId: value, muxedAddress: null, address: value };
  }
  if (StrKey.isValidMed25519PublicKey(value)) {
    const base = extractBasePublicKeyFromMuxed(value);
    return { accountId: base, muxedAddress: value, address: value };
  }
  throw new Error('resolveOrValidatePublicKey.invalid');
}

/**
 * Findet doppelte Trustlines zwischen zwei Konten
 * (gleicher Asset-Code & -Issuer auf beiden Seiten)
 * @param {string} sourceKey - Public Key der Quelle
 * @param {string} destinationKey - Public Key des Ziels
 * @returns {Promise<Array>} - Gemeinsame Trustlines
 * @throws {Error} - Bei ungültigem Key
 */
export async function findDuplicateTrustlines(sourceKey, destinationKey) {
  const sourceResolved = await resolveOrValidateAccount(sourceKey);
  const destResolved = await resolveOrValidateAccount(destinationKey);
  if (!sourceResolved?.accountId || !destResolved?.accountId) {
    throw new Error('findDuplicateTrustlines.invalidKey');
  }

  const [sourceTrustlines, destTrustlines] = await Promise.all([
    loadTrustlines(sourceResolved.accountId),
    loadTrustlines(destResolved.accountId)
  ]);

  return sourceTrustlines.filter(source =>
    destTrustlines.some(dest =>
      dest.assetCode === source.assetCode && dest.assetIssuer === source.assetIssuer
    )
  );
}

/**
 * Sortiert eine Liste von Trustlines nach Spalte und Richtung
 * @param {Array} trustlines - Die zu sortierende Trustline-Liste
 * @param {string} column - 'assetCode', 'assetIssuer', 'creationDate'
 * @param {string} direction - 'asc' oder 'desc'
 * @returns {Array} - Sortierte Liste
 */
export function sortTrustlines(trustlines, column, direction = 'asc') {
  const isAsc = direction === 'asc' ? 1 : -1;
  return [...trustlines].sort((a, b) => {
    if (column === 'assetCode') {
      return a.assetCode.localeCompare(b.assetCode) * isAsc;
    } else if (column === 'assetIssuer') {
      return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
    } else if (column === 'creationDate') {
      const dateA = a.creationDate ? new Date(a.creationDate).getTime() : (isAsc ? Infinity : -Infinity);
      const dateB = b.creationDate ? new Date(b.creationDate).getTime() : (isAsc ? Infinity : -Infinity);
      return (dateA - dateB) * isAsc;
    }
    return 0;
  });
}

/**
 * Gibt einen Ausschnitt der Trustlines für die aktuelle Seite zurück
 * @param {Array} trustlines - Gesamtliste
 * @param {number} currentPage - Aktuelle Seite (0-basiert)
 * @param {number} itemsPerPage - Anzahl pro Seite
 * @returns {Array} - Paginierte Liste
 */
export function paginateTrustlines(trustlines, currentPage, itemsPerPage) {
  const startIndex = currentPage * itemsPerPage;
  return trustlines.slice(startIndex, startIndex + itemsPerPage);
}

/**
 * Validiert, ob ein Secret Key gültig ist
 * @param {string} secret - Secret Key im S...-Format
 * @throws {Error} - Wenn ungültig oder leer
 */
export function validateSecretKey(secret) {
  if (!secret || !StrKey.isValidEd25519SecretSeed(secret)) {
    throw new Error('validateSecretKey.invalid');
  }
}

/**
 * Lädt eine kompakte Konto-Zusammenfassung für Header/Status-Anzeige.
 * Nutzt nur einen Account-Call und kein Operations-Listing.
 */
export async function getAccountSummary(publicKey, serverOverride) {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('resolveOrValidatePublicKey.invalid');
  }
  try {
    const server = serverOverride || getHorizonServer();
    const account = await loadAccountCached(server, publicKey, { ttlMs: 15000 });
    const native = (account?.balances || []).find(b => b.asset_type === 'native');
    const nonNative = (account?.balances || []).filter(b => b.asset_type !== 'native');
    return {
      xlmBalance: native ? native.balance : null,
      trustlineCount: nonNative.length,
      sequence: account.sequence,
      thresholds: account.thresholds,
      flags: account.flags,
    };
  } catch (error) {
    const status = error?.response?.status || error?.status;
    if (status === 404) {
      throw new Error('error.loadTrustlinesNotFound');
    }
    if (status === 429) {
      throw new Error('error.rateLimited');
    }
    throw new Error('error.loadTrustlines');
  }
}

// Lädt Trustlines für eine gegebene Federation-Adresse oder Public Key
// und gibt sowohl die aufgelöste Adresse als auch die Trustlines zurück.
// Fehler werden als übersetzbare Error-Objekte zurückgegeben.
export async function handleSourceSubmit(sourceInput, t, networkOverride /* 'PUBLIC' | 'TESTNET' */, options = {}) {
  const { includeTrustlines = true } = options;
  let publicKey = sourceInput;
  const resolveNetworkLabel = () => {
    const toLabel = (netCode) => (netCode === 'TESTNET'
      ? t('settings:explorer.testnetLabel', 'Testnet')
      : t('settings:explorer.mainnetLabel', 'Mainnet'));
    if (networkOverride === 'TESTNET' || networkOverride === 'PUBLIC') {
      return toLabel(networkOverride);
    }
    try {
      const stored = window?.localStorage?.getItem('SKM_NETWORK');
      if (stored === 'TESTNET' || stored === 'PUBLIC') {
        return toLabel(stored);
      }
    } catch { /* noop */ }
    return toLabel('PUBLIC');
  };

  try {
    // Auflösung oder Validierung der Adresse (z.B. Federation → G...)
    publicKey = await resolveOrValidatePublicKey(sourceInput);
  } catch (resolveError) {
    // Fehler beim Auflösen (z.B. Federation-Adresse ungültig)
    throw new Error(t(resolveError.message));
  }

  try {
    const server = networkOverride === 'TESTNET'
      ? getHorizonServer('https://horizon-testnet.stellar.org')
      : networkOverride === 'PUBLIC'
        ? getHorizonServer('https://horizon.stellar.org')
        : undefined;

    if (!includeTrustlines) {
      // Nur leichte Zusammenfassung für Header laden (kein ops-Listing)
      const summary = await getAccountSummary(publicKey, server);
      return { publicKey, summary };
    }

    const trustlines = await loadTrustlines(publicKey, server);
    return { publicKey, trustlines };
  } catch (loadError) {
    // Fehler beim Laden der Trustlines (z.B. Netzwerkproblem)
    const code = String(loadError?.message || '');
    if (code === 'error.rateLimited') {
      throw new Error(t('common:error.rateLimited', 'Horizon rate limit exceeded. Please wait a few seconds and try again.'));
    }
    if (code === 'error.loadTrustlinesNotFound') {
      const networkName = resolveNetworkLabel();
      throw new Error(t('common:error.loadTrustlinesNotFound', {
        network: networkName,
        defaultValue: 'Account not found on network "{{network}}".',
      }));
    }
    throw new Error(t('common:error.loadTrustlines', 'Failed to load trustlines. Please try again.'));
  }
}
/**
 * Teilt ein Array in gleich große Blöcke (Chunks) auf
 */
export function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
export async function deleteTrustlinesInChunks({
  signerKeypairs,
  trustlines,
  onProgress,
  validateLiveEvery = 3, // <-- NEU: nur jede n-te Runde live prüfen (1 = immer)
  accountPublicKey,
}) {
  const signerList = Array.isArray(signerKeypairs) ? signerKeypairs : [signerKeypairs];
  const primary = signerList[0];
  if (!primary) throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
  const targetAccount = accountPublicKey || primary.publicKey();
  if (!targetAccount) throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
  const net = (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC';
  const server = getHorizonServer(net === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
  const chunks = chunkArray(trustlines, 100);
  const allDeleted = [];
  let processed = 0;

  let liveTrustlines = await loadTrustlines(targetAccount, server); // initial einmal
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];

    // nur jede n-te Runde live neu laden
    if (idx === 0 || (validateLiveEvery > 0 && idx % validateLiveEvery === 0)) {
      liveTrustlines = await loadTrustlines(targetAccount, server);
    }

    const stillValid = chunk.filter(tl =>
      liveTrustlines.some(existing =>
        existing.assetCode === tl.assetCode &&
        existing.assetIssuer === tl.assetIssuer &&
        existing.assetType !== 'native' &&
        parseFloat(existing.assetBalance) === 0 &&
        parseFloat(existing.buyingLiabilities || 0) === 0 &&
        parseFloat(existing.sellingLiabilities || 0) === 0
      )
    );

    if (stillValid.length === 0) {
      processed += chunk.length;
      onProgress?.({ processed, total: trustlines.length, phase: 'chunkSkip' });
      continue;
    }

    // Build and submit TX for this chunk using the loaded account as source
    const account = await server.loadAccount(targetAccount);
    const feeStats = await server.feeStats();
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));
    const txb = new TransactionBuilder(account, {
      fee,
      networkPassphrase: net === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
    });

    stillValid.forEach((tl) => {
      txb.addOperation(Operation.changeTrust({
        asset: new Asset(tl.assetCode, tl.assetIssuer),
        limit: '0',
      }));
    });

    const tx = txb.setTimeout(60).build();
    const signFailures = [];
    signerList.forEach((kp) => {
      try { tx.sign(kp); } catch (e) { signFailures.push(e); }
    });
    if (signFailures.length > 0) {
      console.error('[SKM] Trustline delete: signing failed for one or more keys', signFailures);
      throw new Error('submitTransaction.failed:signingFailed');
    }

    const res = await server.submitTransaction(tx);
    const txId = res?.id || res?.hash || '';
    allDeleted.push(...stillValid.map((tl) => ({ ...tl, txId })));

    processed += chunk.length;
    onProgress?.({ phase:'chunkDone', processed, total: trustlines.length });
  }

  if (allDeleted.length === 0) {
    if (import.meta.env.MODE !== 'production') {
      try { console.error('[Trustline delete] no matching balance on account', targetAccount, { trustlines }); } catch { /* noop */ }
    }
    throw new Error('error.trustline.notFound');
  }
  return allDeleted;
}

/**
 * Normalisiert Datumsstrings:
 * - Leerer Wert -> null (kein Filter)
 * - "YYYY-MM-DD" -> auf 00:00:00Z (from) bzw. 23:59:59Z (to) erweitert
 * - ISO 8601 (mit Uhrzeit) wird direkt verwendet
 * Wirft i18n-Fehler bei ungültigen Eingaben.
 */
function normalizeDateISO(value, role /* 'from' | 'to' */) {
  if (!value) return null;
  // nur Datum?
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const normalized = isDateOnly
    ? (role === 'from' ? `${value}T00:00:00Z` : `${value}T23:59:59Z`)
    : value;

  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) {
    throw new Error('error.xlmByMemo.dateInvalid');
  }
  return new Date(ts);
}

/**
 * Summiert eingehende XLM-Zahlungen für ein Konto, gefiltert nach Memo-Substring
 * und optionalem Datumsfenster. Arbeitet seitenweise über Horizon.
 *
 * @param {object} params
 * @param {Horizon.Server} params.server - Horizon Server Instanz
 * @param {string} params.accountId - G... Public Key
 * @param {string} params.memoQuery - Substring, der im Memo stehen muss
 * @param {string|undefined} params.fromISO - ISO-String (UTC) Untergrenze inkl.
 * @param {string|undefined} params.toISO   - ISO-String (UTC) Obergrenze inkl.
 * @param {number} [params.limitPerPage=200] - max. 1..200
 * @param {(info:object)=>void} [params.onProgress] - Fortschritts-Callback
 * @param {AbortSignal} [params.signal] - zum Abbrechen
 * @returns {Promise<number>} Gesamtsumme in XLM
 * @throws Error mit i18n-Key unter error.xlmByMemo.*
 */
export async function sumIncomingXLMByMemo({
  server,
  accountId,
  memoQuery,
  fromISO,
  toISO,
  limitPerPage = 200,
  onProgress,          // optional: (info) => void
  signal               // optional: AbortSignal
}) {
  if (!server || !(server instanceof Horizon.Server)) {
    throw new Error('error.xlmByMemo.serverInvalid');
  }
  if (!accountId || !accountId.startsWith('G')) {
    throw new Error('error.xlmByMemo.accountInvalid');
  }
  if (typeof memoQuery !== 'string' || memoQuery.length === 0) {
    throw new Error('error.xlmByMemo.memoInvalid');
  }
  const emit = (info) => { try { onProgress && onProgress(info); } catch { /* noop */ } };
  if (signal?.aborted) throw new Error('error.xlmByMemo.aborted');

  // Datumsfenster prüfen
  let fromDate = null;
  let toDate = null;
  try {
    fromDate = normalizeDateISO(fromISO, 'from');
    toDate   = normalizeDateISO(toISO,   'to');
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new Error('error.xlmByMemo.dateRange');
    }
  } catch (e) {
    if (e instanceof Error && String(e.message).startsWith('error.xlmByMemo.')) throw e;
    throw new Error('error.xlmByMemo.dateInvalid');
  }

  // Erste Seite
  let page;
  try {
    page = await server
      .payments()
      .forAccount(accountId)
      .order('desc')
      .limit(Math.min(200, Math.max(1, limitPerPage)))
      .join('transactions')
      .call();
  } catch {
    throw new Error('error.xlmByMemo.paymentsFetch');
  }

  // Helpers
  const txCache = new Map(); // txHash -> txRecord|null
  const txMatchesMemo = async (op) => {
    if (signal?.aborted) throw new Error('error.xlmByMemo.aborted');
    const embedded = op.transaction || op._embedded?.records?.find?.(() => false);
    if (embedded?.memo) return embedded.memo.includes(memoQuery);

    const txHash = op.transaction_hash;
    if (!txCache.has(txHash)) {
      try {
        const tx = await server.transactions().transaction(txHash).call();
        txCache.set(txHash, tx);
      } catch {
        txCache.set(txHash, null);
      }
    }
    const tx = txCache.get(txHash);
    return !!tx?.memo && tx.memo.includes(memoQuery);
  };

  const inDateRange = (op) => {
    if ((!fromDate && !toDate) || !op?.created_at) return true;
    const ts = Date.parse(op.created_at);
    if (Number.isNaN(ts)) return true;
    const d = new Date(ts);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  };

  const asIncomingXlmAmount = (op) => {
    if (op.type === 'create_account' && op.account === accountId) {
      return parseFloat(op.starting_balance || '0');
    }
    const isNative =
      op.asset_type === 'native' ||
      op.into_asset_type === 'native' ||
      op.source_asset_type === 'native' ||
      op.dest_asset_type === 'native';
    const toField = op.to || op.to_account || op.destination || op.to_muxed;
    const goesToAccount = toField === accountId;
    if (isNative && goesToAccount) {
      const a = op.amount || op.amount_received || op.source_amount || op.dest_amount || '0';
      return parseFloat(a);
    }
    return 0;
  };

  // ETA-Heuristik + Metriken
  const t0 = Date.now();
  let pagesDone = 0;
  let opsTotal = 0;
  let matches = 0;
  let firstMatchAt = null;            // erste passende Einzahlung (neueste), innerhalb Range
  let oldestMatchInRangeAt = null;    // älteste passende Einzahlung innerhalb Range (what you asked)

  const tickEta = () => {
    const elapsed = Date.now() - t0;
    const estTotalPages = Math.max(2, pagesDone + 1 + Math.floor(pagesDone * 0.7));
    const ratio = Math.min(0.95, pagesDone / estTotalPages);
    const etaMs = ratio > 0 ? Math.max(0, (elapsed / ratio) - elapsed) : 0;
    return { etaMs: Math.round(etaMs), progress: ratio };
  };

  // Loop über Seiten
  let total = 0;
  while (true) {
    if (signal?.aborted) throw new Error('error.xlmByMemo.aborted');

    let itemsProcessed = 0;
    const pending = []; // Kandidaten ohne eingebettetes Memo
    for (const op of page.records) {
      if (!inDateRange(op)) continue;

      const amt = asIncomingXlmAmount(op);
      if (amt > 0) {
        const matchesMemo = await txMatchesMemo(op);
        if (matchesMemo) {
          total += amt;
          matches++;
          const ts = Date.parse(op.created_at || '');
          if (!Number.isNaN(ts)) {
            const dt = new Date(ts).toISOString();
            // erste passende Einzahlung (neueste innerhalb Range)
            if (!firstMatchAt) firstMatchAt = dt;
            // älteste passende Einzahlung innerhalb Range
            if (!oldestMatchInRangeAt || ts < Date.parse(oldestMatchInRangeAt)) {
              oldestMatchInRangeAt = dt;
            }
          }
        }
      }

      itemsProcessed++;
      opsTotal++;

      // häufiger Progress (alle 10 Ops)
      if (itemsProcessed % 10 === 0) {
        const oldestOnPage = page.records[page.records.length - 1]?.created_at || '';
        const { etaMs, progress } = tickEta();
        emit({
          phase: 'scan',
          page: pagesDone + 1,
          itemsProcessed,
          opsTotal,
          matches,
          oldestOnPage,
          firstMatchAt,
          oldestMatchInRangeAt,
          progress,
          etaMs
        });
      }
    }

    // 3) Ausstehende TX-Memos in einem kleinen Pool (z. B. 6) parallel holen
   if (pending.length) {
     const pool = Math.max(2, Math.min(6, navigator.hardwareConcurrency || 6));
     let idx = 0, done = 0;
     const worker = async () => {
       while (idx < pending.length) {
         if (signal?.aborted) throw new Error('error.xlmByMemo.aborted');
         const cur = pending[idx++]; // nächstes Item
         let tx = txCache.get(cur.txHash);
         if (tx === undefined) {
           try {
             tx = await server.transactions().transaction(cur.txHash).call();
           } catch {
             tx = null;
           }
           txCache.set(cur.txHash, tx);
         }
         if (tx?.memo && tx.memo.includes(memoQuery)) {
           total += cur.amt;
           matches++;
           const ts = Date.parse(cur.created_at || '');
           if (!Number.isNaN(ts)) {
             const dt = new Date(ts).toISOString();
             if (!firstMatchAt) firstMatchAt = dt;
             if (!oldestMatchInRangeAt || ts < Date.parse(oldestMatchInRangeAt)) {
               oldestMatchInRangeAt = dt;
             }
           }
         }
         done++;
         // UI: im Sekundentakt „lebt“ sie schon via Heartbeat, aber wir pushen hier zusätzlich
         if (done % 10 === 0) {
           const { etaMs, progress } = tickEta();
           emit({ phase: 'txFetch', page: pagesDone + 1, opsTotal, matches, firstMatchAt, oldestMatchInRangeAt, progress, etaMs });
         }
       }
     };
     // Pool starten
     await Promise.all(Array.from({ length: pool }, worker));
   }

    // Frühabbruch: älteste Op der Seite vor fromDate => fertig
    if (fromDate && page.records?.length) {
      const oldest = page.records[page.records.length - 1];
      const oldestTs = Date.parse(oldest?.created_at || '');
      if (!Number.isNaN(oldestTs) && new Date(oldestTs) < fromDate) {
        break;
      }
    }

    pagesDone++;
    const { etaMs, progress } = tickEta();
    emit({
      phase: 'pageDone',
      page: pagesDone,
      itemsProcessed,
      opsTotal,
      matches,
      oldestOnPage: page.records[page.records.length - 1]?.created_at || '',
      firstMatchAt,
      oldestMatchInRangeAt,
      progress,
      etaMs
    });

    if (!page.records || page.records.length === 0 || !page.next) break;
    try {
      page = await page.next();
    } catch {
      break;
    }
  }

  // Abschluss
  emit({
    phase: 'finalize',
    page: pagesDone,
    opsTotal,
    matches,
    firstMatchAt,
    oldestMatchInRangeAt,
    progress: 1,
    etaMs: 0
  });

  return total;
}
