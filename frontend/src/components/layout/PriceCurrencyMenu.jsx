import React from 'react';
import { useTranslation } from 'react-i18next';

import NavIcon from './NavIcon.jsx';

/**
 * Waehrungsauswahl fuer die Kursanzeige (XLM und XRP), gestaltet wie die
 * Sprachauswahl. Die Daten kommen aus useXlmPrice (einmal in AppLayout aufgerufen).
 * @param {{ price: ReturnType<typeof import('../../utils/useXlmPrice.js').useXlmPrice>, align?: 'left'|'right', className?: string, compact?: boolean }} props
 */
export default function PriceCurrencyMenu({ price, align = 'right', className = '', compact = false }) {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const buttonRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!price) return null;
  const { pairs, selectedPair, setSelectedPair } = price;

  const choose = (key) => {
    setSelectedPair(key);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const label = t('common:xlmPrice.pair', 'Währung für den XLM-Kurs');

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${selectedPair}`}
        title={label}
        data-testid="price-currency-button"
        className={`inline-flex ${compact ? 'h-7 px-2' : 'h-9 px-2.5'} items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-800`}
      >
        <span className="text-xs">{selectedPair}</span>
        <NavIcon name="chevronDown" className="w-3.5 h-3.5 text-gray-400" />
      </button>
      {open && (
        <ul
          role="menu"
          aria-label={label}
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-40 mt-2 w-32 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900`}
        >
          {pairs.map((pair) => {
            const active = pair.key === selectedPair;
            return (
              <li key={pair.key} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => choose(pair.key)}
                  className={`flex w-full items-center justify-between gap-2.5 rounded-none border-0 px-3 py-1.5 text-left text-sm ${
                    active
                      ? 'bg-blue-50 font-semibold text-blue-800 hover:bg-blue-50 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-800'
                      : 'bg-transparent font-normal text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                  }`}
                >
                  <span>{pair.key}</span>
                  <span className="text-xs text-gray-400">{pair.symbol.trim()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
