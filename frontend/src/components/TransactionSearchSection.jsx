import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDateTime } from '../utils/datetime';
import { memoLooksLikeUrl, sanitizeMemo } from '../utils/stellar/activity.js';
import { UrlBadge } from './wallet/ActivityWarnings.jsx';
import {
  MAX_FILTER_ENTRIES, assetLabel, buildSearchFilters, matchesFilters, parseRecipient, sortRows, sumByAsset,
} from '../utils/stellar/transactionSearch.js';
import { cleanMemo } from '../utils/stellar/queryUtils.js';

const MAX_SHOWN = 500;
const CSV_HEADERS = ['created_at', 'tx_hash', 'op_id', 'type', 'dir', 'from', 'to', 'amount', 'asset_code', 'asset_issuer', 'memo'];
const EMPTY_AMOUNT = { min: '', max: '', asset: 'native', code: '', issuer: '' };

// Memos stammen von Absendern: nur bereinigt als Text zeigen, Webadressen markieren.
function MemoCell({ memo }) {
  const shown = sanitizeMemo(memo);
  return (
    <div className="font-mono break-all">
      {shown || '–'}
      {memoLooksLikeUrl(shown) && <div><UrlBadge /></div>}
    </div>
  );
}

function csvRowOf(r) {
  const [code, issuer] = r.assetKey === 'native' ? ['XLM', ''] : r.assetKey.split(':');
  return {
    created_at: r.created_at, tx_hash: r.tx_hash, op_id: r.id, type: r.type, dir: r.dir,
    from: r.from, to: r.to, amount: r.amount, asset_code: r.amount ? code : '', asset_issuer: r.amount ? issuer : '', memo: r.memo,
  };
}

function Chip({ label, title, onEdit, onRemove, removeLabel }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs max-w-full" title={title || label}>
      {onEdit ? (
        <button type="button" className="!p-0 !border-0 !bg-transparent truncate max-w-[18rem]" onClick={onEdit}>{label}</button>
      ) : (
        <span className="truncate max-w-[18rem]">{label}</span>
      )}
      <button type="button" className="!p-0 !border-0 !bg-transparent leading-none" aria-label={removeLabel} onClick={onRemove}>×</button>
    </span>
  );
}

