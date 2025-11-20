import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../../utils/basePath.js';
import { getStartInNewTabGlobal, getStartInNewTabForId, setStartInNewTabForId } from '../../utils/quiz/startInNewTab.js';

/**
 * QuizLanding
 * Grundstruktur für die Quiz-Startseite einer Lektion.
 *
 * Props:
 * - data: {
 *     questions: Array,
 *     meta?: { estimatedMinutes?: number, passPercent?: number, threeStarPercent?: number }
 *   }
 * - onStartQuiz?: () => void
 * - onStartPractice?: () => void
 * - onOpenSettings?: () => void
 * - onOpenAchievements?: () => void
 * - showPractice?: boolean (falls true oder onStartPractice vorhanden, zeige Button)
 * - lessonId?: string | number (optional; wird zur Navigations-URL verwendet, sonst aus dem Pfad gelesen)
 */
export default function QuizLanding({
  data,
  onStartQuiz,
  onStartPractice,
  onOpenSettings,
  onOpenAchievements,
  showPractice,
  lessonId
}) {
  const { t } = useTranslation();

  const totalQuestions = Array.isArray(data?.questions) ? data.questions.length : 0;
  const estimatedMinutes = data?.meta?.estimatedMinutes ?? 2;
  const passRaw = data?.meta?.passPercent ?? 80;
  const passDisplay = passRaw <= 1 ? Math.round(passRaw * 100) : Math.round(passRaw);
  const threeRaw = data?.meta?.threeStarPercent;
  const threeDisplay = typeof threeRaw === 'number' ? (threeRaw <= 1 ? Math.round(threeRaw * 100) : Math.round(threeRaw)) : undefined;

  const handle = (fn) => { try { fn && fn(); } catch { /* noop */ } };

  const numericId = React.useMemo(() => {
    try {
      if (lessonId != null) return String(lessonId).replace(/[^0-9]/g, '') || '1';
      const p = typeof window !== 'undefined' ? window.location.pathname : '';
      let m = String(p || '').match(/quiz\/(\d+)/);
      if (m) return m[1];
      m = String(p || '').match(/lesson\/(\d+)/);
      if (m) return m[1];
    } catch { /* noop */ }
    return '1';
  }, [lessonId]);

  const startInNewTab = React.useMemo(() => {
    const per = getStartInNewTabForId(numericId);
    if (per == null) return getStartInNewTabGlobal();
    return !!per;
  }, [numericId]);

  const toggleStartInNewTab = (checked) => {
    try {
      // Prefer per-quiz setting
      setStartInNewTabForId(numericId, checked);
    } catch { /* noop */ }
  };

  const runPath = React.useMemo(() => buildPath(`quiz/${numericId}/run`), [numericId]);

  return (
    <section className="max-w-2xl mx-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
      {/* Titel und kurze Beschreibung */}
      <header className="text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {t('quiz:landing.title')}
        </h1>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          {t('quiz:landing.description')}
        </p>
      </header>

      {/* Kennzahlen */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t('quiz:landing.questionsLabel')}</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{totalQuestions}</div>
        </div>
        <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t('quiz:landing.estimatedMinutesLabel')}</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{estimatedMinutes}</div>
        </div>
        <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t('quiz:landing.passThresholdLabel')}</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{passDisplay}%</div>
        </div>
        {typeof threeDisplay === 'number' && (
          <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('quiz:landing.threeStarThresholdLabel')}</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{threeDisplay}%</div>
          </div>
        )}
      </div>

      {/* Option: in neuem Tab starten */}
      <div className="mt-6 flex items-center justify-center">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={startInNewTab}
            onChange={(e) => toggleStartInNewTab(e.target.checked)}
          />
          {t('quiz:ui.openInNewTab.default', 'Quiz standardmäßig in neuem Tab öffnen')}
        </label>
      </div>

      {/* Aktionen */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {startInNewTab ? (
          <a
            href={runPath}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => handle(onStartQuiz)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow"
          >
            {t('quiz:ui.startInNewTab', 'Quiz in neuem Tab starten')}
          </a>
        ) : (
          <>
            <button
              type="button"
              onClick={() => handle(onStartQuiz)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow"
            >
              {t('quiz:ui.startQuiz', 'Quiz starten')}
            </button>
            <a
              href={runPath}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
            >
              {t('quiz:ui.openInNewTab.once', 'In neuem Tab öffnen')}
            </a>
          </>
        )}

        {(showPractice || !!onStartPractice) && (
          <button
            type="button"
            onClick={() => handle(onStartPractice)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
          >
            {t('quiz:landing.startPractice')}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            handle(onOpenSettings);
            try {
              const url = buildPath(`quiz/${numericId}/settings`);
              window.history.pushState({}, '', url);
              window.dispatchEvent(new PopStateEvent('popstate'));
            } catch { /* noop */ }
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
          aria-label={t('quiz:landing.settingsLink')}
          title={t('quiz:landing.settingsLink')}
        >
          {t('quiz:landing.settingsLink')}
        </button>

        <button
          type="button"
          onClick={() => {
            handle(onOpenAchievements);
            try {
              const url = buildPath(`quiz/${numericId}/achievements`);
              window.history.pushState({}, '', url);
              window.dispatchEvent(new PopStateEvent('popstate'));
            } catch { /* noop */ }
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
          aria-label={t('quiz:achievements.link')}
          title={t('quiz:achievements.link')}
        >
          {t('quiz:achievements.link')}
        </button>
      </div>
    </section>
  );
}
