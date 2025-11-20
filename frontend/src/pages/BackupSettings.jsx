import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';
import { useToast } from '../components/Toast.jsx';
import { getWarnOnActiveQuiz, setWarnOnActiveQuiz } from '../utils/quiz/globalSettings.js';
import { getPerQuizSettings, setPerQuizSettings, getPerQuizProgress, setPerQuizProgress, getAchievements, setAchievements } from '../utils/quiz/storage.js';

function collectAllQuizIds() {
  try {
    const ids = new Set();
    const s = window.localStorage;
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key) continue;
      const m = key.match(/^quiz\.(\d+)\.(settings|progress|achievements)$/);
      if (m) ids.add(m[1]);
    }
    return Array.from(ids).sort((a, b) => Number(a) - Number(b));
  } catch {
    return [];
  }
}

function readAll() {
  const ids = collectAllQuizIds();
  const settings = {};
  const progress = {};
  const achievements = {};
  for (const id of ids) {
    try { const s = getPerQuizSettings(id); if (s) settings[id] = s; } catch { /* noop */ }
    try { const p = getPerQuizProgress(id); if (p) progress[id] = p; } catch { /* noop */ }
    try { const a = getAchievements(id); if (a && a.length) achievements[id] = a; } catch { /* noop */ }
  }
  // include global quiz.* settings
  const global = {};
  try {
    const store = window.localStorage;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key) continue;
      if (key.startsWith('quiz.globalSettings.')) {
        const sub = key.slice('quiz.globalSettings.'.length);
        const raw = store.getItem(key);
        try { global[sub] = JSON.parse(raw); } catch { global[sub] = raw; }
      }
      if (key === 'quiz.startInNewTab') {
        const raw = store.getItem(key);
        global.startInNewTab = String(raw) === 'true';
      }
    }
  } catch { /* noop */ }
  return { settings, progress, achievements, global };
}

