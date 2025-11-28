import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getHorizonServer, resolveOrValidatePublicKey } from '../utils/stellar/stellarUtils';
import { Asset, Keypair, Networks, Operation, TransactionBuilder, Memo, StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import SecretKeyModal from '../components/SecretKeyModal';
import { useSettings } from '../utils/useSettings';
import { useTrustedWallets } from '../utils/useTrustedWallets.js';
import { createWalletInfoMap, findWalletInfo } from '../utils/walletInfo.js';

export default function SendPaymentPage({ publicKey, onBack: _onBack, initial }) {
  const { t, i18n } = useTranslation();
  void _onBack;
  const { wallets } = useTrustedWallets();

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
  const [preflight, setPreflight] = useState({
    loading: false,
    err: '',
    destExists: true,
    activationRequired: false,
    minReserve: 0,
    desired: 0,
    adjusted: 0,
    willBump: false,
    resolvedDest: ''
  });

  const walletInfoMap = useMemo(() => createWalletInfoMap(wallets), [wallets]);

  const clearSuccess = useCallback(() => {
    setSentInfo(null);
    setStatus('');
  }, []);

  const [balances, setBalances] = useState(null); // array from account.balances
  const [accountInfo, setAccountInfo] = useState(null); // horizon account
  const [offersCount, setOffersCount] = useState(0);
  const [baseReserve, setBaseReserve] = useState(0.5); // default fallback
  const [showReserveInfo, setShowReserveInfo] = useState(false);

  const [netLabel, setNetLabel] = useState(() => {
    try { return (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC'; } catch { return 'PUBLIC'; }
  });
  const server = useMemo(() => {
    const url = netLabel === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org';
    return getHorizonServer(url);
  }, [netLabel]);
  const popupRef = useRef(null);

  const normalizeAmountValue = useCallback(() => {
    let raw = (amount || '').trim();
    if (raw.endsWith('.')) raw = raw.slice(0, -1);
    if (!raw) throw new Error(t('common:payment.send.amountMissing'));
    if (!/^\d+(\.\d{1,7})?$/.test(raw)) throw new Error(t('common:payment.send.amountInvalid'));
    const [intPartRaw, fracPartRaw = ''] = raw.split('.');
    const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
    const fracPart = fracPartRaw.replace(/0+$/, '');
    const normalized = fracPart ? `${intPart}.${fracPart}` : intPart;
    if (parseFloat(normalized) <= 0) throw new Error(t('common:payment.send.amountPositive'));
    return normalized;
  }, [amount, t]);

  const buildMemoObject = useCallback(() => {
    const value = (memoVal || '').trim();
    if (!value || memoType === 'none') {
      return { memo: undefined, display: '' };
    }
    try {
      switch (memoType) {
        case 'text':
          return { memo: Memo.text(value), display: value };
        case 'id':
          return { memo: Memo.id(value), display: value };
        case 'hash': {
          const hex = value.replace(/^0x/i, '');
          if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('invalid');
          return { memo: Memo.hash(Buffer.from(hex, 'hex')), display: value };
        }
        case 'return': {
          const hex = value.replace(/^0x/i, '');
          if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('invalid');
          return { memo: Memo.return(Buffer.from(hex, 'hex')), display: value };
        }
        default:
          return { memo: undefined, display: '' };
      }
    } catch {
      throw new Error(t('errors:query.invalidMemo'));
    }
  }, [memoType, memoVal, t]);

  const describeHorizonError = useCallback((err) => {
    const extras = err?.response?.data?.extras;
    if (extras?.result_codes) {
      const tx = extras.result_codes.transaction;
      const ops = extras.result_codes.operations;
      let codes = '';
      if (tx) codes = tx;
      if (ops) {
        const opText = Array.isArray(ops) ? ops.join(', ') : ops;
        codes = codes ? `${codes} / ${opText}` : opText;
      }
      return codes
        ? `${t('common:payment.send.horizonError')} (${codes})`
        : t('common:payment.send.horizonError');
    }
    const status = err?.response?.status;
    if (status === 504) return t('common:payment.send.timeout');
    if (typeof status === 'number') {
      return t('common:payment.send.httpError', { status });
    }
    return err?.message || 'unknown';
  }, [t]);

  const handlePaymentError = useCallback((err) => {
    console.error('Payment submission failed', err);
    const detail = describeHorizonError(err);
    setError(t('common:payment.send.error', { detail }));
    return detail;
  }, [describeHorizonError, t]);

  const applySendResult = useCallback((payload) => {
    setStatus(payload.hash);
    setSentInfo({
      account: publicKey,
      recipient: payload.recipient,
      amount: Number(payload.amountDisplay),
      amountDisplay: payload.amountDisplay,
      asset: payload.asset,
      memo: payload.memo,
      activated: !!payload.activated,
    });
  }, [publicKey]);

  const runPreflight = useCallback(async () => {
    try {
      setPreflight({
        loading: true,
        err: '',
        destExists: true,
        activationRequired: false,
        minReserve: 0,
        desired: 0,
        adjusted: 0,
        willBump: false,
        resolvedDest: ''
      });
      const v = (dest || '').trim();
      if (!v) {
        setPreflight(p => ({ ...p, loading: false, err: t('publicKey:destination.error') }));
        return;
      }
      let resolvedDest;
      try {
        resolvedDest = await resolveOrValidatePublicKey(v);
      } catch {
        setPreflight(p => ({ ...p, loading: false, err: t('publicKey:destination.error') }));
        return;
      }
      let desiredNum = 0;
      try {
        desiredNum = Number(normalizeAmountValue());
      } catch (e) {
        setPreflight(p => ({ ...p, loading: false, err: e?.message || t('common:payment.send.amountInvalid') }));
        return;
      }
      const minReserve = (baseReserve || 0.5) * 2;
      let destExists = true;
      try {
        await server.loadAccount(resolvedDest);
      } catch {
        destExists = false;
      }
      if (!destExists) {
        if (assetKey !== 'XLM') {
          setPreflight({
            loading: false,
            err: t('common:payment.send.destUnfundedNonNative', 'Destination account is not active. Please send XLM to activate it first or switch the asset to XLM.'),
            destExists,
            activationRequired: true,
            minReserve,
            desired: desiredNum,
            adjusted: desiredNum,
            willBump: false,
            resolvedDest
          });
          return;
        }
        const adjusted = Math.max(desiredNum, minReserve);
        setPreflight({
          loading: false,
          err: '',
          destExists,
          activationRequired: true,
          minReserve,
          desired: desiredNum,
          adjusted,
          willBump: adjusted > desiredNum,
          resolvedDest
        });
        return;
      }
      setPreflight({
        loading: false,
        err: '',
        destExists,
        activationRequired: false,
        minReserve,
        desired: desiredNum,
        adjusted: desiredNum,
        willBump: false,
        resolvedDest
      });
    } catch (e) {
      setPreflight(p => ({ ...p, loading: false, err: e?.message || 'unknown' }));
    }
  }, [assetKey, baseReserve, dest, normalizeAmountValue, server, t]);

  const submitPayment = useCallback(async (secret) => {
    const kp = Keypair.fromSecret(secret);
    if (kp.publicKey() !== publicKey) throw new Error(t('secretKey:mismatch'));
    const isTestnet = typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET';
    const net = isTestnet ? Networks.TESTNET : Networks.PUBLIC;
    const account = await server.loadAccount(publicKey);
    const feeStats = await server.feeStats();
    const fee = Number(feeStats?.fee_charged?.mode || 100);
    const { memo, display: memoDisplay } = buildMemoObject();
    let resolvedDest;
    try {
      resolvedDest = await resolveOrValidatePublicKey(dest);
    } catch (resolveError) {
      throw new Error(t(resolveError?.message || 'resolveOrValidatePublicKey.invalid'));
    }
    const paymentAmount = normalizeAmountValue();
    let asset;
    let assetLabel = 'XLM';
    if (assetKey === 'XLM') {
      asset = Asset.native();
    } else {
      const [code, issuer] = assetKey.split(':');
      asset = new Asset(code, issuer);
      assetLabel = code || 'XLM';
    }

    // Check if destination account exists; if not and sending XLM, auto-activate via createAccount
    let destExists = true;
    try {
      await server.loadAccount(resolvedDest);
    } catch {
      destExists = false;
    }

    let tx;
    let activated = false;
    if (!destExists) {
      if (assetKey !== 'XLM') {
        throw new Error(t('common:payment.send.destUnfundedNonNative', 'Destination account is not active. Please send XLM to activate it first or switch the asset to XLM.'));
      }
      // Ensure starting balance covers minimum reserve (2 * baseReserve), fallback baseReserve default is 0.5
      const desired = parseFloat(paymentAmount);
      const minStart = Math.max(desired, (baseReserve || 0.5) * 2);
      const startingBalance = (Math.round(minStart * 1e7) / 1e7).toFixed(7).replace(/\.0+$/, '');
      tx = new TransactionBuilder(account, { fee, networkPassphrase: net, memo })
        .addOperation(Operation.createAccount({ destination: resolvedDest, startingBalance }))
        .setTimeout(60)
        .build();
      activated = true;
      assetLabel = 'XLM';
    } else {
      tx = new TransactionBuilder(account, { fee, networkPassphrase: net, memo })
        .addOperation(Operation.payment({ destination: resolvedDest, amount: paymentAmount, asset }))
        .setTimeout(60)
        .build();
    }

    tx.sign(kp);
    const res = await server.submitTransaction(tx);
    const amountDisplayOut = activated ? (
      // Show the actual starting balance if we created the account
      (() => {
        const desired = parseFloat(paymentAmount);
        const minStart = Math.max(desired, (baseReserve || 0.5) * 2);
        return (Math.round(minStart * 1e7) / 1e7).toFixed(7).replace(/\.0+$/, '');
      })()
    ) : paymentAmount;
    return {
      hash: res.hash || res.id || '',
      recipient: resolvedDest,
      amountDisplay: amountDisplayOut,
      asset: assetLabel,
      memo: memoDisplay,
      activated,
    };
  }, [assetKey, baseReserve, buildMemoObject, dest, normalizeAmountValue, publicKey, server, t]);

  const handleStoredSecretSend = useCallback(async () => {
    setShowConfirmModal(false);
    try {
      setError('');
      setStatus('');
      const saved = sessionStorage.getItem(`stm.session.secret.${publicKey}`);
      if (saved) {
        const result = await submitPayment(saved);
        applySendResult(result);
        setSecretError('');
      } else {
        setSecretError('');
        setShowSecretModal(true);
      }
    } catch (err) {
      handlePaymentError(err);
    }
  }, [applySendResult, handlePaymentError, publicKey, submitPayment]);

  useEffect(() => {
    clearSuccess();
  }, [publicKey, initial, clearSuccess]);

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


  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!publicKey) return;
      setError('');
      clearSuccess();
      setStatus('');
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
        if (!cancelled) setError(t('common:error.loadTrustlines') + ': ' + (e?.message || ''));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [publicKey, server, t, clearSuccess]);

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
  const [inputWasFederation, setInputWasFederation] = useState(false);
  
  // Destination XLM balance state (resolved recipient account)
  const [destXlmBalance, setDestXlmBalance] = useState(undefined); // undefined = not resolved yet; null = unfunded/error; string = balance
  const [destXlmLoading, setDestXlmLoading] = useState(false);
  useEffect(() => {
    let active = true;
    async function resolve() {
      try {
        const v = (dest || '').trim();
        if (!v) { setResolvedAccount(''); setResolvedFederation(''); setInputWasFederation(false); return; }
        if (v.includes('*')) {
          const acc = await resolveOrValidatePublicKey(v);
          if (!active) return;
          setResolvedAccount(acc);
          setResolvedFederation(v);
          setInputWasFederation(true);
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
        } else {
          setResolvedAccount('');
          setResolvedFederation('');
          setInputWasFederation(false);
        }
      } catch {
        if (!active) return;
        setResolvedAccount('');
        setResolvedFederation('');
        setInputWasFederation(false);
      }
    }
    resolve();
    return () => { active = false; };
  }, [dest, server]);

  // Load destination account XLM balance for the resolved recipient
  useEffect(() => {
    let cancelled = false;
    async function loadDestBalance() {
      try {
        if (!resolvedAccount) {
          setDestXlmLoading(false);
          setDestXlmBalance(undefined);
          return;
        }
        setDestXlmLoading(true);
        try {
          const acct = await server.loadAccount(resolvedAccount);
          if (cancelled) return;
          const native = (acct?.balances || []).find(b => b.asset_type === 'native');
          setDestXlmBalance(native ? native.balance : null);
        } catch {
          if (!cancelled) setDestXlmBalance(null);
        } finally {
          if (!cancelled) setDestXlmLoading(false);
        }
      } catch {
        if (!cancelled) {
          setDestXlmLoading(false);
          setDestXlmBalance(null);
        }
      }
    }
    loadDestBalance();
    return () => { cancelled = true; };
  }, [resolvedAccount, server]);

  const trimmedRecipient = (dest || '').trim();
  const walletInfoFromInput = useMemo(() => findWalletInfo(walletInfoMap, trimmedRecipient), [walletInfoMap, trimmedRecipient]);
  const walletInfoFromAccount = useMemo(() => findWalletInfo(walletInfoMap, resolvedAccount), [walletInfoMap, resolvedAccount]);
  const effectiveRecipientInfo = walletInfoFromInput || walletInfoFromAccount;
  const recipientLabel = effectiveRecipientInfo?.label || '';
  const savedRecipientFederation = effectiveRecipientInfo?.federation || '';
  const recipientCompromised = !!effectiveRecipientInfo?.compromised;
  const recipientDeactivated = !!effectiveRecipientInfo?.deactivated;
  const recipientFederationDisplay = resolvedFederation || savedRecipientFederation || (trimmedRecipient && trimmedRecipient.includes('*') ? trimmedRecipient : '');
 
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
      clearSuccess();
      if (initial.recipient) setDest(initial.recipient);
      if (initial.amount != null) setAmount(String(initial.amount));
      if (initial.memoText) { setMemoType('text'); setMemoVal(initial.memoText); }
    } catch { /* noop */ }
  }, [initial, clearSuccess]);

  const sentAmountText = sentInfo
    ? sentInfo.amountDisplay || (Number.isFinite(sentInfo.amount) ? amountFmt.format(sentInfo.amount) : '')
    : '';

  if (!publicKey) {
    return (
      <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
        {t('investedTokens:hintEnterPublicKey')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">{t('common:payment.send.title')}</h2>
      </div>

      {error && <div className="text-red-600 text-sm text-center">{error}</div>}
      {sentInfo && sentInfo.account === publicKey && (
        <div className="text-sm bg-green-100 dark:bg-green-900/30 border border-green-300/60 text-green-800 dark:text-green-200 rounded p-3 max-w-4xl mx-auto">
          <div className="font-semibold mb-1">{t('common:payment.send.successShort', 'Erfolgreich gesendet')}</div>
          <div className="space-y-0.5">
            <div><span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.recipient')}:</span> <span className="font-mono break-all">{sentInfo.recipient}</span></div>
            <div><span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.amount')}:</span> {sentAmountText || '0'} {sentInfo.asset}</div>
            <div><span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.memo')}:</span> {sentInfo.memo || '-'}</div>
            {sentInfo.activated && (
              <div className="text-green-800 dark:text-green-200 font-medium">{t('common:payment.send.activated', 'The destination account was activated.')}</div>
            )}
            {status && (<div><span className="text-gray-600 dark:text-gray-400">TX:</span> <span className="font-mono break-all">{status}</span></div>)}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded border p-4 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <label className="block text-sm">{t('common:payment.send.recipient')}</label>
          <div className="relative">
            <input className="border rounded w-full pr-8 px-2 py-1 text-base md:text-sm font-mono" list="hist-recipients" value={dest} onChange={(e)=>{ clearSuccess(); setDest(e.target.value); }} onBlur={()=>pushHistory('stm.hist.recipients', dest, setHistoryRecipients)} placeholder="G... oder user*domain" />
            {dest && (
              <button type="button" onClick={()=>{ clearSuccess(); setDest(''); }} title={t('common:clear', 'Clear')} aria-label={t('common:clear', 'Clear')} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center">×</button>
            )}
            <datalist id="hist-recipients">
              {historyRecipients.map((v,i)=>(<option key={v+i} value={v} />))}
            </datalist>
          </div>
          <div className="mt-1 text-xs text-gray-700 dark:text-gray-300">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1">
              {/* Links: Empfänger-Infos linksbündig */}
              <div className="min-w-0 space-y-0.5 text-left">
                <div>
                  <span className="font-semibold">{t('wallet:federationDisplay.label', 'Föderationsadresse')}:</span>{' '}
                  {recipientFederationDisplay
                    ? <span className="font-mono break-all">{recipientFederationDisplay}</span>
                    : <span className="italic text-gray-500">{t('wallet:federationDisplay.none', 'Keine Föderationsadresse definiert')}</span>}
                </div>

                {resolvedFederation && resolvedAccount && inputWasFederation && (
                  <div>
                    <span className="font-semibold">{t('wallet:federationDisplay.account', 'Konto')}:</span>{' '}
                    <span className="font-mono break-all">{resolvedAccount}</span>
                  </div>
                )}

                {recipientLabel && (
                  <div>
                    <span className="font-semibold">{t('wallet:federationDisplay.accountLabel', 'Label')}:</span>{' '}
                    <span>{recipientLabel}</span>
                  </div>
                )}

                {recipientCompromised && (
                  <div className="text-red-600 dark:text-red-400 font-semibold">
                    {t('wallet:flag.compromised', 'Warning: This recipient is marked as compromised in your trusted list.')}
                  </div>
                )}
                {recipientDeactivated && (
                  <div className="text-amber-600 dark:text-amber-400 font-medium">
                    {t('wallet:flag.deactivated', 'Note: This recipient is marked as deactivated in your trusted list.')}
                  </div>
                )}
              </div>

              {/* Rechts: Ziel-XLM-Kontostand als Label, ohne Überlagerung */}
              <div className="text-right">
                <span className="font-semibold">{t('wallet:xlmBalance', 'XLM')}:</span>{' '}
                <span className="font-mono">
                  {destXlmLoading
                    ? t('common:common.loading', 'Loading…')
                    : (resolvedAccount
                        ? (destXlmBalance != null ? `${destXlmBalance}` : t('wallet:unfunded', 'Unfunded'))
                        : '—')}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr] gap-3 mt-2">
          <div className="flex flex-col min-w-0">
          <label className="text-sm">{t('common:payment.send.amount')}</label>
          <div className="relative">
          <input type="text" inputMode="decimal" className="border rounded pr-8 px-2 py-1 text-base md:text-sm w-full appearance-none [-moz-appearance:textfield]" list="hist-amounts"
                  value={amountFocused ? amount : (amount ? amountFmt.format(Number(amount) || 0) : '')}
                  onFocus={()=>setAmountFocused(true)}
                  onBlur={()=>{ setAmountFocused(false); pushHistory('stm.hist.amounts', amount, setHistoryAmounts); }}
                  onChange={(e)=>{
                    clearSuccess();
                    let s = e.target.value || '';
                    s = s.replace(/,/g, '.');
                    s = s.replace(/[^0-9.]/g, '');
                    const i = s.indexOf('.');
                    if (i !== -1) {
                      s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
                      const decimals = s.length - i - 1;
                      if (decimals > 7) s = s.slice(0, i + 1 + 7);
                    }
                    setAmount(s);
                  }}
                />
          {amount && (
          <button type="button" onClick={()=>{ clearSuccess(); setAmount(''); }} title={t('common:clear', 'Clear')} aria-label={t('common:clear', 'Clear')} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center">×</button>
          )}
          <datalist id="hist-amounts">
          {historyAmounts.map((v,i)=>(<option key={v+i} value={v} />))}
          </datalist>
          </div>
          </div>
          <div className="flex flex-col min-w-0">
          <label className="text-sm">{t('common:payment.send.asset')}</label>
          <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={assetKey} onChange={(e)=>{ clearSuccess(); setAssetKey(e.target.value); }}>
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
          title={t('common:payment.send.reserved')}
          aria-label={t('common:payment.send.reserved')}
          >
          !
          </button>
          <span className="ml-2 text-xs text-gray-700 dark:text-gray-300 align-middle">{t('common:payment.send.reservedInline', { amount: amountFmt.format(reservedTotal) })}</span>
          {showReserveInfo && (
          <div ref={popupRef} className="absolute left-0 mt-2 w-80 z-40 bg-white dark:bg-gray-800 border rounded shadow-lg p-3 text-left">
          <div className="flex items-start justify-between">
          <div className="font-semibold mr-4">{t('common:payment.send.reserved')}</div>
          <button className="text-xs px-2 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700" onClick={()=>setShowReserveInfo(false)}>×</button>
          </div>
          <div className="text-lg font-bold mt-1">{amountFmt.format(reservedTotal)} XLM</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-2">
            <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.baseReserve')}</div><div>{amountFmt.format(baseReserve)} XLM</div>
              <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.extra')}</div><div>{amountFmt.format(reservedTotal - baseReserve*2)} XLM</div>
                <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.xlmInOffers')}</div><div>{amountFmt.format(xlmInOffers)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.trustlines', { n: trustCount })}</div><div>{amountFmt.format(reservedTrust)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.lpTrustlines')}</div><div>{amountFmt.format(reservedLp)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.offers')}</div><div>{amountFmt.format(reservedOffers)} XLM</div>
                             <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.signers')}</div><div>{amountFmt.format(reservedSigners)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.accountData')}</div><div>{amountFmt.format(reservedData)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.sponsoring')}</div><div>{amountFmt.format(reservedSponsor)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.sponsored')}</div><div>{amountFmt.format(reservedSponsored)} XLM</div>
                  </div>
                </div>
              )}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 ml-2 text-right">{t('common:payment.send.available')}: {amountFmt.format(availableXLM)} XLM</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div>
              <label className="block text-sm">{t('common:payment.send.memoType')}</label>
              <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={memoType} onChange={(e)=>{ clearSuccess(); setMemoType(e.target.value); }}>
                <option value="none">{t('common:payment.send.memoTypes.none')}</option>
                <option value="text">{t('common:payment.send.memoTypes.text')}</option>
                <option value="id">{t('common:payment.send.memoTypes.id')}</option>
                <option value="hash">{t('common:payment.send.memoTypes.hash')}</option>
                <option value="return">{t('common:payment.send.memoTypes.return')}</option>
              </select>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t(`payment.send.memoTypes.info.${memoType}`)}</div>
            </div>
            <div>
              <label className="block text-sm">{t('common:payment.send.memo')}</label>
              <div className="relative">
                <input className="border rounded w-full pr-8 px-2 py-1 text-base md:text-sm" list="hist-memos" value={memoVal} onChange={(e)=>{ clearSuccess(); setMemoVal(e.target.value); }} onBlur={()=>pushHistory('stm.hist.memos', memoVal, setHistoryMemos)} />
                {memoVal && (
                  <button type="button" onClick={()=>{ clearSuccess(); setMemoVal(''); }} title={t('common:clear', 'Clear')} aria-label={t('common:clear', 'Clear')} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center">×</button>
                )}
                <datalist id="hist-memos">
                  {historyMemos.map((v,i)=>(<option key={v+i} value={v} />))}
                </datalist>
              </div>
            </div>
          </div>

          <button
            className="mt-3 px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={!dest || !amount || (Number(amount) || 0) <= 0}
            onClick={() => {
              clearSuccess();
              try {
                window.dispatchEvent(new Event('stm-transaction-start'));
              } catch (dispatchError) {
                console.debug('stm-transaction-start event failed', dispatchError);
              }
              setShowConfirmModal(true);
              setPreflight(p => ({ ...p, loading: true, err: '' }));
              void runPreflight();
            }}
          >
            {t('common:payment.send.sendButton')}
          </button>
        </div>

      </div>
           </div>
      
       {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-md my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-2">{t('common:option.confirm.action.title', 'Confirm action')}</h3>
            <div className="text-sm space-y-1 mb-3">
              <div><span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.recipient')}:</span> <span className="font-mono break-all">{dest}</span></div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.amount')}:</span>{' '}
                <span>
                  {amountFmt.format(Number(amount))} {(assetKey==='XLM'?'XLM':assetKey.split(':')[0])}
                  {preflight.activationRequired && assetKey==='XLM' && preflight.willBump && !preflight.loading && !preflight.err && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">→ {amountFmt.format(preflight.adjusted)} XLM</span>
                  )}
                </span>
              </div>
              <div><span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.memo')}:</span> {memoType==='none' || !memoVal ? '-' : memoVal}</div>
              {recipientCompromised && (
                <div className="text-red-600 dark:text-red-400">
                  {t('wallet:flag.compromised', 'Warning: This recipient is marked as compromised in your trusted list.')}
                </div>
              )}
              {recipientDeactivated && (
                <div className="text-amber-600 dark:text-amber-400">
                  {t('wallet:flag.deactivated', 'Note: This recipient is marked as deactivated in your trusted list.')}
                </div>
              )}
            </div>

            {preflight.loading && (
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">{t('common:common.loading')}</div>
            )}
            {!!preflight.err && !preflight.loading && (
              <div className="text-xs text-red-600 mb-2">{preflight.err}</div>
            )}
            {preflight.activationRequired && assetKey==='XLM' && !preflight.loading && !preflight.err && (
              <div className="border rounded p-2 mb-2 text-xs">
                <div className="font-semibold mb-1">{t('common:payment.send.activateConfirm.title', 'Account activation required')}</div>
                <div className="mb-1">{t('common:payment.send.activateConfirm.info', 'The destination account is not active yet. A minimum amount is required to activate it.')}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.minReserve', 'Minimum (2 × base reserve)')}</div>
                  <div>{amountFmt.format(preflight.minReserve)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.yourAmount', 'Entered amount')}</div>
                  <div>{amountFmt.format(preflight.desired)} XLM</div>
                  {preflight.willBump && (
                    <>
                      <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.adjustedAmount', 'Proposed amount (to activate)')}</div>
                      <div className="text-amber-600 dark:text-amber-400 font-medium">{amountFmt.format(preflight.adjusted)} XLM</div>
                    </>
                  )}
                </div>
                {preflight.willBump && (
                  <div className="mt-1 text-amber-600 dark:text-amber-400">{t('common:payment.send.activateConfirm.noteAdjust', 'Your amount is not sufficient for activation. If you continue, the minimum amount will be sent automatically.')}</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700" onClick={()=>setShowConfirmModal(false)}>{t('common:option.cancel', 'Cancel')}</button>
              <button className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={preflight.loading || !!preflight.err} onClick={handleStoredSecretSend}>{t('common:option.yes', 'Yes')}</button>
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
              setError('');
              setStatus('');
              const kp = Keypair.fromSecret(secret);
              if (kp.publicKey() !== publicKey) {
                setSecretError(t('secretKey:mismatch'));
                return;
              }
              if (remember) {
                try {
                  sessionStorage.setItem(`stm.session.secret.${publicKey}`, secret);
                  try { window.dispatchEvent(new CustomEvent('stm-session-secret-changed', { detail: { publicKey } })); } catch { /* noop */ }
                } catch { /* noop */ }
              }
              const result = await submitPayment(secret);
              applySendResult(result);
              setSecretError('');
              setShowSecretModal(false);
            } catch (e) {
              const detail = handlePaymentError(e);
              setSecretError(detail);
            }
          }}
        />
      )}
    </div>
  );
}
