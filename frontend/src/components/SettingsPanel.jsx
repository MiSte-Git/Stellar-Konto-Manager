// src/components/SettingsPanel.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrustedWallets } from '../utils/useTrustedWallets.js';
import { useSettings } from '../utils/useSettings.js';

export default function SettingsPanel() {
  const { t } = useTranslation();
  const { data, wallets, setWallets, resetToDefault, exportFile, importFile, error } = useTrustedWallets();
  const { decimalsMode, setDecimalsMode } = useSettings();

  const fileRef = useRef(null);

  // Editable rows state
  const [rows, setRows] = useState(() => wallets.map(copyRow));
  useEffect(() => {
    setRows(wallets.map(copyRow));
  }, [wallets]);

  // Validation and change detection
  const { hasChanges, invalidReason } = useMemo(() => {
    const norm = (arr) => arr.map(sanitizeRow);
    const a = JSON.stringify(norm(rows));
    const b = JSON.stringify(norm(wallets));
    // validate addresses: non-empty + unique
    const seen = new Set();
    for (const r of rows) {
      const addr = (r.address || '').trim();
      if (!addr) return { hasChanges: a !== b, invalidReason: 'missing' };
      if (seen.has(addr)) return { hasChanges: a !== b, invalidReason: 'duplicate' };
      seen.add(addr);
    }
    return { hasChanges: a !== b, invalidReason: '' };
  }, [rows, wallets]);

  const onImportClick = () => fileRef.current?.click();
  const onFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importFile(file);
    // rows will sync via effect
    e.target.value = '';
  };

  const addRow = () => {
    setRows((r) => [{ address: '', label: '', compromised: false, deactivated: false }, ...r]);
  };

  const removeRow = (idx) => {
    setRows((r) => r.filter((_, i) => i !== idx));
  };

  const updateCell = (idx, key, value) => {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [key]: value } : row)));
  };

  const applyChanges = () => {
    const cleaned = rows.map(sanitizeRow);
    setWallets(cleaned);
  };

  const discardChanges = () => {
    setRows(wallets.map(copyRow));
  };

  const infoCount = wallets.length;
  const infoUpdatedAt = data?.updatedAt || '';

  return (
    <div className="rounded-2xl border p-6 space-y-8 w-full">
      {/* Display / Global settings */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {t('settings.display.title', 'Display')}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('settings.display.desc', 'Global display preferences.')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm" htmlFor="decimals-mode">
            {t('settings.display.decimals.label', 'Decimals')}
          </label>
          <select
            id="decimals-mode"
            className="border rounded px-2 py-1"
            value={decimalsMode}
            onChange={(e) => setDecimalsMode(e.target.value)}
          >
            <option value="auto">{t('settings.display.decimals.auto', 'Automatic')}</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
            <option value="7">7</option>
          </select>
        </div>
      </section>

      {/* Trusted wallets editor */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t('settings.trustedWallets.title', 'Trusted wallets (QSI)')}
          </h2>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            <span className="mr-3">
              {t('settings.trustedWallets.info.count', 'Entries: {{n}}', { n: infoCount })}
            </span>
            {infoUpdatedAt && (
              <span>
                {t('settings.trustedWallets.info.updatedAt', 'As of: {{date}}', { date: infoUpdatedAt })}
              </span>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('settings.trustedWallets.desc', 'This list is stored locally (browser). Default file: QSI_TrustedWallets.json')}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onImportClick}
            className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {t('settings.trustedWallets.buttons.import', 'Import')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onFileSelected}
            className="hidden"
            aria-label={t('settings.trustedWallets.file.label', 'File')}
            title={t('settings.trustedWallets.file.hint', 'Import a JSON file of shape { wallets: [...] }')}
          />
          <button
            type="button"
            onClick={exportFile}
            className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {t('settings.trustedWallets.buttons.export', 'Export')}
          </button>
          <button
            type="button"
            onClick={resetToDefault}
            className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {t('settings.trustedWallets.buttons.reset', 'Reset to default')}
          </button>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={addRow}
              className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('settings.trustedWallets.table.addRow', 'Add row')}
            </button>
            <button
              type="button"
              onClick={discardChanges}
              disabled={!hasChanges}
              className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('settings.trustedWallets.table.discard', 'Discard')}
            </button>
            <button
              type="button"
              onClick={applyChanges}
              disabled={!hasChanges || !!invalidReason}
              title={invalidReason ? t('settings.trustedWallets.validation.hint', 'At least one row is invalid (missing/duplicate address).') : ''}
              className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('settings.trustedWallets.table.save', 'Save')}
            </button>
          </div>
        </div>

        {error ? (
          <div className="text-sm text-red-600">
            {t(error, error)}
          </div>
        ) : null}

        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="px-2 py-1">{t('settings.trustedWallets.table.columns.address', 'Address')}</th>
                <th className="px-2 py-1">{t('settings.trustedWallets.table.columns.label', 'Label')}</th>
                <th className="px-2 py-1">{t('settings.trustedWallets.table.columns.compromised', 'Compromised')}</th>
                <th className="px-2 py-1">{t('settings.trustedWallets.table.columns.deactivated', 'Deactivated')}</th>
                <th className="px-2 py-1">{t('settings.trustedWallets.table.columns.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className={idx % 2 ? 'bg-gray-50 dark:bg-gray-800/40' : ''}>
                  <td className="px-2 py-1">
                    <input
                      className="w-full font-mono border rounded px-2 py-1"
                      value={r.address}
                      onChange={(e) => updateCell(idx, 'address', e.target.value)}
                      placeholder="G..."
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={r.label || ''}
                      onChange={(e) => updateCell(idx, 'label', e.target.value)}
                      placeholder={t('settings.trustedWallets.table.columns.label', 'Label')}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={!!r.compromised}
                      onChange={(e) => updateCell(idx, 'compromised', e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={!!r.deactivated}
                      onChange={(e) => updateCell(idx, 'deactivated', e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="px-2 py-1 rounded border text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      {t('settings.trustedWallets.table.deleteRow', 'Delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function copyRow(w) {
  return {
    address: w.address || '',
    label: w.label || '',
    compromised: !!w.compromised,
    deactivated: !!w.deactivated,
  };
}

function sanitizeRow(w) {
  return {
    address: String(w.address || '').trim(),
    label: String(w.label || '').trim(),
    compromised: !!w.compromised,
    deactivated: !!w.deactivated,
  };
}
