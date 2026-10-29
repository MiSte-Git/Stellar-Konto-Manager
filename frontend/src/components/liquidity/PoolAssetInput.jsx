import React from 'react';
import { useTranslation } from 'react-i18next';
import AssetPickerField from '../trading/AssetPickerField.jsx';
import { getAssetTrustlineCount, parseHorizonNumber } from '../trading/assetSearchUtils.js';

/**
 * Eine Seite des Asset-Paars: XLM oder Token. Fuer Token wird der
 * AssetPickerField aus Trading genutzt; picker ist eine Instanz von
 * useAssetPickerSearch.
 */
export default function PoolAssetInput({ name, label, kind, onKindChange, picker }) {
  const { t, i18n } = useTranslation(['liquidity']);
  const formatTrustlineCount = (asset) => {
    const value = parseHorizonNumber(getAssetTrustlineCount(asset));
    return value == null ? '—' : value.toLocaleString(i18n.language);
  };
  return (
    <fieldset className="rounded-sm border border-gray-200 p-3 dark:border-gray-700">
      <legend className="px-1 text-xs font-semibold">{label}</legend>
      <div className="mb-2 flex gap-4 text-xs">
        {['native', 'token'].map((value) => (
          <label key={value} className="inline-flex items-center gap-1">
            <input type="radio" name={name} value={value} checked={kind === value} onChange={() => onKindChange(value)} />
            {t(`liquidity:finder.kind.${value}`)}
          </label>
        ))}
      </div>
      {kind === 'token' && (
        <AssetPickerField
          label={t('liquidity:finder.tokenLabel')}
          placeholder={t('liquidity:finder.tokenPlaceholder')}
          searchLabel={t('liquidity:finder.tokenSearch')}
          selectedLabel={t('liquidity:finder.tokenSelected')}
          query={picker.query}
          onQueryChange={picker.setQuery}
          onSearch={picker.search}
          loading={picker.loading}
          error={picker.error}
          selected={picker.selected}
          onSelect={picker.select}
          results={picker.results}
          formatTrustlineCount={formatTrustlineCount}
        />
      )}
    </fieldset>
  );
}
