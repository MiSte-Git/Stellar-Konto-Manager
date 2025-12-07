import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getHorizonServer } from '../utils/stellar/stellarUtils.js';
import { useSettings } from '../utils/useSettings.js';
import { buildExplorerUrl } from '../utils/stellar/accountUtils.js';

const HORIZON_MAIN = 'https://horizon.stellar.org';
const HORIZON_TEST = 'https://horizon-testnet.stellar.org';

export default function BalancePage({ publicKey }) {
const { t, i18n } = useTranslation(['common']);
const { decimalsMode, explorers: explorerList, defaultExplorerKey } = useSettings();
const [netLabel, setNetLabel] = useState(() => {
  try { return (localStorage.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC'; } catch { return 'PUBLIC'; }
});
const [balances, setBalances] = useState([]);
const [payments, setPayments] = useState([]);
const [paymentsLimit, setPaymentsLimit] = useState('100'); // 'all' | number as string
const [paymentsMemoQuery, setPaymentsMemoQuery] = useState('');
const [paymentsCounterpartyQuery, setPaymentsCounterpartyQuery] = useState('');
const [error, setError] = useState('');
const [loading, setLoading] = useState(false);
const [fromTs, setFromTs] = useState(''); // datetime-local
const [toTs, setToTs] = useState('');
const [balSort, setBalSort] = useState({ key: 'code', dir: 'asc' });
const [paySort, setPaySort] = useState({ key: 'date', dir: 'desc' });
const [selectedExplorerKey, setSelectedExplorerKey] = useState(() => {
  if (defaultExplorerKey) return defaultExplorerKey;
  if (explorerList && explorerList.length > 0) return explorerList[0].key;
  return '';
});
 
  const server = useMemo(
    () => getHorizonServer(netLabel === 'TESTNET' ? HORIZON_TEST : HORIZON_MAIN),
    [netLabel]
  );

  // Fetch missing memos for displayed payments
  const [memoMap, setMemoMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    async function fetchMemos() {
      const missing = [];
      const seen = new Set();
      for (const op of payments) {
        const hash = op.transaction_hash;
        const embedded = op.transaction;
        const memo = embedded?.memo || embedded?.memo_text;
        if (!hash) continue;
        if (memoMap[hash] || memo) continue;
        if (!seen.has(hash)) { seen.add(hash); missing.push(hash); }
      }
      const limit = missing.slice(0, 50);
      const concurrency = 4;
      let idx = 0;
      async function worker() {
        while (idx < limit.length && !cancelled) {
          const cur = limit[idx++];
          try {
            const tx = await server.transactions().transaction(cur).call();
            const m = tx?.memo || tx?.memo_text || '';
            if (!cancelled) setMemoMap(prev => (prev[cur] ? prev : { ...prev, [cur]: m }));
          } catch {
            if (!cancelled) setMemoMap(prev => (prev[cur] ? prev : { ...prev, [cur]: '' }));
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker));
    }
    if (payments && payments.length) fetchMemos();
    return () => { cancelled = true; };
  }, [payments, server, memoMap]);

  const nf = useMemo(() => {
    const digits = decimalsMode === 'auto' ? undefined : Number(decimalsMode);
    const opts = digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
    try {
      return new Intl.NumberFormat(i18n.language || undefined, opts);
    } catch {
      return new Intl.NumberFormat(undefined, opts);
    }
  }, [decimalsMode, i18n.language]);

  useEffect(() => {
    if (!selectedExplorerKey && explorerList?.length) {
      setSelectedExplorerKey(defaultExplorerKey || explorerList[0].key);
    }
  }, [selectedExplorerKey, explorerList, defaultExplorerKey]);
  const clearMemoFilter = () => setPaymentsMemoQuery('');
  const clearCounterpartyFilter = () => setPaymentsCounterpartyQuery('');
  const clearAllPaymentFilters = () => {
    setPaymentsMemoQuery('');
    setPaymentsCounterpartyQuery('');
    setFromTs('');
    setToTs('');
  };

  // listen to global network changes
  useEffect(() => {
    const handler = (e) => {
      try {
        const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('SKM_NETWORK') || 'PUBLIC');
        setNetLabel(v === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
      } catch { /* noop */ }
    };
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  const fmt = (val) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return String(val ?? '');
    return nf.format(n);
  };
  useEffect(() => {
  let cancelled = false;
  async function load() {
  if (!publicKey) return;
  setLoading(true);
  setError('');
  try {
  const account = await server.loadAccount(publicKey);

  // Load payments with pagination based on paymentsLimit
  let all = [];
  let page = await server
  .payments()
  .forAccount(publicKey)
    .order('desc')
  .limit(200)
  .join('transactions')
    .call();
    const max = paymentsLimit === 'all' ? Infinity : Math.max(0, Number(paymentsLimit) || 0);
  while (true) {
      if (cancelled) break;
    all = all.concat(page.records || []);
      if (all.length >= max) break;
        if (!page.next) break;
        page = await page.next();
        if (!page || !page.records || page.records.length === 0) break;
        }
        if (!cancelled) {
          setBalances(account.balances || []);
          setPayments(max === Infinity ? all : all.slice(0, max));
        }
      } catch (e) {
      if (!cancelled) {
      setError(String(e?.message || e));
      if (netLabel === 'TESTNET') {
      // Wenn im Testnet das Konto nicht existiert: Tabellen leeren
      setBalances([]);
      setPayments([]);
      }
      }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [publicKey, server, paymentsLimit, netLabel]);

  const selectedExplorer = useMemo(() => {
    return (explorerList || []).find((e) => e.key === selectedExplorerKey) || (explorerList && explorerList[0]) || null;
  }, [explorerList, selectedExplorerKey]);
  const txUrlFor = (hash) => {
    if (!hash || !selectedExplorer) return '';
    return buildExplorerUrl(selectedExplorer, hash, netLabel, { type: 'tx' });
  };
  const passesPaymentFilters = useCallback((op) => {
    if (!op) return false;
    const ts = Date.parse(op.created_at || '');
    if (fromTs) {
      const f = Date.parse(fromTs);
      if (!Number.isNaN(f) && ts < f) return false;
    }
    if (toTs) {
      const tlim = Date.parse(toTs);
      if (!Number.isNaN(tlim) && ts > tlim) return false;
    }
    const memoQuery = paymentsMemoQuery.trim().toLowerCase();
    if (memoQuery) {
      const txMemo = op.transaction?.memo || op.transaction?.memo_text || memoMap[op.transaction_hash];
      const memoCandidates = [
        txMemo,
        op.memo,
        op.transaction?.memo_type && op.transaction.memo_type !== 'none' ? op.transaction.memo_type : '',
        op.transaction_hash,
      ];
      const memoMatch = memoCandidates.some((m) => m && String(m).toLowerCase().includes(memoQuery));
      if (!memoMatch) return false;
    }
    const counterpartyQuery = paymentsCounterpartyQuery.trim().toLowerCase();
    if (counterpartyQuery) {
      const parties = [
        op.to,
        op.to_account,
        op.destination,
        op.account,
        op.from,
        op.from_account,
        op.source_account,
        op.funder,
      ];
      const partyMatch = parties.some((p) => p && String(p).toLowerCase().includes(counterpartyQuery));
      if (!partyMatch) return false;
    }
    return true;
  }, [fromTs, toTs, paymentsMemoQuery, paymentsCounterpartyQuery, memoMap]);
  const filteredPayments = useMemo(() => (payments || []).filter(passesPaymentFilters), [payments, passesPaymentFilters]);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-semibold">{t('common:balance.title')}</h2>
      </div>

      {!publicKey && (
        <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
          {t('common:balance.noPublicKey')}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded border p-3 flex flex-wrap items-center gap-4 mb-4">

        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={()=>document.getElementById('payments')?.scrollIntoView({ behavior:'smooth' })} className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-800">
            {t('common:balance.buttons.payments')}
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">{t('common:common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {publicKey && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">{t('common:balance.current')}</h3>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                XLM: {fmt((balances.find(b=>b.asset_type==='native')||{}).balance || '0')}
              </div>
            </div>
            {/* Desktop: Tabelle mit horizontal scroll */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1 pr-2 cursor-pointer select-none" onClick={()=>setBalSort(s=>({key:'code', dir: s.key==='code' && s.dir==='asc' ? 'desc':'asc'}))}>
                      {t('common:asset.code', 'Asset code')} {balSort.key==='code' ? (balSort.dir==='asc' ? '▲' : '▼') : '↕'}
                    </th>
                    <th className="py-1 pr-2 cursor-pointer select-none" onClick={()=>setBalSort(s=>({key:'issuer', dir: s.key==='issuer' && s.dir==='asc' ? 'desc':'asc'}))}>
                      {t('common:asset.issuer', 'Issuer')} {balSort.key==='issuer' ? (balSort.dir==='asc' ? '▲' : '▼') : '↕'}
                    </th>
                    <th className="py-1 pr-2 cursor-pointer select-none" onClick={()=>setBalSort(s=>({key:'balance', dir: s.key==='balance' && s.dir==='asc' ? 'desc':'asc'}))}>
                      {t('common:asset.balance', 'Balance')} {balSort.key==='balance' ? (balSort.dir==='asc' ? '▲' : '▼') : '↕'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...balances]
                    .map(b => ({
                      code: b.asset_type === 'native' ? 'XLM' : b.asset_code,
                      issuer: b.asset_type === 'native' ? '-' : b.asset_issuer,
                      balance: b.balance
                    }))
                    .sort((a,b)=>{
                      const dir = balSort.dir === 'asc' ? 1 : -1;
                      if (balSort.key === 'code') return a.code.localeCompare(b.code) * dir;
                      if (balSort.key === 'issuer') return a.issuer.localeCompare(b.issuer) * dir;
                      if (balSort.key === 'balance') return (Number(a.balance)-Number(b.balance)) * dir;
                      return 0;
                    })
                    .map((b, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2">{b.code}</td>
                      <td className="py-1 pr-2 font-mono text-xs break-all">{b.issuer}</td>
                      <td className="py-1 pr-2">{fmt(b.balance)}</td>
                    </tr>
                  ))}
                  {balances.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-2 text-gray-500">{t('common:balance.empty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Mobile: Karten-Layout */}
            <div className="sm:hidden space-y-2">
              {[...balances]
                .map(b => ({
                  code: b.asset_type === 'native' ? 'XLM' : b.asset_code,
                  issuer: b.asset_type === 'native' ? '-' : b.asset_issuer,
                  balance: b.balance
                }))
                .sort((a,b)=>{
                  const dir = balSort.dir === 'asc' ? 1 : -1;
                  if (balSort.key === 'code') return a.code.localeCompare(b.code) * dir;
                  if (balSort.key === 'issuer') return a.issuer.localeCompare(b.issuer) * dir;
                  if (balSort.key === 'balance') return (Number(a.balance)-Number(b.balance)) * dir;
                  return 0;
                })
                .map((b, i) => (
                  <div key={i} className="border rounded p-3 bg-white dark:bg-gray-800">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold">{b.code}</span>
                      <span className="text-lg">{fmt(b.balance)}</span>
                    </div>
                    {b.issuer !== '-' && (
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-semibold">{t('common:asset.issuer', 'Issuer')}:</span>
                        <div className="font-mono break-all mt-1">{b.issuer}</div>
                      </div>
                    )}
                  </div>
                ))}
              {balances.length === 0 && (
                <div className="py-4 text-center text-gray-500">{t('common:balance.empty')}</div>
              )}
            </div>
          </div>

          <div id="payments" className="bg-white dark:bg-gray-800 rounded border p-4 mb-4">
            <h3 className="font-semibold mb-2">{t('common:balance.payments.title')}</h3>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm">{t('common:balance.payments.limit')}</label>
                  <select className="border rounded px-2 py-1" value={paymentsLimit} onChange={(e) => setPaymentsLimit(e.target.value)}>
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="all">{t('common:balance.payments.all')}</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm">{t('common:balance.payments.from')}</label>
                  <input type="datetime-local" className="border rounded px-2 py-1" value={fromTs} onChange={(e)=>setFromTs(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm">{t('common:balance.payments.to')}</label>
                  <input type="datetime-local" className="border rounded px-2 py-1" value={toTs} onChange={(e)=>setToTs(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm">{t('common:balance.payments.filter.memo')}</label>
                  <div className="flex items-center gap-1">
                    <input type="text" className="border rounded px-2 py-1" value={paymentsMemoQuery} placeholder={t('common:balance.payments.filter.memoPlaceholder')} onChange={(e)=>setPaymentsMemoQuery(e.target.value)} />
                    {paymentsMemoQuery ? (
                      <button
                        type="button"
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={clearMemoFilter}
                      >
                        {t('common:balance.payments.filter.clear', 'Löschen')}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label className="text-sm">{t('common:balance.payments.filter.counterparty')}</label>
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      type="text"
                      className="border rounded px-2 py-1 w-full"
                      value={paymentsCounterpartyQuery}
                      placeholder={t('common:balance.payments.filter.counterpartyPlaceholder')}
                      onChange={(e) => setPaymentsCounterpartyQuery(e.target.value)}
                    />
                    {paymentsCounterpartyQuery ? (
                      <button
                        type="button"
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={clearCounterpartyFilter}
                      >
                        {t('common:balance.payments.filter.clear', 'Löschen')}
                      </button>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="ml-auto px-3 py-1 text-xs border rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={clearAllPaymentFilters}
                >
                  {t('common:balance.payments.filter.resetAll', 'Alle Filter löschen')}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto"><table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1 pr-2 cursor-pointer select-none" onClick={()=>setPaySort(s=>({key:'date', dir:s.key==='date' && s.dir==='asc'?'desc':'asc'}))}>
                    {t('common:balance.payments.columns.date')} {paySort.key==='date' ? (paySort.dir==='asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th className="py-1 pr-2 cursor-pointer select-none whitespace-nowrap" onClick={()=>setPaySort(s=>({key:'direction', dir:s.key==='direction' && s.dir==='asc'?'desc':'asc'}))}>
                    <span className="inline-flex items-center gap-1">{t('common:balance.payments.columns.direction')}<span>{paySort.key==='direction' ? (paySort.dir==='asc' ? '▲' : '▼') : '↕'}</span></span>
                  </th>
                  <th className="py-1 pr-2 cursor-pointer select-none whitespace-nowrap" onClick={()=>setPaySort(s=>({key:'type', dir:s.key==='type' && s.dir==='asc'?'desc':'asc'}))}>
                    <span className="inline-flex items-center gap-1">{t('common:balance.payments.columns.type')}<span>{paySort.key==='type' ? (paySort.dir==='asc' ? '▲' : '▼') : '↕'}</span></span>
                  </th>
                  <th className="py-1 pr-2 cursor-pointer select-none whitespace-nowrap" onClick={()=>setPaySort(s=>({key:'asset', dir:s.key==='asset' && s.dir==='asc'?'desc':'asc'}))}>
                    <span className="inline-flex items-center gap-1">{t('common:balance.payments.columns.asset')}<span>{paySort.key==='asset' ? (paySort.dir==='asc' ? '▲' : '▼') : '↕'}</span></span>
                  </th>
                  <th className="py-1 pr-2 cursor-pointer select-none whitespace-nowrap" onClick={()=>setPaySort(s=>({key:'amount', dir:s.key==='amount' && s.dir==='asc'?'desc':'asc'}))}>
                    <span className="inline-flex items-center gap-1">{t('common:balance.payments.columns.amount')}<span>{paySort.key==='amount' ? (paySort.dir==='asc' ? '▲' : '▼') : '↕'}</span></span>
                  </th>
                  <th className="py-1 pr-2 cursor-pointer select-none whitespace-nowrap" onClick={()=>setPaySort(s=>({key:'counterparty', dir:s.key==='counterparty' && s.dir==='asc'?'desc':'asc'}))}>
                    <span className="inline-flex items-center gap-1">{t('common:balance.payments.columns.counterparty')}<span>{paySort.key==='counterparty' ? (paySort.dir==='asc' ? '▲' : '▼') : '↕'}</span></span>
                  </th>
                  <th className="py-1 pr-2 cursor-pointer select-none whitespace-nowrap" onClick={()=>setPaySort(s=>({key:'memo', dir:s.key==='memo' && s.dir==='asc'?'desc':'asc'}))}>
                    <span className="inline-flex items-center gap-1">{t('common:balance.payments.columns.memo')}<span>{paySort.key==='memo' ? (paySort.dir==='asc' ? '▲' : '▼') : '↕'}</span></span>
                  </th>
                  <th className="py-1 pr-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      {t('common:balance.payments.columns.txLabel', 'Tx')}
                      <select
                        className="border rounded px-1 py-0.5 text-xs"
                        value={selectedExplorerKey}
                        onChange={(e)=>setSelectedExplorerKey(e.target.value)}
                      >
                        {(explorerList || []).map((exp) => (
                          <option key={exp.key} value={exp.key}>{exp.name}</option>
                        ))}
                        {(!explorerList || explorerList.length === 0) && (
                          <option value="" disabled>{t('common:balance.explorer.noneConfigured')}</option>
                        )}
                      </select>
                      <span
                        className="text-xs text-gray-500 cursor-help"
                        title={t('common:balance.explorer.settingsHint')}
                      >
                        ⓘ
                      </span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...filteredPayments]
                  .sort((a,b)=>{
                    const dir = paySort.dir==='asc' ? 1 : -1;
                    const get = (op, key) => {
                      if (key==='date') return Date.parse(op.created_at || 0) || 0;
                      if (key==='direction') {
                        const to = op.to || op.to_account || op.destination || op.account;
                        const isIncoming = (op.type==='create_account' ? (op.account === publicKey) : (to===publicKey));
                        return isIncoming ? 'in' : 'out';
                      }
                      if (key==='type') return op.type || '';
                      if (key==='asset') {
                        const isNative = op.asset_type === 'native' || op.dest_asset_type === 'native' || op.source_asset_type === 'native' || op.into_asset_type === 'native';
                        return isNative ? 'XLM' : (op.asset_code || op.dest_asset_code || op.source_asset_code || op.into_asset_code || '');
                      }
                      if (key==='amount') {
                        const amt = op.amount || op.amount_received || op.source_amount || op.dest_amount || op.starting_balance || '0';
                        return Number(amt);
                      }
                      if (key==='counterparty') {
                        const to = op.to || op.to_account || op.destination || op.account;
                        const from = op.from || op.from_account || op.source_account;
                        const isIncoming = (op.type==='create_account' ? (op.account === publicKey) : (to===publicKey));
                        return isIncoming ? (from || '') : (to || '');
                      }
                      if (key==='memo') {
                        const txMemo = op.transaction?.memo || op.transaction?.memo_text || memoMap[op.transaction_hash] || '';
                        const m = txMemo || (op.memo ? String(op.memo) : '') || (op.transaction?.memo_type && op.transaction.memo_type !== 'none' ? op.transaction.memo_type : '');
                        return String(m).toLowerCase();
                      }
                      return 0;
                    };
                    const av = get(a, paySort.key);
                    const bv = get(b, paySort.key);
                    if (typeof av === 'number' && typeof bv === 'number') return (av-bv)*dir;
                    return String(av).localeCompare(String(bv))*dir;
                  })
                  .filter(op => {
                  const ts = Date.parse(op.created_at || '');
                  if (fromTs) {
                    const f = Date.parse(fromTs);
                    if (!Number.isNaN(f) && ts < f) return false;
                  }
                  if (toTs) {
                    const tlim = Date.parse(toTs);
                    if (!Number.isNaN(tlim) && ts > tlim) return false;
                  }
                  if (paymentsMemoQuery && paymentsMemoQuery.trim()) {
                    const q = paymentsMemoQuery.trim().toLowerCase();
                    const txMemo = op.transaction?.memo || op.transaction?.memo_text || memoMap[op.transaction_hash] || '';
                    const memoLower = (txMemo || (op.memo ? String(op.memo) : '')).toLowerCase();
                    const txLower = String(op.transaction_hash || '').toLowerCase();
                    if (!(memoLower.includes(q) || txLower.includes(q))) return false;
                  }
                  return true;
                }).map((op, i) => {
                  const to = op.to || op.to_account || op.destination || op.account;
                  const from = op.from || op.from_account || op.source_account;
                  let direction = '';
                  if (op.type === 'create_account') {
                    direction = op.account === publicKey ? t('common:balance.payments.incoming') : (op.funder === publicKey ? t('common:balance.payments.outgoing') : '');
                  } else {
                    if (to === publicKey) direction = t('common:balance.payments.incoming');
                    else if (from === publicKey) direction = t('common:balance.payments.outgoing');
                  }
                  const amount = op.amount || op.amount_received || op.source_amount || op.dest_amount || op.starting_balance || '';
                  const isNative = op.asset_type === 'native' || op.dest_asset_type === 'native' || op.source_asset_type === 'native' || op.into_asset_type === 'native';
                  const asset = isNative ? 'XLM' : (op.asset_code || op.dest_asset_code || op.source_asset_code || op.into_asset_code || '');
                  const counterparty = direction === t('common:balance.payments.incoming') ? (from || '') : (to || '');
                  const txMemo = op.transaction?.memo || op.transaction?.memo_text || memoMap[op.transaction_hash] || '';
                  const memo = txMemo || (op.memo ? String(op.memo) : '') || (op.transaction?.memo_type && op.transaction.memo_type !== 'none' ? op.transaction.memo_type : '');
                  const date = op.created_at || '';
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2 whitespace-nowrap">{date.replace('T', ' ').replace('Z','')}</td>
                      <td className="py-1 pr-2">{direction}</td>
                      <td className="py-1 pr-2">{op.type}</td>
                      <td className="py-1 pr-2">{asset}</td>
                      <td className="py-1 pr-2">{fmt(amount)}</td>
                      <td className="py-1 pr-2 break-all">{counterparty}</td>
                      <td className="py-1 pr-2 break-all">{memo}</td>
                      <td className="py-1 pr-2 break-all">
                        {op.transaction_hash ? (
                          <a
                            href={txUrlFor(op.transaction_hash)}
                            target="_blank"
                            rel="noreferrer"
                            className={`text-blue-600 ${txUrlFor(op.transaction_hash) ? 'hover:underline' : 'opacity-50 pointer-events-none cursor-not-allowed'}`}
                          >
                            {op.transaction_hash}
                          </a>
                        ) : ''}
                      </td>
                    </tr>
                  );
                })}
                {(filteredPayments.length === 0) && (
                  <tr>
                    <td colSpan={8} className="py-2 text-gray-500">{t('common:balance.payments.empty')}</td>
                  </tr>
                )}
              </tbody>
            </table></div>
          </div>

        </>
      )}
    </div>
  );
}
