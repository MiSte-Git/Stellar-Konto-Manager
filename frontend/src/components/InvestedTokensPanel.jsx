import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchGroupfundByMemo, fetchGroupfundByMemoCached, fetchInvestedPerToken } from '../utils/stellar/investmentUtils';
import trustedWallets from '../../settings/QSI_TrustedWallets.json';
import ProgressBar from './ProgressBar';
import { useSettings } from '../utils/useSettings';

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
  const [sortKey, setSortKey] = useState('memo'); // memo: 'memo' | 'occurrences' | 'amount' | 'destination' | 'label'; token: 'token' | 'amount' | 'issuer'
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  const { useCache, prefetchDays } = useSettings();

  // Map Zieladresse -> Info aus Settings-Datei (Label, compromised, deactivated)
  const walletInfoMap = useMemo(() => {
    try {
      if (!trustedWallets?.wallets) return new Map();
      return new Map(
        trustedWallets.wallets.map(w => [w.address, { label: w.label, compromised: !!w.compromised, deactivated: !!w.deactivated }])
      );
    } catch {
      return new Map();
    }
  }, []);

  useEffect(() => {
    // Reset Sortierung beim Wechsel der Ansicht
    if (view === 'memo') {
      setSortKey('memo');
      setSortDir('asc');
    } else {
      setSortKey('token');
      setSortDir('asc');
    }
  }, [view]);

  /** Lädt die Daten je nach Ansicht (Memo vs. Token) */
  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      let res = null;
      if (view === 'memo') {
        // Groupfund-Sicht: ausgehende XLM mit Memo (Memo-Gruppen + Summe XLM)
        if (useCache) {
          res = await fetchGroupfundByMemoCached({ publicKey, prefetchDays });
        } else {
          res = await fetchGroupfundByMemo({ publicKey, limitPages: 5000 });
        }
      } else {
        // Token-Sicht: Summen je Asset (CODE:ISSUER)
        res = await fetchInvestedPerToken({ publicKey, limitPages: 5000 });
      }
      setData(res);
    } catch (e) {
      // UI fängt den Fehler ab und übersetzt mit t()
      setData(null);
      setErr(e?.message || t('error.fetchInvestedTokens.failed'));
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
      {/* Auswahl der Ansicht + Aktionen */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">{t('investedTokens.view.label')}</label>
        <select
          className="border rounded px-2 py-1"
          value={view}
          onChange={(e) => setView(e.target.value)}
        >
          <option value="memo">{t('investedTokens.view.memo')}</option>
          <option value="token">{t('investedTokens.view.token')}</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="border rounded px-3 py-1"
            onClick={load}
            disabled={loading}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
          <button
            className="border rounded px-3 py-1"
            onClick={() => {
              try {
                if (!data?.items) return;
                if (view === 'memo') exportCsvMemo(); else exportCsvToken();
              } catch {}
            }}
          >
            {t('option.export.csv')}
          </button>
        </div>
      </div>

      {err && <div className="text-red-600 text-sm">{t(err)}</div>}

      {loading && (
        <div className="mt-2">
          <ProgressBar progress={null} phase={view === 'memo' ? 'scan_payments' : 'scan_tx'} />
        </div>
      )}

      {/* Datenanzeige */}
      {data && view === 'memo' && (() => {
        const rows = data.items.map((it) => {
          const addr = it.topDestination || '';
          const info = addr ? (walletInfoMap.get(addr) || {}) : {};
          const label = info.label || '';
          return {
            memo: it.group,
            occurrences: it.occurrences,
            amount: Number(it.totalAmount || 0),
            destination: addr,
            label: label,
            compromised: !!info.compromised,
            deactivated: !!info.deactivated,
          };
        });
        const sorted = [...rows].sort((a, b) => {
          const dir = sortDir === 'asc' ? 1 : -1;
          switch (sortKey) {
            case 'occurrences':
              return (a.occurrences - b.occurrences) * dir;
            case 'amount':
              return (a.amount - b.amount) * dir;
            case 'destination':
              return String(a.destination).localeCompare(String(b.destination)) * dir;
            case 'label':
              return String(a.label).localeCompare(String(b.label)) * dir;
            case 'compromised':
              return ((a.compromised === b.compromised) ? 0 : a.compromised ? 1 : -1) * dir;
            case 'deactivated':
              return ((a.deactivated === b.deactivated) ? 0 : a.deactivated ? 1 : -1) * dir;
            case 'memo':
            default:
              return String(a.memo).localeCompare(String(b.memo)) * dir;
          }
        });
        const onSort = (key) => {
          if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          else { setSortKey(key); setSortDir('asc'); }
        };
        return (
          <div className="space-y-2">
            <div className="text-lg font-semibold">
              {t('investedTokens.total', { count: sorted.length })}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('memo')}>{t('investedTokens.columns.memo')}</th>
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('occurrences')}>{t('investedTokens.columns.payments')}</th>
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('amount')}>{t('investedTokens.columns.amount')}</th>
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('destination')}>{t('investedTokens.columns.destination')}</th>
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('label')}>{t('investedTokens.columns.label')}</th>
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('compromised')}>{t('investedTokens.columns.compromised')}</th>
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('deactivated')}>{t('investedTokens.columns.deactivated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, idx) => (
                    <tr key={r.memo + idx} className={idx % 2 ? 'bg-gray-50 dark:bg-gray-800/40' : ''}>
                      <td className="px-2 py-1 whitespace-pre-wrap break-all">{r.memo}</td>
                      <td className="px-2 py-1">{r.occurrences}</td>
                      <td className="px-2 py-1">{r.amount.toFixed(7)} XLM</td>
                      <td className="px-2 py-1 font-mono break-all">{r.destination}</td>
                      <td className="px-2 py-1">{r.label}</td>
                      <td className="px-2 py-1">{r.compromised ? t('option.yes') : t('option.no')}</td>
                      <td className="px-2 py-1">{r.deactivated ? t('option.yes') : t('option.no')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {data && view === 'token' && (() => {
        const rows = data.items.map((it) => {
          const key = String(it.group || '');
          const idx = key.indexOf(':');
          const token = idx >= 0 ? key.slice(0, idx) : key;
          const issuer = idx >= 0 ? key.slice(idx + 1) : '';
          return {
            token,
            issuer,
            amount: Number(it.totalAmount || 0),
          };
        });
        const sorted = [...rows].sort((a, b) => {
          const dir = sortDir === 'asc' ? 1 : -1;
          switch (sortKey) {
            case 'issuer':
              return String(a.issuer).localeCompare(String(b.issuer)) * dir;
            case 'amount':
              return (a.amount - b.amount) * dir;
            case 'token':
            default:
              return String(a.token).localeCompare(String(b.token)) * dir;
          }
        });
        const onSort = (key) => {
          if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          else { setSortKey(key); setSortDir('asc'); }
        };
        return (
          <div className="space-y-2">
            <div className="text-lg font-semibold">
              {t('investedTokens.totalTokens', { count: sorted.length })}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('token')}>{t('investedTokens.columns.token')}</th>
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('amount')}>{t('investedTokens.columns.amount')}</th>
                    <th className="px-2 py-1 cursor-pointer" onClick={() => onSort('issuer')}>{t('investedTokens.columns.issuer')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, idx) => (
                    <tr key={r.token + r.issuer + idx} className={idx % 2 ? 'bg-gray-50 dark:bg-gray-800/40' : ''}>
                      <td className="px-2 py-1 break-all">{r.token}</td>
                      <td className="px-2 py-1">{r.amount}</td>
                      <td className="px-2 py-1 font-mono break-all">{r.issuer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-500">
              {t('investedTokens.walletCapInfo')}
            </div>
          </div>
        );
      })()}
    </div>
  );

  function exportCsvMemo() {
    if (!data?.items) return;
    const rows = data.items.map((it) => {
      const addr = it.topDestination || '';
      const info = addr ? (walletInfoMap.get(addr) || {}) : {};
      const label = info.label || '';
      const compromised = info.compromised ? 'YES' : 'NO';
      const deactivated = info.deactivated ? 'YES' : 'NO';
      return [it.group, it.occurrences, Number(it.totalAmount || 0).toFixed(7), addr, label, compromised, deactivated];
    });
    const header = [
      t('investedTokens.columns.memo'),
      t('investedTokens.columns.payments'),
      t('investedTokens.columns.amount'),
      t('investedTokens.columns.destination'),
      t('investedTokens.columns.label'),
      t('investedTokens.columns.compromised'),
      t('investedTokens.columns.deactivated'),
    ];
    downloadCsv([header, ...rows]);
  }

  function exportCsvToken() {
    if (!data?.items) return;
    const rows = data.items.map((it) => {
      const key = String(it.group || '');
      const idx = key.indexOf(':');
      const token = idx >= 0 ? key.slice(0, idx) : key;
      const issuer = idx >= 0 ? key.slice(idx + 1) : '';
      return [token, Number(it.totalAmount || 0), issuer];
    });
    const header = [
      t('investedTokens.columns.token'),
      t('investedTokens.columns.amount'),
      t('investedTokens.columns.issuer'),
    ];
    downloadCsv([header, ...rows]);
  }

  function downloadCsv(dataRows) {
    const escape = (val) => {
      const s = String(val ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const csv = dataRows.map((r) => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = view === 'memo' ? 'groupfund_by_memo.csv' : 'invested_per_token.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
