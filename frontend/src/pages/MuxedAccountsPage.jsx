import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildMuxedAddress } from '../utils/muxed.js';
import usePageMeta from '../utils/usePageMeta.js';
import { listMuxed, addMuxed, removeMuxed, exportMuxedCsv, importMuxedCsvText, exportMuxedTemplateCsv } from '../utils/muxedStore.js';

// TEMP DEBUG for muxed page investigations
const DBG = {
  log: (...args) => { try { console.debug('[MuxedAccountsPage]', ...args); } catch { /* noop */ } },
  warn: (...args) => { try { console.warn('[MuxedAccountsPage]', ...args); } catch { /* noop */ } },
  error: (...args) => { try { console.error('[MuxedAccountsPage]', ...args); } catch { /* noop */ } },
};

// Diese Seite holt sich den aktiven Account direkt aus localStorage.
// So funktioniert die Erstellung von Muxed-Konten auch dann,
// wenn der Aufrufer kein publicKey-Prop gesetzt hat
// oder der Main-State noch nicht weitergereicht wurde.
export default function MuxedAccountsPage({ publicKey }) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = React.useState('');
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [rows, setRows] = React.useState([]);
  const [selected, setSelected] = React.useState(new Set());
  const [countInput, setCountInput] = React.useState('1');

  const [netLabel, setNetLabel] = React.useState(() => {
    try {
      return (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET')
        ? 'TESTNET'
        : 'PUBLIC';
    } catch {
      return 'PUBLIC';
    }
  });

  const [editingId, setEditingId] = React.useState(null);
  const [editLabel, setEditLabel] = React.useState('');
  const [editNote, setEditNote] = React.useState('');
  const [focusField, setFocusField] = React.useState('label');

  const fileInputRef = React.useRef(null);

  const labelInputRef = React.useRef(null);
  const noteInputRef = React.useRef(null);

  const [sort, setSort] = React.useState({ by: 'id', dir: 'asc' });

  const onSort = React.useCallback((key) => {
    setSort((s) => (
      s.by === key
        ? { by: s.by, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { by: key, dir: 'asc' }
    ));
  }, []);

  const sortedRows = React.useMemo(() => {
    const arr = [...rows];
    const dir = sort.dir === 'asc' ? 1 : -1;
    const cmpStr = (a, b) => String(a || '').localeCompare(String(b || ''));
    const cmpBig = (a, b) => {
      try {
        const ai = BigInt(a);
        const bi = BigInt(b);
        return ai < bi ? -1 : ai > bi ? 1 : 0;
      } catch {
        return cmpStr(a, b);
      }
    };
    const cmpDate = (a, b) => {
      const ta = Date.parse(a || '') || 0;
      const tb = Date.parse(b || '') || 0;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    };
    arr.sort((ra, rb) => {
      let c = 0;
      switch (sort.by) {
        case 'id': c = cmpBig(ra.id, rb.id); break;
        case 'address': c = cmpStr(ra.address, rb.address); break;
        case 'label': c = cmpStr(ra.label, rb.label); break;
        case 'note': c = cmpStr(ra.note, rb.note); break;
        case 'createdAt': c = cmpDate(ra.createdAt, rb.createdAt); break;
        default: c = 0;
      }
      return c * dir;
    });
    return arr;
  }, [rows, sort]);

  const sortIndicator = React.useCallback((col) => {
    if (sort.by !== col) return null;
    return (<span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>);
  }, [sort]);



  // Initial + bei Änderungen von publicKey / netLabel Liste laden
  React.useEffect(() => {
    DBG.log('effect(loadRows)', { publicKey, netLabel });
    if (!publicKey) {
      setRows([]);
      setSelected(new Set());
      return;
    }
    try {
      const ls = listMuxed(publicKey, netLabel);
      DBG.log('listMuxed ->', ls);
      setRows(ls);
    } catch (e) {
      DBG.error('listMuxed failed', e);
    }
    setSelected(new Set());
  }, [publicKey, netLabel]);

  React.useEffect(() => {
    const handler = (e) => {
      try {
        const v = (typeof e?.detail === 'string')
          ? e.detail
          : (window.localStorage?.getItem('STM_NETWORK') || 'PUBLIC');
        DBG.log('stm-network-changed', { detail: e?.detail, resolved: v });
        setNetLabel(v === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
      } catch { /* noop */ }
    };
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  // SEO: set page title and description using i18n
  const titleKey = 'muxed.seo.title';
  const descKey = 'muxed.seo.description';
  const hasTitleInLang = !!i18n.getResource?.(i18n.language, 'translation', titleKey);
  const hasDescInLang = !!i18n.getResource?.(i18n.language, 'translation', descKey);
  const metaTitle = hasTitleInLang ? t(titleKey) : 'Muxed account create/manage';
  const metaDesc = hasDescInLang ? t(descKey) : 'Create and manage muxed M-address aliases for a Stellar account. Generate IDs, add labels/notes, export/import CSV.';
  usePageMeta(metaTitle, metaDesc);

  const toggleAll = React.useCallback(() => {
    if (!rows.length) return;
    const allIds = rows.map(r => String(r.id));
    const allSelected = allIds.every(id => selected.has(id));
    setSelected(new Set(allSelected ? [] : allIds));
  }, [rows, selected]);

  const toggleOne = React.useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      const k = String(id);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  const onDeleteSelected = React.useCallback(() => {
    DBG.log('onDeleteSelected', { selected: Array.from(selected) });
    if (!publicKey) return;
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { removed } = removeMuxed(publicKey, ids, netLabel);
    DBG.log('removeMuxed ->', { removed });
    if (removed > 0) {
      const next = listMuxed(publicKey, netLabel);
      DBG.log('after delete listMuxed ->', next);
      setRows(next);
      setSelected(new Set());
      setSuccess(t('muxed.deleteSuccess', 'Auswahl gelöscht.'));
      setError('');
    }
  }, [publicKey, selected, netLabel, t]);

  const onExport = React.useCallback(() => {
    DBG.log('onExport', { publicKey, netLabel });
    if (!publicKey) {
      setError(t('muxed.error.noBaseAccount', 'Bitte ein bestehendes Konto auswählen.'));
      return;
    }
    try {
      exportMuxedCsv(publicKey, t('muxed.export.filename', 'muxed_accounts.csv'), netLabel);
      setSuccess(t('muxed.export.success', 'Muxed-Konten erfolgreich exportiert.'));
      setError('');
    } catch (e) {
      DBG.error('exportMuxedCsv failed', e);
      setError(t('muxed.export.failed', 'Fehler beim Export der Muxed-Konten.'));
    }
  }, [publicKey, netLabel, t]);

  const onExportTemplate = React.useCallback(() => {
    try {
      exportMuxedTemplateCsv('muxed_accounts_template.csv');
      setSuccess(t('muxed.exportTemplateSuccess', 'Template erfolgreich exportiert.'));
      setError('');
    } catch (e) {
      DBG.error('exportMuxedTemplateCsv failed', e);
      setError(t('muxed.exportTemplateFailed', 'Fehler beim Export des Templates.'));
    }
  }, [t]);

  const onImportClick = React.useCallback(() => {
    DBG.log('onImportClick');
    if (!publicKey) {
      setError(t('muxed.error.noBaseAccount', 'Bitte ein bestehendes Konto auswählen.'));
      return;
    }
    setError('');
    setSuccess('');
    fileInputRef.current?.click();
  }, [publicKey, t]);

  const onImportFileChange = React.useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const txt = String(reader.result || '');
        DBG.log('onImportFileChange loaded file, size', txt.length);
        const res = importMuxedCsvText(publicKey, txt, netLabel);
        DBG.log('importMuxedCsvText ->', res);
        setRows(listMuxed(publicKey, netLabel));
        setSelected(new Set());
        setSuccess(t('muxed.import.success', 'Importiert: {{imported}} • Übersprungen: {{skipped}} • Fehler: {{errors}}.', res));
        setError('');
      } catch (err) {
        DBG.error('importMuxedCsvText failed', err);
        setError(t('muxed.import.failed', 'Fehler beim Import.'));
      } finally {
        e.target.value = '';
      }
    };
    reader.onerror = () => {
      setError(t('muxed.import.failed', 'Fehler beim Import.'));
      e.target.value = '';
    };
    reader.readAsText(file);
  }, [publicKey, netLabel, t]);

  // Direkt erstellen. Kein aufgeklapptes Panel mehr.
  const onGenerate = React.useCallback(() => {
    DBG.log('onGenerate start', { publicKey, countInput, netLabel });
    setResult('');
    setError('');
    setSuccess('');

    if (!publicKey) {
      setError(t('muxed.error.noBaseAccount', 'Please select an existing account.'));
      return;
    }

    const rawCount = (countInput || '1').trim();
    const countNum = parseInt(rawCount, 10);
    if (!Number.isFinite(countNum) || countNum < 1) {
      setError(t('muxed.invalidCount', 'Please enter a valid amount (>= 1).'));
      return;
    }
    if (countNum > 100) {
      setError(t('muxed.tooMany', 'Please create at most 100 at once.'));
      return;
    }

    try {
      // höchste vergebene ID bestimmen
      const currentMax = rows.reduce((m, r) => {
        try { const v = BigInt(r.id); return v > m ? v : m; } catch { return m; }
      }, 0n);
      const startId = (rows.length === 0 ? 1n : currentMax + 1n);
      const MAX = 18446744073709551615n;
      const lastId = startId + BigInt(countNum - 1);
      if (lastId > MAX) {
        setError(t('muxed.rangeOverflow', 'The ID range exceeds the maximum allowed muxed ID.'));
        return;
      }

      let lastAddress = '';
      for (let i = 0; i < countNum; i++) {
        const id = startId + BigInt(i);
        const idStr = id.toString();
        DBG.log('buildMuxedAddress()', { idStr });
        const m = buildMuxedAddress(publicKey, idStr);
        DBG.log('buildMuxedAddress ->', m);
        lastAddress = m;
        addMuxed(
          publicKey,
          {
            id: idStr,
            address: m,
            label: '',
            note: '',
          },
          netLabel
        );
      }

      const next = listMuxed(publicKey, netLabel);
      DBG.log('after generate listMuxed ->', next);
      setRows(next);
      setSelected(new Set());
      setResult(countNum === 1 ? lastAddress : '');
      setSuccess(t('muxed.generateSuccess', 'Muxed-Adresse(n) erstellt.'));
    } catch (err) {
      DBG.error('onGenerate failed', err);
      const msg = String(err?.message || '');
      const detail = msg.startsWith('submitTransaction.failed:')
        ? msg.slice('submitTransaction.failed:'.length)
        : msg;
      setError(t(detail, t('muxed.error.unknown', 'Unknown error while generating muxed address.')));
    }
  }, [publicKey, countInput, rows, netLabel, t]);

  const onCopy = React.useCallback(async (text) => {
    DBG.log('onCopy', text);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setSuccess(t('muxed.copied', 'Copied to clipboard.'));
      setError('');
    } catch (e) {
      DBG.error('copy failed', e);
      setError(t('muxed.import.failed', 'Fehler beim Import.'));
    }
  }, [t]);

  const startEdit = React.useCallback((row, field = 'label') => {
    DBG.log('startEdit', row, field);
    setEditingId(String(row.id));
    setEditLabel(row.label || '');
    setEditNote(row.note || '');
    setFocusField(field === 'note' ? 'note' : 'label');
  }, []);

  const cancelEdit = React.useCallback(() => {
    DBG.log('cancelEdit');
    setEditingId(null);
    setEditLabel('');
    setEditNote('');
  }, []);

  const saveEdit = React.useCallback(() => {
    DBG.log('saveEdit', { editingId, editLabel, editNote });
    if (!editingId || !publicKey) return;
    try {
      const row = rows.find(r => String(r.id) === String(editingId));
      if (!row) return;
      addMuxed(publicKey, { id: row.id, address: row.address, label: editLabel, note: editNote }, netLabel);
      setRows(listMuxed(publicKey, netLabel));
      setSuccess(t('muxed.editSaved', 'Saved changes.'));
      setError('');
      cancelEdit();
    } catch (e) {
      DBG.error('saveEdit failed', e);
      setError(t('muxed.import.failed', 'Fehler beim Import.'));
    }
  }, [editingId, editLabel, editNote, publicKey, rows, netLabel, t, cancelEdit]);

  const handleInlineBlur = React.useCallback((e) => {
    const rt = e?.relatedTarget || null;
    if (rt && (rt === labelInputRef.current || rt === noteInputRef.current)) {
      return; // focus remains within the same row's edit inputs; don't save yet
    }
    // otherwise, focus left the edit area -> save
    saveEdit();
  }, [saveEdit]);

  React.useEffect(() => {
    if (!editingId) return;
    const el = focusField === 'note' ? noteInputRef.current : labelInputRef.current;
    if (el && typeof el.focus === 'function') {
      setTimeout(() => {
        try { el.focus({ preventScroll: true }); } catch { el.focus(); }
      }, 0);
    }
  }, [editingId, focusField]);

  if (!publicKey) {
    DBG.warn('render with no publicKey');
    return (
      <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
        {t('investedTokens.hintEnterPublicKey')}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">{t('muxed.title', 'Muxed account create/manage')}</h2>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-200 mb-4">{t('muxed.explainer', 'Create M-addresses that point to the same account, distinguished by ID.')}</p>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">{t('muxed.selectBaseAccount', 'Base account (G-address)')}</label>
          {publicKey ? (
            <div className="w-full border rounded p-2 font-mono bg-gray-50 text-gray-900" aria-readonly="true">
              {publicKey}
            </div>
          ) : (
            <div className="w-full border rounded p-2 font-mono bg-gray-50 text-gray-400 italic" aria-readonly="true">
              {t('muxed.selectPlaceholder', 'Please select account')}
            </div>
          )}
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {t('muxed.baseAccountInfo', 'The M-address will always point to this base account.')}
          </p>
        </div>

        {/* Erstellen + Import/Export jetzt in einem festen Block. Kein Aufklappen mehr. */}
        <div className="border rounded p-3 space-y-3">
          <div className="flex flex-col md:flex-row md:items-start md:gap-3">
            <div className="mb-3 md:mb-0">
              <label className="block text-sm font-medium mb-1">{t('muxed.countLabel', 'Anzahl')}</label>
              <input
                type="number"
                min="1"
                max="100"
                className="border rounded p-2 w-36 sm:w-44"
                placeholder="1"
                value={countInput}
                onChange={(e) => setCountInput(e.target.value)}
              />
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {t('muxed.countInfo', 'Anzahl neuer Muxed-Adressen, fortlaufende IDs.')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onGenerate}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              {t('muxed.generateButton', 'Create muxed account')}
            </button>

            <button
              type="button"
              onClick={onExport}
              className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              disabled={!rows.length}
            >
              {t('muxed.exportButton', 'Exportieren')}
            </button>

            <button
              type="button"
              onClick={onExportTemplate}
              className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('muxed.exportTemplateButton', 'Template exportieren')}
            </button>


            <button
              type="button"
              onClick={onImportClick}
              className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('muxed.importButton', 'Importieren')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onImportFileChange}
            />
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-400">
            {t('muxed.import.hint', 'Import supports CSV with headers. Delimiters comma, semicolon and tab are auto-detected. Unknown columns are ignored. Formats: extended (network,basePublicKey,muxedId,label,note,createdAt) or template (muxedId,label,note).')}
          </p>
        </div>

        <div className="mt-6">
          <h3 className="font-semibold mb-2">{t('muxed.listTitle', 'Existing muxed accounts')}</h3>
          {rows.length === 0 ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">{t('muxed.none', 'No muxed accounts stored.')}</div>
          ) : (
            <div className="overflow-x-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="p-2 text-left w-10">
                      <input
                        type="checkbox"
                        aria-label={t('muxed.selectAll', 'Select all')}
                        onChange={toggleAll}
                        checked={rows.length>0 && rows.every(r => selected.has(String(r.id)))} />
                    </th>
                    <th className="p-2 text-left">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('id')}>
                        {t('muxed.columns.id', 'Muxed ID')} {sortIndicator('id')}
                      </button>
                    </th>
                    <th className="p-2 text-left">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('address')}>
                        {t('muxed.columns.address', 'Muxed address')} {sortIndicator('address')}
                      </button>
                    </th>
                    <th className="p-2 text-left" title={t('muxed.labelInfo', 'z. B. Mitarbeitername oder Zweck')}>
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('label')}>
                        {t('muxed.columns.label', 'Bezeichnung')} {sortIndicator('label')}
                      </button>
                    </th>
                    <th className="p-2 text-left" title={t('muxed.noteInfo', 'z. B. Abteilung / Projekt')}>
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('note')}>
                        {t('muxed.columns.note', 'Notiz')} {sortIndicator('note')}
                      </button>
                    </th>
                    <th className="p-2 text-left">
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('createdAt')}>
                        {t('muxed.columns.createdAt', 'Created')} {sortIndicator('createdAt')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(r => (
                    <tr key={r.id} className="border-t align-top">
                      <td className="p-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(String(r.id))}
                          onChange={() => toggleOne(r.id)} />
                      </td>
                      <td className="p-2 align-top font-mono">{r.id}</td>
                      <td className="p-2 align-top font-mono break-all">
                        <span className="break-all">{r.address}</span>
                      </td>
                      <td className="p-2 align-top break-all">
                        {editingId === String(r.id) ? (
                          <input
                            type="text"
                            className="w-full border rounded p-1"
                            title={t('muxed.labelInfo', 'z. B. Mitarbeitername oder Zweck')}
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            onBlur={handleInlineBlur}
                            ref={labelInputRef}
                          />
                        ) : (
                          <span
                            className="cursor-text"
                            title={t('muxed.labelInfo', 'z. B. Mitarbeitername oder Zweck')}
                            tabIndex={0}
                            role="button"
                            onClick={() => startEdit(r, 'label')}
                            onKeyDown={(e) => { if (e.key === 'Enter') startEdit(r, 'label'); }}
                          >
                            {r.label || (<span className="text-gray-400">{t('muxed.label', 'Bezeichnung')}</span>)}
                          </span>
                        )}
                      </td>
                      <td className="p-2 align-top break-all">
                        {editingId === String(r.id) ? (
                          <input
                            type="text"
                            className="w-full border rounded p-1"
                            title={t('muxed.noteInfo', 'z. B. Abteilung / Projekt')}
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                            onBlur={handleInlineBlur}
                            ref={noteInputRef}
                          />
                        ) : (
                          <span
                            className="cursor-text"
                            title={t('muxed.noteInfo', 'z. B. Abteilung / Projekt')}
                            tabIndex={0}
                            role="button"
                            onClick={() => startEdit(r, 'note')}
                            onKeyDown={(e) => { if (e.key === 'Enter') startEdit(r, 'note'); }}
                          >
                            {r.note || (<span className="text-gray-400">{t('muxed.columns.note', 'Notiz')}</span>)}
                          </span>
                        )}
                      </td>
                      <td className="p-2 align-top">{new Date(r.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={onDeleteSelected} className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50" disabled={selected.size===0}>
                {t('muxed.deleteSelected', 'Delete selected')}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-700 border border-red-400 rounded p-2">{error}</div>
        )}
        {success && !error && (
          <div className="text-sm text-green-700 border border-green-400 rounded p-2">{success}</div>
        )}

        {result && (
          <div>
            <label className="block text-sm font-medium mb-1">{t('createAccount.muxedAddress', 'Muxed address')}</label>
            <div className="flex items-center gap-2">
              <input type="text" className="w-full border rounded p-2 font-mono" value={result} readOnly />
              <button type="button" className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => onCopy(result)}>{t('option.copy', 'Copy')}</button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t('createAccount.muxedActivationInfo', 'Muxed addresses are aliases. They do not need activation.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
