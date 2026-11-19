const toml = require('toml');
// F-7: SSRF-Schutz an einer Stelle, auch fuer federationService.js (Gegenstueck zu api/ssrfGuard.php).
const { assertSafeScheme, ssrfSafeLookup, ssrfSafeAgent, nextRedirectUrl, readTextWithLimit } = require('./ssrfGuard.js');
const { networkFromQuery } = require('./stellarNetworks.js');
const { isClassicAccount, asciiTrim } = require('./addressKind.js');

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const TOML_FETCH_TIMEOUT_MS = 6000;
const MAX_TOML_REDIRECTS = 5;
const MAX_TOML_RESPONSE_BYTES = 1_000_000; // 1 MiB - generous for a stellar.toml, blocks a memory-DoS response (N2)

function normalizeAssetSearchInput({ assetCode, issuer, limit }) {
  const code = String(assetCode || '').trim();
  const assetIssuer = String(issuer || '').trim();
  const pageLimit = Math.max(1, Math.min(50, Number(limit || 20)));

  if (!code && !assetIssuer) {
    throw new Error('assetSearch.invalidInput:queryMissing');
  }
  if (code && !ASSET_CODE_RE.test(code)) {
    throw new Error('assetSearch.invalidInput:codeInvalid');
  }
  if (assetIssuer && !isClassicAccount(assetIssuer)) {
    throw new Error('assetSearch.invalidInput:issuerInvalid');
  }

  return { code, issuer: assetIssuer, limit: pageLimit };
}

// Review LP-6: nur Strings (code[]=x ist ungueltig, nicht "x") und nur ASCII-Leerraum trimmen, wie
// asset_identity_from_input in api/assetIdentity.php. Gilt fuer /facts und /logo.
function normalizeAssetIdentity({ assetCode, issuer }) {
  if (assetCode !== undefined && typeof assetCode !== 'string') throw new Error('assetSearch.invalidInput:codeInvalid');
  if (issuer !== undefined && typeof issuer !== 'string') throw new Error('assetSearch.invalidInput:issuerInvalid');
  const code = asciiTrim(assetCode ?? '');
  const assetIssuer = asciiTrim(issuer ?? '');

  if (!code || !ASSET_CODE_RE.test(code)) {
    throw new Error('assetSearch.invalidInput:codeInvalid');
  }
  if (!assetIssuer || !isClassicAccount(assetIssuer)) {
    throw new Error('assetSearch.invalidInput:issuerInvalid');
  }

  return { code, issuer: assetIssuer };
}

