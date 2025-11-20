import React from 'react';
import { useTranslation } from 'react-i18next';
import lessons from '../data/learn/lessons.json';
import { buildPath } from '../utils/basePath.js';
import { getFlattenedProgress, setManualStars, toggleManualCompleted, computeBadges } from '../utils/learnProgress.js';

function sortByLessonId(list) {
  const num = (id) => {
    try { const m = String(id || '').match(/\d+/); return m ? parseInt(m[0], 10) : 0; } catch { return 0; }
  };
  return [...list].sort((a, b) => num(a.id) - num(b.id));
}

function LearnPage() {
  // Ensure all used namespaces are available for translations
  const { t } = useTranslation(['learn']);
  const [showBackToTop, setShowBackToTop] = React.useState(false);
  const [progress, setProgress] = React.useState(() => getFlattenedProgress());
  const [badges, setBadges] = React.useState(() => computeBadges());
  const [infoMsg, setInfoMsg] = React.useState('');
  const [errorMsg, setErrorMsg] = React.useState('');
  const fileInputRef = React.useRef(null);
  const [importDialog, setImportDialog] = React.useState({ open: false, summary: null, data: null, strategy: 'merge', includePracticeMeta: true });

  React.useEffect(() => {
    const getContainer = () => {
      try {
        return document.getElementById('stm-learn-overlay') || window;
      } catch { return window; }
    };
    const container = getContainer();
    const onScroll = () => {
      try {
        const top = (container instanceof Window) ? window.scrollY : (container?.scrollTop || 0);
        setShowBackToTop(top > 200);
      } catch { /* noop */ }
    };
    onScroll();
    (container).addEventListener('scroll', onScroll);
    return () => (container).removeEventListener('scroll', onScroll);
  }, []);

  const goBack = React.useCallback(() => {
    try {
      const prev = (typeof window !== 'undefined' && window.sessionStorage)
        ? window.sessionStorage.getItem('STM_PREV_PATH')
        : '';
      if (prev) {
        window.history.pushState({}, '', prev);
        try { window.dispatchEvent(new PopStateEvent('popstate')); } catch { /* noop */ }
        return;
      }
      window.history.back();
      setTimeout(() => { try { window.dispatchEvent(new PopStateEvent('popstate')); } catch { /* noop */ } }, 0);
    } catch { /* noop */ }
  }, []);

  const handleSetStars = React.useCallback((lessonId, stars) => {
    try {
      const res = setManualStars(lessonId, stars);
      setProgress(res.flat);
      setBadges(computeBadges(res.v1));
      setErrorMsg('');
      setInfoMsg(t('learn:progress.saved', 'Progress saved'));
    } catch {
      setErrorMsg(t('learn:progress.error', 'Could not save progress'));
    }
  }, [t]);

  const handleToggleCompleted = React.useCallback((lessonId) => {
    try {
      const res = toggleManualCompleted(lessonId);
      setProgress(res.flat);
      setBadges(computeBadges(res.v1));
      setErrorMsg('');
      setInfoMsg(t('learn:progress.saved', 'Progress saved'));
    } catch {
      setErrorMsg(t('learn:progress.error', 'Could not save progress'));
    }
  }, [t]);

  const handleClearAll = React.useCallback(() => {
    try {
      localStorage.removeItem('skm.learn.progress.v1');
      setProgress({});
      setBadges({ chapters: {}, pro: false });
      setErrorMsg('');
      setInfoMsg(t('learn:progress.cleared', 'Progress cleared'));
    } catch {
      setErrorMsg(t('learn:progress.error', 'Could not save progress'));
    }
  }, [t]);

  React.useEffect(() => {
    if (!infoMsg) return;
    const id = setTimeout(() => setInfoMsg(''), 3000);
    return () => clearTimeout(id);
  }, [infoMsg]);

  const sortedLessons = React.useMemo(() => sortByLessonId(lessons), []);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="shrink-0">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-sm font-medium px-3 py-1.5 rounded"
            >
              ← {t('learn:back', 'Back')}
            </button>
          </div>
          <h1 className="text-2xl font-bold text-center flex-1">
            {t('learn:pageTitle', 'Learn')}
          </h1>
          <div className="w-[76px] shrink-0" aria-hidden />
        </div>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 text-center">
          {t('learn:pageIntro', 'Short, beginner-friendly lessons about blockchain and the Stellar network. No prior knowledge needed.')}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {/* Export/Import controls */}
          <button
            type="button"
            onClick={() => {
              try {
                // Lazy import to avoid increasing initial bundle
                import('../utils/learn/exportImport.js').then(({ buildExportData, downloadJsonFile }) => {
                  const data = buildExportData({ includePracticeMeta: true });
                  downloadJsonFile(data, 'learn-progress.json');
                  setInfoMsg(t('learn:progress.exported', 'Progress exported'));
                }).catch(() => {
                  setErrorMsg(t('learn:progress.error', 'Could not save progress'));
                });
              } catch {
                setErrorMsg(t('learn:progress.error', 'Could not save progress'));
              }
            }}
            className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-xs font-medium px-3 py-1.5 rounded"
          >
            {t('learn:progress.export', 'Export')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  import('../utils/learn/exportImport.js').then(({ parseLearnExport, summarizeExportData }) => {
                    const text = String(reader.result || '');
                    const parsed = parseLearnExport(text);
                    if (!parsed.ok) {
                      setErrorMsg(t('learn:import.invalid', 'Invalid or incompatible file'));
                      try { if (fileInputRef.current) fileInputRef.current.value = ''; } catch { /* noop */ }
                      return;
                    }
                    const summary = summarizeExportData(parsed.data);
                    setImportDialog({ open: true, summary, data: parsed.data, strategy: 'merge', includePracticeMeta: true });
                  }).catch(() => {
                    setErrorMsg(t('learn:progress.error', 'Could not save progress'));
                  });
                } catch {
                  setErrorMsg(t('learn:progress.error', 'Could not save progress'));
                }
              };
              reader.readAsText(file);
            }}
          />
          <button
            type="button"
            onClick={() => { try { fileInputRef.current?.click(); } catch { /* noop */ } }}
            className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-xs font-medium px-3 py-1.5 rounded"
          >
            {t('learn:progress.import', 'Import')}
          </button>
          <a
            href={buildPath('glossar')}
            onClick={(e) => {
              e.preventDefault();
              try {
                const url = buildPath('glossar');
                window.history.pushState({}, '', url);
                window.dispatchEvent(new PopStateEvent('popstate'));
              } catch { /* noop */ }
            }}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
            title={t('learn:glossary.link', 'Open Glossary')}
            aria-label={t('learn:glossary.link', 'Open Glossary')}
          >
            {t('learn:glossary.link', 'Open Glossary')}
          </a>
          <button
            type="button"
            onClick={handleClearAll}
            className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-xs font-medium px-3 py-1.5 rounded"
          >
            {t('learn:progress.clearAll', 'Clear progress')}
          </button>
        </div>

        {/* Status/Fehler-Live-Regionen */}
        <div className="sr-only" role="status" aria-live="polite">{infoMsg}</div>
        <div className="sr-only" role="alert" aria-live="assertive">{errorMsg}</div>
        {infoMsg && (
          <div className="mt-2 text-xs bg-green-100 dark:bg-green-900/30 border border-green-300/60 text-green-800 dark:text-green-200 rounded p-2 inline-block">
            {infoMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mt-2 text-xs bg-red-100 dark:bg-red-900/30 border border-red-300/60 text-red-800 dark:text-red-200 rounded p-2 inline-block">
            {errorMsg}
          </div>
        )}
      </header>

      {/* Abzeichen-Übersicht */}
      <section className="mb-4" aria-labelledby="learn-badges-title">
        <h2 id="learn-badges-title" className="text-lg font-semibold">{t('learn:badges.title', 'Badges')}</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className={`px-2 py-1 rounded ${badges.chapters?.grundlagen ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}
            title={t('learn:badges.chapters.grundlagen', 'Basics')}
            aria-label={t('learn:badges.chapters.grundlagen', 'Basics')}>
            {t('learn:badges.chapters.grundlagen', 'Basics')}
          </span>
          <span className={`px-2 py-1 rounded ${badges.chapters?.sicherheit ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}
            title={t('learn:badges.chapters.sicherheit', 'Security')}
            aria-label={t('learn:badges.chapters.sicherheit', 'Security')}>
            {t('learn:badges.chapters.sicherheit', 'Security')}
          </span>
          <span className={`px-2 py-1 rounded ${badges.chapters?.praxis ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}
            title={t('learn:badges.chapters.praxis', 'Practice')}
            aria-label={t('learn:badges.chapters.praxis', 'Practice')}>
            {t('learn:badges.chapters.praxis', 'Practice')}
          </span>
          <span className={`ml-2 px-2 py-1 rounded ${badges.pro ? 'bg-indigo-700 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}
            title={t('learn:badges.pro', 'Stellar Pro')}
            aria-label={t('learn:badges.pro', 'Stellar Pro')}>
            {t('learn:badges.pro', 'Stellar Pro')}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sortedLessons.map((lesson) => {
          const pid = lesson.id;
          const state = progress[pid] || { completed: false, stars: 0 };
          const stars = Math.max(0, Math.min(3, Number(state.stars || 0)));
          return (
            <article key={pid} className="border border-gray-200 dark:border-gray-700 rounded p-3 bg-white dark:bg-gray-800 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-semibold mb-1">
                  {t(`learn:${pid}.title`, lesson.title)}
                </h2>
                {state.completed && (
                  <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-300 text-xs font-semibold" aria-label={t('learn:progress.completed', 'Completed')}>
                    ✓ {t('learn:progress.completed', 'Completed')}
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                <span className="font-medium">{t('learn:labels.goal', 'Goal')}:</span>{' '}
                {t(`learn:${pid}.goal`, lesson.goal)}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                <span className="font-medium">{t('learn:labels.task', 'Task')}:</span>{' '}
                {t(`learn:${pid}.task`, lesson.task)}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                <span className="font-medium">{t('learn:labels.outcome', 'Outcome')}:</span>{' '}
                {t(`learn:${pid}.learningOutcome`, lesson.learningOutcome)}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">{t('learn:labels.reward', 'Reward')}:</span>{' '}
                {t(`learn:${pid}.reward`, lesson.reward)}
              </p>

              {/* Fortschritt: Sterne & Abschluss */}
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1" role="group" aria-label={t('learn:progress.setStarsGroup', 'Set stars')}>
                  {[0,1,2,3].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => handleSetStars(pid, cnt)}
                      className={`px-2 py-1 rounded text-xs font-semibold border ${cnt === stars ? 'bg-yellow-400 text-black border-yellow-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border-gray-300 dark:border-gray-600'}`}
                      aria-pressed={cnt === stars}
                      aria-label={t('learn:progress.setStars', 'Set {count} stars').replace('{count}', String(cnt))}
                      title={t('learn:progress.setStars', 'Set {count} stars').replace('{count}', String(cnt))}
                    >
                      {t('learn:progress.starsLabel', '{count} ★').replace('{count}', String(cnt))}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleCompleted(pid)}
                    className={`px-3 py-1.5 rounded text-xs font-semibold ${state.completed ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100'}`}
                    aria-pressed={state.completed}
                    aria-label={state.completed ? t('learn:progress.completed', 'Completed') : t('learn:progress.markComplete', 'Mark as complete')}
                    title={state.completed ? t('learn:progress.completed', 'Completed') : t('learn:progress.markComplete', 'Mark as complete')}
                  >
                    {state.completed ? t('learn:progress.completed', 'Completed') : t('learn:progress.markComplete', 'Mark as complete')}
                  </button>
                  <a
                    href={buildPath(`quiz/${String(pid).match(/\d+/)?.[0] || '1'}/settings`)}
                    onClick={(e) => {
                      try {
                        e.preventDefault();
                        const id = String(pid).match(/\d+/)?.[0] || '1';
                        const url = buildPath(`quiz/${id}/settings`);
                        // remember previous path to restore on back
                        try { if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.setItem('STM_PREV_PATH', window.location.pathname); } } catch { /* noop */ }
                        window.history.pushState({}, '', url);
                        window.dispatchEvent(new PopStateEvent('popstate'));
                      } catch { /* noop */ }
                    }}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
                    title={t('quiz:landing.settings', 'Einstellungen')}
                    aria-label={t('quiz:landing.settings', 'Einstellungen')}
                  >
                    {t('quiz:landing.settings', 'Einstellungen')}
                  </a>
                  <a
                    href={buildPath(`quiz/${String(pid).match(/\d+/)?.[0] || '1'}`)}
                    onClick={(e) => {
                      try {
                        e.preventDefault();
                        const id = String(pid).match(/\d+/)?.[0] || '1';
                        const url = buildPath(`quiz/${id}`);
                        // remember previous path to restore on back
                        try { if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.setItem('STM_PREV_PATH', window.location.pathname); } } catch { /* noop */ }
                        window.history.pushState({}, '', url);
                        window.dispatchEvent(new PopStateEvent('popstate'));
                      } catch { /* noop */ }
                    }}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
                    title={t('learn:actions.startQuiz', 'Start quiz')}
                    aria-label={t('learn:actions.startQuiz', 'Start quiz')}
                  >
                    {t('learn:actions.startQuiz', 'Start quiz')}
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Import dialog */}
      {importDialog.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded shadow-lg p-4">
            <h3 className="text-lg font-semibold mb-2">{t('learn:import.title', 'Import progress')}</h3>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
              {t('learn:import.summary', 'Summary: {lessons} lessons, {stars} total stars. Practice meta: {meta}').
                replace('{lessons}', String(importDialog.summary?.countLessons || 0)).
                replace('{stars}', String(importDialog.summary?.starsSum || 0)).
                replace('{meta}', importDialog.summary?.hasPracticeMeta ? t('learn:import.metaYes', 'yes') : t('learn:import.metaNo', 'no'))}
            </p>
            {importDialog.summary?.createdAt && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('learn:import.createdAt', 'File created')}: {importDialog.summary.createdAt}</p>
            )}
            <div className="mt-2">
              <p className="text-sm font-medium mb-1">{t('learn:import.strategy', 'How to import?')}</p>
              <div className="flex items-center gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="stm-import-strategy"
                    checked={importDialog.strategy === 'merge'}
                    onChange={() => setImportDialog((s) => ({ ...s, strategy: 'merge' }))}
                  />
                  {t('learn:import.merge', 'Merge (keep existing, add from file)')}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="stm-import-strategy"
                    checked={importDialog.strategy === 'replace'}
                    onChange={() => setImportDialog((s) => ({ ...s, strategy: 'replace' }))}
                  />
                  {t('learn:import.replace', 'Replace (overwrite existing progress)')}
                </label>
              </div>
            </div>
            <div className="mt-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={importDialog.includePracticeMeta}
                  onChange={(e) => setImportDialog((s) => ({ ...s, includePracticeMeta: !!e.target.checked }))}
                />
                {t('learn:import.includePracticeMeta', 'Include practice metadata')}
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
                onClick={() => {
                  setImportDialog({ open: false, summary: null, data: null, strategy: 'merge', includePracticeMeta: true });
                  try { if (fileInputRef.current) fileInputRef.current.value = ''; } catch { /* noop */ }
                }}
              >
                {t('learn:import.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => {
                  try {
                    import('../utils/learn/exportImport.js').then(({ importLearnData }) => {
                      const v1 = importLearnData(importDialog.data, { strategy: importDialog.strategy, includePracticeMeta: importDialog.includePracticeMeta });
                      setProgress(getFlattenedProgress());
                      setBadges(computeBadges(v1));
                      setInfoMsg(t('learn:progress.imported', 'Progress imported'));
                      setImportDialog({ open: false, summary: null, data: null, strategy: 'merge', includePracticeMeta: true });
                      try { if (fileInputRef.current) fileInputRef.current.value = ''; } catch { /* noop */ }
                    }).catch(() => {
                      setErrorMsg(t('learn:progress.error', 'Could not save progress'));
                    });
                  } catch {
                    setErrorMsg(t('learn:progress.error', 'Could not save progress'));
                  }
                }}
              >
                {t('learn:import.confirm', 'Import')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBackToTop && (
        <button
          onClick={() => {
            try {
              const container = document.getElementById('stm-learn-overlay');
              if (container) {
                container.scrollTo({ top: 0, behavior: 'smooth' });
              } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            } catch { /* noop */ }
          }}
          className="fixed right-4 bottom-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          aria-label={t('learn:backToTop', 'Back to top')}
          title={t('learn:backToTop', 'Back to top')}
        >
          ↑ {t('learn:backToTop', 'Back to top')}
        </button>
      )}
    </div>
  );
}

export default LearnPage;
