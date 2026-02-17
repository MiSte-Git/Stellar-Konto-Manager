import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';
import { QUIZ_ORDER } from '../utils/quiz/quizNavigation.js';
import { getFlattenedProgress, setManualStars, toggleManualCompleted, computeBadges } from '../utils/learnProgress.js';
import lessons from '../data/learn/lessons.json';
import MultisigIntro from './learn/MultisigIntro.jsx';

// Map quiz ID → lesson data from lessons.json
// Quiz IDs are '1'-'12' + 'multisig', lesson IDs are 'lesson1'-'lesson13'
function getLessonForQuizId(quizId) {
  if (quizId === 'multisig') return lessons.find(l => l.id === 'lesson13') || null;
  return lessons.find(l => l.id === `lesson${quizId}`) || null;
}

export default function QuizIndex() {
  const { t } = useTranslation(['quiz', 'quiz.ui', 'navigation', 'learn', 'learnMultisig']);

  const [progress, setProgress] = React.useState(() => getFlattenedProgress());
  const [badges, setBadges] = React.useState(() => computeBadges());
  const [expandedLesson, setExpandedLesson] = React.useState(null);
  const [infoMsg, setInfoMsg] = React.useState('');

  React.useEffect(() => {
    if (!infoMsg) return;
    const id = setTimeout(() => setInfoMsg(''), 3000);
    return () => clearTimeout(id);
  }, [infoMsg]);

  const navigate = (url) => {
    try {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* noop */ }
  };

  const handleSetStars = React.useCallback((lessonId, stars) => {
    try {
      const res = setManualStars(lessonId, stars);
      setProgress(res.flat);
      setBadges(computeBadges(res.v1));
      setInfoMsg(t('learn:progress.saved', 'Fortschritt gespeichert'));
    } catch { /* noop */ }
  }, [t]);

  const handleToggleCompleted = React.useCallback((lessonId) => {
    try {
      const res = toggleManualCompleted(lessonId);
      setProgress(res.flat);
      setBadges(computeBadges(res.v1));
      setInfoMsg(t('learn:progress.saved', 'Fortschritt gespeichert'));
    } catch { /* noop */ }
  }, [t]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => navigate(buildPath(''))}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors"
        >
          ← {t('learn:back', 'Zurück')}
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex-1">
          {t('quiz.ui:quiz', 'Quiz')}
        </h1>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        {t('quiz.ui:indexSubtitle', 'Wähle eine Lektion')}
      </p>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        <span className={`px-2 py-1 rounded ${badges.chapters?.grundlagen ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
          {t('learn:badges.chapters.grundlagen', 'Grundlagen')}
        </span>
        <span className={`px-2 py-1 rounded ${badges.chapters?.sicherheit ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
          {t('learn:badges.chapters.sicherheit', 'Sicherheit')}
        </span>
        <span className={`px-2 py-1 rounded ${badges.chapters?.praxis ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
          {t('learn:badges.chapters.praxis', 'Praxis')}
        </span>
        <span className={`ml-1 px-2 py-1 rounded ${badges.pro ? 'bg-indigo-700 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
          {t('learn:badges.pro', 'Stellar-Profi')}
        </span>
      </div>

      {/* Status message */}
      {infoMsg && (
        <div className="mb-3 text-xs bg-green-100 dark:bg-green-900/30 border border-green-300/60 text-green-800 dark:text-green-200 rounded p-2 inline-block">
          {infoMsg}
        </div>
      )}

      {/* Lesson list */}
      <div className="space-y-2">
        {QUIZ_ORDER.map((quizId, idx) => {
          const lesson = getLessonForQuizId(quizId);
          const lessonKey = quizId === 'multisig' ? 'lesson13' : `lesson${quizId}`;
          const prog = progress[lessonKey] || { completed: false, stars: 0 };
          const stars = Math.max(0, Math.min(3, Number(prog.stars || 0)));
          const completed = !!prog.completed;
          const score = Number(prog.score || 0);
          const hasAttempt = !!(prog && (prog.attempts > 0 || prog.score > 0));
          const isExpanded = expandedLesson === quizId;

          // Try i18n title first, fall back to lessons.json
          const titleKey = quizId === 'multisig' ? 'quiz:multisig.title' : `quiz:l${quizId}.title`;
          const i18nTitle = t(titleKey);
          const title = (i18nTitle && i18nTitle !== titleKey) ? i18nTitle : (lesson?.title || `Lektion ${quizId}`);

          return (
            <div key={quizId} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              {/* Main row */}
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Number / check */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${completed ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                  {completed ? (
                    <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>

                {/* Title + progress */}
                <button
                  type="button"
                  onClick={() => navigate(buildPath(`quiz/${quizId}`))}
                  className="flex-1 min-w-0 text-left hover:underline"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {title}
                  </div>
                  {hasAttempt && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{score}%</span>
                      {stars > 0 && (
                        <span className="text-xs">
                          {Array.from({ length: 3 }, (_, i) => (
                            <span key={i} className={i < stars ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}>★</span>
                          ))}
                        </span>
                      )}
                    </div>
                  )}
                </button>

                {/* Expand toggle */}
                <button
                  type="button"
                  onClick={() => setExpandedLesson(isExpanded ? null : quizId)}
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label={isExpanded ? 'Details schließen' : 'Details anzeigen'}
                >
                  <svg viewBox="0 0 20 20" className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>

                {/* Start quiz arrow */}
                <button
                  type="button"
                  onClick={() => navigate(buildPath(`quiz/${quizId}`))}
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label={t('learn:actions.startQuiz', 'Quiz starten')}
                >
                  <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {/* Expandable details */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-700 space-y-3">
                  {/* Lesson description */}
                  <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
                    <p>
                      <span className="font-medium">{t('learn:labels.goal', 'Ziel')}:</span>{' '}
                      {t(`learn:${lessonKey}.goal`, lesson?.goal || '')}
                    </p>
                    <p>
                      <span className="font-medium">{t('learn:labels.task', 'Aufgabe')}:</span>{' '}
                      {t(`learn:${lessonKey}.task`, lesson?.task || '')}
                    </p>
                    <p>
                      <span className="font-medium">{t('learn:labels.outcome', 'Ergebnis')}:</span>{' '}
                      {t(`learn:${lessonKey}.learningOutcome`, lesson?.learningOutcome || '')}
                    </p>
                    <p>
                      <span className="font-medium">{t('learn:labels.reward', 'Belohnung')}:</span>{' '}
                      {t(`learn:${lessonKey}.reward`, lesson?.reward || '')}
                    </p>
                  </div>

                  {/* MultisigIntro for lesson13 */}
                  {quizId === 'multisig' && <MultisigIntro />}

                  {/* Manual progress controls */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1" role="group" aria-label={t('learn:progress.setStarsGroup', 'Sterne setzen')}>
                      {[0, 1, 2, 3].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => handleSetStars(lessonKey, cnt)}
                          className={`px-1.5 py-1 rounded text-xs font-semibold border leading-tight ${cnt === stars ? 'bg-yellow-400 text-black border-yellow-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border-gray-300 dark:border-gray-600'}`}
                          aria-pressed={cnt === stars}
                        >
                          <span className="flex flex-col items-center leading-tight text-center">
                            <span>{cnt}</span>
                            <span aria-hidden>★</span>
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleCompleted(lessonKey)}
                      className={`px-2 py-1 rounded text-xs font-semibold ${completed ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100'}`}
                      aria-pressed={completed}
                    >
                      {completed ? t('learn:progress.completed', 'Abgeschlossen') : t('learn:progress.markComplete', 'Als erledigt markieren')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