function writeAll(data, strategy = 'merge') {
  const { settings = {}, progress = {}, achievements = {}, global = {} } = data || {};
  const ids = new Set([...Object.keys(settings), ...Object.keys(progress), ...Object.keys(achievements)]);

  for (const id of ids) {
    if (strategy === 'replace') {
      // replace: we overwrite for listed ids, but we do not clear unknown keys
      try { if (settings[id]) setPerQuizSettings(id, settings[id]); } catch { /* noop */ }
      try { if (progress[id]) setPerQuizProgress(id, progress[id]); } catch { /* noop */ }
      try { if (achievements[id]) setAchievements(id, achievements[id]); } catch { /* noop */ }
    } else {
      // merge: shallow merge objects, concat uniq arrays
      try {
        if (settings[id]) {
          const cur = getPerQuizSettings(id) || {};
          setPerQuizSettings(id, { ...cur, ...settings[id] });
        }
      } catch { /* noop */ }
      try {
        if (progress[id]) {
          const cur = getPerQuizProgress(id) || {};
          setPerQuizProgress(id, { ...cur, ...progress[id] });
        }
      } catch { /* noop */ }
      try {
        if (achievements[id]) {
          const cur = getAchievements(id) || [];
          const map = new Map();
          [...cur, ...achievements[id]].forEach((a) => {
            if (a && a.id) map.set(a.id + (a.date || ''), a);
          });
          setAchievements(id, Array.from(map.values()));
        }
      } catch { /* noop */ }
    }
  }

  // Global settings
  try {
    if (global && typeof global === 'object') {
      if (Object.prototype.hasOwnProperty.call(global, 'startInNewTab')) {
        window.localStorage.setItem('quiz.startInNewTab', String(!!global.startInNewTab));
      }
      for (const [k, v] of Object.entries(global)) {
        if (k === 'startInNewTab') continue;
        try { window.localStorage.setItem(`quiz.globalSettings.${k}`, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* noop */ }
      }
    }
  } catch { /* noop */ }
}

function downloadJson(content, filename) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BackupSettings() {
  const { t } = useTranslation();
  const { notify, ToastHost } = useToast();
  const [fileData, setFileData] = React.useState(null);
  const [strategy, setStrategy] = React.useState('merge');
  const [stats, setStats] = React.useState({ settings: 0, progress: 0, achievements: 0 });
  const [warnOnActiveQuiz, setWarnOnActiveQuizState] = React.useState(() => getWarnOnActiveQuiz());

  const goBack = () => {
    try {
      const url = buildPath('');
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* noop */ }
  };

  const handleExport = () => {
    try {
      const payload = { type: 'stm.quiz.backup', version: 1, createdAt: new Date().toISOString(), data: readAll() };
      downloadJson(payload, t('settings:backup.export.fileName', 'quiz-backup.json'));
      notify(t('settings:backup.toast.exported', 'Backup exportiert'), { type: 'success' });
    } catch {
      notify(t('settings:backup.toast.exportFailed', 'Export fehlgeschlagen'), { type: 'error' });
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!obj || obj.type !== 'stm.quiz.backup' || obj.version !== 1 || !obj.data) {
        notify(t('settings:backup.import.invalid', 'Ungültige Importdatei'), { type: 'error' });
        setFileData(null);
        return;
      }
      setFileData(obj);
      const d = obj.data || {};
      setStats({
        settings: Object.keys(d.settings || {}).length,
        progress: Object.keys(d.progress || {}).length,
        achievements: Object.keys(d.achievements || {}).length
      });
    } catch {
              notify(t('settings:backup.import.invalid', 'Ungültige Importdatei'), { type: 'error' });
      setFileData(null);
    }
  };

  const handleImport = () => {
    try {
      // automatic backup of current state
      const current = { type: 'stm.quiz.backup', version: 1, createdAt: new Date().toISOString(), data: readAll() };
      downloadJson(current, 'auto-backup-before-import.json');
      notify(t('settings:backup.import.backupCreated', 'Automatisches Backup gespeichert'), { type: 'info' });
    } catch { /* noop */ }

    try {
      if (!fileData) return;
      writeAll(fileData.data, strategy);
      notify(t('settings:backup.import.done', 'Import abgeschlossen'), { type: 'success' });
    } catch {
      notify(t('settings:backup.toast.importFailed', 'Import fehlgeschlagen'), { type: 'error' });
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4">
      <ToastHost />
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={goBack} className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100">
          ← {t('settings:backup.nav.back', 'Zurück')}
        </button>
        <h1 className="text-2xl font-bold flex-1 text-center">{t('settings:backup.title', 'Backup & Wiederherstellung')}</h1>
        <div className="w-[76px]" aria-hidden />
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">{t('settings:backup.desc', 'Exportiere oder importiere deine Quiz-Daten (Einstellungen, Fortschritt, Abzeichen).')}</p>

      {/* Quiz Globale Einstellungen */}
      <div className="border border-gray-200 dark:border-gray-700 rounded p-3 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{t('quiz:settings.warnOnActiveQuiz', 'Warnung bei laufendem Quiz anzeigen')}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">{t('quiz:settings.warnOnActiveQuiz.desc', 'Bei bereits beantworteten Fragen vor dem Verlassen der Seite warnen')}</div>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!warnOnActiveQuiz}
              onChange={(e) => {
                const v = !!e.target.checked;
                setWarnOnActiveQuizState(v);
                try { setWarnOnActiveQuiz(v); } catch { /* noop */ }
              }}
            />
          </label>
        </div>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">{t('settings:backup.export.button', 'Export starten')}</div>
          <button type="button" onClick={handleExport} className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">
            {t('settings:backup.export.button', 'Export starten')}
          </button>
        </div>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded p-3">
        <div className="font-medium mb-2">{t('settings:backup.import.title', 'Import')}</div>
        <div className="flex items-center gap-2 mb-3">
          <label className="text-sm text-gray-700 dark:text-gray-300" htmlFor="backupFile">{t('settings:backup.import.selectFile', 'Datei auswählen')}</label>
          <input id="backupFile" type="file" accept="application/json" onChange={(e) => handleFile(e.target.files?.[0])} />
        </div>
        {fileData ? (
          <div className="mb-3">
            <div className="font-medium mb-1">{t('settings:backup.import.preview.title', 'Vorschau')}</div>
            <ul className="text-sm text-gray-700 dark:text-gray-300 list-disc pl-5">
              <li>{t('settings:backup.import.preview.stats.settings', { count: stats.settings })}</li>
              <li>{t('settings:backup.import.preview.stats.progress', { count: stats.progress })}</li>
              <li>{t('settings:backup.import.preview.stats.achievements', { count: stats.achievements })}</li>
            </ul>
          </div>
        ) : (
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('settings:backup.import.noFile', 'Keine Datei ausgewählt')}</div>
        )}

        <div className="flex items-center gap-3 mb-3">
          <label className="text-sm font-medium" htmlFor="strategySel">{t('settings:backup.import.strategy.label', 'Strategie')}</label>
          <select id="strategySel" className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="merge">{t('settings:backup.import.strategy.merge', 'Zusammenführen')}</option>
            <option value="replace">{t('settings:backup.import.strategy.replace', 'Ersetzen')}</option>
          </select>
        </div>

        <button type="button" onClick={handleImport} disabled={!fileData} className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white">
          {t('settings:backup.import.perform', 'Import durchführen')}
        </button>
      </div>
    </div>
  );
}
