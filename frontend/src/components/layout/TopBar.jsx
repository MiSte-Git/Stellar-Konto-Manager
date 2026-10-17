import React from 'react';
import { useTranslation } from 'react-i18next';

import { openMainView } from '../../utils/appNavigation.js';
import LanguageMenu from './LanguageMenu.jsx';
import NavIcon from './NavIcon.jsx';
import PriceCurrencyMenu from './PriceCurrencyMenu.jsx';
import SigningStatus from './SigningStatus.jsx';
import XlmPriceTicker from './XlmPriceTicker.jsx';

function readNetwork() {
  try {
    return window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET' ? 'TESTNET' : 'PUBLIC';
  } catch {
    return 'PUBLIC';
  }
}

function NetworkBadge() {
  const { t } = useTranslation(['network']);
  const [network, setNetwork] = React.useState(readNetwork);

  React.useEffect(() => {
    const handler = (e) => setNetwork(typeof e?.detail === 'string' && e.detail === 'TESTNET' ? 'TESTNET' : readNetwork());
    window.addEventListener('stm-network-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('stm-network-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const isTest = network === 'TESTNET';
  return (
    <span
      data-testid="network-badge"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        isTest
          ? 'bg-amber-400 text-amber-950'
          : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isTest ? 'bg-amber-900' : 'bg-emerald-500'}`} aria-hidden="true" />
      {isTest ? t('network:testnet', 'Testnet') : t('network:mainnet', 'Mainnet')}
    </span>
  );
}

/**
 * Feste Titelleiste der App-Shell.
 * @param {{ onOpenMenu: () => void, menuOpen: boolean, menuButtonRef: React.RefObject<HTMLButtonElement>, price?: object }} props
 */
export default function TopBar({ onOpenMenu, menuOpen, menuButtonRef, price }) {
  const { t } = useTranslation(['common', 'menu', 'settings']);
  const logoSrc = `${import.meta.env.BASE_URL || '/'}Trustline-Logo-Favicon.ico`;
  const iconBtn =
    'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white p-0 text-gray-600 ' +
    'hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ' +
    'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-white';

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
      <div className="flex h-full items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMenu}
          aria-label={t('menu:openNavigation', 'Navigation öffnen')}
          aria-expanded={!!menuOpen}
          aria-controls="skm-nav-drawer"
          className={`${iconBtn} lg:hidden`}
        >
          <NavIcon name="menu" className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => openMainView('home')}
          className="flex min-w-0 items-center gap-2 rounded-lg border-0 bg-transparent p-1 text-gray-900 hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-white"
          title={t('common:main.title')}
        >
          <img src={logoSrc} alt="" className="h-7 w-7 shrink-0 rounded-md" />
          <span className="hidden truncate text-[15px] font-semibold tracking-tight lg:inline">
            {t('common:main.title')}
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline lg:hidden">SKM</span>
        </button>

        <NetworkBadge />

        <div className="ml-auto flex items-center gap-2">
          <SigningStatus />
          <XlmPriceTicker price={price} className="hidden sm:inline-flex" />
          <PriceCurrencyMenu price={price} className="hidden sm:block" />
          <LanguageMenu />
          <button
            type="button"
            onClick={() => openMainView('settings')}
            aria-label={t('settings:label', 'Einstellungen')}
            title={t('settings:label', 'Einstellungen')}
            className={iconBtn}
          >
            <NavIcon name="settings" className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
