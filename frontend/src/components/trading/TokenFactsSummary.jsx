import React from 'react';
import { useTranslation } from 'react-i18next';
import { getFactsSnapshot, getAssetRiskWarnings, factValue, tomlStatusLabel, issuerLockStatusLabel, expertStatusLabel, isExpertFlagged, getExpertWarningTags } from './assetFactsUtils.js';
import HelpLabel from './HelpLabel.jsx';

// Risk-warning list shown under the facts grid. Only ever rendered from
// TokenFactsSummary below - kept private to this module (was the component's
// own renderRiskWarnings() before the file-split).
function RiskWarnings({ facts, asset, t }) {
  const warnings = getAssetRiskWarnings(facts, asset, t);
  if (!warnings.length) return null;
  return (
    <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <div className="mb-1 font-semibold">{t('trading:assetSearch.risk.title')}</div>
      <ul className="list-disc pl-4">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Issuer/TOML/auth-flag summary shown both in the asset detail panel and in
 * every confirmation modal (trustline, swap, trustline+swap, and the
 * swap-target's facts). Extracted from AssetSearch.jsx's inline
 * renderTokenFactsSummary() (step 2 of the file-split) without any behavior
 * change.
 *
 * `routeStatus` replaces the original's direct read of the container's
 * swapPreview state ('available' | 'unavailable' | 'notChecked', mirroring
 * swapPreview.path / swapPreview.error / neither) - the container computes it
 * once and passes it down, so this component has no swap-specific coupling.
 * Only used when includeRoute is true; safe to omit otherwise.
 */
export default function TokenFactsSummary({
  facts,
  asset,
  includeDisclaimer = false,
  includeRoute = true,
  routeStatus,
}) {
  const { t } = useTranslation(['trading', 'common']);
  const snapshot = getFactsSnapshot(facts, asset);
  return (
    <>
      {includeDisclaimer && (
        <p className="mb-3 text-xs text-gray-700 dark:text-blue-100">
          {t('trading:assetSearch.facts.disclaimer')}
        </p>
      )}
      {facts.loading && (
        <div className="text-xs text-gray-700 dark:text-blue-100">
          {t('trading:assetSearch.facts.loading')}
        </div>
      )}
      {facts.error && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t('trading:assetSearch.facts.issuerLoadFailed')}
        </div>
      )}
      {!facts.loading && !facts.error && (
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.homeDomain')} helpKey="trading:assetSearch.help.homeDomain" /></dt>
            <dd className="break-all font-mono">{snapshot.issuerHomeDomain || t('trading:assetSearch.facts.notAvailable')}</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.issuerMasterWeight')} helpKey="trading:assetSearch.help.issuerMasterWeight" /></dt>
            <dd className="font-mono">{snapshot.issuerMasterWeight === null ? t('trading:assetSearch.facts.notAvailable') : snapshot.issuerMasterWeight}</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.issuerLocked')} helpKey="trading:assetSearch.help.issuerLocked" /></dt>
            <dd className={
              snapshot.issuerLockStatus.status === 'appearsLocked'
                ? 'font-semibold text-red-700 dark:text-red-400'
                : snapshot.issuerLockStatus.status === 'locked'
                  ? 'text-green-700 dark:text-green-400'
                  : ''
            }>
              {issuerLockStatusLabel(snapshot.issuerLockStatus.status, t)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.toml.status')} helpKey="trading:assetSearch.help.tomlStatus" /></dt>
            <dd>{tomlStatusLabel(facts, t)}</dd>
          </div>
          {facts.toml.url && (
            <div className="sm:col-span-2">
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.toml.url')} helpKey="trading:assetSearch.help.tomlUrl" /></dt>
              <dd className="break-all font-mono">{facts.toml.url}</dd>
            </div>
          )}
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.toml.assetListed')} helpKey="trading:assetSearch.help.tomlAssetListed" /></dt>
            <dd>{facts.toml.status === 'loaded' ? factValue(snapshot.tomlContainsAsset, t) : t('trading:assetSearch.facts.notAvailable')}</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.toml.currencyCount')} helpKey="trading:assetSearch.help.tomlCurrencyCount" /></dt>
            <dd className="font-mono">{facts.toml.status === 'loaded' ? snapshot.tomlCurrencyCount : t('trading:assetSearch.facts.notAvailable')}</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.flags.authRequired')} helpKey="trading:assetSearch.help.authRequired" /></dt>
            <dd>{factValue(snapshot.authRequired, t)}</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.flags.authRevocable')} helpKey="trading:assetSearch.help.authRevocable" /></dt>
            <dd>{factValue(snapshot.authRevocable, t)}</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.flags.authImmutable')} helpKey="trading:assetSearch.help.authImmutable" /></dt>
            <dd>{factValue(snapshot.authImmutable, t)}</dd>
          </div>
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.flags.clawbackEnabled')} helpKey="trading:assetSearch.help.clawbackEnabled" /></dt>
            <dd>{factValue(snapshot.clawbackEnabled, t)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.expert.label')} helpKey="trading:assetSearch.help.expertDirectory" /></dt>
            <dd className={isExpertFlagged(facts) ? 'font-semibold text-red-700 dark:text-red-400' : ''}>
              {expertStatusLabel(facts, t)}
            </dd>
          </div>
          {includeRoute && (
          <div>
            <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.facts.liquidityRoute')} helpKey="trading:assetSearch.help.liquidityRoute" /></dt>
            <dd>
              {routeStatus === 'available'
                ? t('trading:assetSearch.facts.routeAvailable')
                : routeStatus === 'unavailable'
                  ? t('trading:assetSearch.facts.routeUnavailable')
                  : t('trading:assetSearch.facts.notChecked')}
            </dd>
          </div>
          )}
        </dl>
      )}
      {!facts.loading && !facts.error && isExpertFlagged(facts) && (
        <div
          className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          role="alert"
        >
          {t('trading:assetSearch.risk.expertFlagged', { tags: getExpertWarningTags(facts).join(', ') })}
        </div>
      )}
      <RiskWarnings facts={facts} asset={asset} t={t} />
    </>
  );
}
