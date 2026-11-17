import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PriceChart from './PriceChart.jsx';
import useAssetMarket from './useAssetMarket.js';
import { referencePrice } from '../../utils/stellar/assetMarket.js';

const cardCls = 'rounded-xl border border-gray-200 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-800';
const btnCls = 'rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700';

function Stat({ label, children, testId }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-gray-900 dark:text-gray-100" data-testid={testId}>{children}</dd>
    </div>
  );
}

/**
 * Kurs eines Tokens gegen XLM (Asset-Detailseite): Kopf mit letztem Handel, Orderbuch-Mitte, Spread und Tausch von
 * 1 Einheit, Kennzahlen 24 h und 7 Tage, Kursverlauf und Orderbuch (je 10 Stufen). Nur Anzeige, sendet nichts.
 * Fehlende Daten erscheinen als kein Handel bzw. kein Angebot, nie als 0. Keine Bewertung des Tokens (Regel 4).
 */
export default function AssetMarketCard({ code, issuer, network, balance }) {
  const { t, i18n } = useTranslation(['wallet']);
  const market = useAssetMarket({ code, issuer, network, enabled: !!code && !!issuer });
  const { data } = market;

  const fmt = useMemo(() => {
    // Preise unter 1 mit signifikanten Stellen: sehr kleine Kurse (Billionen-Supply-Token) nie als 0 (AM-4).
    const price = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 7 });
    const smallPrice = new Intl.NumberFormat(i18n.language, { maximumSignificantDigits: 6 });
    const amount = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
    const tiny = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(0.01);
    const pct = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
    const pctPlain = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
    const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
    return {
      price: (v) => {
        if (!Number.isFinite(v)) return '–';
        return v > 0 && v < 1 ? smallPrice.format(v) : price.format(v);
      },
      amount: (v) => {
        if (!Number.isFinite(v)) return '–';
        return v > 0 && v < 0.01 ? `< ${tiny}` : amount.format(v);
      },
      pct: (v) => (Number.isFinite(v) ? `${pct.format(v)} %` : '–'),
      pctPlain: (v) => (Number.isFinite(v) ? `${pctPlain.format(v)} %` : '–'),
      date: (v) => {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? '–' : date.format(d);
      },
    };
  }, [i18n.language]);

  const ob = data?.orderbook || null;
  const ref = referencePrice(data);
  const unavailable = t('wallet:assetDetail.market.unavailable', 'nicht verfügbar');
  const levels = (count, capped) => (capped ? `${count}+` : String(count));
  const balanceNum = balance != null ? Number(balance) : null;
  const ranges = [
    ['24h', t('wallet:assetDetail.market.range.24h', '24 h')],
    ['7d', t('wallet:assetDetail.market.range.7d', '7 Tage')],
    ['30d', t('wallet:assetDetail.market.range.30d', '30 Tage')],
  ];
  const rangeLabel = ranges.find(([k]) => k === market.range)?.[1] || '';
  const noTrade = t('wallet:assetDetail.market.noTrade', 'kein Handel');

  const statBlock = (stats, key, title) => (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700" data-testid={`asset-market-${key}`}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</div>
      {stats ? (
        <dl className="grid grid-cols-2 gap-2">
          <Stat label={t('wallet:assetDetail.market.volume', 'Volumen')}>{fmt.amount(stats.volumeXlm)} XLM</Stat>
          <Stat label={t('wallet:assetDetail.market.change', 'Änderung')}>{fmt.pct(stats.changePct)}</Stat>
          <Stat label={t('wallet:assetDetail.market.high', 'Hoch')}>{fmt.price(stats.high)}</Stat>
          <Stat label={t('wallet:assetDetail.market.low', 'Tief')}>{fmt.price(stats.low)}</Stat>
          <Stat label={t('wallet:assetDetail.market.trades', 'Trades')}>{fmt.amount(stats.trades)}</Stat>
        </dl>
      ) : null}
      {stats && stats.changeBase === 'firstTrade' && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400" data-testid={`asset-market-${key}-firsttrade`}>
          {t('wallet:assetDetail.market.changeSinceFirst', 'Änderung seit dem ersten Handel im Zeitraum (davor kein Handel bekannt).')}
        </p>
      )}
      {stats ? null : (
        <p className="text-sm text-gray-600 dark:text-gray-300">{market.data?.statsError ? unavailable : noTrade}</p>
      )}
    </div>
  );

  const bookSide = (rows, side) => (
    <div className="min-w-0" data-testid={`asset-orderbook-${side}`}>
      <div className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
        {side === 'bids'
          ? t('wallet:assetDetail.market.book.bids', { count: levels(ob?.bidCount ?? 0, ob?.bidCountCapped), defaultValue: 'Kaufangebote ({{count}} Preisstufen)' })
          : t('wallet:assetDetail.market.book.asks', { count: levels(ob?.askCount ?? 0, ob?.askCountCapped), defaultValue: 'Verkaufsangebote ({{count}} Preisstufen)' })}
      </div>
      {rows.length ? (
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="py-1 font-medium">{t('wallet:assetDetail.market.book.price', 'Preis (XLM)')}</th>
              <th className="py-1 font-medium">{t('wallet:assetDetail.market.book.amount', { code, defaultValue: 'Menge ({{code}})' })}</th>
              <th className="py-1 font-medium">{t('wallet:assetDetail.market.book.total', 'Summe (XLM)')}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => (
              <tr key={`${r.price}-${r.amount}`}>
                <td className={`py-0.5 ${side === 'bids' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{fmt.price(r.price)}</td>
                <td className="py-0.5">{fmt.amount(r.amount)}</td>
                <td className="py-0.5">{fmt.amount(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:assetDetail.market.book.empty', 'Keine Angebote')}</p>
      )}
    </div>
  );

  return (
    <section className={cardCls} data-testid="asset-market">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('wallet:assetDetail.market.title', { code, defaultValue: 'Kurs {{code}} in XLM' })}</h2>
        <button type="button" className={btnCls} onClick={market.reload} disabled={market.loading} data-testid="asset-market-reload">
          {market.loading ? t('wallet:assetDetail.market.loading', 'Lädt …') : t('wallet:assetDetail.market.reload', 'Aktualisieren')}
        </button>
      </div>

      {market.error && (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">{t('wallet:assetDetail.market.loadError', 'Marktdaten konnten nicht geladen werden.')}</p>
      )}
      {(market.rateLimited || data?.rateLimited) && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100" role="status" data-testid="asset-market-rate-limited">
          {t('wallet:assetDetail.market.rateLimited', 'Horizon begrenzt gerade die Anfragen von deiner Verbindung, ein Teil der Marktdaten fehlt deshalb. Bitte in einigen Minuten aktualisieren.')}
        </p>
      )}
      {!data && market.loading && (
        <p className="text-sm text-gray-600 dark:text-gray-300" aria-busy="true">{t('wallet:assetDetail.market.loading', 'Lädt …')}</p>
      )}

      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('wallet:assetDetail.market.lastTrade', 'Letzter Handel')}</div>
              <div className="font-mono text-2xl font-semibold text-gray-900 dark:text-white" data-testid="asset-market-last">
                {data.lastTrade ? `${fmt.price(data.lastTrade.price)} XLM` : (data.lastTradeError ? t('wallet:assetDetail.market.unavailable', 'nicht verfügbar') : noTrade)}
              </div>
              {data.lastTrade?.at && <div className="text-xs text-gray-500 dark:text-gray-400">{fmt.date(data.lastTrade.at)}</div>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              <Stat label={t('wallet:assetDetail.market.mid', 'Orderbuch-Mitte')} testId="asset-market-mid">
                {data.orderbookError ? unavailable : ob?.mid != null ? `${fmt.price(ob.mid)} XLM` : t('wallet:assetDetail.market.noOffers', 'kein Angebot')}
              </Stat>
              <Stat label={t('wallet:assetDetail.market.spread', 'Spread')} testId="asset-market-spread">
                {data.orderbookError ? unavailable : ob?.spreadPct != null ? fmt.pctPlain(ob.spreadPct) : '–'}
              </Stat>
              <Stat label={t('wallet:assetDetail.market.sendOne', { code, defaultValue: 'Tausch 1 {{code}} ergibt jetzt' })} testId="asset-market-send-one">
                {data.sendOneError ? unavailable : data.sendOne != null ? `${fmt.price(data.sendOne)} XLM` : t('wallet:assetDetail.market.noPath', 'kein Pfad')}
              </Stat>
            </dl>
          </div>

          {balanceNum != null && Number.isFinite(balanceNum) && (
            <p className="text-sm text-gray-700 dark:text-gray-200" data-testid="asset-market-holding">
              {ref.price != null
                ? t('wallet:assetDetail.market.holding', { amount: fmt.amount(balanceNum), code, value: fmt.amount(balanceNum * ref.price), defaultValue: 'Dein Bestand {{amount}} {{code}} entspricht zur Orderbuch-Mitte etwa {{value}} XLM. Ein Verkauf der ganzen Menge kann weniger ergeben.' })
                : t(`wallet:assetDetail.market.holdingNo.${ref.reason || 'none'}`)}
            </p>
          )}

          {ob?.thin && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100" data-testid="asset-market-thin">
              {t('wallet:assetDetail.market.thin', 'Das Orderbuch für dieses Paar ist dünn: wenige Angebote oder ein großer Abstand zwischen Kauf- und Verkaufspreis. Schon kleine Aufträge können den Kurs stark bewegen.')}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {statBlock(data.stats24h, '24h', t('wallet:assetDetail.market.last24h', 'Letzte 24 Stunden'))}
            {statBlock(data.stats7d, '7d', t('wallet:assetDetail.market.last7d', 'Letzte 7 Tage'))}
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('wallet:assetDetail.market.chart.title', 'Kursverlauf (XLM)')}</h3>
              <div className="inline-flex rounded-sm border border-gray-300 p-0.5 text-xs dark:border-gray-600" role="group" aria-label={t('wallet:assetDetail.market.range.label', 'Zeitraum')}>
                {ranges.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={market.range === key}
                    onClick={() => market.setRange(key)}
                    className={`rounded-sm px-2 py-0.5 font-medium ${market.range === key ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {market.seriesLoading ? (
              <p className="text-sm text-gray-600 dark:text-gray-300" aria-busy="true">{t('wallet:assetDetail.market.loading', 'Lädt …')}</p>
            ) : market.seriesError ? (
              <p className="text-sm text-gray-600 dark:text-gray-300">{t('wallet:assetDetail.market.unavailable', 'nicht verfügbar')}</p>
            ) : (
              <PriceChart series={market.series} fmtPrice={fmt.price} fmtXlm={fmt.amount} rangeLabel={rangeLabel} code={code} dateTimeFormat={fmt.date} />
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{t('wallet:assetDetail.market.book.title', 'Orderbuch')}</h3>
            {ob ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {bookSide(ob.bids, 'bids')}
                {bookSide(ob.asks, 'asks')}
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">{t('wallet:assetDetail.market.unavailable', 'nicht verfügbar')}</p>
            )}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('wallet:assetDetail.market.disclaimer', 'Kurse vom Stellar-DEX und aus Liquidity Pools laut Horizon, keine Bewertung des Tokens. Der Richtkurs ist der letzte Handel, ohne Handel die Orderbuch-Mitte; größere Beträge können zu einem schlechteren Kurs ausgeführt werden. Kennzahlen aus Stundenwerten, deshalb können sie leicht von anderen Seiten abweichen.')}
            {' '}
            {t('wallet:assetDetail.market.updated', { time: fmt.date(data.loadedAt), defaultValue: 'Stand {{time}}.' })}
          </p>
        </div>
      )}
    </section>
  );
}
