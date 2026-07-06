// Pure, React-free helpers shared across the trading/AssetSearch feature:
// query parsing, asset/amount normalization and formatting, and the Horizon
// number-parsing/reserve-calculation helpers. Extracted from AssetSearch.jsx
// (step 1 of the file-split) without any behavior change - every function
// here is verbatim what used to live at module scope in that file.
import { Asset } from '@stellar/stellar-sdk';

export const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;
export const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
export const AMOUNT_RE = /^\d+(?:\.\d{1,7})?$/;
export const DEFAULT_TRUSTLINE_LIMIT = '1000000';
export const BASE_RESERVE_XLM = 0.5;
export const EMPTY_ASSET_FACTS = {
  loading: false,
  error: '',
  issuerAccount: null,
  toml: {
    status: 'notChecked',
    url: '',
    currencies: [],
    matches: [],
    error: '',
  },
};

export function shortenKey(value = '') {
  if (!value || value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

export function assetResultKey(asset) {
  return `${asset?.assetCode || ''}:${asset?.assetIssuer || ''}`;
}

export function parseAssetSearchQuery(raw) {
  const value = String(raw || '').trim();
  if (!value) return { error: 'queryMissing' };

  if (value.includes(':')) {
    const parts = value.split(':').map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) return { error: 'queryInvalid' };
    const [code, issuer] = parts;
    if (!ASSET_CODE_RE.test(code)) return { error: 'codeInvalid' };
    if (!STELLAR_PUBLIC_KEY_RE.test(issuer)) return { error: 'issuerInvalid' };
    return { code, issuer, mode: 'exact' };
  }

  if (STELLAR_PUBLIC_KEY_RE.test(value)) {
    return { issuer: value, mode: 'issuer' };
  }

  if (!ASSET_CODE_RE.test(value)) {
    return { error: 'queryInvalid' };
  }

  return { code: value, mode: 'code' };
}

export function getStoredAccountInput() {
  if (typeof window === 'undefined') return '';
  try {
    return (
      window.sessionStorage?.getItem('stm.currentAccount') ||
      window.localStorage?.getItem('SKM_LAST_ACCOUNT') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

export function getStoredNetwork() {
  if (typeof window === 'undefined') return 'PUBLIC';
  try {
    return window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET' ? 'TESTNET' : 'PUBLIC';
  } catch {
    return 'PUBLIC';
  }
}

export function normalizeAmount(value) {
  const trimmed = String(value || '').trim().replace(',', '.');
  if (!AMOUNT_RE.test(trimmed)) return '';
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return trimmed;
}

export function calculateMinimumDestinationAmount(destinationAmount, slippageValue) {
  const received = Number(destinationAmount || 0);
  const slippage = Number(String(slippageValue || '').replace(',', '.'));
  if (!Number.isFinite(received) || received <= 0 || !Number.isFinite(slippage) || slippage < 0 || slippage > 50) return '';
  const min = received * (1 - (slippage / 100));
  return min > 0 ? min.toFixed(7).replace(/\.?0+$/, '') : '';
}

export function normalizeTrustlineLimit(value) {
  return normalizeAmount(value);
}

export function formatAssetLabel(asset) {
  if (!asset || asset.isNative?.() || asset.asset_type === 'native') return 'XLM';
  return asset.assetCode || asset.code || asset.asset_code || 'Asset';
}

export function getAssetIssuer(asset) {
  if (!asset || asset.isNative?.() || asset.asset_type === 'native') return '';
  return asset.assetIssuer || asset.issuer || asset.asset_issuer || '';
}

export function getAssetCode(asset) {
  if (!asset || asset.isNative?.() || asset.asset_type === 'native') return 'XLM';
  return asset.assetCode || asset.code || asset.asset_code || '';
}

export function formatAssetLabelWithIssuer(asset) {
  if (!asset || asset.isNative?.() || asset.asset_type === 'native') return 'XLM';
  const code = getAssetCode(asset) || 'Asset';
  const issuer = getAssetIssuer(asset);
  return issuer ? `${code}:${shortenKey(issuer)}` : code;
}

export function formatAssetPath(path = [], sourceAsset = Asset.native(), destinationAsset = Asset.native()) {
  const sourceLabel = formatAssetLabel(sourceAsset);
  const destinationLabel = formatAssetLabel(destinationAsset);
  const intermediate = Array.isArray(path) ? path.map((asset) => {
    if (!asset || asset.asset_type === 'native') return 'XLM';
    return asset.asset_code || 'Asset';
  }) : [];
  return [sourceLabel, ...intermediate, destinationLabel].join(' -> ');
}

export function formatDetailedAssetPath(path = [], sourceAsset = Asset.native(), destinationAsset = Asset.native()) {
  const intermediate = Array.isArray(path) ? path.map(assetFromPathRecord) : [];
  return [sourceAsset, ...intermediate, destinationAsset].map(formatAssetLabelWithIssuer).join(' -> ');
}

export function assetFromPathRecord(asset) {
  if (!asset || asset.asset_type === 'native') return Asset.native();
  return new Asset(asset.asset_code, asset.asset_issuer);
}

export function assetFromOfferSide(offer, prefix) {
  const type = offer?.[`${prefix}_asset_type`];
  if (!type || type === 'native') return Asset.native();
  return new Asset(offer?.[`${prefix}_asset_code`], offer?.[`${prefix}_asset_issuer`]);
}

export function assetFromSearchResult(asset) {
  return new Asset(asset.assetCode, asset.assetIssuer);
}

export function assetFromExactQuery(query) {
  if (!query?.code || !query?.issuer) return null;
  return new Asset(query.code, query.issuer);
}

export function assetsEqual(left, right) {
  if (!left || !right) return false;
  if (left.isNative?.() || right.isNative?.()) return Boolean(left.isNative?.() && right.isNative?.());
  return left.code === right.code && left.issuer === right.issuer;
}

export function formatReserveAsset(value = '') {
  if (!value || value === 'native') return 'XLM';
  const [code] = String(value).split(':');
  return code || value;
}

export function parseHorizonNumber(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

export function sumHorizonSplitValue(value) {
  if (!value || typeof value !== 'object') return null;
  let hasNumber = false;
  const total = [
    value.authorized,
    value.authorized_to_maintain_liabilities,
    value.unauthorized,
  ].reduce((sum, item) => {
    const number = parseHorizonNumber(item);
    if (number == null) return sum;
    hasNumber = true;
    return sum + number;
  }, 0);
  return hasNumber ? total : null;
}

export function getAssetTrustlineCount(asset) {
  const value = asset?.accounts ?? asset?.numAccounts ?? asset?.num_accounts ?? '';
  if (value && typeof value === 'object') {
    const total = sumHorizonSplitValue(value);
    if (total != null) return total;
    return Object.values(value).find((item) => typeof item === 'string' || typeof item === 'number') ?? null;
  }
  return value === '' || value == null ? null : value;
}

export function getAssetTrustlineCountNumber(asset) {
  return parseHorizonNumber(getAssetTrustlineCount(asset)) ?? 0;
}

export function getAssetAmountNumber(asset) {
  const value = asset?.balances ?? asset?.amount ?? asset?.totalAmount ?? asset?.total_amount ?? asset?.balance ?? '';
  if (value && typeof value === 'object') {
    const total = sumHorizonSplitValue(value);
    if (total != null) return total;
    const fallback = Object.values(value).find((item) => typeof item === 'string' || typeof item === 'number');
    return parseHorizonNumber(fallback);
  }
  return parseHorizonNumber(value);
}

export function getOfferPriceNumber(item) {
  const direct = parseHorizonNumber(item?.price);
  if (direct != null) return direct;
  const numerator = parseHorizonNumber(item?.price_r?.n);
  const denominator = parseHorizonNumber(item?.price_r?.d);
  if (numerator != null && denominator != null && denominator !== 0) return numerator / denominator;
  return null;
}

export function sumOrderbookAmount(items = [], limit = 5) {
  return items.slice(0, limit).reduce((sum, item) => sum + (parseHorizonNumber(item?.amount) || 0), 0);
}

export function calculatePercentChange(next, previous) {
  const current = parseHorizonNumber(next);
  const base = parseHorizonNumber(previous);
  if (current == null || base == null || base <= 0) return null;
  return ((current - base) / base) * 100;
}

export function getCollectedSignerWeight(collectedSigners, horizonSigners) {
  const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
  const knownSigners = Array.isArray(horizonSigners) ? horizonSigners : [];
  return signers.reduce((acc, signer) => {
    try {
      const publicKey = signer.keypair?.publicKey?.();
      const match = knownSigners.find((item) => item.key === publicKey || item.public_key === publicKey);
      const weight = Number(match?.weight || 0);
      return acc + (weight > 0 ? weight : 0);
    } catch {
      return acc;
    }
  }, 0);
}

export function getIssuerMasterWeight(account, issuer) {
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  const master = signers.find((signer) => signer.key === issuer || signer.public_key === issuer);
  return master ? Number(master.weight || 0) : null;
}

export function getAccountFlag(account, snakeKey, camelKey) {
  const flags = account?.flags || {};
  return Boolean(flags[snakeKey] ?? flags[camelKey] ?? false);
}

export function getNativeBalance(account) {
  const native = Array.isArray(account?.balances)
    ? account.balances.find((balance) => balance.asset_type === 'native')
    : null;
  return parseHorizonNumber(native?.balance) ?? null;
}

export function getAccountSubentryCount(account) {
  return parseHorizonNumber(account?.subentry_count ?? account?.subentryCount) ?? 0;
}

export function getTrustlineReserveSummary(account) {
  if (!account) return null;
  const subentries = getAccountSubentryCount(account);
  const currentMinimum = (2 + subentries) * BASE_RESERVE_XLM;
  const afterTrustlineMinimum = (2 + subentries + 1) * BASE_RESERVE_XLM;
  const nativeBalance = getNativeBalance(account);
  return {
    reservePerEntry: BASE_RESERVE_XLM,
    currentMinimum,
    afterTrustlineMinimum,
    extraReserve: BASE_RESERVE_XLM,
    nativeBalance,
    spendableAfterTrustline: nativeBalance == null ? null : nativeBalance - afterTrustlineMinimum,
  };
}