function Seg({ value, options, onChange, ariaLabel }) {
  return (
    <div className="inline-flex rounded-sm border overflow-hidden" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`!rounded-none !border-0 px-2 py-1 text-xs ${value === o.value ? '!bg-blue-600 text-white' : '!bg-transparent'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Suche in der geladenen Liste (Variante C): Suchfeld fuer Memo, Filter-Chips fuer Empfaenger, Betrag und
 * "Memo enthaelt nicht", Richtung als Umschalter. Gleiche Chips wirken als ODER, verschiedene als UND.
 * Gefiltert wird live im Browser, die Liste kommt fertig geladen vom Panel.
 */
export default function TransactionSearchSection({ rows, incomplete, memoIncomplete, oldestLoaded, busy, onDownloadCsv }) {
  const { t } = useTranslation(['xlmByMemo', 'common']);
  const [memoDraft, setMemoDraft] = useState('');
  const [memos, setMemos] = useState([]);
  const [notMemos, setNotMemos] = useState([]);
  const [wrongMode, setWrongMode] = useState(false); // Memo-Suchfeld als erwartetes Memo: zeigt alles, was nicht exakt passt
  const [recipients, setRecipients] = useState([]);
  const [amount, setAmount] = useState(null);
  const [direction, setDirection] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [editor, setEditor] = useState(null); // null | 'recipient' | 'notMemo' | 'amount'
  const [editorText, setEditorText] = useState('');
  const [amountDraft, setAmountDraft] = useState(EMPTY_AMOUNT);
  const [editorErrors, setEditorErrors] = useState([]);
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const menuRef = useRef(null);

  // Das Filter-Menue schliesst auch bei Klick daneben, Tab-Wechsel im Menue und Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const onFocus = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, [menuOpen]);

  const built = useMemo(() => buildSearchFilters({
    memosText: wrongMode ? '' : [...memos, memoDraft].join('\n'),
    notMemosText: notMemos.join('\n'),
    notExactMemosText: wrongMode ? [...memos, memoDraft].join('\n') : '',
    recipientsText: recipients.map((r) => r.value).join(' '),
    amountAsset: amount?.asset, assetCode: amount?.code, assetIssuer: amount?.issuer,
    amountMin: amount?.min, amountMax: amount?.max,
    direction,
  }), [memos, memoDraft, wrongMode, notMemos, recipients, amount, direction]);

  const matches = useMemo(() => {
    if (!built.ok) return rows;
    return rows.filter((r) => matchesFilters(r, built.filters));
  }, [rows, built]);
  const sorted = useMemo(() => sortRows(matches, sort), [matches, sort]);
  const sums = useMemo(() => sumByAsset(matches), [matches]);
  const wallets = useMemo(() => new Set(matches.map((r) => r.from).filter(Boolean)).size, [matches]);

  const anyFilter = memos.length || notMemos.length || wrongMode || recipients.length || amount || memoDraft.trim() || direction !== 'all';
  const wrongMemoEmpty = wrongMode && memos.length === 0 && !cleanMemo(memoDraft);

  const closeEditor = () => { setEditor(null); setEditorText(''); setEditorErrors([]); };
  const openEditor = (kind) => {
    setMenuOpen(false);
    setEditorErrors([]);
    setEditorText('');
    if (kind === 'amount') setAmountDraft(amount || EMPTY_AMOUNT);
    setEditor(kind);
  };

  const addMemoFromDraft = () => {
    const m = cleanMemo(memoDraft);
    if (!m) return;
    setMemos((prev) => (prev.includes(m) || prev.length >= MAX_FILTER_ENTRIES ? prev : [...prev, m]));
    setMemoDraft('');
  };

  const commitText = () => {
    if (editor === 'notMemo') {
      const m = cleanMemo(editorText);
      if (m) setNotMemos((prev) => (prev.includes(m) || prev.length >= MAX_FILTER_ENTRIES ? prev : [...prev, m]));
      closeEditor();
      return;
    }
    // Empfaenger: mehrere Adressen durch Leerzeichen, Komma oder Zeilenumbruch
    const tokens = [...new Set(editorText.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
    const parsed = tokens.map(parseRecipient);
    const errs = parsed.filter((p) => p.error).map((p) => ({ key: p.error, params: p.error === 'recipientInvalid' ? { value: p.value } : {} }));
    if (errs.length) {
      // Ein eingefuegter Secret Key wird sofort aus dem Feld entfernt, er soll nicht stehen bleiben.
      if (errs.some((e) => e.key === 'recipientSecretKey')) setEditorText('');
      setEditorErrors(errs);
      return;
    }
    setRecipients((prev) => {
      const next = [...prev];
      for (const p of parsed) {
        if (next.length < MAX_FILTER_ENTRIES && !next.some((x) => x.value === p.value)) next.push(p);
      }
      return next;
    });
    closeEditor();
  };

  const commitAmount = () => {
    const d = amountDraft;
    if (!String(d.min).trim() && !String(d.max).trim()) { setEditorErrors([{ key: 'amountEmpty', params: {} }]); return; }
    const res = buildSearchFilters({
      amountAsset: d.asset, assetCode: d.code, assetIssuer: d.issuer, amountMin: d.min, amountMax: d.max,
    });
    if (!res.ok) { setEditorErrors(res.errors); return; }
    setAmount({ ...d, min: String(d.min).trim(), max: String(d.max).trim(), code: String(d.code).trim(), issuer: String(d.issuer).trim() });
    closeEditor();
  };

  const resetAll = () => {
    setMemoDraft(''); setMemos([]); setNotMemos([]); setWrongMode(false); setRecipients([]); setAmount(null); setDirection('all'); closeEditor();
  };

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const dirLabel = (d) => (d ? t(`xlmByMemo:search.dir.${d}`) : '');
  const shown = sorted.slice(0, MAX_SHOWN);
  const amountLabel = amount
    ? t('xlmByMemo:search.chips.amount', {
      from: amount.min || '…', to: amount.max || '…',
      asset: amount.asset === 'custom' ? amount.code : 'XLM',
    })
    : '';
  const inputCls = 'border rounded-sm p-2 text-sm';

  return (
    <section className="mt-4" aria-label={t('xlmByMemo:search.title')}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} flex-1 min-w-[12rem]`}
          type="search"
          aria-label={t('xlmByMemo:search.memoLabel')}
          placeholder={t(wrongMode ? 'xlmByMemo:search.placeholderWrong' : 'xlmByMemo:search.placeholder')}
          value={memoDraft}
          onChange={(e) => setMemoDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMemoFromDraft(); } }}
        />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="px-3 py-2 rounded-sm border text-sm"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            + {t('xlmByMemo:search.addFilter')}
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-sm border bg-gray-800 text-white shadow-lg" onKeyDown={(e) => { if (e.key === 'Escape') setMenuOpen(false); }}>
              {['recipient', 'amount', 'notMemo'].map((k) => (
                <button key={k} role="menuitem" type="button" className="block w-full !rounded-none !border-0 !bg-transparent text-left text-sm hover:!bg-gray-700" onClick={() => openEditor(k)}>
                  {t(`xlmByMemo:search.menu.${k}`)}
                </button>
              ))}
            </div>
          )}
        </div>
        <Seg
          value={direction}
          onChange={setDirection}
          ariaLabel={t('xlmByMemo:search.direction.label')}
          options={[
            { value: 'all', label: t('xlmByMemo:search.direction.all') },
            { value: 'in', label: t('xlmByMemo:search.direction.in') },
            { value: 'out', label: t('xlmByMemo:search.direction.out') },
          ]}
        />
      </div>

      <div className="mt-2">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={wrongMode}
            onChange={(e) => {
              setWrongMode(e.target.checked);
              // Falsche Memos gibt es nur bei Eingaengen: Richtung sichtbar auf Eingang stellen
              if (e.target.checked) setDirection((d) => (d === 'all' ? 'in' : d));
            }}
          />
          {t('xlmByMemo:search.wrongMode.label')}
        </label>
        {wrongMode && !wrongMemoEmpty && <p className="text-xs text-gray-500 mt-1">{t('xlmByMemo:search.wrongMode.hint')}</p>}
        {wrongMemoEmpty && <p className="text-sm text-amber-500 mt-1" role="alert">{t('xlmByMemo:search.wrongMode.empty')}</p>}
      </div>

      {editor && (
        <div className="mt-2 rounded-sm border p-2" role="group" aria-label={t(`xlmByMemo:search.menu.${editor}`)}>
          {editor !== 'amount' ? (
            <div className="flex flex-wrap gap-2">
              <input
                className={`${inputCls} flex-1 min-w-[12rem] ${editor === 'recipient' ? 'font-mono' : ''}`}
                autoFocus
                spellCheck={false}
                aria-label={t(`xlmByMemo:search.menu.${editor}`)}
                placeholder={t(`xlmByMemo:search.editor.${editor}Placeholder`)}
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } if (e.key === 'Escape') closeEditor(); }}
              />
              <button type="button" className="px-3 py-2 rounded-sm bg-blue-600 text-white text-sm" onClick={commitText}>{t('xlmByMemo:search.editor.add')}</button>
              <button type="button" className="px-3 py-2 rounded-sm border text-sm" onClick={closeEditor}>{t('common:progress.cancel')}</button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input className={`${inputCls} w-28`} inputMode="decimal" autoFocus aria-label={t('xlmByMemo:search.editor.from')} placeholder={t('xlmByMemo:search.editor.from')}
                  value={amountDraft.min} onChange={(e) => setAmountDraft((d) => ({ ...d, min: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAmount(); } }} />
                <span aria-hidden="true">–</span>
                <input className={`${inputCls} w-28`} inputMode="decimal" aria-label={t('xlmByMemo:search.editor.to')} placeholder={t('xlmByMemo:search.editor.to')}
                  value={amountDraft.max} onChange={(e) => setAmountDraft((d) => ({ ...d, max: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAmount(); } }} />
                <Seg
                  value={amountDraft.asset}
                  onChange={(v) => setAmountDraft((d) => ({ ...d, asset: v }))}
                  ariaLabel={t('xlmByMemo:search.editor.asset')}
                  options={[{ value: 'native', label: 'XLM' }, { value: 'custom', label: t('xlmByMemo:search.editor.assetCustom') }]}
                />
              </div>
              {amountDraft.asset === 'custom' && (
                <div className="flex flex-wrap gap-2">
                  <input className={`${inputCls} w-28`} aria-label={t('xlmByMemo:search.editor.code')} placeholder={t('xlmByMemo:search.editor.code')}
                    value={amountDraft.code} onChange={(e) => setAmountDraft((d) => ({ ...d, code: e.target.value }))} />
                  <input className={`${inputCls} flex-1 min-w-[12rem] font-mono`} spellCheck={false} aria-label={t('xlmByMemo:search.editor.issuer')} placeholder={t('xlmByMemo:search.editor.issuer')}
                    value={amountDraft.issuer} onChange={(e) => setAmountDraft((d) => ({ ...d, issuer: e.target.value }))} />
                </div>
              )}
              <p className="text-xs text-gray-500">{t('xlmByMemo:search.editor.amountHint')}</p>
              <div className="flex gap-2">
                <button type="button" className="px-3 py-2 rounded-sm bg-blue-600 text-white text-sm" onClick={commitAmount}>{t('xlmByMemo:search.editor.apply')}</button>
                <button type="button" className="px-3 py-2 rounded-sm border text-sm" onClick={closeEditor}>{t('common:progress.cancel')}</button>
              </div>
            </div>
          )}
          {editorErrors.length > 0 && (
            <ul className="mt-2 text-red-600 text-sm list-disc pl-5" role="alert">
              {editorErrors.map((e, i) => <li key={i}>{t(`xlmByMemo:search.errors.${e.key}`, e.params)}</li>)}
            </ul>
          )}
        </div>
      )}

      {(memos.length > 0 || notMemos.length > 0 || recipients.length > 0 || amount) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {memos.map((m) => {
            const label = t(wrongMode ? 'xlmByMemo:search.chips.wrongMemo' : 'xlmByMemo:search.chips.memo', { value: sanitizeMemo(m) });
            return <Chip key={`m-${m}`} label={label} removeLabel={t('xlmByMemo:search.chips.remove', { label })} onRemove={() => setMemos((p) => p.filter((x) => x !== m))} />;
          })}
          {notMemos.map((m) => {
            const label = t('xlmByMemo:search.chips.notMemo', { value: sanitizeMemo(m) });
            return <Chip key={`n-${m}`} label={label} removeLabel={t('xlmByMemo:search.chips.remove', { label })} onRemove={() => setNotMemos((p) => p.filter((x) => x !== m))} />;
          })}
          {recipients.map((r) => {
            const label = t('xlmByMemo:search.chips.recipient', { value: `${r.value.slice(0, 6)}…${r.value.slice(-6)}` });
            return <Chip key={`r-${r.value}`} label={label} title={r.value} removeLabel={t('xlmByMemo:search.chips.remove', { label })} onRemove={() => setRecipients((p) => p.filter((x) => x.value !== r.value))} />;
          })}
          {amount && (
            <Chip label={amountLabel} removeLabel={t('xlmByMemo:search.chips.remove', { label: amountLabel })} onEdit={() => openEditor('amount')} onRemove={() => setAmount(null)} />
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{t('xlmByMemo:search.result.count', { shown: matches.length, total: rows.length })}</span>
        <span className="text-xs text-gray-500">{t('xlmByMemo:search.result.wallets', { n: wallets })}</span>
        {sums.length > 0 && (
          <span className="text-xs">
            <span className="text-gray-500">{t('xlmByMemo:search.result.sums')} </span>
            {sums.map((s) => (
              <span key={s.assetKey} className="inline-block mr-3">{t('xlmByMemo:search.result.sumLine', { amount: s.amount, asset: s.label, count: s.count })}</span>
            ))}
          </span>
        )}
        {anyFilter && <button type="button" className="!p-0 !border-0 !bg-transparent text-xs underline" onClick={resetAll}>{t('xlmByMemo:search.result.reset')}</button>}
      </div>
      {incomplete && (
        <div className="mt-1 text-xs text-amber-500" role="status">
          {t('xlmByMemo:search.result.incomplete', { date: oldestLoaded ? formatLocalDateTime(oldestLoaded) : '–' })}
        </div>
      )}
      {memoIncomplete && <div className="mt-1 text-xs text-amber-500" role="status">{t('xlmByMemo:search.result.memoIncomplete')}</div>}

      {sorted.length === 0 ? (
        <div className="mt-3 text-sm text-gray-500">{t(rows.length === 0 ? 'xlmByMemo:search.result.noneLoaded' : 'xlmByMemo:search.result.none')}</div>
      ) : (
        <>
          <div className="mt-2 overflow-auto max-h-[28rem] text-xs">
            <div className="grid grid-cols-6 gap-2 font-semibold sticky top-0 bg-gray z-10 py-1">
              <button type="button" className="!p-0 !border-0 !bg-transparent text-left font-semibold" onClick={() => toggleSort('created_at')}>{t('xlmByMemo:search.columns.created_at')}{arrow('created_at')}</button>
              <div>{t('xlmByMemo:search.columns.from')}</div>
              <div>{t('xlmByMemo:search.columns.to')}</div>
              <button type="button" className="!p-0 !border-0 !bg-transparent text-left font-semibold" onClick={() => toggleSort('amount')}>{t('xlmByMemo:search.columns.amount')}{arrow('amount')}</button>
              <div>{t('xlmByMemo:search.columns.memo')}</div>
              <div>{t('xlmByMemo:search.columns.tx_hash')}</div>
            </div>
            {shown.map((r, i) => (
              <div key={`${r.id}-${i}`} className="grid grid-cols-6 gap-2 py-0.5">
                <div>
                  <div className="font-mono">{r.created_at}</div>
                  <div className="text-gray-500">{[dirLabel(r.dir), r.type].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="font-mono break-all">{r.from}</div>
                <div className="font-mono break-all">{r.to}</div>
                <div className="font-mono">{r.amount ? `${r.amount} ${assetLabel(r.assetKey)}` : '–'}</div>
                <MemoCell memo={r.memo} />
                <div className="font-mono break-all">{r.tx_hash}</div>
              </div>
            ))}
          </div>
          {sorted.length > MAX_SHOWN && (
            <div className="text-xs text-gray-500 mt-1">{t('xlmByMemo:search.result.capped', { shown: MAX_SHOWN, total: sorted.length })}</div>
          )}
          <div className="mt-2">
            <button
              type="button"
              className="px-2 py-1 text-sm rounded-sm border bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-50"
              onClick={() => onDownloadCsv(sorted.map(csvRowOf), CSV_HEADERS)}
              disabled={busy}
            >
              {t('xlmByMemo:search.result.csv')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
