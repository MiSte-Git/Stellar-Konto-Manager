import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrustedWallets } from '../utils/useTrustedWallets.js';

/**
 * Button plus popover that lets the user pick an address from the trusted
 * wallet list (Einstellungen -> Konten-Liste), independent of the input
 * history. Compromised/deactivated entries stay selectable but are marked;
 * the consuming page decides whether to warn after selection.
 *
 * Renders the popover absolutely positioned, so the closest positioned
 * ancestor (AddressDropdown's wrapper) determines its width.
 */
export default function AccountListPicker({
  onSelect,
  onOpenChange,
  disabled = false,
  buttonClassName = '',
}) {
  const { t } = useTranslation(['common']);
  const { wallets } = useTrustedWallets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const filterRef = useRef(null);

  const entries = useMemo(() => wallets
    .map((w) => ({
      address: String(w?.address || w?.publicKey || '').trim(),
      label: String(w?.label || '').trim(),
      isTestnet: !!w?.isTestnet,
      compromised: !!w?.compromised,
      deactivated: !!w?.deactivated,
    }))
    .filter((w) => w.address), [wallets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.address.toLowerCase().includes(q) || e.label.toLowerCase().includes(q));
  }, [entries, query]);

  const setOpenState = (next) => {
    setOpen(next);
    if (!next) setQuery('');
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return undefined;
    // Focus the filter once the popover is mounted (useRef + useEffect pattern,
    // not the autoFocus attribute).
    filterRef.current?.focus();
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpenState(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenState(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (address) => {
    onSelect?.(address);
    setOpenState(false);
  };

  const title = t('common:accountPicker.button', 'Aus Konten-Liste wählen');

  return (
    <div ref={rootRef} className="shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpenState(!open)}
        title={title}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          'h-full px-2 border rounded text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-50',
          open ? 'bg-gray-100 dark:bg-gray-800' : '',
          buttonClassName,
        ].filter(Boolean).join(' ')}
      >
        {/* address book icon */}
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="5" y="3" width="15" height="18" rx="2" />
          <path d="M3 7h3M3 12h3M3 17h3" strokeLinecap="round" />
          <circle cx="12.5" cy="10" r="2.5" />
          <path d="M8.5 17c.6-2 2.2-3 4-3s3.4 1 4 3" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 rounded border bg-white dark:bg-gray-900 shadow-lg"
          data-testid="account-list-picker"
        >
          <div className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-700 dark:text-gray-300">
            {t('common:accountPicker.title', 'Konten-Liste')}
          </div>
          {entries.length === 0 ? (
            <div className="px-3 pb-3 text-sm text-gray-600 dark:text-gray-400">
              {t('common:accountPicker.empty', 'Noch keine Konten gespeichert. Konten legst du unter Einstellungen → Konten-Liste an.')}
            </div>
          ) : (
            <>
              <div className="px-3 pb-2">
                <input
                  ref={filterRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('common:accountPicker.filterPlaceholder', 'Nach Label oder Adresse filtern')}
                  className="w-full border rounded px-2 py-1 text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <ul role="listbox" className="max-h-64 overflow-y-auto border-t">
                {filtered.map((e) => (
                  <li key={e.address} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => pick(e.address)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      {e.label && <div className="font-medium break-all">{e.label}</div>}
                      <div className="font-mono text-xs break-all text-gray-700 dark:text-gray-300">{e.address}</div>
                      {(e.isTestnet || e.compromised || e.deactivated) && (
                        <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                          {e.isTestnet && (
                            <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
                              {t('common:account.testnetLabel', '(Testnet)')}
                            </span>
                          )}
                          {e.compromised && (
                            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200">
                              {t('common:accountPicker.compromised', 'kompromittiert')}
                            </span>
                          )}
                          {e.deactivated && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                              {t('common:accountPicker.deactivated', 'deaktiviert')}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                    {t('common:accountPicker.noMatch', 'Kein Konto passt zum Filter.')}
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
