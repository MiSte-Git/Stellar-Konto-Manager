import React from 'react';
import { useTranslation } from 'react-i18next';
import QuizRunner from '../components/quiz/QuizRunner.jsx';
import QuizSettings from '../components/quiz/QuizSettings.jsx';
import QuizAchievements from '../components/quiz/QuizAchievements.jsx';
import QuizLanding from '../components/quiz/QuizLanding.jsx';
import { buildPath } from '../utils/basePath.js';

function useLessonIdFromPath() {
  const parseId = (p) => {
    try {
      // Support both legacy and new routes: /learn/lesson/:id/quiz and /quiz/:id/run
      let m = String(p || '').match(/lesson\/(\d+)/);
      if (m) return m[1];
      m = String(p || '').match(/quiz\/(\d+)/);
      if (m) return m[1];
    } catch { /* noop */ }
    return '1';
  };

  const [id, setId] = React.useState(() => {
    try {
      const p = typeof window !== 'undefined' ? window.location.pathname : '';
      return parseId(p);
    } catch { return '1'; }
  });

  React.useEffect(() => {
    const onPop = () => {
      try {
        const p = window.location.pathname;
        setId(parseId(p));
      } catch { /* noop */ }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return id;
}

function isSettingsRoute() {
  try {
    const p = typeof window !== 'undefined' ? window.location.pathname : '';
    return /\/quiz\/\d+\/settings$/.test(p);
  } catch { return false; }
}

function isAchievementsRoute() {
  try {
    const p = typeof window !== 'undefined' ? window.location.pathname : '';
    return /\/quiz\/\d+\/achievements$/.test(p);
  } catch { return false; }
}

function isRunRoute() {
  try {
    const p = typeof window !== 'undefined' ? window.location.pathname : '';
    // support new /quiz/:id/run and legacy /learn/lesson/:id/quiz
    return (/\/quiz\/\d+\/run$/.test(p) || /\/learn\/lesson\/\d+\/quiz$/.test(p));
  } catch { return false; }
}

export default function QuizPage() {
  const { t } = useTranslation(['learn', 'quiz', 'quiz.ui', 'common']);
  const lessonNum = useLessonIdFromPath();
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const id = String(lessonNum);
    import(`../data/learn/quiz/lesson${id}.json`).then((mod) => {
      if (!alive) return;
      setData(mod.default || mod);
      setLoading(false);
    }).catch(() => {
      if (!alive) return;
      setError(t('learn:status.noData', 'No quiz data'));
      setData(null);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [lessonNum, t]);

  const goBack = React.useCallback(() => {
    try {
      const prev = (typeof window !== 'undefined' && window.sessionStorage)
        ? window.sessionStorage.getItem('STM_PREV_PATH')
        : '';
      if (prev) {
        window.history.pushState({}, '', prev);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      const url = buildPath('learn');
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* noop */ }
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-sm font-medium px-3 py-1.5 rounded"
        >
          ← {t('learn:back', 'Back')}
        </button>
        <h1 className="text-2xl font-bold flex-1 text-center">{isSettingsRoute() ? t('quiz:settings.title') : isAchievementsRoute() ? t('quiz:achievements.title') : t('quiz.ui:routeTitle', { id: lessonNum })}</h1>
        <div className="w-[76px]" aria-hidden />
      </div>

      {isSettingsRoute() ? (
        <QuizSettings />
      ) : isAchievementsRoute() ? (
        <QuizAchievements />
      ) : isRunRoute() ? (
        <>
          {loading && (
            <div className="text-sm text-gray-600 dark:text-gray-300">{t('common:common.loading', 'Loading…')}</div>
          )}
          {error && !loading && (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              <div>{error}</div>
              <div className="mt-1">{t('quiz.ui:noDataHelp')}</div>
              <button
                type="button"
                onClick={goBack}
                className="mt-3 inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-xs font-medium px-3 py-1.5 rounded"
              >
                ← {t('quiz.ui:backToLearn')}
              </button>
            </div>
          )}
          {!loading && !error && data && (
            <QuizRunner
              lessonId={lessonNum}
              data={data}
              onComplete={() => {}}
              onExit={goBack}
            />
          )}
        </>
      ) : (
        <>
          {loading && (
            <div className="text-sm text-gray-600 dark:text-gray-300">{t('common:common.loading', 'Loading…')}</div>
          )}
          {error && !loading && (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              <div>{error}</div>
              <div className="mt-1">{t('quiz.ui:noDataHelp')}</div>
              <button
                type="button"
                onClick={goBack}
                className="mt-3 inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-xs font-medium px-3 py-1.5 rounded"
              >
                ← {t('quiz.ui:backToLearn')}
              </button>
            </div>
          )}
          {!loading && !error && data && (
            <QuizLanding
              data={data}
              lessonId={lessonNum}
              onStartQuiz={() => {
                try {
                  const url = buildPath(`quiz/${lessonNum}/run`);
                  if (typeof window !== 'undefined' && window.sessionStorage) {
                    window.sessionStorage.setItem('STM_PREV_PATH', window.location.pathname);
                  }
                  window.history.pushState({}, '', url);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch { /* noop */ }
              }}
              onOpenSettings={() => {
                try {
                  const url = buildPath(`quiz/${lessonNum}/settings`);
                  if (typeof window !== 'undefined' && window.sessionStorage) {
                    window.sessionStorage.setItem('STM_PREV_PATH', window.location.pathname);
                  }
                  window.history.pushState({}, '', url);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch { /* noop */ }
              }}
              onOpenAchievements={() => {
                try {
                  const url = buildPath(`quiz/${lessonNum}/achievements`);
                  if (typeof window !== 'undefined' && window.sessionStorage) {
                    window.sessionStorage.setItem('STM_PREV_PATH', window.location.pathname);
                  }
                  window.history.pushState({}, '', url);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch { /* noop */ }
              }}
              showPractice={false}
            />
          )}
        </>
      )}
    </div>
  );
}
