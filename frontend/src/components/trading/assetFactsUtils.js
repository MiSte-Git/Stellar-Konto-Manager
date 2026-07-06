// Derives the token-facts snapshot and risk warnings shown in TokenFactsSummary
// (and reused for the plain-boolean market-data checkmark in AssetSearch).
// Extracted from AssetSearch.jsx (step 2 of the file-split) without any
// behavior change. getFactsSnapshot() is pure; the other two need the
// translation function passed in explicitly since they used to close over
// the component's own `t` from react-i18next.
import { getAssetIssuer, getAccountFlag, getIssuerMasterWeight } from './assetSearchUtils.js';

export function getFactsSnapshot(facts, asset) {
  const issuer = getAssetIssuer(asset);
  const issuerMasterWeight = issuer ? getIssuerMasterWeight(facts.issuerAccount, issuer) : null;
  return {
    issuerHomeDomain: facts.issuerAccount?.home_domain || facts.issuerAccount?.homeDomain || '',
    issuerMasterWeight,
    tomlContainsAsset: facts.toml.status === 'loaded' && facts.toml.matches.length > 0,
    tomlCurrencyCount: Array.isArray(facts.toml.currencies) ? facts.toml.currencies.length : 0,
    authRequired: getAccountFlag(facts.issuerAccount, 'auth_required', 'authRequired'),
    authRevocable: getAccountFlag(facts.issuerAccount, 'auth_revocable', 'authRevocable'),
    authImmutable: getAccountFlag(facts.issuerAccount, 'auth_immutable', 'authImmutable'),
    clawbackEnabled: getAccountFlag(facts.issuerAccount, 'auth_clawback_enabled', 'authClawbackEnabled'),
  };
}

export function getAssetRiskWarnings(facts, asset, t) {
  if (!asset || facts.loading) return [];
  if (facts.error) return [t('trading:assetSearch.risk.issuerLoadFailed')];
  const snapshot = getFactsSnapshot(facts, asset);
  const warnings = [];
  if (!snapshot.issuerHomeDomain) warnings.push(t('trading:assetSearch.risk.noHomeDomain'));
  if (facts.toml.status !== 'loaded') warnings.push(t('trading:assetSearch.risk.tomlNotLoaded'));
  if (facts.toml.status === 'loaded' && !snapshot.tomlContainsAsset) warnings.push(t('trading:assetSearch.risk.tomlAssetMissing'));
  if (snapshot.issuerMasterWeight !== null && snapshot.issuerMasterWeight !== 0) warnings.push(t('trading:assetSearch.risk.issuerUnlocked'));
  if (snapshot.authRequired) warnings.push(t('trading:assetSearch.risk.authRequired'));
  if (snapshot.clawbackEnabled) warnings.push(t('trading:assetSearch.risk.clawbackEnabled'));
  return warnings;
}

export function factValue(value, t) {
  return value ? t('trading:assetSearch.facts.yes') : t('trading:assetSearch.facts.no');
}

export function tomlStatusLabel(facts, t) {
  if (facts.toml.status === 'loading') return t('trading:assetSearch.facts.toml.loading');
  if (facts.toml.status === 'loaded') return t('trading:assetSearch.facts.toml.loaded');
  if (facts.toml.status === 'failed') return t('trading:assetSearch.facts.toml.failed');
  if (facts.toml.status === 'noHomeDomain') return t('trading:assetSearch.facts.toml.noHomeDomain');
  return t('trading:assetSearch.facts.notChecked');
}
