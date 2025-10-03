import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getHorizonServer, resolveOrValidatePublicKey } from '../utils/stellar/stellarUtils';
import { Asset, Keypair, Networks, Operation, TransactionBuilder, Memo, StrKey } from '@stellar/stellar-sdk';
import SecretKeyModal from '../components/SecretKeyModal';
import { useSettings } from '../utils/useSettings';
import trustedWallets from '../../settings/QSI_TrustedWallets.json';

export default function SendPaymentPage({ publicKey, onBack: _onBack, initial }) {
  const { t, i18n } = useTranslation();
  void _onBack;

  const [dest, setDest] = useState(initial?.recipient || '');
  const [amount, setAmount] = useState('');
  const [amountFocused, setAmountFocused] = useState(false);
  const [assetKey, setAssetKey] = useState('XLM'); // 'XLM' or 'CODE:ISSUER'
  const [memoType, setMemoType] = useState('text'); // 'none' | 'text' | 'id' | 'hash' | 'return'
  const [memoVal, setMemoVal] = useState('');
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [secretError, setSecretError] = useState('');
  const [status, setStatus] = useState('');
  const [sentInfo, setSentInfo] = useState(null);
  const [error, setError] = useState('');

  const [balances, setBalances] = useState(null); // array from account.balances
  const [accountInfo, setAccountInfo] = useState(null); // horizon account
  const [offersCount, setOffersCount] = useState(0);
  const [baseReserve, setBaseReserve] = useState(0.5); // default fallback
  const [showReserveInfo, setShowReserveInfo] = useState(false);

  const [netLabel, setNetLabel] = useState(() => {
    try { return (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC'; } catch { return 'PUBLIC'; }
  });
  const server = useMemo(() => getHorizonServer(), [netLabel]);
  const popupRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      try {
        const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('STM_NETWORK') || 'PUBLIC');
        setNetLabel(v === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
      } catch { /* noop */ }
    };
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);


  // Trusted wallet labels map
  const walletInfoMap = useMemo(() => {
    try {
      if (!trustedWallets?.wallets) return new Map();
      return new Map(trustedWallets.wallets.map(w => [w.address, { label: w.label, compromised: !!w.compromised, deactivated: !!w.deactivated }]));
    } catch {
      return new Map();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!publicKey) return;
      setError(''); setStatus('');
      try {
        const acct = await server.loadAccount(publicKey);
        if (cancelled) return;
        setAccountInfo(acct);
        setBalances(acct.balances || []);
        // offers count
        try {
          const offers = await server.offers().forAccount(publicKey).limit(1).call();
          const total = (offers?.records?.length || 0) < 1 ? 0 : (offers?.records?._embedded?.records?.length || offers.records.length); // horizon may not provide total easily
          // naive: follow next pages not needed just for count; approximate via first page length
          setOffersCount(total);
        } catch { setOffersCount(0); }
        // latest ledger base reserve
        try {
          const ledgers = await server.ledgers().order('desc').limit(1).call();
          const br = parseFloat((ledgers?.records?.[0]?.base_reserve_in_stroops || '5000000')) / 1e7;
          if (!Number.isNaN(br)) setBaseReserve(br);
        } catch { /* keep default */ }
      } catch (e) {
        if (!cancelled) setError(t('error.loadTrustlines') + ': ' + (e?.message || ''));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [publicKey, server, t]);

  // Close popup when clicking outside
  useEffect(() => {
    if (!showReserveInfo) return;
    const onDocClick = (e) => {
      try {
        if (popupRef.current && !popupRef.current.contains(e.target)) {
          setShowReserveInfo(false);
        }
      } catch { /* noop */ }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showReserveInfo]);

  const native = useMemo(() => (balances || []).find(b => b.asset_type === 'native') || { balance: '0', selling_liabilities: '0' }, [balances]);
  const trustlines = useMemo(() => (balances || []).filter(b => b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'), [balances]);
  const lpTrusts = useMemo(() => (balances || []).filter(b => b.asset_type === 'liquidity_pool_shares'), [balances]);

  // Zahlformat gemäß Settings
  const { decimalsMode } = useSettings();
  const amountFmt = useMemo(() => {
    const isAuto = decimalsMode === 'auto';
    const n = isAuto ? undefined : Math.max(0, Math.min(7, Number(decimalsMode)));
    return new Intl.NumberFormat(i18n.language || undefined, {
      minimumFractionDigits: isAuto ? 0 : n,
      maximumFractionDigits: isAuto ? 7 : n,
    });
  }, [i18n.language, decimalsMode]);

  const trustCount = trustlines.length;
  const lpCount = lpTrusts.length;
  const signerCount = Math.max(0, (accountInfo?.signers?.length || 1) - 1);
  const dataCount = Object.keys(accountInfo?.data_attr || {}).length;
  const sponsoring = Number(accountInfo?.num_sponsoring || 0);
  const sponsored = Number(accountInfo?.num_sponsored || 0);

  const reservedBase = baseReserve * 2;
  const reservedTrust = baseReserve * trustCount;
  const reservedLp = baseReserve * lpCount;
  const reservedOffers = baseReserve * offersCount;
  const reservedSigners = baseReserve * signerCount;
  const reservedData = baseReserve * dataCount;
  const reservedSponsor = baseReserve * sponsoring;
  const reservedSponsored = baseReserve * sponsored;
  const reservedTotal = Math.max(0, reservedBase + reservedTrust + reservedLp + reservedOffers + reservedSigners + reservedData + reservedSponsor - reservedSponsored);
  const xlmInOffers = parseFloat(native?.selling_liabilities || '0') || 0;
  const nativeBalance = parseFloat(native?.balance || '0') || 0;
  const availableXLM = Math.max(0, nativeBalance - reservedTotal - xlmInOffers);

  // Resolve recipient helpers
  const [resolvedAccount, setResolvedAccount] = useState('');
  const [resolvedFederation, setResolvedFederation] = useState('');
  const [recipientLabel, setRecipientLabel] = useState('');
  const [inputWasFederation, setInputWasFederation] = useState(false);
  useEffect(() => {
    let active = true;
    async function resolve() {
      try {
        const v = (dest || '').trim();
        setRecipientLabel('');
        if (!v) { setResolvedAccount(''); setResolvedFederation(''); setInputWasFederation(false); return; }
        if (v.includes('*')) {
          const acc = await resolveOrValidatePublicKey(v);
          if (!active) return;
          setResolvedAccount(acc);
          setResolvedFederation(v);
          setInputWasFederation(true);
          const info = walletInfoMap.get(acc);
          if (info?.label) setRecipientLabel(info.label);
        } else if (StrKey.isValidEd25519PublicKey(v)) {
          setResolvedAccount(v);
          setInputWasFederation(false);
          // Try reverse federation lookup via home_domain → stellar.toml → FEDERATION_SERVER
          try {
            const acct = await server.loadAccount(v);
            const domain = acct?.home_domain || acct?.homeDomain || '';
            if (domain) {
              try {
                const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
                const resp = await fetch(tomlUrl, { mode: 'cors' });
                const txt = await resp.text();
                const m = txt.match(/FEDERATION_SERVER\s*=\s*"([^"]+)"/i);
                const fedUrl = m && m[1] ? m[1] : null;
                if (fedUrl) {
                  const q = `${fedUrl}?q=${encodeURIComponent(v)}&type=id`;
                  const fr = await fetch(q, { mode: 'cors' });
                  if (fr.ok) {
                    const data = await fr.json();
                    const addr = data?.stellar_address || data?.stellar_address || '';
                    if (addr && active) setResolvedFederation(addr);
                  }
                }
              } catch { /* ignore reverse federation failures */ }
            }
          } catch { /* ignore account/home_domain issues */ }
          const info = walletInfoMap.get(v);
          if (info?.label) setRecipientLabel(info.label);
        } else {
          setResolvedAccount(''); setResolvedFederation(''); setInputWasFederation(false);
        }
      } catch {
        if (!active) return;
        setResolvedAccount(''); setResolvedFederation('');
      }
    }
    resolve();
    return () => { active = false; };
  }, [dest, walletInfoMap]);
 
  // Histories for inputs
  const [historyRecipients, setHistoryRecipients] = useState(() => { try { return JSON.parse(localStorage.getItem('stm.hist.recipients')||'[]'); } catch { return []; } });
  const [historyAmounts, setHistoryAmounts] = useState(() => { try { return JSON.parse(localStorage.getItem('stm.hist.amounts')||'[]'); } catch { return []; } });
  const [historyMemos, setHistoryMemos] = useState(() => { try { return JSON.parse(localStorage.getItem('stm.hist.memos')||'[]'); } catch { return []; } });
  const pushHistory = (key, val, setter, limit=15) => {
    try {
      const v = String(val||'').trim(); if (!v) return;
      setter(prev => {
        const next = [v, ...prev.filter(x => x !== v)].slice(0, limit);
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    } catch { /* noop */ }
  };
 
  const assetOptions = useMemo(() => {
    const opts = [{ key: 'XLM', label: 'XLM' }];
    for (const b of trustlines) {
      const key = `${b.asset_code}:${b.asset_issuer}`;
      // Anzeige nur der Asset-Bezeichnung (ohne Issuer)
      opts.push({ key, label: `${b.asset_code}`, title: `${b.asset_code}:${b.asset_issuer}` });
    }
    return opts;
  }, [trustlines]);

  // Update fields when donation is triggered again or initial changes
  useEffect(() => {
    try {
      if (!initial) return;
      if (initial.recipient) setDest(initial.recipient);
      if (initial.amount != null) setAmount(String(initial.amount));
      if (initial.memoText) { setMemoType('text'); setMemoVal(initial.memoText); }
    } catch { /* noop */ }
  }, [initial]);

  if (!publicKey) {
    return (
      <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
        {t('investedTokens.hintEnterPublicKey')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">{t('payment.send.title')}</h2>
      </div>

      {error && <div className="text-red-600 text-sm text-center">{error}</div>}
      {sentInfo && (
        <div className="text-sm bg-green-100 dark:bg-green-900/30 border border-green-300/60 text-green-800 dark:text-green-200 rounded p-3 max-w-4xl mx-auto">
          <div className="font-semibold mb-1">{t('payment.send.successShort', 'Erfolgreich gesendet')}</div>
          <div className="space-y-0.5">
            <div><span className="text-gray-600 dark:text-gray-400">{t('payment.send.recipient')}:</span> <span className="font-mono break-all">{sentInfo.recipient}</span></div>
            <div><span className="text-gray-600 dark:text-gray-400">{t('payment.send.amount')}:</span> {amountFmt.format(sentInfo.amount)} {sentInfo.asset}</div>
            <div><span className="text-gray-600 dark:text-gray-400">{t('payment.send.memo')}:</span> {sentInfo.memo || '-'}</div>
            {status && (<div><span className="text-gray-600 dark:text-gray-400">TX:</span> <span className="font-mono break-all">{status}</span></div>)}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded border p-4 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <label className="block text-sm">{t('payment.send.recipient')}</label>
          <div className="relative">
            <input className="border rounded w-full pr-8 px-2 py-1 text-base md:text-sm font-mono" list="hist-recipients" value={dest} onChange={(e)=>setDest(e.target.value)} onBlur={()=>pushHistory('stm.hist.recipients', dest, setHistoryRecipients)} placeholder="G... oder user*domain" />
            {dest && (
              <button type="button" onClick={()=>setDest('')} title={t('common.clear')} aria-label={t('common.clear')} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center">×</button>
            )}
            <datalist id="hist-recipients">
              {historyRecipients.map((v,i)=>(<option key={v+i} value={v} />))}
            </datalist>
          </div>
          {(resolvedFederation || recipientLabel) && (
            <div className="mt-1 text-xs text-gray-700 dark:text-gray-300 space-y-0.5">
              {resolvedFederation && (<div>Föderation: <span className="font-mono break-all">{resolvedFederation}</span></div>)}
              {resolvedFederation && resolvedAccount && inputWasFederation && (<div>Konto: <span className="font-mono break-all">{resolvedAccount}</span></div>)}
              {recipientLabel && (<div>Label: <span className="font-semibold">{recipientLabel}</span></div>)}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr] gap-3 mt-2">
          <div className="flex flex-col min-w-0">
          <label className="text-sm">{t('payment.send.amount')}</label>
          <div className="relative">
          <input type="text" inputMode="decimal" className="border rounded pr-8 px-2 py-1 text-base md:text-sm w-full appearance-none [-moz-appearance:textfield]" list="hist-amounts"
                  value={amountFocused ? amount : (amount ? amountFmt.format(Number(amount) || 0) : '')}
                  onFocus={()=>setAmountFocused(true)}
                  onBlur={()=>{ setAmountFocused(false); pushHistory('stm.hist.amounts', amount, setHistoryAmounts); }}
                  onChange={(e)=>{
                    let s = e.target.value || '';
                    s = s.replace(/,/g, '.');
                    s = s.replace(/[^0-9.]/g, '');
                    const i = s.indexOf('.');
                    if (i !== -1) s = s.slice(0, i+1) + s.slice(i+1).replace(/\./g, '');
                    setAmount(s);
                  }}
                />
          {amount && (
          <button type="button" onClick={()=>setAmount('')} title={t('common.clear')} aria-label={t('common.clear')} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center">×</button>
          )}
          <datalist id="hist-amounts">
          {historyAmounts.map((v,i)=>(<option key={v+i} value={v} />))}
          </datalist>
          </div>
          </div>
          <div className="flex flex-col min-w-0">
          <label className="text-sm">{t('payment.send.asset')}</label>
          <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={assetKey} onChange={(e)=>setAssetKey(e.target.value)}>
          {assetOptions.map(o => <option key={o.key} value={o.key} title={o.title || o.key}>{o.label}</option>)}
          </select>
          </div>
          </div>
          <div className="mt-1 flex items-center justify-between">
          <div className="relative">
          <button
          type="button"
          onClick={() => setShowReserveInfo(v => !v)}
          className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-green-600 text-white text-xs hover:bg-green-700"
          title={t('payment.send.reserved')}
          aria-label={t('payment.send.reserved')}
          >
          !
          </button>
          <span className="ml-2 text-xs text-gray-700 dark:text-gray-300 align-middle">{t('payment.send.reservedInline', { amount: amountFmt.format(reservedTotal) })}</span>
          {showReserveInfo && (
          <div ref={popupRef} className="absolute left-0 mt-2 w-80 z-40 bg-white dark:bg-gray-800 border rounded shadow-lg p-3 text-left">
          <div className="flex items-start justify-between">
          <div className="font-semibold mr-4">{t('payment.send.reserved')}</div>
          <button className="text-xs px-2 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700" onClick={()=>setShowReserveInfo(false)}>×</button>
          </div>
          <div className="text-lg font-bold mt-1">{amountFmt.format(reservedTotal)} XLM</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-2">
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.baseReserve')}</div><div>{amountFmt.format(baseReserve)} XLM</div>
              <div className="text-gray-600 dark:text-gray-400">{t('payment.send.extra')}</div><div>{amountFmt.format(reservedTotal - baseReserve*2)} XLM</div>
                <div className="text-gray-600 dark:text-gray-400">{t('payment.send.xlmInOffers')}</div><div>{amountFmt.format(xlmInOffers)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('payment.send.trustlines', { n: trustCount })}</div><div>{amountFmt.format(reservedTrust)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('payment.send.lpTrustlines')}</div><div>{amountFmt.format(reservedLp)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('payment.send.offers')}</div><div>{amountFmt.format(reservedOffers)} XLM</div>
                             <div className="text-gray-600 dark:text-gray-400">{t('payment.send.signers')}</div><div>{amountFmt.format(reservedSigners)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('payment.send.accountData')}</div><div>{amountFmt.format(reservedData)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('payment.send.sponsoring')}</div><div>{amountFmt.format(reservedSponsor)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('payment.send.sponsored')}</div><div>{amountFmt.format(reservedSponsored)} XLM</div>
                  </div>
                </div>
              )}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 ml-2 text-right">{t('payment.send.available')}: {amountFmt.format(availableXLM)} XLM</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div>
              <label className="block text-sm">{t('payment.send.memoType')}</label>
              <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={memoType} onChange={(e)=>setMemoType(e.target.value)}>
                <option value="none">{t('payment.send.memoTypes.none')}</option>
                <option value="text">{t('payment.send.memoTypes.text')}</option>
                <option value="id">{t('payment.send.memoTypes.id')}</option>
                <option value="hash">{t('payment.send.memoTypes.hash')}</option>
                <option value="return">{t('payment.send.memoTypes.return')}</option>
              </select>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t(`payment.send.memoTypes.info.${memoType}`)}</div>
            </div>
            <div>
              <label className="block text-sm">{t('payment.send.memo')}</label>
              <div className="relative">
                <input className="border rounded w-full pr-8 px-2 py-1 text-base md:text-sm" list="hist-memos" value={memoVal} onChange={(e)=>setMemoVal(e.target.value)} onBlur={()=>pushHistory('stm.hist.memos', memoVal, setHistoryMemos)} />
                {memoVal && (
                  <button type="button" onClick={()=>setMemoVal('')} title={t('common.clear')} aria-label={t('common.clear')} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center">×</button>
                )}
                <datalist id="hist-memos">
                  {historyMemos.map((v,i)=>(<option key={v+i} value={v} />))}
                </datalist>
              </div>
            </div>
          </div>

          <button className="mt-3 px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!dest || !amount || (Number(amount) || 0) <= 0} onClick={()=>{ setSentInfo(null); setStatus(''); try{window.dispatchEvent(new Event('stm-transaction-start'));}catch{}; setShowConfirmModal(true); }}>
            {t('payment.send.sendButton')}
          </button>
        </div>

      </div>
           </div>
      
       {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-md my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-2">{t('option.confirm.action.title')}</h3>
            <div className="text-sm space-y-1 mb-3">
              <div><span className="text-gray-600 dark:text-gray-400">{t('payment.send.recipient')}:</span> <span className="font-mono break-all">{dest}</span></div>
              <div><span className="text-gray-600 dark:text-gray-400">{t('payment.send.amount')}:</span> {amountFmt.format(Number(amount))} {(assetKey==='XLM'?'XLM':assetKey.split(':')[0])}</div>
              <div><span className="text-gray-600 dark:text-gray-400">{t('payment.send.memo')}:</span> {memoType==='none' || !memoVal ? '-' : memoVal}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700" onClick={()=>setShowConfirmModal(false)}>{t('option.cancel')}</button>
              <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={async ()=>{ setShowConfirmModal(false); try { const saved = sessionStorage.getItem(`stm.session.secret.${publicKey}`); if (saved) { await (async () => { const kp = Keypair.fromSecret(saved); if (kp.publicKey() !== publicKey) throw new Error('secretKey.mismatch'); const net = (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? Networks.TESTNET : Networks.PUBLIC; const acct = await server.loadAccount(publicKey); const feeStats = await server.feeStats(); const fee = Number(feeStats?.fee_charged?.mode || 100); const memoObj = (() => { const v = (memoVal || '').trim(); if (!v || memoType === 'none') return undefined; try { switch (memoType) { case 'text': return Memo.text(v); case 'id': return Memo.id(v); case 'hash': { const hex = v.replace(/^0x/i, ''); if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('query.invalidMemo'); return Memo.hash(Buffer.from(hex, 'hex')); } case 'return': { const hex = v.replace(/^0x/i, ''); if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('query.invalidMemo'); return Memo.return(Buffer.from(hex, 'hex')); } default: return undefined; } } catch { throw new Error('query.invalidMemo'); }})(); const builder = new TransactionBuilder(acct, { fee, networkPassphrase: net, memo: memoObj }); const resolvedDest = await resolveOrValidatePublicKey(dest); let asset; if (assetKey === 'XLM') asset = Asset.native(); else { const [code, issuer] = assetKey.split(':'); asset = new Asset(code, issuer); } builder.addOperation(Operation.payment({ destination: resolvedDest, amount: String(Number(amount)), asset })); const tx = builder.setTimeout(60).build(); tx.sign(kp); const res = await server.submitTransaction(tx); const hash = res.hash || res.id || ''; setStatus(hash); setSentInfo({ recipient: resolvedDest, amount: Number(amount), asset: (assetKey==='XLM' ? 'XLM' : (assetKey.split(':')[0] || '')), memo: (memoType==='none'||!memoVal) ? '' : memoVal }); } )(); } else { setShowSecretModal(true); } } catch (e) { setSecretError(''); setError(t('payment.send.error', { detail: e?.message || 'unknown' })); } }}>{t('option.yes')}</button>
            </div>
          </div>
        </div>
      )}

      {showSecretModal && (
        <SecretKeyModal
          errorMessage={secretError}
          onCancel={()=>{ setShowSecretModal(false); setSecretError(''); }}
          onConfirm={async (secret, remember) => {
            try {
              setError(''); setStatus('');
              const kp = Keypair.fromSecret(secret);
              if (kp.publicKey() !== publicKey) {
                setSecretError('secretKey.mismatch');
                return;
              }
              if (remember) {
                try {
                  sessionStorage.setItem(`stm.session.secret.${publicKey}`, secret);
                  // Notify global header that a session secret is now present
                  try { window.dispatchEvent(new CustomEvent('stm-session-secret-changed', { detail: { publicKey } })); } catch { /* noop */ }
                } catch { /* noop */ }
              }
              const net = (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? Networks.TESTNET : Networks.PUBLIC;
              const acct = await server.loadAccount(publicKey);
              const feeStats = await server.feeStats();
              const fee = Number(feeStats?.fee_charged?.mode || 100);
              const memoObj = (() => {
                const v = (memoVal || '').trim();
                if (!v || memoType === 'none') return undefined;
                try {
                  switch (memoType) {
                    case 'text':
                      return Memo.text(v);
                    case 'id':
                      return Memo.id(v);
                    case 'hash': {
                      const hex = v.replace(/^0x/i, '');
                      if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('query.invalidMemo');
                      return Memo.hash(Buffer.from(hex, 'hex'));
                    }
                    case 'return': {
                      const hex = v.replace(/^0x/i, '');
                      if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('query.invalidMemo');
                      return Memo.return(Buffer.from(hex, 'hex'));
                    }
                    default:
                      return undefined;
                  }
                } catch {
                  throw new Error('query.invalidMemo');
                }
              })();
              const builder = new TransactionBuilder(acct, { fee, networkPassphrase: net, memo: memoObj });
              const resolvedDest = await resolveOrValidatePublicKey(dest);
              let asset;
              if (assetKey === 'XLM') asset = Asset.native();
              else {
                const [code, issuer] = assetKey.split(':');
                asset = new Asset(code, issuer);
              }
              builder.addOperation(Operation.payment({ destination: resolvedDest, amount: String(Number(amount)), asset }));
              const tx = builder.setTimeout(60).build();
              tx.sign(kp);
              const res = await server.submitTransaction(tx);
              const hash = res.hash || res.id || '';
              setStatus(hash);
              setSentInfo({ recipient: resolvedDest, amount: Number(amount), asset: (assetKey==='XLM' ? 'XLM' : (assetKey.split(':')[0] || '')), memo: (memoType==='none'||!memoVal) ? '' : memoVal });
              setShowSecretModal(false);
            } catch (e) {
              setSecretError('');
              setError(t('payment.send.error', { detail: e?.message || 'unknown' }));
            }
          }}
        />
      )}
    </div>
  );
}
