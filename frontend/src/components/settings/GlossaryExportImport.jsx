import React from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { glossaryGroups } from '../../utils/glossary.ts';

const LANGS = ['de', 'en', 'es', 'fi', 'fr', 'hr', 'it', 'nl', 'ru'];

// Metadata keys that are not glossary entries
const META_KEYS = ['pageTitle', 'pageIntro', 'searchLabel', 'searchPlaceholder', 'searchHint', 'noResults', 'groups', 'missingKey'];

// Build slug→group lookup from glossaryGroups
const slugToGroup = {};
for (const group of glossaryGroups) {
  for (const slug of group.slugs) {
    slugToGroup[slug] = group.id;
  }
}

export default function GlossaryExportImport() {
  const { t, i18n } = useTranslation(['settings', 'glossary']);
  const [lang, setLang] = React.useState(i18n.language?.split('-')[0] || 'de');
  const [importData, setImportData] = React.useState(null);
  const [importError, setImportError] = React.useState('');
  const [importPreview, setImportPreview] = React.useState(null);
  const fileRef = React.useRef(null);

  // ── EXPORT ──────────────────────────────────────────────────────────
  const handleExport = React.useCallback(() => {
    try {
      const bundle = i18n.getResourceBundle(lang, 'glossary');
      if (!bundle) { setImportError(t('settings:maintenance.noData')); return; }

      const rows = [];
      for (const [slug, entry] of Object.entries(bundle)) {
        if (META_KEYS.includes(slug)) continue;
        if (typeof entry !== 'object' || entry === null) continue;

        rows.push({
          Slug: slug,
          Titel: entry.title || '',
          Original: entry.original || '',
          Kurz: entry.short || '',
          Beschreibung: entry.desc || '',
          Kategorie: slugToGroup[slug] || '',
          Verwandte_Begriffe: Array.isArray(entry.seeAlso) ? entry.seeAlso.join(', ') : '',
        });
      }

      if (rows.length === 0) { setImportError(t('settings:maintenance.noData')); return; }

      // Sort by category then slug
      rows.sort((a, b) => (a.Kategorie || '').localeCompare(b.Kategorie || '') || a.Slug.localeCompare(b.Slug));

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 50 }, { wch: 60 }, { wch: 20 }, { wch: 30 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Glossary');
      const today = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `glossary_${lang}_${today}.xlsx`);
      setImportError('');
    } catch (err) {
      setImportError(String(err?.message || err));
    }
  }, [lang, i18n, t]);

  // ── IMPORT ──────────────────────────────────────────────────────────
  const handleFile = React.useCallback((e) => {
    setImportError('');
    setImportData(null);
    setImportPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
      setImportError(t('settings:maintenance.invalidFile'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!rows || rows.length === 0) {
          setImportError(t('settings:maintenance.noData'));
          return;
        }

        // Validate
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const missing = [];
          if (!row.Slug) missing.push('Slug');
          if (!row.Titel) missing.push('Titel');
          if (!row.Kurz) missing.push('Kurz');
          if (!row.Beschreibung) missing.push('Beschreibung');
          if (missing.length > 0) {
            errors.push(`${t('settings:maintenance.row', { row: i + 2 })}: ${t('settings:maintenance.requiredFields', { fields: missing.join(', ') })}`);
          }
        }

        if (errors.length > 0) {
          setImportError(errors.join('\n'));
          return;
        }

        setImportData(rows);
        setImportPreview({ terms: rows.length });
      } catch (err) {
        setImportError(String(err?.message || err));
      }
    };
    reader.readAsArrayBuffer(file);
  }, [t]);

  // ── BUILD JSON & DOWNLOAD ──────────────────────────────────────────
  const handleDownloadJson = React.useCallback(() => {
    if (!importData) return;
    try {
      const bundle = i18n.getResourceBundle(lang, 'glossary') || {};
      const result = {};

      // Preserve metadata keys
      for (const key of META_KEYS) {
        if (bundle[key] !== undefined) result[key] = JSON.parse(JSON.stringify(bundle[key]));
      }

      // Build entries from imported data
      for (const row of importData) {
        const slug = String(row.Slug || '').trim();
        if (!slug) continue;
        const entry = {
          title: row.Titel || '',
          original: row.Original || '',
          short: row.Kurz || '',
          desc: row.Beschreibung || '',
        };
        // Preserve seeAlso if present
        const related = String(row.Verwandte_Begriffe || '').trim();
        if (related) {
          entry.seeAlso = related.split(',').map(s => s.trim()).filter(Boolean);
        }
        // Preserve help sub-object from existing bundle if it exists
        if (bundle[slug]?.help) {
          entry.help = JSON.parse(JSON.stringify(bundle[slug].help));
        }
        result[slug] = entry;
      }

      const blob = new Blob([JSON.stringify(result, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `glossary_${lang}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setImportError(String(err?.message || err));
    }
  }, [importData, lang, i18n]);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t('settings:maintenance.title')}
      </h3>

      {/* Language selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="glossary-export-lang" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('settings:maintenance.selectLanguage')}
        </label>
        <select
          id="glossary-export-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
        >
          {LANGS.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </div>

      {/* Export button */}
      <button
        type="button"
        onClick={handleExport}
        className="px-4 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
      >
        {t('settings:maintenance.exportExcel')}
      </button>

      {/* Import section */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('settings:maintenance.importFile')}
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv"
          onChange={handleFile}
          className="block text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-200 file:text-gray-800 dark:file:bg-gray-700 dark:file:text-gray-200 hover:file:bg-gray-300 dark:hover:file:bg-gray-600"
        />
      </div>

      {/* Error display */}
      {importError && (
        <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">
          {importError}
        </div>
      )}

      {/* Preview */}
      {importPreview && !importError && (
        <div className="p-3 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300">
          <div className="font-semibold">{t('settings:maintenance.preview')}</div>
          <div>{t('settings:maintenance.termsFound', { count: importPreview.terms })}</div>
          <button
            type="button"
            onClick={handleDownloadJson}
            className="mt-2 px-4 py-2 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            {t('settings:maintenance.downloadJson')}
          </button>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('settings:maintenance.replaceHint', { lang, file: 'glossary.json' })}
          </div>
        </div>
      )}
    </div>
  );
}
