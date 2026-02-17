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

// Chapter → lesson IDs (must mirror CHAPTERS in learnProgress.js)
const BADGE_CHAPTERS = {
  grundlagen: ['lesson1', 'lesson2', 'lesson3'],
  sicherheit: ['lesson7', 'lesson8', 'lesson9'],
  praxis: ['lesson10'],
};
const ALL_LESSON_IDS = Array.from({ length: 13 }, (_, i) => `lesson${i + 1}`);

/** Count how many lessons in a list have ≥ 2 stars. */
function countQualified(lessonIds, progress) {
  return lessonIds.filter(id => {
    const p = progress[id];
    return p && Number(p.stars || 0) >= 2;
  }).length;
}

export default function QuizIndex() {
  const { t } = useTranslation(['quiz', 'quiz.ui', 'navigation', 'learn', 'learnMultisig', 'quizMultisig']);

  const [progress, setProgress] = React.useState(() => getFlattenedProgress());
  const [badges, setBadges] = React.useState(() => computeBadges());
  const [expandedLesson, setExpandedLesson] = React.useState(null);
  const [quizMeta, setQuizMeta] = React.useState({});
  const [infoMsg, setInfoMsg] = React.useState('');

  // Lazy-load quiz data (question count + meta) when a lesson is expanded
  React.useEffect(() => {
    if (!expandedLesson || quizMeta[expandedLesson]) return;
    let alive = true;
    const id = String(expandedLesson);
    const loader = id === 'multisig'
      ? () => import('../data/quiz/quizMultisig.json')
      : () => import(`../data/learn/quiz/lesson${id}.json`);
    loader().then((mod) => {
      if (!alive) return;
      const data = mod.default || mod;
      setQuizMeta((prev) => ({
        ...prev,
        [id]: {
          questions: Array.isArray(data.questions) ? data.questions.length : 0,
          estimatedMinutes: data.meta?.estimatedMinutes || 0,
          passPercent: data.meta?.passPercent || 0,
          threeStarPercent: data.meta?.threeStarPercent || 0,
        },
      }));
    }).catch(() => { /* noop */ });
    return () => { alive = false; };
  }, [expandedLesson, quizMeta]);

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

      {/* Badges with progress */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
        {[
          { key: 'grundlagen', label: t('learn:badges.chapters.grundlagen', 'Grundlagen'), done: badges.chapters?.grundlagen },
          { key: 'sicherheit', label: t('learn:badges.chapters.sicherheit', 'Sicherheit'), done: badges.chapters?.sicherheit },
          { key: 'praxis', label: t('learn:badges.chapters.praxis', 'Praxis'), done: badges.chapters?.praxis },
        ].map(({ key, label, done }) => {
          const ids = BADGE_CHAPTERS[key];
          const count = countQualified(ids, progress);
          const total = ids.length;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={key} className={`rounded-lg px-2.5 py-2 ${done ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
              <div className="font-semibold truncate">{label}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${done ? 'bg-emerald-400/40' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <div
                    className={`h-full rounded-full transition-all ${done ? 'bg-white' : 'bg-emerald-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="tabular-nums">{count}/{total}</span>
              </div>
            </div>
          );
        })}
        {(() => {
          const proCount = countQualified(ALL_LESSON_IDS, progress);
          const proTotal = ALL_LESSON_IDS.length;
          const proPct = proTotal > 0 ? Math.round((proCount / proTotal) * 100) : 0;
          return (
            <div className={`rounded-lg px-2.5 py-2 ${badges.pro ? 'bg-indigo-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}>
              <div className="font-semibold truncate">{t('learn:badges.pro', 'Stellar-Profi')}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${badges.pro ? 'bg-indigo-400/40' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <div
                    className={`h-full rounded-full transition-all ${badges.pro ? 'bg-white' : 'bg-indigo-500'}`}
                    style={{ width: `${proPct}%` }}
                  />
                </div>
                <span className="tabular-nums">{proCount}/{proTotal}</span>
              </div>
            </div>
          );
        })()}
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
          const titleKey = quizId === 'multisig' ? 'quizMultisig:title' : `quiz:l${quizId}.title`;
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
                  className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-lg leading-none bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
                  title={isExpanded ? t('quiz.ui:hideDetails', 'Details ausblenden') : t('quiz.ui:showDetails', 'Details anzeigen')}
                  aria-label={isExpanded ? t('quiz.ui:hideDetails', 'Details ausblenden') : t('quiz.ui:showDetails', 'Details anzeigen')}
                  aria-expanded={isExpanded}
                >
                  <span aria-hidden>ℹ</span>
                </button>

                {/* Start quiz */}
                <button
                  type="button"
                  onClick={() => navigate(buildPath(`quiz/${quizId}`))}
                  className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-lg leading-none bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 hover:text-green-800 dark:hover:text-green-200 transition-colors"
                  title={t('learn:actions.startQuiz', 'Quiz starten')}
                  aria-label={t('learn:actions.startQuiz', 'Quiz starten')}
                >
                  <span aria-hidden>▶</span>
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

                  {/* Quiz stats */}
                  {quizMeta[quizId] && (
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                        <span aria-hidden>📝</span> {t('quiz:landing.questionsLabel', 'Fragen')}: {quizMeta[quizId].questions}
                      </span>
                      {quizMeta[quizId].estimatedMinutes > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                          <span aria-hidden>⏱</span> ~{quizMeta[quizId].estimatedMinutes} Min
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                        <span aria-hidden>🎯</span> {t('quiz:landing.passThresholdLabel', 'Bestehensgrenze')}: {Math.round(quizMeta[quizId].passPercent * 100)}%
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                        <span aria-hidden>⭐</span> 3★: {Math.round(quizMeta[quizId].threeStarPercent * 100)}%
                      </span>
                    </div>
                  )}

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
