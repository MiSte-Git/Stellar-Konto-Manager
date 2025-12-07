import React from 'react';
import { useTranslation } from 'react-i18next';

function parseLessonIdFromPath(p) {
  try {
    const m = String(p || '').match(/quiz\/(\d+)\//);
    return m ? m[1] : '1';
  } catch { return '1'; }
}

import { getPerQuizSettings, setPerQuizSettings } from '../../utils/quiz/storage.js';

function loadSettings(id) {
  try {
    return getPerQuizSettings(id);
  } catch { /* noop */ }
  return null;
}

function saveSettings(id, s) {
  try {
    setPerQuizSettings(id, s);
  } catch { /* noop */ }
}

export default function QuizSettings({ showTitle = true }) {
  const { t } = useTranslation(['quiz']);
  const lessonId = React.useMemo(() => parseLessonIdFromPath(typeof window !== 'undefined' ? window.location.pathname : ''), []);

  const [stickyNav, setStickyNav] = React.useState(true);
  const [hints, setHints] = React.useState(true);
  const [haptics, setHaptics] = React.useState(true);
  const [shuffle, setShuffle] = React.useState(false);
  const [timeLimit, setTimeLimit] = React.useState(0);

  React.useEffect(() => {
    const s = loadSettings(lessonId);
    if (s) {
      if (typeof s.stickyNav === 'boolean') setStickyNav(s.stickyNav);
      if (typeof s.hints === 'boolean') setHints(s.hints);
      if (typeof s.haptics === 'boolean') setHaptics(s.haptics);
      if (typeof s.shuffle === 'boolean') setShuffle(s.shuffle);
      if (typeof s.timeLimit === 'number') setTimeLimit(s.timeLimit);
    }
  }, [lessonId]);

  React.useEffect(() => {
    saveSettings(lessonId, { stickyNav, hints, haptics, shuffle, timeLimit });
  }, [lessonId, stickyNav, hints, haptics, shuffle, timeLimit]);

  return (
    <div className="max-w-2xl mx-auto">
      {showTitle && (
        <h2 className="text-xl font-bold mb-3">{t('quiz:settings.title', 'Quiz-Einstellungen')}</h2>
      )}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{t('quiz:settings.stickyNav')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{t('quiz:settings.stickyNav.desc')}</div>
          </div>
          <button
            type="button"
            onClick={() => setStickyNav(v => !v)}
            aria-pressed={stickyNav}
            className={`px-3 py-1.5 rounded text-xs font-semibold border ${stickyNav ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600'}`}
          >
            {stickyNav ? t('quiz:settings.on') : t('quiz:settings.off')}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{t('quiz:settings.hints')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{t('quiz:settings.hints.desc')}</div>
          </div>
          <button
            type="button"
            onClick={() => setHints(v => !v)}
            aria-pressed={hints}
            className={`px-3 py-1.5 rounded text-xs font-semibold border ${hints ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600'}`}
          >
            {hints ? t('quiz:settings.on') : t('quiz:settings.off')}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{t('quiz:settings.haptics')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{t('quiz:settings.haptics.desc')}</div>
          </div>
          <button
            type="button"
            onClick={() => setHaptics(v => !v)}
            aria-pressed={haptics}
            className={`px-3 py-1.5 rounded text-xs font-semibold border ${haptics ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600'}`}
          >
            {haptics ? t('quiz:settings.on') : t('quiz:settings.off')}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{t('quiz:settings.shuffle')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{t('quiz:settings.shuffle.desc')}</div>
          </div>
          <button
            type="button"
            onClick={() => setShuffle(v => !v)}
            aria-pressed={shuffle}
            className={`px-3 py-1.5 rounded text-xs font-semibold border ${shuffle ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600'}`}
          >
            {shuffle ? t('quiz:settings.on') : t('quiz:settings.off')}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{t('quiz:settings.timeLimit')}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{t('quiz:settings.timeLimit.desc')}</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={120}
              value={timeLimit}
              onChange={(e) => setTimeLimit(Math.max(0, Math.min(120, Number(e.target.value || 0))))}
              className="w-20 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              aria-label={t('quiz:settings.timeLimit.input')}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">{t('quiz:settings.minutes')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
