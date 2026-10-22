import React from 'react';
import { useTranslation } from 'react-i18next';

import NavIcon from '../components/layout/NavIcon.jsx';
import QrCode from '../components/QrCode.jsx';
import { copyText } from '../utils/clipboard.js';
import { splitAddressForCompare } from '../utils/stellar/walletSummary.js';
import { buildSep7Pay, validateRequestFields } from '../utils/stellar/sep7.js';
import { parseTargetAsset } from '../utils/stellar/batchConvert.js';

function readNetwork() {
  try {
    return window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET' ? 'TESTNET' : 'PUBLIC';
  } catch {
    return 'PUBLIC';
  }
}

const cardCls =
  'rounded-2xl border border-gray-200 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-800/70';

/**
 * Empfangen: zeigt die Adresse des geladenen Kontos als QR-Code und Text.
 * Bewusst nur Adressen aus dem geladenen Konto (nicht aus dem Eingabefeld),
 * damit nie eine andere als die aktive Adresse angezeigt wird.
 * @param {{ publicKey?: string, muxedAddress?: string }} props
 */
export default function ReceivePage({ publicKey, muxedAddress }) {
  const { t } = useTranslation(['wallet', 'network']);
  const [network, setNetwork] = React.useState(readNetwork);
  const [variant, setVariant] = React.useState(muxedAddress ? 'muxed' : 'base');
  const [copied, setCopied] = React.useState(false);
  const copiedTimer = React.useRef(null);
  // Optionale Zahlungsanfrage (SEP-7): Betrag, Asset, Memo
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [reqAmount, setReqAmount] = React.useState('');
  const [reqAssetMode, setReqAssetMode] = React.useState('xlm'); // xlm | custom
  const [reqAsset, setReqAsset] = React.useState('');
  const [reqMemoType, setReqMemoType] = React.useState('text');
  const [reqMemo, setReqMemo] = React.useState('');
  const [linkCopied, setLinkCopied] = React.useState(false);

  React.useEffect(() => {
    const handler = (e) => setNetwork(typeof e?.detail === 'string' && e.detail === 'TESTNET' ? 'TESTNET' : readNetwork());
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  React.useEffect(() => {
    setVariant(muxedAddress ? 'muxed' : 'base');
  }, [muxedAddress]);

  React.useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const address = variant === 'muxed' && muxedAddress ? muxedAddress : publicKey;

  React.useEffect(() => {
    setCopied(false);
  }, [address]);

  const reqAmountNorm = reqAmount.trim().replace(',', '.');
  const reqAssetParsed = reqAssetMode === 'custom' ? parseTargetAsset(reqAsset) : null;
  const reqAssetInvalid = reqAssetMode === 'custom' && (!reqAssetParsed || reqAssetParsed.isNative);
  const reqErrorKey = requestOpen
    ? (validateRequestFields({ amount: reqAmountNorm, memoType: reqMemoType, memo: reqMemo.trim() }) || (reqAssetInvalid ? 'invalidAsset' : null))
    : null;
  const hasRequest = requestOpen && !reqErrorKey && (reqAmountNorm || reqAssetMode === 'custom' || reqMemo.trim());
  const requestUri = hasRequest && address
    ? buildSep7Pay({
      destination: address,
      amount: reqAmountNorm,
      asset: reqAssetMode === 'custom' ? reqAssetParsed : null,
      memo: reqMemo.trim() ? { type: reqMemoType, value: reqMemo.trim() } : null,
      network,
    })
    : '';

  React.useEffect(() => { setLinkCopied(false); }, [requestUri]);

  const handleCopyLink = async () => {
    setLinkCopied(await copyText(requestUri));
  };

  const handleCopy = async () => {
    const ok = await copyText(address);
    setCopied(ok);
    clearTimeout(copiedTimer.current);
    if (ok) copiedTimer.current = setTimeout(() => setCopied(false), 2500);
  };

  if (!publicKey) {
    return (
      <div className="mx-auto max-w-xl px-4 pb-10 text-left">
        <section className={`${cardCls} p-6`} data-testid="receive-empty">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('wallet:receive.title', 'Empfangen')}</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {t('wallet:receive.noAccount', 'Lade zuerst oben ein Konto. Dann siehst du hier seine Adresse und den QR-Code.')}
          </p>
        </section>
      </div>
    );
  }

  const groups = splitAddressForCompare(address);
  const segBtn = (active) =>
    `flex-1 rounded-lg border-0 px-3 py-1.5 text-sm font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 ${
      active
        ? 'bg-white text-gray-900 shadow-xs dark:bg-gray-700 dark:text-white'
        : 'bg-transparent text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
    }`;

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 text-left" data-testid="receive-page">
      <section className={`${cardCls} p-5 sm:p-6`}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('wallet:receive.title', 'Empfangen')}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t('wallet:receive.intro', 'Gib diese Adresse an, um XLM oder Token auf dieses Konto zu erhalten.')}
        </p>

        {network === 'TESTNET' && (
          <p className="mt-4 rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950 dark:bg-amber-400/15 dark:text-amber-200" role="note">
            {t('wallet:receive.testnet', 'Du bist im Testnet. Guthaben im Testnet hat keinen Wert.')}
          </p>
        )}

        {muxedAddress && (
          <div className="mt-4 flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900/60" role="group" aria-label={t('wallet:receive.variantLabel', 'Adresstyp')}>
            <button type="button" aria-pressed={variant === 'muxed'} onClick={() => setVariant('muxed')} className={segBtn(variant === 'muxed')}>
              {t('wallet:receive.muxed', 'Muxed-Adresse (M…)')}
            </button>
            <button type="button" aria-pressed={variant === 'base'} onClick={() => setVariant('base')} className={segBtn(variant === 'base')}>
              {t('wallet:receive.base', 'Basiskonto (G…)')}
            </button>
          </div>
        )}

        <div className="mt-5 flex justify-center">
          <div className="rounded-2xl bg-white p-3 ring-1 ring-gray-200 dark:ring-gray-600">
            <QrCode
              value={requestUri || address}
              size={224}
              label={requestUri
                ? t('wallet:receive.request.qrLabel', { address })
                : t('wallet:receive.qrLabel', { address, defaultValue: 'QR-Code der Adresse {{address}}' })}
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {variant === 'muxed' && muxedAddress
              ? t('wallet:receive.muxedAddressLabel', 'Muxed-Adresse')
              : t('wallet:receive.addressLabel', 'Deine Stellar-Adresse')}
          </div>
          <p
            className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5 font-mono text-[15px] leading-relaxed text-gray-900 dark:text-gray-100"
            aria-label={address}
            data-testid="receive-address"
          >
            {groups.map((segments, i) => (
              <span key={i}>
                {segments.map((seg, j) => (
                  <span key={j} className={seg.strong ? 'font-semibold' : ''} data-strong={seg.strong ? 'true' : undefined}>{seg.text}</span>
                ))}
              </span>
            ))}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-xl border-0 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:hover:bg-blue-500 dark:focus-visible:ring-offset-gray-900"
          >
            <NavIcon name="copy" className="h-4 w-4" />
            {t('wallet:receive.copy', 'Adresse kopieren')}
          </button>
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400" role="status" aria-live="polite">
            {copied ? t('wallet:receive.copied', 'Kopiert') : ''}
          </span>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700" data-testid="receive-request">
          <button
            type="button"
            onClick={() => setRequestOpen((v) => !v)}
            aria-expanded={requestOpen}
            className="inline-flex items-center gap-2 rounded-md border-0 bg-transparent p-0 text-sm font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-300"
          >
            <span aria-hidden="true" className={`inline-block transition-transform ${requestOpen ? 'rotate-90' : ''}`}>▸</span>
            {t('wallet:receive.request.toggle')}
          </button>
          {requestOpen && (
            <div className="mt-3 space-y-3 text-sm">
              <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:receive.request.intro')}</p>
              <div>
                <label htmlFor="req-amount" className="block font-medium text-gray-800 dark:text-gray-200">{t('wallet:receive.request.amount')}</label>
                <input id="req-amount" type="text" inputMode="decimal" value={reqAmount} onChange={(e) => setReqAmount(e.target.value)} className="mt-1 w-40 rounded-sm border px-2 py-1.5 dark:bg-gray-900" />
              </div>
              <fieldset>
                <legend className="font-medium text-gray-800 dark:text-gray-200">{t('wallet:receive.request.asset')}</legend>
                <label className="mr-4 inline-flex items-center gap-2">
                  <input type="radio" name="req-asset" checked={reqAssetMode === 'xlm'} onChange={() => setReqAssetMode('xlm')} /> XLM
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="req-asset" checked={reqAssetMode === 'custom'} onChange={() => setReqAssetMode('custom')} /> {t('wallet:receive.request.customAsset')}
                </label>
                {reqAssetMode === 'custom' && (
                  <input
                    type="text"
                    value={reqAsset}
                    onChange={(e) => setReqAsset(e.target.value)}
                    placeholder="CODE:G..."
                    aria-label={t('wallet:receive.request.customAsset')}
                    className="mt-2 w-full rounded-sm border px-2 py-1.5 font-mono text-xs dark:bg-gray-900"
                    spellCheck="false"
                    autoComplete="off"
                  />
                )}
              </fieldset>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="req-memo-type" className="block font-medium text-gray-800 dark:text-gray-200">{t('wallet:receive.request.memoType')}</label>
                  <select id="req-memo-type" value={reqMemoType} onChange={(e) => setReqMemoType(e.target.value)} className="mt-1 rounded-sm border px-2 py-1.5 dark:bg-gray-900">
                    <option value="text">{t('wallet:receive.request.memoText')}</option>
                    <option value="id">{t('wallet:receive.request.memoId')}</option>
                  </select>
                </div>
                <div className="min-w-0 flex-1">
                  <label htmlFor="req-memo" className="block font-medium text-gray-800 dark:text-gray-200">{t('wallet:receive.request.memo')}</label>
                  <input id="req-memo" type="text" value={reqMemo} onChange={(e) => setReqMemo(e.target.value)} className="mt-1 w-full rounded-sm border px-2 py-1.5 dark:bg-gray-900" />
                </div>
              </div>
              {reqErrorKey && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{t(`wallet:receive.request.errors.${reqErrorKey}`)}</p>}
              {requestUri && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 dark:text-gray-300">{t('wallet:receive.request.active')}</p>
                  <p className="break-all rounded-sm bg-gray-50 p-2 font-mono text-xs text-gray-800 dark:bg-gray-900/60 dark:text-gray-200" data-testid="receive-request-uri">{requestUri}</p>
                  <button type="button" onClick={handleCopyLink} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
                    {linkCopied ? t('wallet:receive.copied', 'Kopiert') : t('wallet:receive.request.copyLink')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <ul className="mt-6 space-y-2 border-t border-gray-200 pt-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-gray-400">•</span>
            <span>{t('wallet:receive.hintCompare', 'Lass den Absender die ersten und letzten 8 Zeichen der Adresse prüfen, sie sind fett markiert. Betrüger nutzen gezielt Adressen, die am Anfang und Ende ähnlich aussehen.')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-gray-400">•</span>
            <span>{t('wallet:receive.hintTrustline', 'Andere Token als XLM kannst du erst empfangen, wenn du eine Token-Freigabe (Trustline) dafür hast.')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-gray-400">•</span>
            <span>{t('wallet:receive.hintActivate', 'Ein neues Konto wird erst mit einer ersten Einzahlung von mindestens 1 XLM aktiviert.')}</span>
          </li>
          {variant === 'muxed' && muxedAddress && (
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-gray-400">•</span>
              <span>{t('wallet:receive.hintMuxed', 'Zahlungen an die M-Adresse landen auf deinem Basiskonto und sind mit der Muxed-ID gekennzeichnet. Nicht jede Wallet oder Börse unterstützt M-Adressen.')}</span>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
