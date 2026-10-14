import React from 'react';
import { useTranslation } from 'react-i18next';

import NavIcon from '../components/layout/NavIcon.jsx';
import QrCode from '../components/QrCode.jsx';
import { copyText } from '../utils/clipboard.js';
import { groupAddress } from '../utils/stellar/walletSummary.js';

function readNetwork() {
  try {
    return window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET' ? 'TESTNET' : 'PUBLIC';
  } catch {
    return 'PUBLIC';
  }
}

const cardCls =
  'rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/70';

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

  const groups = groupAddress(address);
  const segBtn = (active) =>
    `flex-1 rounded-lg border-0 px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
      active
        ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
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
            <QrCode value={address} size={224} label={t('wallet:receive.qrLabel', { address, defaultValue: 'QR-Code der Adresse {{address}}' })} />
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
            {groups.map((g, i) => (
              <span key={i} className={i === 0 || i === groups.length - 1 ? 'font-semibold' : ''}>{g}</span>
            ))}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-xl border-0 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:hover:bg-blue-500 dark:focus-visible:ring-offset-gray-900"
          >
            <NavIcon name="copy" className="h-4 w-4" />
            {t('wallet:receive.copy', 'Adresse kopieren')}
          </button>
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400" role="status" aria-live="polite">
            {copied ? t('wallet:receive.copied', 'Kopiert') : ''}
          </span>
        </div>

        <ul className="mt-6 space-y-2 border-t border-gray-200 pt-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-gray-400">•</span>
            <span>{t('wallet:receive.hintCompare', 'Lass den Absender die ersten und letzten Zeichen der Adresse prüfen. Betrüger nutzen gezielt Adressen, die ähnlich aussehen.')}</span>
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
