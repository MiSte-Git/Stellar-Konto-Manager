// src/pages/SettingsPage.jsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import SettingsPanel from '../components/SettingsPanel';
import QuizSettings from '../components/quiz/QuizSettings.jsx';
import { useSettings } from '../utils/useSettings.js';
import { buildPath } from '../utils/basePath.js';

/**
 * Zeigt die Einstellungsseite mit Überschrift und einem "Zurück zum Menü"-Button.
 * @param {string} publicKey - Der aktuell geladene Public Key
 * @param {function} onBack - Callback zum Zurückkehren ins Hauptmenü
 */
export default function SettingsPage({ publicKey, onBack: _onBack }) {
  const { t } = useTranslation(['settings', 'quiz']);
  const navigate = useNavigate();
  const {
    explorers,
    setExplorers,
    defaultExplorer,
    setDefaultExplorer,
    getSettingsSnapshot,
    applySettingsSnapshot,
  } = useSettings();
  const [activeTab, setActiveTab] = useState('general');
  const [newExplorerName, setNewExplorerName] = useState('');
  const [newExplorerUrl, setNewExplorerUrl] = useState('');
  const [newExplorerTestnetUrl, setNewExplorerTestnetUrl] = useState('');
  const [explorerError, setExplorerError] = useState('');
  const [editingExplorerId, setEditingExplorerId] = useState(null);
  const isEditingExplorer = Boolean(editingExplorerId);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const importFileRef = React.useRef(null);
  void _onBack;

  const handleExportSettings = () => {
    try {
      const snapshot = getSettingsSnapshot();
      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const ts = now.toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `skm-settings-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      try {
        if (a.parentNode) a.parentNode.removeChild(a);
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Settings export failed', err);
    }
  };

  // Handles reading and applying a settings import file.
  const handleImportSettings = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportSuccess('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      applySettingsSnapshot(parsed);
      setImportSuccess(t('settings:import.success'));
    } catch (err) {
      const key = typeof err?.message === 'string' && err.message.startsWith('settings:') ? err.message : 'settings:import.error.invalid';
      setImportError(key);
    } finally {
      e.target.value = '';
    }
  };

  const explorerList = useMemo(() => explorers || [], [explorers]);
  React.useEffect(() => {
    if (!explorerList.length) return;
    if (!defaultExplorer || explorerList.every((e) => e.id !== defaultExplorer)) {
      setDefaultExplorer(explorerList[0].id);
    }
  }, [explorerList, defaultExplorer, setDefaultExplorer]);

  const handleBack = () => {
    try {
      if (window?.history?.length > 1) {
        navigate(-1);
        return;
      }
    } catch { /* noop */ }
    navigate(buildPath(''));
  };

  const addExplorer = () => {
    const name = newExplorerName.trim();
    const urlTemplate = newExplorerUrl.trim();
    const testnetUrlRaw = newExplorerTestnetUrl.trim();
    if (!name) { setExplorerError(t('settings:explorer.validation.nameRequired')); return; }
    if (!urlTemplate) { setExplorerError(t('settings:explorer.validation.urlRequired')); return; }
    try { const u = urlTemplate.replace('{address}', 'GABC'); new URL(u.startsWith('http') ? u : `https://${u}`); } catch { setExplorerError(t('settings:explorer.validation.urlInvalid')); return; }
    if (testnetUrlRaw) {
      try { const u = testnetUrlRaw.replace('{address}', 'GABC'); new URL(u.startsWith('http') ? u : `https://${u}`); } catch { setExplorerError(t('settings:explorer.validation.testnetUrlInvalid')); return; }
    }
    const id = editingExplorerId || `${name}-${urlTemplate}`.toLowerCase().replace(/\s+/g, '-');
    if (explorerList.some((e) => e.urlTemplate === urlTemplate && (e.id || e.key) !== editingExplorerId)) {
      setExplorerError('');
      return;
    }
    const testnetUrlTemplate = testnetUrlRaw || urlTemplate;
    let next;
    if (editingExplorerId) {
      next = explorerList.map((e) => {
        const currentId = e.id || e.key;
        if (currentId === editingExplorerId) {
          return { ...e, id: e.id || currentId, key: e.key || currentId, name, urlTemplate, testnetUrlTemplate };
        }
        return e;
      });
    } else {
      next = [...explorerList, { id, key: id, name, urlTemplate, testnetUrlTemplate }];
    }
    setExplorers(next);
    setExplorerError('');
    setNewExplorerName('');
    setNewExplorerUrl('');
    setNewExplorerTestnetUrl('');
    setEditingExplorerId(null);
  };

  const removeExplorer = (id) => {
    const targetId = id || '';
    if (explorerList.length <= 1) return;
    const next = explorerList.filter((e) => (e.id || e.key) !== targetId);
    setExplorers(next);
    if (editingExplorerId === targetId) {
      setEditingExplorerId(null);
      setNewExplorerName('');
      setNewExplorerUrl('');
      setNewExplorerTestnetUrl('');
    }
    if (defaultExplorer === targetId && next[0]) {
      setDefaultExplorer(next[0].id || next[0].key);
    }
  };

  const handleEditExplorer = (exp) => {
    const editId = exp.id || exp.key;
    setEditingExplorerId(editId);
    setNewExplorerName(exp.name || '');
    setNewExplorerUrl(exp.urlTemplate || '');
    setNewExplorerTestnetUrl(exp.testnetUrlTemplate || '');
  };

  const setAsDefault = (id) => setDefaultExplorer(id);

  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-10 space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="px-3 py-2 rounded border text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label={t('settings:aria.back')}
          >
            {t('settings:back')}
          </button>
          <h1 className="text-2xl font-bold flex-1 text-center">{t('settings:label', 'Settings')}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {['general', 'app', 'accounts', 'network', 'explorer', 'quiz'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-full text-sm font-semibold border ${activeTab === tab ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-300 dark:border-gray-700'}`}
            >
              {t(`settings:tabs.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'general' && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{t('settings:sections.general', t('settings:tabs.general'))}</h2>
          <SettingsPanel publicKey={publicKey} showDisplay={false} showTrustedWallets={false} showNetwork={false} />
          <section className="mt-6 space-y-2">
            <h3 className="font-semibold">{t('settings:export.title')}</h3>
            <button
              type="button"
              className="px-3 py-1 rounded border text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={handleExportSettings}
            >
              {t('settings:export.button')}
            </button>
            <div className="space-y-2">
              <h3 className="font-semibold mt-4">{t('settings:import.title')}</h3>
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  className="px-3 py-1 rounded border text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={() => importFileRef.current?.click()}
                >
                  {t('settings:import.button')}
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportSettings}
                  aria-label={t('settings:import.ariaLabel')}
                />
                {importSuccess && (
                  <span className="text-sm text-green-700 dark:text-green-400">{importSuccess}</span>
                )}
                {importError && (
                  <span className="text-sm text-red-600">{t(importError)}</span>
                )}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">{t('settings:import.hint')}</p>
            </div>
          </section>
        </section>
      )}

      {activeTab === 'app' && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{t('settings:sections.app', t('settings:tabs.app'))}</h2>
          <SettingsPanel publicKey={publicKey} showNetwork={false} showTrustedWallets={false} />
        </section>
      )}

      {activeTab === 'accounts' && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{t('settings:sections.accounts', t('settings:tabs.accounts'))}</h2>
          <SettingsPanel publicKey={publicKey} showDisplay={false} showNetwork={false} />
        </section>
      )}

      {activeTab === 'network' && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{t('settings:sections.network', t('settings:tabs.network'))}</h2>
          <SettingsPanel publicKey={publicKey} showDisplay={false} showTrustedWallets={false} />
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{t('settings:network.historyInfo')}</p>
        </section>
      )}

      {activeTab === 'explorer' && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{t('settings:sections.explorer', t('settings:tabs.explorer'))}</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300">{t('settings:explorer.description')}</p>
          <div className="rounded border p-4 space-y-3">
            <div className="text-sm font-semibold">
              {isEditingExplorer ? t('common:settings.explorer.editTitle') : t('settings:explorer.addButton')}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start">
              <label className="text-sm sm:w-40" htmlFor="explorer-name">{t('settings:explorer.nameLabel')}</label>
              <input
                id="explorer-name"
                className="border rounded px-2 py-1 w-full"
                value={newExplorerName}
                onChange={(e) => setNewExplorerName(e.target.value)}
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start">
              <label className="text-sm sm:w-40" htmlFor="explorer-url">{t('settings:explorer.urlLabel')}</label>
              <input
                id="explorer-url"
                className="border rounded px-2 py-1 w-full"
                value={newExplorerUrl}
                onChange={(e) => setNewExplorerUrl(e.target.value)}
                placeholder="https://…{address}"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start">
              <label className="text-sm sm:w-40" htmlFor="explorer-testnet-url">{t('settings:explorer.testnetUrlLabel')}</label>
              <input
                id="explorer-testnet-url"
                className="border rounded px-2 py-1 w-full"
                value={newExplorerTestnetUrl}
                onChange={(e) => setNewExplorerTestnetUrl(e.target.value)}
                placeholder={t('settings:explorer.testnetUrlPlaceholder')}
              />
            </div>
            {explorerError && <div className="text-sm text-red-600">{explorerError}</div>}
            <button
              type="button"
              onClick={addExplorer}
              className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm"
            >
              {isEditingExplorer ? t('common:settings.explorer.edit') : t('settings:explorer.addButton')}
            </button>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">{t('settings:explorer.defaultLabel')}</div>
            {explorerList.length === 0 && (
              <div className="text-sm text-gray-600">{t('settings:explorer.noEntries')}</div>
            )}
            {explorerList.map((exp) => (
              <div key={exp.id} className="flex items-center gap-3 border rounded px-3 py-2">
                <input
                  type="radio"
                  name="default-explorer"
                  checked={defaultExplorer === (exp.key || exp.id)}
                  onChange={() => setAsDefault(exp.key || exp.id)}
                  aria-label={t('settings:explorer.setDefault')}
                />
                <div className="flex-1">
                  <div className="font-semibold">{exp.name}</div>
                  <div className="text-xs text-gray-600 break-all">
                    {t('settings:explorer.mainnetLabel', 'Mainnet')}: {exp.urlTemplate}
                  </div>
                  {exp.testnetUrlTemplate && exp.testnetUrlTemplate !== exp.urlTemplate && (
                    <div className="text-xs text-gray-600 break-all">
                      {t('settings:explorer.testnetLabel', 'Testnet')}: {exp.testnetUrlTemplate}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAsDefault(exp.key || exp.id)}
                  className="px-2 py-1 rounded border text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {t('settings:explorer.setDefault')}
                </button>
                <button
                  type="button"
                  onClick={() => handleEditExplorer(exp)}
                  className="px-2 py-1 rounded border text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {t('settings:explorer.edit')}
                </button>
                <button
                  type="button"
                  onClick={() => removeExplorer(exp.id || exp.key)}
                  className={`px-2 py-1 rounded border text-xs ${explorerList.length <= 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                  disabled={explorerList.length <= 1}
                >
                  {t('settings:explorer.removeButton')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'quiz' && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{t('settings:sections.quiz', t('settings:tabs.quiz'))}</h2>
          <QuizSettings showTitle={false} />
        </section>
      )}

    </div>
  );
}
