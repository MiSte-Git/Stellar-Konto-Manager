import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getHorizonServer, resolveOrValidatePublicKey } from '../utils/stellar/stellarUtils';
import { Asset, Keypair, Networks, Operation, TransactionBuilder, Memo } from '@stellar/stellar-sdk';
import SecretKeyModal from '../components/SecretKeyModal';

export default function SendPaymentPage({ publicKey, onBack: _onBack, initial }) {
  const { t } = useTranslation();
  void _onBack;

  const [dest, setDest] = useState(initial?.recipient || '');
  const [amount, setAmount] = useState('');
  const [assetKey, setAssetKey] = useState('XLM'); // 'XLM' or 'CODE:ISSUER'
  const [memoType, setMemoType] = useState('text'); // 'text' | 'id'
  const [memoVal, setMemoVal] = useState('');
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [secretError, setSecretError] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const [balances, setBalances] = useState(null); // array from account.balances
  const [accountInfo, setAccountInfo] = useState(null); // horizon account
  const [offersCount, setOffersCount] = useState(0);
  const [baseReserve, setBaseReserve] = useState(0.5); // default fallback

  const server = useMemo(() => getHorizonServer(), []);

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

  const native = useMemo(() => (balances || []).find(b => b.asset_type === 'native') || { balance: '0', selling_liabilities: '0' }, [balances]);
  const trustlines = useMemo(() => (balances || []).filter(b => b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'), [balances]);
  const lpTrusts = useMemo(() => (balances || []).filter(b => b.asset_type === 'liquidity_pool_shares'), [balances]);

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

  const assetOptions = useMemo(() => {
    const opts = [{ key: 'XLM', label: 'XLM' }];
    for (const b of trustlines) {
      const key = `${b.asset_code}:${b.asset_issuer}`;
      opts.push({ key, label: `${b.asset_code}:${b.asset_issuer}` });
    }
    return opts;
  }, [trustlines]);

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
      {status && <div className="text-green-700 text-sm text-center">{status}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm">{t('payment.send.recipient')}</label>
          <input className="border rounded w-full p-2 font-mono" value={dest} onChange={(e)=>setDest(e.target.value)} placeholder="G... oder user*domain" />

          <label className="block text-sm mt-2">{t('payment.send.amount')}</label>
          <input type="number" min="0" step="0.0000001" className="border rounded w-full p-2" value={amount} onChange={(e)=>setAmount(e.target.value)} />
          <div className="text-xs text-gray-600 dark:text-gray-400">{t('payment.send.available')}: {availableXLM.toFixed(7)} XLM</div>

          <label className="block text-sm mt-2">{t('payment.send.asset')}</label>
          <select className="border rounded w-full p-2" value={assetKey} onChange={(e)=>setAssetKey(e.target.value)}>
            {assetOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="block text-sm">{t('payment.send.memoType')}</label>
              <select className="border rounded w-full p-2" value={memoType} onChange={(e)=>setMemoType(e.target.value)}>
                <option value="text">{t('payment.send.memoTypes.text')}</option>
                <option value="id">{t('payment.send.memoTypes.id')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm">{t('payment.send.memo')}</label>
              <input className="border rounded w-full p-2" value={memoVal} onChange={(e)=>setMemoVal(e.target.value)} />
            </div>
          </div>

          <button className="mt-3 px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!dest || !amount || parseFloat(amount) <= 0} onClick={()=>setShowSecretModal(true)}>
            {t('payment.send.sendButton')}
          </button>
        </div>

        <div className="space-y-2 p-3 border rounded">
          <div className="font-semibold">{t('payment.send.reserved')}</div>
          <div className="text-2xl font-bold">{reservedTotal.toFixed(7)} XLM</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm mt-2">
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.baseReserve')}</div><div>{baseReserve.toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.extra')}</div><div>{(reservedTotal - baseReserve*2).toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.xlmInOffers')}</div><div>{xlmInOffers.toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.trustlines', { n: trustCount })}</div><div>{reservedTrust.toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.lpTrustlines')}</div><div>{reservedLp.toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.offers')}</div><div>{reservedOffers.toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.signers')}</div><div>{reservedSigners.toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.accountData')}</div><div>{reservedData.toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.sponsoring')}</div><div>{reservedSponsor.toFixed(7)} XLM</div>
            <div className="text-gray-600 dark:text-gray-400">{t('payment.send.sponsored')}</div><div>{reservedSponsored.toFixed(7)} XLM</div>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-2">
            {t('publicKey.source')}: <span className="font-mono break-all">{publicKey}</span>
          </div>
        </div>
      </div>

      {showSecretModal && (
        <SecretKeyModal
          errorMessage={secretError}
          onCancel={()=>{ setShowSecretModal(false); setSecretError(''); }}
          onConfirm={async (secret) => {
            try {
              setError(''); setStatus('');
              const kp = Keypair.fromSecret(secret);
              if (kp.publicKey() !== publicKey) {
                setSecretError('secretKey.mismatch');
                return;
              }
              const net = (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? Networks.TESTNET : Networks.PUBLIC;
              const acct = await server.loadAccount(publicKey);
              const feeStats = await server.feeStats();
              const fee = Number(feeStats?.fee_charged?.mode || 100);
              const builder = new TransactionBuilder(acct, { fee, networkPassphrase: net, memo: memoType === 'text' && memoVal ? Memo.text(memoVal) : (memoType === 'id' && memoVal ? Memo.id(memoVal) : undefined) });
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
              setStatus(t('payment.send.success', { hash: res.hash || res.id || '' }));
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