function normalizeHomeDomain(domain) {
  return String(domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

function buildTomlUrl(homeDomain) {
  const domain = normalizeHomeDomain(homeDomain);
  return domain ? `https://${domain}/.well-known/stellar.toml` : '';
}

// Nur echte Tabellen zaehlen als Eintrag (kein Array, kein Date), wie in api/stellarToml.php.
function isPlainTable(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function normalizeCurrencyEntry(entry) {
  if (!isPlainTable(entry)) return null;
  return Object.entries(entry).reduce((acc, [key, value]) => {
    acc[String(key).toLowerCase()] = value;
    return acc;
  }, {});
}

// Review LP-4: alle Top-Level-Keys, die ohne Gross-/Kleinschreibung "currencies" heissen ([[CURRENCIES]],
// [[Currencies]], ...), in der Reihenfolge der Keys, wie parse_currency_sections_from_toml in
// api/stellarToml.php. Vorher nur CURRENCIES oder currencies. Gemeinsame Faelle: tomlCases in
// test/assets/asset-logo.json.
/** Eintrag gehoert zu genau diesem Asset (Text-Werte, Schreibweise zaehlt). Gleich wie skm_currency_matches. */
function currencyMatches(currency, asset) {
  return typeof currency?.code === 'string' && currency.code === asset.code
    && typeof currency?.issuer === 'string' && currency.issuer === asset.issuer;
}

// Hoechstens so viele Ebenen in der gelesenen Struktur (Tabellen und Arrays, Wurzel = 1, Skalare zaehlen nicht),
// gleich wie SKM_TOML_MAX_STRUCTURE_DEPTH in api/stellarToml.php. Die Bibliothek begrenzt nur verschachtelte
// Werte (500); Tabellenkoepfe und Punkt-Keys ([k.k.k...]) bauen beliebig tiefe Tabellen, an denen JSON.stringify
// fuer /facts scheiterte (und PHP abstuerzte). Zaehlung ohne Rekursion.
const TOML_MAX_STRUCTURE_DEPTH = 1000;

function assertStructureDepth(root, maxStructureDepth = TOML_MAX_STRUCTURE_DEPTH) {
  const stack = [[root, 1]];
  while (stack.length) {
    const [value, level] = stack.pop();
    if (level > maxStructureDepth) throw new Error('toml.invalidFormat');
    const children = Array.isArray(value) ? value : (isPlainTable(value) ? Object.values(value) : null);
    if (!children) continue;
    for (const child of children) {
      if (Array.isArray(child) || isPlainTable(child)) stack.push([child, level + 1]);
    }
  }
}

// limits nur fuer Tests (Gegenprobe ohne Grenze): { maxDepth, maxStructureDepth }. maxDepth geht an die Bibliothek
// (Standard 500, wie SKM_TOML_MAX_DEPTH in PHP).
function parseCurrencySectionsFromToml(tomlText, limits = {}) {
  const parsed = toml.parse(String(tomlText || ''), limits.maxDepth != null ? { maxDepth: limits.maxDepth } : undefined);
  assertStructureDepth(parsed, limits.maxStructureDepth);
  const out = [];
  for (const [key, raw] of Object.entries(parsed || {})) {
    if (key.toLowerCase() !== 'currencies') continue;
    const list = Array.isArray(raw) ? raw : [raw];
    for (const entry of list) {
      const normalized = normalizeCurrencyEntry(entry);
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

// A server that answers with an HTML error/redirect page instead of the
// TOML file (misconfiguration, WAF/CDN block page) is common enough to
// deserve its own "invalidFormat" category rather than falling through to
// toml.parse()'s often-cryptic SyntaxError.
function looksLikeHtml(text) {
  return /^\s*<(!doctype|html)/i.test(String(text || ''));
}

// Normalizes the wide range of internal fetch/parse failures into a small,
// UI-stable set of categories so the frontend can tell a real data problem
// at the issuer's domain (noHomeDomain/notFound/invalidFormat) apart from a
// network condition (timeout/connectionError) or our own SSRF guard
// stepping in (blocked) - instead of surfacing a single generic message for
// every cause. Raw internal error messages (ssrf.blocked:*, HTTP nnn, ...)
// are deliberately left unchanged at their throw sites so existing callers/
// tests of assertSafeScheme()/ssrfSafeLookup() keep seeing the raw reason;
// this classification only applies where fetchAssetFacts turns a caught
// error into the public toml.error field.
function classifyTomlError(error) {
  if (error?.name === 'AbortError') return 'timeout';
  if (error?.name === 'SyntaxError') return 'invalidFormat'; // toml.parse() syntax error
  const message = String(error?.message || '');
  if (message === 'toml.invalidFormat') return 'invalidFormat';

  const httpMatch = message.match(/^HTTP (\d+)$/);
  if (httpMatch) return httpMatch[1] === '404' ? 'notFound' : 'httpError';

  const classifySsrfReason = (reason) =>
    (reason === 'dnsLookupFailed' || reason === 'noAddress') ? 'connectionError' : 'blocked';
  if (message.startsWith('ssrf.blocked:')) {
    return classifySsrfReason(message.slice('ssrf.blocked:'.length));
  }
  // undici wraps network-level failures (DNS, connection refused/reset) from
  // our custom connect.lookup - including the ssrf.blocked:* errors it
  // raises - in a generic TypeError('fetch failed') with the real reason on
  // .cause, rather than surfacing it as the top-level message/name.
  const cause = error?.cause;
  const causeMessage = String(cause?.message || '');
  if (causeMessage.startsWith('ssrf.blocked:')) {
    return classifySsrfReason(causeMessage.slice('ssrf.blocked:'.length));
  }
  if (cause?.code === 'ETIMEDOUT') return 'timeout';
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN'].includes(cause?.code)) return 'connectionError';
  if (message === 'fetch failed') return 'connectionError';

  return 'fetchFailed';
}

function simplifyIssuerAccount(account, issuer) {
  const flags = account?.flags || {};
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  const master = signers.find((signer) => signer.key === issuer || signer.public_key === issuer);
  const thresholds = account?.thresholds || {};
  return {
    accountId: account?.account_id || account?.id || issuer,
    homeDomain: account?.home_domain || account?.homeDomain || '',
    home_domain: account?.home_domain || account?.homeDomain || '',
    flags: {
      auth_required: Boolean(flags.auth_required ?? flags.authRequired ?? false),
      auth_revocable: Boolean(flags.auth_revocable ?? flags.authRevocable ?? false),
      auth_immutable: Boolean(flags.auth_immutable ?? flags.authImmutable ?? false),
      auth_clawback_enabled: Boolean(flags.auth_clawback_enabled ?? flags.authClawbackEnabled ?? false),
    },
    signers: signers.map((signer) => ({
      key: signer.key || signer.public_key || '',
      public_key: signer.public_key || signer.key || '',
      weight: Number(signer.weight || 0),
    })),
    // Needed by the frontend to tell a genuinely locked issuer apart from one
    // where other signers (or a 0-value threshold) could still control the
    // account despite master_weight === 0.
    thresholds: {
      low_threshold: Number(thresholds.low_threshold ?? thresholds.lowThreshold ?? 0),
      med_threshold: Number(thresholds.med_threshold ?? thresholds.medThreshold ?? 0),
      high_threshold: Number(thresholds.high_threshold ?? thresholds.highThreshold ?? 0),
    },
    issuerMasterWeight: master ? Number(master.weight || 0) : null,
  };
}

// extraHeaders: z. B. der Hop-Header des Logo-Proxys (services/assetLogo.js). accept-encoding identity wie
// PHP (curl fragt ohne Accept-Encoding an und entpackt nicht), Review LP-5.
async function fetchTextWithTimeout(url, extraHeaders = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TOML_FETCH_TIMEOUT_MS) : null;
  try {
    let currentUrl = url;
    for (let redirects = 0; redirects <= MAX_TOML_REDIRECTS; redirects += 1) {
      // F-7: stellar.toml nur ueber https, auch nach jeder Weiterleitung (nextRedirectUrl).
      if (assertSafeScheme(currentUrl).protocol !== 'https:') throw new Error('ssrf.blocked:scheme');
      const response = await fetch(currentUrl, {
        headers: { ...extraHeaders, accept: 'text/plain, application/toml, */*', 'accept-encoding': 'identity' },
        signal: controller?.signal,
        redirect: 'manual',
        dispatcher: ssrfSafeAgent,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        currentUrl = nextRedirectUrl(currentUrl, response.headers.get('location'));
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await readTextWithLimit(response, MAX_TOML_RESPONSE_BYTES);
    }
    throw new Error('ssrf.blocked:tooManyRedirects');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function searchAssets({ assetCode, issuer, horizon, limit }) {
  const query = normalizeAssetSearchInput({ assetCode, issuer, limit });
  try {
    const codeVariants = query.code ? getCaseInsensitiveCodeVariants(query.code) : [''];
    const seen = new Set();
    const results = [];

    for (const code of codeVariants) {
      const builder = horizon.assets().limit(query.limit);
      if (code) builder.forCode(code);
      if (query.issuer) builder.forIssuer(query.issuer);
      const response = await builder.call();
      const records = response?.records || [];
      records.forEach((record) => {
        const item = mapAssetRecord(record);
        const key = `${item.assetCode}:${item.assetIssuer}`;
        if (seen.has(key)) return;
        seen.add(key);
        results.push(item);
      });
    }

    return results;
  } catch (err) {
    const detail = err?.response?.data?.status || err?.response?.title || 'generic';
    throw new Error('assetSearch.failed:' + detail);
  }
}

function getCaseInsensitiveCodeVariants(code) {
  return [...new Set([code, code.toUpperCase(), code.toLowerCase()])];
}

function mapAssetRecord(record) {
  return {
    assetCode: record.asset_code,
    assetIssuer: record.asset_issuer,
    // "amount" is the trustline-held total only. Horizon's /assets response
    // separately reports units locked in claimable balances, liquidity
    // pools, and Soroban contracts - those are real outstanding supply too,
    // so they're captured here rather than silently left out of "Gesamtmenge".
    amount: formatAssetAmount(record.balances ?? record.amount ?? record.total_amount ?? record.balance ?? ''),
    numAccounts: formatSplitHorizonNumber(record.accounts ?? record.num_accounts ?? record.numAccounts ?? ''),
    claimableBalancesAmount: formatAssetAmount(record.claimable_balances_amount ?? record.claimableBalancesAmount ?? ''),
    liquidityPoolsAmount: formatAssetAmount(record.liquidity_pools_amount ?? record.liquidityPoolsAmount ?? ''),
    contractsAmount: formatAssetAmount(record.contracts_amount ?? record.contractsAmount ?? ''),
    pagingToken: record.paging_token,
  };
}

function formatAssetAmount(value) {
  if (value && typeof value === 'object') {
    const total = sumSplitHorizonNumber(value);
    if (total != null) return total.toFixed(7).replace(/\.?0+$/, '');
    return '';
  }
  return value ?? '';
}

function formatSplitHorizonNumber(value) {
  if (value && typeof value === 'object') {
    const total = sumSplitHorizonNumber(value);
    return total ?? '';
  }
  return value ?? '';
}

function sumSplitHorizonNumber(value) {
  let hasNumber = false;
  const total = [
    value.authorized,
    value.authorized_to_maintain_liabilities,
    value.unauthorized,
  ].reduce((sum, item) => {
    const number = Number(item);
    if (!Number.isFinite(number)) return sum;
    hasNumber = true;
    return sum + number;
  }, 0);
  return hasNumber ? total : null;
}

async function fetchAssetFacts({ assetCode, issuer, horizon }) {
  const asset = normalizeAssetIdentity({ assetCode, issuer });
  try {
    const issuerAccountRaw = await horizon.loadAccount(asset.issuer);
    const issuerAccount = simplifyIssuerAccount(issuerAccountRaw, asset.issuer);
    const tomlUrl = buildTomlUrl(issuerAccount.homeDomain);

    const facts = {
      assetCode: asset.code,
      assetIssuer: asset.issuer,
      issuerAccount,
      toml: {
        status: tomlUrl ? 'loading' : 'noHomeDomain',
        url: tomlUrl,
        currencies: [],
        matches: [],
        error: '',
      },
    };

    if (!tomlUrl) {
      return {
        ...facts,
        toml: { ...facts.toml, status: 'noHomeDomain' },
      };
    }

    try {
      const tomlText = await fetchTextWithTimeout(tomlUrl);
      if (looksLikeHtml(tomlText)) throw new Error('toml.invalidFormat');
      const currencies = parseCurrencySectionsFromToml(tomlText);
      // Asset codes are case-sensitive on Stellar (USDC and usdc are
      // different assets even for the same issuer), so this must not
      // upcase either side - a differently-cased fake would otherwise be
      // confirmed as "listed in the issuer's stellar.toml".
      // Nur Text-Werte: code = true ergaebe sonst in Node "true", in PHP "1" (Review LP-4).
      const matches = currencies.filter((currency) => currencyMatches(currency, asset));
      return {
        ...facts,
        toml: {
          status: 'loaded',
          url: tomlUrl,
          currencies,
          matches,
          error: '',
        },
      };
    } catch (error) {
      return {
        ...facts,
        toml: {
          status: 'failed',
          url: tomlUrl,
          currencies: [],
          matches: [],
          error: classifyTomlError(error),
        },
      };
    }
  } catch (err) {
    if (String(err?.message || '').startsWith('assetSearch.invalidInput')) throw err;
    const detail = err?.response?.data?.status || err?.response?.title || err?.message || 'generic';
    throw new Error('assetFacts.failed:' + detail);
  }
}

// --- StellarExpert directory lookup ----------------------------------------
// Third-party hint only: the curated stellar.expert directory tags known
// accounts (exchanges, anchors, and - most valuable here - #malicious /
// #unsafe scam issuers). A listing is never treated as proof of legitimacy
// and a missing listing is never treated as a scam indicator; the caller
// renders both as neutral hints. The endpoint is queried only for the
// user-selected asset (not per search result) to stay well inside the
// public API's rate limits, with a small in-memory cache on top.

const EXPERT_DIRECTORY_BASE_URL = 'https://api.stellar.expert/explorer/directory';
const EXPERT_FETCH_TIMEOUT_MS = 5000;
const EXPERT_CACHE_TTL_MS = 10 * 60 * 1000;
// Failures (rate limit, outage) are cached much shorter so the hint comes
// back quickly once the API recovers, without hammering it while it is down.
const EXPERT_UNAVAILABLE_TTL_MS = 60 * 1000;
const EXPERT_CACHE_MAX_ENTRIES = 500;
const expertDirectoryCache = new Map();

function normalizeExpertTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  return rawTags
    .map((tag) => String(tag || '').replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean);
}

async function fetchExpertDirectoryEntry({ issuer, network }) {
  const accountId = String(issuer || '').trim();
  if (!accountId || !isClassicAccount(accountId)) {
    throw new Error('assetSearch.invalidInput:issuerInvalid');
  }

  // The directory covers the public network; testnet issuers are throwaway
  // keys that can never be listed, so skip the upstream call entirely.
  const isPublic = networkFromQuery(network) === 'public';
  if (!isPublic) {
    return { issuer: accountId, status: 'notChecked', name: '', domain: '', tags: [] };
  }

  const cached = expertDirectoryCache.get(accountId);
  if (cached && cached.expires > Date.now()) return cached.entry;

  const entry = await loadExpertDirectoryEntry(accountId);
  if (expertDirectoryCache.size >= EXPERT_CACHE_MAX_ENTRIES) expertDirectoryCache.clear();
  expertDirectoryCache.set(accountId, {
    entry,
    expires: Date.now() + (entry.status === 'unavailable' ? EXPERT_UNAVAILABLE_TTL_MS : EXPERT_CACHE_TTL_MS),
  });
  return entry;
}

async function loadExpertDirectoryEntry(accountId) {
  const base = { issuer: accountId, name: '', domain: '', tags: [] };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), EXPERT_FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch(`${EXPERT_DIRECTORY_BASE_URL}/${accountId}`, {
      headers: { accept: 'application/json' },
      signal: controller?.signal,
    });
    // 404 is the API's way of saying "no directory entry" for some routes -
    // a perfectly normal answer for most legitimate assets, not a failure.
    if (response.status === 404) return { ...base, status: 'notListed' };
    if (!response.ok) return { ...base, status: 'unavailable' };
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') return { ...base, status: 'unavailable' };
    // The directory endpoint actually answers "no entry" with HTTP 200 and an
    // empty object (verified live), not a 404 - only a body that carries the
    // account's own address is a real listing. Without this check every
    // unlisted (i.e. almost every) asset was mislabeled "listed".
    if (!data.address) return { ...base, status: 'notListed' };
    return {
      ...base,
      status: 'listed',
      name: String(data.name || ''),
      domain: String(data.domain || ''),
      tags: normalizeExpertTags(data.tags),
    };
  } catch {
    return { ...base, status: 'unavailable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  searchAssets,
  fetchAssetFacts,
  fetchExpertDirectoryEntry,
  parseCurrencySectionsFromToml,
  // Exported for direct unit testing of the SSRF hardening (N1/N2) without
  // needing real network access or a running server.
  assertSafeScheme,
  ssrfSafeLookup,
  readTextWithLimit,
  // Shared with services/federationService.js (same SSRF-safe connect path).
  ssrfSafeAgent,
  MAX_TOML_RESPONSE_BYTES,
  classifyTomlError,
  // Fuer services/assetLogo.js (gleicher TOML-Weg wie /facts).
  normalizeAssetIdentity,
  buildTomlUrl,
  fetchTextWithTimeout,
  looksLikeHtml,
  currencyMatches,
  TOML_FETCH_TIMEOUT_MS,
  TOML_MAX_STRUCTURE_DEPTH,
};
