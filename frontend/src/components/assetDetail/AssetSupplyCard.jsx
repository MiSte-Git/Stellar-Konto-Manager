import React from 'react';
import { useTranslation } from 'react-i18next';
import useAssetSupply from './useAssetSupply.js';

/**
 * Holder und ausgegebene Menge laut Horizon /assets. Nur Fakten aus dem Netz, keine Bewertung.
 * fmt: Zahlformat der Seite (gleiche Darstellung wie die Kontowerte).
 */
export default function AssetSupplyCard({ code, issuer, network, fmt, cardCls }) {
  const { t } = useTranslation(['wallet', 'trading']);
  const { status, data } = useAssetSupply(code, issuer, network);

  let body;
  if (status === 'ok' && data) {
    const { holders, supply } = data;
    const showSplit = holders.maintain > 0 || holders.unauthorized > 0;
    const parts = [];
    if (supply.claimable) parts.push(t('trading:assetSearch.facts.amountBreakdown.claimable', { amount: `${fmt(supply.claimable)} ${code}` }));
    if (supply.pools) parts.push(t('trading:assetSearch.facts.amountBreakdown.pools', { amount: `${fmt(supply.pools)} ${code}` }));
    if (supply.contracts) parts.push(t('trading:assetSearch.facts.amountBreakdown.contracts', { amount: `${fmt(supply.contracts)} ${code}` }));
    body = (
      <>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">{t('wallet:assetDetail.supply.holders', 'Konten mit Trustline (auch mit Saldo 0)')}</dt>
            <dd className="mt-0.5 font-mono text-sm text-gray-900 dark:text-gray-100" data-testid="asset-supply-holders">{fmt(holders.total)}</dd>
            {showSplit && (
              <dd className="mt-1 text-xs text-gray-600 dark:text-gray-300" data-testid="asset-supply-holders-split">
                {t('wallet:assetDetail.supply.holdersSplit', {
                  authorized: fmt(holders.authorized), maintain: fmt(holders.maintain), unauthorized: fmt(holders.unauthorized),
                  defaultValue: '{{authorized}} autorisiert, {{maintain}} nur bestehende Verpflichtungen, {{unauthorized}} nicht autorisiert',
                })}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">{t('wallet:assetDetail.supply.amount', 'Ausgegebene Menge')}</dt>
            <dd className="mt-0.5 break-all font-mono text-sm text-gray-900 dark:text-gray-100" data-testid="asset-supply-amount">{fmt(supply.total)} {code}</dd>
            {parts.length > 0 && (
              <dd className="mt-1 text-xs text-gray-600 dark:text-gray-300" data-testid="asset-supply-breakdown">
                {[t('trading:assetSearch.facts.amountBreakdown.trustlines', { amount: `${fmt(supply.trustlines)} ${code}` }), ...parts].join(', ')}
              </dd>
            )}
          </div>
        </dl>
        <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
          {t('wallet:assetDetail.supply.issuerNote', 'Ohne den Bestand des Issuers. Solange sein Konto nicht gesperrt ist, kann der Issuer weitere Einheiten ausgeben.')}
        </p>
      </>
    );
  } else if (status === 'none') {
    body = <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="asset-supply-none">{t('wallet:assetDetail.supply.none', 'Noch kein Konto hält eine Trustline zu diesem Asset.')}</p>;
  } else if (status === 'error') {
    body = <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="asset-supply-error">{t('wallet:assetDetail.supply.error', 'Holder und Menge konnten nicht geladen werden.')}</p>;
  } else {
    body = <p className="text-sm text-gray-500 dark:text-gray-400">{t('wallet:assetDetail.supply.loading', 'Lade Holder und Menge …')}</p>;
  }

  return (
    <section className={cardCls} data-testid="asset-supply-card">
      <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{t('wallet:assetDetail.supply.title', 'Verbreitung im Netz')}</h2>
      {body}
    </section>
  );
}
