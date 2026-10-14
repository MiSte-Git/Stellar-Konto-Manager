import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { SIDEBAR_FOOTER_ITEMS, SIDEBAR_SECTIONS } from '../../config/mainNavigation.js';
import { SHOW_DONATE_BUTTON } from '../../config.js';
import {
  MENU_CHANGED_EVENT,
  getActiveMainView,
  getActiveRouteItemId,
  navigateToPath,
  openMainView,
  resolveMainItemId,
} from '../../utils/appNavigation.js';
import NavIcon from './NavIcon.jsx';

const NAMESPACES = ['menu', 'home', 'navigation', 'scamSimulator', 'legal', 'common'];

function isItemVisible(item) {
  if (item.requiresFlag === 'donate') return !!SHOW_DONATE_BUTTON;
  return true;
}

function useActiveItemId() {
  const location = useLocation();
  const [mainView, setMainView] = React.useState(() => getActiveMainView());

  React.useEffect(() => {
    const handler = (e) => setMainView(e?.detail ?? null);
    window.addEventListener(MENU_CHANGED_EVENT, handler);
    return () => window.removeEventListener(MENU_CHANGED_EVENT, handler);
  }, []);

  const routeId = getActiveRouteItemId(location?.pathname || '');
  return routeId || resolveMainItemId(mainView);
}

function NavItem({ item, active, compact, label, onSelect }) {
  const base =
    'group w-full flex items-center gap-3 rounded-lg border-0 text-left font-medium leading-snug ' +
    'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ' +
    (compact ? 'px-3 py-1 text-[13px]' : 'px-3 py-1.5 text-sm');
  const state = active
    ? 'bg-blue-50 text-blue-800 shadow-[inset_3px_0_0_0_#2563eb] hover:bg-blue-50 ' +
      'dark:bg-gray-800 dark:text-white dark:shadow-[inset_3px_0_0_0_#60a5fa] dark:hover:bg-gray-800'
    : 'bg-transparent text-gray-700 hover:bg-gray-200/70 hover:text-gray-900 ' +
      'dark:text-gray-300 dark:hover:bg-gray-800/70 dark:hover:text-white';
  const iconState = active
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300';

  return (
    <li>
      <button
        type="button"
        data-nav-id={item.id}
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(item)}
        className={`${base} ${state}`}
      >
        <NavIcon name={item.icon} className={`shrink-0 ${compact ? 'w-4 h-4' : 'w-[18px] h-[18px]'} ${iconState}`} />
        <span className="min-w-0">{label}</span>
      </button>
    </li>
  );
}

/**
 * Seitenleiste der App-Shell. Wird auf grossen Bildschirmen fest angezeigt
 * und auf kleinen Bildschirmen im Drawer wiederverwendet.
 * @param {{ onNavigate?: () => void }} props
 */
export default function Sidebar({ onNavigate }) {
  const { t } = useTranslation(NAMESPACES);
  const activeId = useActiveItemId();
  const navRef = React.useRef(null);

  // Aktiven Eintrag bei Bedarf in den sichtbaren Bereich der Seitenleiste scrollen.
  React.useEffect(() => {
    const el = navRef.current?.querySelector('[aria-current="page"]');
    try { el?.scrollIntoView?.({ block: 'nearest' }); } catch { /* noop */ }
  }, [activeId]);

  const handleSelect = React.useCallback((item) => {
    if (item.kind === 'route') {
      navigateToPath(item.to, { rememberPrevPath: !!item.rememberPrevPath });
    } else {
      openMainView(item.id);
    }
    try { window.scrollTo({ top: 0 }); } catch { /* noop */ }
    onNavigate?.();
  }, [onNavigate]);

  const labelOf = (item) => t(item.labelKey, item.fallback || item.id);

  return (
    <nav
      ref={navRef}
      aria-label={t('menu:sidebarLabel', 'Hauptnavigation')}
      className="flex h-full flex-col"
    >
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-4">
        {SIDEBAR_SECTIONS.map((section) => {
          const items = section.items.filter(isItemVisible);
          if (items.length === 0) return null;
          const headingId = section.titleKey ? `skm-nav-${section.id}` : undefined;
          return (
            <div key={section.id} role="group" aria-labelledby={headingId}>
              {section.titleKey && (
                <div
                  id={headingId}
                  className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  {t(section.titleKey, section.titleFallback || section.id)}
                </div>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <NavItem
                    key={item.id}
                    item={item}
                    label={labelOf(item)}
                    active={activeId === item.id}
                    onSelect={handleSelect}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-2">
        <ul className="space-y-0.5">
          {SIDEBAR_FOOTER_ITEMS.filter(isItemVisible).map((item) => (
            <NavItem
              key={item.id}
              item={item}
              compact
              label={labelOf(item)}
              active={activeId === item.id}
              onSelect={handleSelect}
            />
          ))}
        </ul>
      </div>
    </nav>
  );
}
