import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchGroupfundByMemo, fetchInvestedPerToken } from '../services/investmentUtils';

/**
 * Zeigt zwei Sichten:
 *  - "Memos (Groupfund)": ausgehende XLM-Zahlungen mit Memo, gruppiert + Summe je Memo
 *  - "Token (gekaufte Menge)": Summen je Asset (CODE:ISSUER) aus Trades + eingehenden Asset-Payments
 * Alle sichtbaren Texte laufen über t().
 */
export default function InvestedTokensPanel({ publicKey }) {
  const { t } = useTranslation();
  const [view, setView] = useState('memo'); // 'memo' | 'token'
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  /** Lädt die Daten je nach Ansicht (Memo vs. Token) */
  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      let res = null;
      if (view === 'memo') {
        // Groupfund-Sicht: ausgehende XLM mit Memo (Memo-Gruppen + Summe XLM)
        res = await fetchGroupfundByMemo({ publicKey, limitPages: 5000 });
      } else {
        // Token-Sicht: Summen je Asset (CODE:ISSUER)
        res = await fetchInvestedPerToken({ publicKey, limitPages: 5000 });
      }
      setData(res);
    } catch (e) {
      // UI fängt den Fehler ab und übersetzt mit t()
      setData(null);
      setErr(e?.message || 'fetchInvestedTokens.failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (publicKey) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, view]);

  if (!publicKey) return <div className="p-3 text-sm">{t('investedTokens.hintEnterPublicKey')}</div>;

  return (
    <div className="p-4 space-y-3">
      {/* Auswahl der Ansicht + Reload */}
      <div className="flex items-center gap-2">
        <label className="text-sm">{t('investedTokens.view.label')}</label>
        <select
          className="border rounded px-2 py-1"
          value={view}
          onChange={(e) => setView(e.target.value)}
        >
          <option value="memo">{t('investedTokens.view.memo')}</option>
          <option value="token">{t('investedTokens.view.token')}</option>
        </select>
        <button
          className="ml-auto border rounded px-3 py-1"
          onClick={load}
          disabled={loading}
        >
          {loading ? t('common.loading') : t('common.refresh')}
        </button>
      </div>

      {err && <div className="text-red-600 text-sm">{t(err)}</div>}

      {/* Datenanzeige */}
      {data && view === 'memo' && (
        <div className="space-y-2">
          <div className="text-lg font-semibold">
            {t('investedTokens.total', { count: data.totalGroups })}
          </div>
          <ul className="text-sm list-disc pl-5">
            {data.items.slice(0, 100).map((it, idx) => (
              <li key={`${it.group}-${idx}`}>
                {t('investedTokens.item.memo', { memo: it.group, occurrences: it.occurrences })} — {t('investedTokens.value.xlm', { amount: it.totalAmount.toFixed(7) })}
              </li>
            ))}
          </ul>
          {data.items.length > 100 && (
            <div className="text-xs text-gray-500">
              {t('investedTokens.moreTruncated', { extra: data.items.length - 100 })}
            </div>
          )}
        </div>
      )}

      {data && view === 'token' && (
        <div className="space-y-2">
          <div className="text-lg font-semibold">
            {t('investedTokens.totalTokens', { count: data.totalTokens })}
          </div>
          <ul className="text-sm list-disc pl-5">
            {data.items.slice(0, 100).map((it, idx) => (
              <li key={`${it.group}-${idx}`}>
                {t('investedTokens.item.tokenShort', { token: it.group })} — {t('investedTokens.value.units', { amount: it.totalAmount })}
              </li>
            ))}
          </ul>
          {data.items.length > 100 && (
            <div className="text-xs text-gray-500">
              {t('investedTokens.moreTruncated', { extra: data.items.length - 100 })}
            </div>
          )}
          <div className="text-xs text-gray-500">
            {t('investedTokens.walletCapInfo')}
          </div>
        </div>
      )}
    </div>
  );
}
