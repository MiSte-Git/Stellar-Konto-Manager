import React from 'react';
import { useTranslation } from 'react-i18next';

import NavIcon from './NavIcon.jsx';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import PriceCurrencyMenu from './PriceCurrencyMenu.jsx';
import XlmPriceTicker from './XlmPriceTicker.jsx';
import { useXlmPrice } from '../../utils/useXlmPrice.js';
import { XlmPriceContext } from '../../utils/xlmPriceContext.js';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * App-Shell: feste Titelleiste oben (unter lg darunter eine Kursleiste),
 * Seitenleiste links (ab lg fest, darunter als Drawer), Inhalt rechts.
 */
export default function AppLayout({ children }) {
  const { t } = useTranslation(['menu', 'common']);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const menuButtonRef = React.useRef(null);
  const drawerRef = React.useRef(null);
  const wasOpenRef = React.useRef(false);
  const price = useXlmPrice();

  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);

  // Fokus beim Oeffnen in den Drawer, beim Schliessen zurueck auf den Hamburger.
  React.useEffect(() => {
    if (drawerOpen) {
      wasOpenRef.current = true;
      const first = drawerRef.current?.querySelector('[aria-current="page"]') || drawerRef.current?.querySelector(FOCUSABLE);
      first?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      menuButtonRef.current?.focus();
    }
  }, [drawerOpen]);

  // Escape schliesst, Tab bleibt im Drawer, Seite scrollt nicht mit.
  React.useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const nodes = Array.from(drawerRef.current.querySelectorAll(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  // Beim Wechsel auf die Desktop-Breite den Drawer schliessen.
  React.useEffect(() => {
    if (!drawerOpen || typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => { if (mq.matches) setDrawerOpen(false); };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [drawerOpen]);

  return (
    <XlmPriceContext.Provider value={price}>
    <div className="min-h-screen">
      <TopBar
        onOpenMenu={() => setDrawerOpen(true)}
        menuOpen={drawerOpen}
        menuButtonRef={menuButtonRef}
        price={price}
      />
      {/* Kursleiste fuer Handy/Tablet; ab lg stehen die Kurse in der Titelleiste (dort gibt es die feste Seitenleiste). */}
      <div
        data-testid="price-bar"
        className="flex h-10 items-center gap-3 border-b border-gray-200 bg-white px-3 sm:px-4 lg:hidden dark:border-gray-800 dark:bg-gray-950"
      >
        <XlmPriceTicker price={price} compact className="min-w-0" />
        <PriceCurrencyMenu price={price} compact className="ml-auto shrink-0" />
      </div>
      <div className="flex">
        <aside
          className="hidden lg:block sticky top-14 self-start h-[calc(100vh-3.5rem)] supports-[height:100dvh]:h-[calc(100dvh-3.5rem)] w-64 shrink-0 border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950"
          data-testid="sidebar-desktop"
        >
          <Sidebar />
        </aside>
        <main id="skm-main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeDrawer}
            data-testid="sidebar-overlay"
            aria-hidden="true"
          />
          <div
            id="skm-nav-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('menu:sidebarLabel', 'Hauptnavigation')}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-gray-50 shadow-xl dark:bg-gray-950"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800">
              <span className="text-[15px] font-semibold text-gray-900 dark:text-white">{t('common:main.title')}</span>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label={t('menu:closeNavigation', 'Navigation schließen')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-gray-500 hover:bg-gray-200 hover:text-gray-900 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              >
                <NavIcon name="close" className="w-5 h-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Sidebar onNavigate={closeDrawer} />
            </div>
          </div>
        </div>
      )}
    </div>
    </XlmPriceContext.Provider>
  );
}
