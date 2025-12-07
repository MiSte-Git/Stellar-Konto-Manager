import React from 'react';
import { useTranslation } from 'react-i18next';
import AssetSearch from '../components/trading/AssetSearch.jsx';

export default function TradingAssetsPage() {
  const { t } = useTranslation(['trading']);
  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">{t('trading:assetSearch.title')}</h1>
      <AssetSearch />
    </div>
  );
}
