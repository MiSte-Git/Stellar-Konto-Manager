const StellarSdk = require('@stellar/stellar-sdk');
const toml = require('toml');

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const TOML_FETCH_TIMEOUT_MS = 6000;

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
  if (assetIssuer && !StellarSdk.StrKey.isValidEd25519PublicKey(assetIssuer)) {
    throw new Error('assetSearch.invalidInput:issuerInvalid');
  }

  return { code, issuer: assetIssuer, limit: pageLimit };
}

function normalizeAssetIdentity({ assetCode, issuer }) {
  const code = String(assetCode || '').trim();
  const assetIssuer = String(issuer || '').trim();

  if (!code || !ASSET_CODE_RE.test(code)) {
    throw new Error('assetSearch.invalidInput:codeInvalid');
  }
  if (!assetIssuer || !StellarSdk.StrKey.isValidEd25519PublicKey(assetIssuer)) {
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

function normalizeCurrencyEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return Object.entries(entry).reduce((acc, [key, value]) => {
    acc[String(key).toLowerCase()] = value;
    return acc;
  }, {});
}

function parseCurrencySectionsFromToml(tomlText) {
  const parsed = toml.parse(String(tomlText || ''));
  const rawCurrencies = parsed?.CURRENCIES || parsed?.currencies || [];
  const list = Array.isArray(rawCurrencies) ? rawCurrencies : [rawCurrencies];
  return list.map(normalizeCurrencyEntry).filter(Boolean);
}

function simplifyIssuerAccount(account, issuer) {
  const flags = account?.flags || {};
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  const master = signers.find((signer) => signer.key === issuer || signer.public_key === issuer);
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
    issuerMasterWeight: master ? Number(master.weight || 0) : null,
  };
}

async function fetchTextWithTimeout(url) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TOML_FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, {
      headers: { accept: 'text/plain, application/toml, */*' },
      signal: controller?.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
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
    amount: formatAssetAmount(record.balances ?? record.amount ?? record.total_amount ?? record.balance ?? ''),
    numAccounts: formatSplitHorizonNumber(record.accounts ?? record.num_accounts ?? record.numAccounts ?? ''),
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
      const currencies = parseCurrencySectionsFromToml(tomlText);
      const matches = currencies.filter((currency) =>
        String(currency.code || '').toUpperCase() === asset.code.toUpperCase() &&
        String(currency.issuer || '') === asset.issuer
      );
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
          error: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'fetchFailed'),
        },
      };
    }
  } catch (err) {
    if (String(err?.message || '').startsWith('assetSearch.invalidInput')) throw err;
    const detail = err?.response?.data?.status || err?.response?.title || err?.message || 'generic';
    throw new Error('assetFacts.failed:' + detail);
  }
}

module.exports = {
  searchAssets,
  fetchAssetFacts,
  parseCurrencySectionsFromToml,
};
