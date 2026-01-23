import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function AddressDropdown({
  value,
  onChange,
  onSelect,
  onBlur,
  placeholder,
  options = [],
  className = '',
  inputClassName = '',
  rightAdornment = null,
  disabled = false,
  inputProps = {},
}) {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const filtered = useMemo(() => {
    const query = String(value || '').trim().toLowerCase();
    if (!query) return options;
    return options.filter((entry) => {
      const v = String(entry.value || '').toLowerCase();
      const l = String(entry.label || '').toLowerCase();
      return v.includes(query) || (l && l.includes(query));
    });
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div className={['relative', className].filter(Boolean).join(' ')} ref={wrapperRef}>
      <input
        className={inputClassName}
        value={value}
        onChange={(e) => {
          onChange?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        {...inputProps}
      />
      {rightAdornment}
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded border bg-white dark:bg-gray-900 shadow-lg">
          {filtered.map((entry, i) => (
            <button
              key={`${entry.value}-${i}`}
              type="button"
              className="w-full text-left px-3 py-0 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect?.(entry.value);
                setOpen(false);
              }}
            >
              <div className="font-mono break-all">{entry.value}</div>
              {(entry.isTestnet || entry.label) && (
                <div className="text-xs text-gray-600 dark:text-gray-400 flex flex-wrap gap-2">
                  {entry.isTestnet && (
                    <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
                      {t('common:account.testnetLabel', '(Testnet)')}
                    </span>
                  )}
                  {entry.label && <span>{entry.label}</span>}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
