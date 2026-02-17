import React from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.button>, <motion.div>
import { motion } from 'framer-motion';
import Lumio from './Lumio.jsx';
import { getStartInNewTabGlobal, getStartInNewTabForId, setStartInNewTabForId } from '../../utils/quiz/startInNewTab.js';
import { quizRunPath, buildPath } from '../../utils/basePath.js';
import { getNextQuizId, getPrevQuizId, getQuizIndex, getTotalQuizCount } from '../../utils/quiz/quizNavigation.js';

function readStars(id) {
  try {
    const raw = localStorage.getItem('skm.learn.progress.v1');
    if (!raw) return 0;
    const obj = JSON.parse(raw);
    const lesson = obj?.lessons?.[`lesson${id}`];
    return Math.max(0, Math.min(3, Number(lesson?.stars || 0)));
  } catch { return 0; }
}

function readStreak() {
  try { return Math.max(0, Number(localStorage.getItem('quiz_streak')) || 0); } catch { return 0; }
}

function StarDisplay({ stars }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={`w-6 h-6 ${i <= stars ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>
          <path fill="currentColor" d="M12 2l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17l-5.8 3-1.1-6.5L.4 8.8l6.5-.9z"/>
        </svg>
      ))}
    </div>
  );
}

/**
 * QuizLanding
 * Props:
 * - data: { questions: Array, meta?: { estimatedMinutes?, passPercent?, threeStarPercent? } }
 * - onStartQuiz?: () => void
 * - onStartPractice?: () => void
 * - onOpenSettings?: () => void
 * - onOpenAchievements?: () => void
 * - showPractice?: boolean
 * - lessonId?: string | number
 */
export default function QuizLanding({
  data,
  onStartQuiz,
  onStartPractice,
  onOpenSettings,
  onOpenAchievements,
  showPractice,
  lessonId,
  embedded
}) {
  const { t } = useTranslation(['quiz', 'quiz.ui', 'quizMultisig']);

  const totalQuestions = Array.isArray(data?.questions) ? data.questions.length : 0;
  const estimatedMinutes = data?.meta?.estimatedMinutes ?? 2;
  const passRaw = data?.meta?.passPercent ?? 80;
  const passDisplay = passRaw <= 1 ? Math.round(passRaw * 100) : Math.round(passRaw);
  const threeRaw = data?.meta?.threeStarPercent;
  const threeDisplay = typeof threeRaw === 'number' ? (threeRaw <= 1 ? Math.round(threeRaw * 100) : Math.round(threeRaw)) : undefined;

  const handle = (fn) => { try { fn && fn(); } catch { /* noop */ } };

  const quizId = React.useMemo(() => {
    try {
      if (lessonId != null) return String(lessonId).replace(/[^0-9]/g, '') || '1';
      const p = typeof window !== 'undefined' ? window.location.pathname : '';
      let m = String(p || '').match(/quiz\/([A-Za-z0-9_-]+)/);
      if (m) return m[1];
      m = String(p || '').match(/lesson\/(\d+)/);
      if (m) return m[1];
    } catch { /* noop */ }
    return '1';
  }, [lessonId]);

  const initialOpenInNewTab = React.useMemo(() => {
    const per = getStartInNewTabForId(quizId);
    if (per == null) return getStartInNewTabGlobal();
    return !!per;
  }, [quizId]);
  const [openInNewTab, setOpenInNewTab] = React.useState(initialOpenInNewTab);

  React.useEffect(() => {
    setOpenInNewTab(initialOpenInNewTab);
  }, [initialOpenInNewTab]);

  const toggleStartInNewTab = (checked) => {
    setOpenInNewTab(checked);
    try {
      setStartInNewTabForId(quizId, checked);
    } catch { /* noop */ }
  };

  const runUrl = React.useMemo(() => quizRunPath(quizId), [quizId]);

  const stars = React.useMemo(() => readStars(quizId), [quizId]);
  const streak = React.useMemo(() => readStreak(), []);

  // Try to read lesson title from i18n (e.g. quiz:l1.title)
  const lessonTitle = React.useMemo(() => {
    const key = `quiz:l${quizId}.title`;
    const val = t(key);
    // If key is returned as-is, it means no translation exists
    return val !== key ? val : null;
  }, [quizId, t]);

  return (
    <section className="max-w-lg mx-auto">
      {/* 1. HERO */}
      <div className="text-center pt-6 pb-4">
        <div className="flex justify-center mb-4">
          <Lumio state="idle" size={100} />
        </div>
        <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 mb-3">
          {t('quiz.ui:routeTitle', { id: quizId })}
        </span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {lessonTitle || t('quiz:landing.title')}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          {t('quiz:landing.description')}
        </p>
      </div>

      {/* 1b. PROGRESS INDICATOR + PREV/NEXT NAV (hidden when embedded in settings) */}
      {!embedded && (() => {
        const idx = getQuizIndex(quizId);
        const total = getTotalQuizCount();
        const prevId = getPrevQuizId(quizId);
        const nextId = getNextQuizId(quizId);
        if (idx < 0) return null;
        const navTo = (id) => {
          try {
            const url = buildPath(`quiz/${id}`);
            window.history.pushState({}, '', url);
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch { /* noop */ }
        };
        return (
          <div className="flex items-center justify-between px-4 mt-2 mb-1">
            <button
              type="button"
              disabled={!prevId}
              onClick={() => prevId && navTo(prevId)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${prevId ? 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'}`}
              aria-label={t('quiz.ui:prevQuiz')}
            >
              ← {t('quiz.ui:prevQuiz')}
            </button>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {t('quiz.ui:lessonProgress', { current: idx + 1, total })}
            </span>
            <button
              type="button"
              disabled={!nextId}
              onClick={() => nextId && navTo(nextId)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${nextId ? 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'}`}
              aria-label={t('quiz.ui:nextQuiz')}
            >
              {t('quiz.ui:nextQuiz')} →
            </button>
          </div>
        );
      })()}

      {/* 2. INFO CHIPS */}
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          <span aria-hidden="true">&#x1F4DD;</span>
          {totalQuestions} {t('quiz:landing.questionsLabel')}
        </span>
        <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          <span aria-hidden="true">&#x23F1;</span>
          ~{estimatedMinutes} Min
        </span>
        <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          <span aria-hidden="true">&#x1F3AF;</span>
          {passDisplay}%
        </span>
        {typeof threeDisplay === 'number' && (
          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
            &#x2B50; {threeDisplay}%
          </span>
        )}
      </div>

      {/* 3. PREVIOUS PERFORMANCE */}
      {stars > 0 && (
        <div className="mt-5 flex justify-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
            <StarDisplay stars={stars} />
            <span className="text-sm text-gray-600 dark:text-gray-400">{stars}/3</span>
          </div>
        </div>
      )}

      {/* 4. STREAK */}
      {streak > 0 && (
        <div className="mt-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
            &#x1F525; {streak}
          </span>
        </div>
      )}

      {/* New tab toggle */}
      <div className="mt-5 flex items-center justify-center">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={openInNewTab}
            onChange={(e) => toggleStartInNewTab(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
          />
          {t('quiz.ui:openInNewTab.default', 'Quiz standardmäßig in neuem Tab öffnen')}
        </label>
      </div>

      {/* 5. MAIN BUTTON — always visible, always calls onStartQuiz */}
      <div className="mt-5 px-4">
        <motion.button
          type="button"
          onClick={() => handle(onStartQuiz)}
          animate={{
            boxShadow: [
              '0 0 0 0 rgba(99,102,241,0.0)',
              '0 0 0 8px rgba(99,102,241,0.15)',
              '0 0 0 0 rgba(99,102,241,0.0)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-full py-4 rounded-2xl text-base font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
        >
          {t('quiz.ui:startQuiz', 'Quiz starten')}
        </motion.button>
      </div>

      {/* 6. SECONDARY BUTTONS — all always visible */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 px-4">
        <a
          href={runUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            try { e.preventDefault(); } catch { /* noop */ }
            try { window.open(runUrl, '_blank', 'noopener'); } catch { /* noop */ }
          }}
          className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {t('quiz.ui:openInNewTab.once', 'In neuem Tab öffnen')}
        </a>

        {(showPractice || !!onStartPractice) && (
          <button
            type="button"
            onClick={() => handle(onStartPractice)}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {t('quiz:landing.startPractice')}
          </button>
        )}

        <button
          type="button"
          onClick={() => handle(onOpenSettings)}
          className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={t('quiz:landing.settingsLink')}
          title={t('quiz:landing.settingsLink')}
        >
          <svg viewBox="0 0 20 20" className="w-4 h-4 inline mr-1" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
          </svg>
          {t('quiz:landing.settingsLink')}
        </button>

        <button
          type="button"
          onClick={() => handle(onOpenAchievements)}
          className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={t('quiz:achievements.link')}
          title={t('quiz:achievements.link')}
        >
          <svg viewBox="0 0 20 20" className="w-4 h-4 inline mr-1 text-yellow-500" fill="currentColor">
            <path d="M10 1.5l2.39 4.84 5.34.78-3.86 3.76.91 5.32L10 13.77l-4.78 2.51.91-5.32L2.27 7.12l5.34-.78L10 1.5z"/>
          </svg>
          {t('quiz:achievements.link')}
        </button>
      </div>

      {/* 7. CROSS-PROMO */}
      {quizId !== 'multisig' && (
        <div className="mt-8 mx-4 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">{t('quizMultisig:title')}</div>
              <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-0.5 line-clamp-2">{t('quizMultisig:introText')}</p>
            </div>
            <button
              type="button"
              className="flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              onClick={() => {
                try {
                  const url = quizRunPath('multisig');
                  window.history.pushState({}, '', url);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch { /* noop */ }
              }}
            >
              {t('quiz.ui:startQuiz', 'Quiz starten')}
            </button>
          </div>
        </div>
      )}

      <div className="h-6" />
    </section>
  );
}
