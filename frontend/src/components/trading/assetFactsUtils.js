// Derives the token-facts snapshot and risk warnings shown in TokenFactsSummary
// (and reused for the plain-boolean market-data checkmark in AssetSearch).
// Extracted from AssetSearch.jsx (step 2 of the file-split) without any
// behavior change. getFactsSnapshot() is pure; the other two need the
// translation function passed in explicitly since they used to close over
// the component's own `t` from react-i18next.
import { getAssetIssuer, getAccountFlag, getIssuerLockStatus } from './assetSearchUtils.js';

export function getFactsSnapshot(facts, asset) {
  const issuer = getAssetIssuer(asset);
  const issuerLockStatus = issuer
    ? getIssuerLockStatus(facts.issuerAccount, issuer)
    : { status: 'unknown', masterWeight: null, otherSignersWeight: null, minThreshold: null };
  return {
    issuerHomeDomain: facts.issuerAccount?.home_domain || facts.issuerAccount?.homeDomain || '',
    issuerMasterWeight: issuerLockStatus.masterWeight,
    issuerLockStatus,
    tomlContainsAsset: facts.toml.status === 'loaded' && facts.toml.matches.length > 0,
    tomlCurrencyCount: Array.isArray(facts.toml.currencies) ? facts.toml.currencies.length : 0,
    authRequired: getAccountFlag(facts.issuerAccount, 'auth_required', 'authRequired'),
    authRevocable: getAccountFlag(facts.issuerAccount, 'auth_revocable', 'authRevocable'),
    authImmutable: getAccountFlag(facts.issuerAccount, 'auth_immutable', 'authImmutable'),
    clawbackEnabled: getAccountFlag(facts.issuerAccount, 'auth_clawback_enabled', 'authClawbackEnabled'),
  };
}

// Three-tier severity so the warning list reads "active/normal" facts as
// neutral, genuine red flags as clear warnings, and situations that merely
// deserve a second look as cautionary notes - instead of one flat list that
// fires on almost every actively managed asset.
export function getAssetRiskWarnings(facts, asset, t) {
  if (!asset || facts.loading) return [];
  if (facts.error) return [t('trading:assetSearch.risk.issuerLoadFailed')];
  const snapshot = getFactsSnapshot(facts, asset);
  const warnings = [];
  if (!snapshot.issuerHomeDomain) warnings.push(t('trading:assetSearch.risk.noHomeDomain'));
  if (facts.toml.status !== 'loaded') warnings.push(t('trading:assetSearch.risk.tomlNotLoaded'));
  if (facts.toml.status === 'loaded' && !snapshot.tomlContainsAsset) warnings.push(t('trading:assetSearch.risk.tomlAssetMissing'));
  // 'active' (master key in normal use) is intentionally not a warning; only
  // the deceptive "looks locked but isn't" case is flagged here.
  if (snapshot.issuerLockStatus.status === 'appearsLocked') warnings.push(t('trading:assetSearch.risk.issuerAppearsLocked'));
  if (snapshot.authRequired) warnings.push(t('trading:assetSearch.risk.authRequired'));
  if (snapshot.authRevocable) warnings.push(t('trading:assetSearch.risk.authRevocable'));
  if (snapshot.clawbackEnabled) warnings.push(t('trading:assetSearch.risk.clawbackEnabled'));
  return warnings;
}

export function factValue(value, t) {
  return value ? t('trading:assetSearch.facts.yes') : t('trading:assetSearch.facts.no');
}

// Maps the three-tier getIssuerLockStatus() result to its label. Kept next to
// factValue()/tomlStatusLabel() since all three exist only to turn a raw
// snapshot field into UI text with the translation function passed in.
export function issuerLockStatusLabel(status, t) {
  if (status === 'active') return t('trading:assetSearch.facts.issuerLockStatus.active');
  if (status === 'locked') return t('trading:assetSearch.facts.issuerLockStatus.locked');
  if (status === 'appearsLocked') return t('trading:assetSearch.facts.issuerLockStatus.appearsLocked');
  return t('trading:assetSearch.facts.notAvailable');
}

export function tomlStatusLabel(facts, t) {
  if (facts.toml.status === 'loading') return t('trading:assetSearch.facts.toml.loading');
  if (facts.toml.status === 'loaded') return t('trading:assetSearch.facts.toml.loaded');
  if (facts.toml.status === 'failed') return t('trading:assetSearch.facts.toml.failed');
  if (facts.toml.status === 'noHomeDomain') return t('trading:assetSearch.facts.toml.noHomeDomain');
  return t('trading:assetSearch.facts.notChecked');
}

// Directory tags that mark an account as harmful in the curated
// stellar.expert directory. Only these two trigger the red warning; every
// other tag (exchange, anchor, ...) is descriptive and stays a neutral hint.
export const EXPERT_WARNING_TAGS = ['malicious', 'unsafe'];

export function getExpertWarningTags(facts) {
  const tags = Array.isArray(facts?.expert?.tags) ? facts.expert.tags : [];
  return tags.filter((tag) => EXPERT_WARNING_TAGS.includes(String(tag).toLowerCase()));
}

export function isExpertFlagged(facts) {
  return facts?.expert?.status === 'listed' && getExpertWarningTags(facts).length > 0;
}

// Wording note: none of these labels may read as an endorsement ("verified",
// "confirmed safe") - a listing is a third-party hint, and "not listed" is
// explicitly framed as saying nothing about authenticity.
export function expertStatusLabel(facts, t) {
  const expert = facts?.expert || {};
  if (expert.status === 'listed') {
    const name = String(expert.name || '');
    const tags = Array.isArray(expert.tags) ? expert.tags.filter(Boolean) : [];
    const label = name
      ? t('trading:assetSearch.facts.expert.listedAs', { name })
      : t('trading:assetSearch.facts.expert.listed');
    return tags.length ? `${label} (${tags.join(', ')})` : label;
  }
  if (expert.status === 'notListed') return t('trading:assetSearch.facts.expert.notListed');
  if (expert.status === 'unavailable') return t('trading:assetSearch.facts.expert.unavailable');
  return t('trading:assetSearch.facts.expert.notChecked');
}
