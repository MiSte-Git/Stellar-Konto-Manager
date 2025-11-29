import React from 'react';
import { useTranslation } from 'react-i18next';
import QuestionCard from './QuestionCard.jsx';
import { recordQuizResult } from '../../utils/learnProgress.js';
import { useToast } from '../Toast.jsx';
import { buildPath } from '../../utils/basePath.js';
import { getQuizSettings, setQuizSettings } from '../../utils/quiz/settings.js';
import { getWarnOnActiveQuiz } from '../../utils/quiz/globalSettings.js';
import { getAchievements } from '../../utils/quiz/storage.js';

function computeHash(str) {
  try {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return String(h >>> 0);
  } catch { return '0'; }
}

export default function QuizRunner({ lessonId, data, onComplete, onExit, stickyFooterEnabled = true }) {
  const { t } = useTranslation(['quiz.ui', 'quiz', 'learn']);
  const { notify, ToastHost } = useToast();
  const [index, setIndex] = React.useState(0);
  const [selected, setSelected] = React.useState({});
  const [showFeedback, setShowFeedback] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const [score, setScore] = React.useState(0);
  const [newAchievements, setNewAchievements] = React.useState([]);
  const [earnedStars, setEarnedStars] = React.useState(0);
  const [correctCount, setCorrectCount] = React.useState(0);
  const nextBtnRef = React.useRef(null);
  const [showJump, setShowJump] = React.useState(false);

  // Einstellungen je Quiz (Sticky, Hints, Haptik, Shuffle, Zeitlimit)
  const [settings, setSettings] = React.useState(() => getQuizSettings(lessonId));
  React.useEffect(() => {
    setSettings(getQuizSettings(lessonId));
  }, [lessonId]);

  // Sticky aus Einstellungen, mit Fallback auf Prop
  const [stickyEnabled, setStickyEnabled] = React.useState(() => (settings?.stickyNav ?? stickyFooterEnabled));
  React.useEffect(() => {
    setStickyEnabled(settings?.stickyNav ?? stickyFooterEnabled);
  }, [settings?.stickyNav, stickyFooterEnabled]);

  // Haptisches Feedback (unterstützt in manchen Mobilbrowsern) – abhängig von Einstellungen
  const hapticsEnabled = !!(settings?.haptics ?? true);
  const vibrate = React.useCallback((pattern) => {
    try {
      if (!hapticsEnabled) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch { /* noop */ }
  }, [hapticsEnabled]);

  // Fragen ggf. mischen je nach Einstellung
  const q = React.useMemo(() => {
    const list = Array.isArray(data?.questions) ? data.questions : [];
    if (!settings?.shuffle) return list;
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [data, settings?.shuffle]);
  const total = q.length;
  const current = q[index] || null;
  const passRaw = (data?.meta?.passPercent ?? 80);
  const passDisplay = passRaw <= 1 ? Math.round(passRaw * 100) : passRaw;
  const threeRaw = data?.meta?.threeStarPercent;
  const threeDisplay = typeof threeRaw === 'number' ? (threeRaw <= 1 ? Math.round(threeRaw * 100) : threeRaw) : undefined;

  // Zeitlimit (gesamt für das Quiz)
  const timeLimitMin = Math.max(0, Number(settings?.timeLimit || 0));
  const [timeLeft, setTimeLeft] = React.useState(() => Math.max(0, Math.floor(timeLimitMin * 60)));
  React.useEffect(() => {
    setTimeLeft(Math.max(0, Math.floor(timeLimitMin * 60)));
  }, [timeLimitMin]);

  React.useEffect(() => {
    if (finished || timeLeft <= 0 || timeLimitMin <= 0) return;
    const id = setInterval(() => {
      setTimeLeft((s) => {
        if (s <= 1) return 0;
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [finished, timeLeft, timeLimitMin]);

  React.useEffect(() => {
    if (!finished && timeLimitMin > 0 && timeLeft === 0) {
      // Auto-Abschluss bei Zeitablauf
      finishQuiz(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, timeLimitMin]);

  // Warn before unload when at least one answer is given and quiz is not finished
  React.useEffect(() => {
    if (finished) return;
    if (!getWarnOnActiveQuiz()) return;
    const hasAnswered = Object.keys(selected || {}).length > 0;
    if (!hasAnswered) return;

    const handler = (e) => {
      try {
        const msg = t('quiz.ui:beforeUnloadMessage');
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      } catch {
        // fallback: Chrome ignores custom text
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, [selected, finished, t]);

  const handleAnswer = (id) => {
    setSelected((s) => ({ ...s, [current.id]: id }));
    setShowFeedback(true);

    // Haptik: kurz bei Auswahl, länger wenn falsch
    try {
      const opt = (current?.options || []).find((o) => o.id === id);
      if (opt && opt.correct) vibrate(10);
      else vibrate(30);
    } catch { /* noop */ }

    try { setTimeout(() => { try { nextBtnRef.current && nextBtnRef.current.focus(); } catch { /* noop */ } }, 0); } catch { /* noop */ }
  };


  const readLocalAchievements = (numId) => {
    try {
      return getAchievements(numId) || [];
    } catch { return []; }
  };

  const finishQuiz = (timeUp = false) => {
    // Compute correct count and percentage
    let correct = 0;
    for (const item of q) {
      const sel = selected[item.id];
      const opt = (item.options || []).find((o) => o.id === sel);
      if (opt && opt.correct) correct += 1;
    }
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    setCorrectCount(correct);
    setScore(pct);
    setFinished(true);
    vibrate(timeUp ? [80, 40, 80] : [20, 30, 20]);
    const answersStr = JSON.stringify(selected);
    const answersHash = computeHash(answersStr);
    const numericId = String(lessonId).replace(/[^0-9]/g, '') || '1';
    const before = readLocalAchievements(numericId).map((a) => a?.id).filter(Boolean);
    const res = recordQuizResult(`lesson${numericId}`, { score: pct, answersHash, passPercent: passRaw, threeStarPercent: threeRaw });
    try {
      const afterList = readLocalAchievements(numericId);
      const newly = afterList.filter((a) => a && a.id && !before.includes(a.id));
      setNewAchievements(newly);
      // Toasts für neue Abzeichen
      newly.forEach((a) => {
        try {
          const name = t(`quiz:achievements.${a.id}`, a.name || a.id);
          notify(t('quiz:result.toast.newAchievement', { name }), { type: 'success', duration: 3000 });
        } catch { /* noop */ }
      });
      try {
        const st = res?.v1?.lessons?.[`lesson${numericId}`] || {};
        setEarnedStars(Math.max(0, Math.min(3, Number(st.stars || 0))));
      } catch { /* noop */ }
    } catch { /* noop */ }
    try { onComplete && onComplete(res); } catch { /* noop */ }
  };

  const goNext = () => {
    if (index < total - 1) {
      setShowFeedback(false);
      setIndex((i) => i + 1);
      vibrate(10);
    } else {
      finishQuiz(false);
    }
  };

  const goPrev = () => {
    if (index > 0) {
      setShowFeedback(false);
      setIndex((i) => i - 1);
    }
  };

  // ESC schließt Sprung-Dialog
  React.useEffect(() => {
    if (!showJump) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowJump(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showJump]);

  if (!data || !Array.isArray(q) || q.length === 0) {
    return (
      <div className="text-sm text-gray-600 dark:text-gray-300">
        <div>{t('learn:status.noData', 'No quiz data')}</div>
        <button
          type="button"
          onClick={() => { try { onExit && onExit(); } catch { /* noop */ } }}
          className="mt-3 inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-xs font-medium px-3 py-1.5 rounded"
        >
          ← {t('quiz.ui:backToLearn')}
        </button>
      </div>
    );
  }

  if (finished) {
    const pass = (data?.meta?.passPercent ?? 80);
    const passPct = pass <= 1 ? pass * 100 : pass; // normalize to 0-100 scale
    const passed = score >= passPct;
    const passDisp = Math.round(passPct);
    const goBackToOverview = () => { try { onExit && onExit(); } catch { /* noop */ } };
    const goNextLesson = () => {
      try {
        const id = (Number(String(lessonId).replace(/[^0-9]/g, '') || '1') + 1);
        const url = buildPath(`quiz/${id}/run`);
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch { /* noop */ }
    };
    return (
      <div className="mt-2">
        <div className="text-lg font-semibold">{t('quiz:result.score', { score })}</div>
        <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">{t('quiz:result.summary', { correct: correctCount, total })}</div>
        <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">{t('quiz:result.passInfo', { pass: passDisp, status: passed ? t('quiz:result.passed') : t('quiz:result.failed') })}</div>
        {typeof threeDisplay === 'number' && (
          <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">{t('quiz:result.threeStarThreshold', { value: threeDisplay })}</div>
        )}
        <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">{t('quiz:result.stars', { stars: earnedStars })}</div>

        <div className="mt-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('quiz:result.newAchievementsTitle')}</div>
          {(!newAchievements || newAchievements.length === 0) ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">{t('quiz:result.noNewAchievements')}</div>
          ) : (
            <ul className="mt-1 space-y-1">
              {newAchievements.map((a, idx) => (
                <li key={idx} className="text-sm text-gray-800 dark:text-gray-200 flex items-center gap-2">
                  <svg viewBox="0 0 20 20" className="w-4 h-4 text-yellow-400" aria-hidden="true" focusable="false">
                    <path fill="currentColor" d="M10 1.5l2.39 4.84 5.34.78-3.86 3.76.91 5.32L10 13.77l-4.78 2.51.91-5.32L2.27 7.12l5.34-.78L10 1.5z"/>
                  </svg>
                  {t('quiz:achievements.badge', { name: t(`quiz:achievements.${a.id}`, a.name || a.id || String(idx + 1)) })}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={() => {
              setIndex(0);
              setSelected({});
              setShowFeedback(false);
              setFinished(false);
              setScore(0);
              setCorrectCount(0);
              setNewAchievements([]);
              setEarnedStars(0);
            }}
          >
            {t('quiz:result.retry')}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
            onClick={goBackToOverview}
          >
            {t('quiz:result.backToOverview')}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
            onClick={goNextLesson}
          >
            {t('quiz:result.nextLesson')}
          </button>
        </div>
      </div>
    );
  }

  const selId = selected[current?.id];

  // Sticky-Button im Runner aktualisiert Quiz-Settings
  const toggleSticky = () => {
    setStickyEnabled((v) => {
      const next = !v;
      const id = String(lessonId || '1').replace(/[^0-9]/g, '') || '1';
      const cur = getQuizSettings(id);
      const updated = { ...cur, stickyNav: next };
      setSettings(updated);
      setQuizSettings(id, updated);
      return next;
    });
  };

  const formatTime = (s) => {
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  return (
    <div className={`max-w-2xl mx-auto px-2 sm:px-0 ${stickyEnabled ? 'pb-20 sm:pb-0' : ''}`}>
      <ToastHost />
      <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
        <div className="text-sm text-gray-600 dark:text-gray-300">{t('quiz.ui:quiz')} — {index + 1} {t('quiz.ui:of')} {total}</div>
        <div className="text-right text-sm text-gray-600 dark:text-gray-300">
          <div>{t('quiz:meta.estimatedMinutes', 'Estimated minutes')}: {data?.meta?.estimatedMinutes ?? 2}</div>
          <div>{t('quiz:meta.passThreshold')}: {passDisplay}%</div>
          {typeof threeDisplay === 'number' && (
            <div>{t('quiz:meta.threeStarThreshold')}: {threeDisplay}%</div>
          )}
          {timeLimitMin > 0 && !finished && (
            <div className="mt-1">
              {t('quiz.ui:timeRemaining')}: {formatTime(timeLeft)}
            </div>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowJump(true)}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
            >
              {t('quiz.ui:jump')}
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  const id = String(lessonId || '').replace(/[^0-9]/g, '') || '1';
                  const url = buildPath(`quiz/${id}/settings`);
                  window.history.pushState({}, '', url);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch { /* noop */ }
              }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
              title={t('quiz:landing.settings', 'Einstellungen')}
              aria-label={t('quiz:landing.settings', 'Einstellungen')}
            >
              {t('quiz:landing.settings', 'Einstellungen')}
            </button>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-gray-700 dark:text-gray-300">{t('quiz.ui:stickyNav')}</span>
              <button
                type="button"
                onClick={toggleSticky}
                aria-pressed={stickyEnabled}
                className={`px-2 py-1 rounded text-xs font-semibold border ${stickyEnabled ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600'}`}
                aria-label={stickyEnabled ? t('quiz.ui:on') : t('quiz.ui:off')}
                title={stickyEnabled ? t('quiz.ui:on') : t('quiz.ui:off')}
              >
                {stickyEnabled ? t('quiz.ui:on') : t('quiz.ui:off')}
              </button>
            </label>
          </div>
        </div>
      </div>

      {/* Fortschrittsbalken */}
      <div className="mt-2" aria-hidden="false">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(((index + 1) / Math.max(1, total)) * 100)}
          aria-valuetext={`${index + 1} ${t('quiz.ui:of')} ${total}`}
          className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
        >
          <div
            className="h-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-300 ease-out"
            style={{ width: `${Math.round(((index + 1) / Math.max(1, total)) * 100)}%` }}
          />
        </div>
      </div>

      <div className="mt-3">
        <QuestionCard
          type={current?.type}
          questionKey={current?.questionKey}
          hintKey={current?.hintKey}
          options={current?.options}
          onAnswer={handleAnswer}
          selectedOptionId={selId}
          showFeedback={showFeedback}
          disabled={false}
          hintsEnabled={settings?.hints !== false}
        />
      </div>
      {/* Desktop/Tablet Navigation */}
      <div className="mt-4 hidden sm:flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          className="px-4 py-2 min-h-11 rounded text-sm font-semibold bg-gray-200 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
        >
          {t('quiz.ui:prev')}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowJump(true)}
            className="px-3 py-2 min-h-11 rounded text-sm font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
          >
            {t('quiz.ui:jump')}
          </button>
        </div>
        <button
          type="button"
          onClick={goNext}
          disabled={!selId}
          ref={nextBtnRef}
          className="px-4 py-2 min-h-11 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white"
        >
          {index < total - 1 ? t('quiz.ui:next') : t('quiz.ui:finish')}
        </button>
      </div>

      {/* Mobile Sticky Navigation */}
      {stickyEnabled && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 px-3 py-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={index === 0}
              className="flex-1 px-4 py-2 min-h-11 rounded text-sm font-semibold bg-gray-200 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
            >
              {t('quiz.ui:prev')}
            </button>
            <button
              type="button"
              onClick={() => setShowJump(true)}
              className="px-3 py-2 min-h-11 rounded text-sm font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
            >
              {t('quiz.ui:jump')}
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!selId}
              ref={nextBtnRef}
              className="flex-1 px-4 py-2 min-h-11 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white"
            >
              {index < total - 1 ? t('quiz.ui:next') : t('quiz.ui:finish')}
            </button>
          </div>
        </div>
      )}

      {/* Sprung-Dialog */}
      {showJump && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="jump-title">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowJump(false)} />
          <div className="relative mx-auto mt-[10vh] max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4">
            <div id="jump-title" className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('quiz.ui:jumpToQuestion')}</div>
            <div className="grid grid-cols-5 gap-2" role="list">
              {q.map((_, i) => {
                const answered = !!selected[q[i].id];
                return (
                  <button
                    key={q[i].id}
                    type="button"
                    onClick={() => { setIndex(i); setShowJump(false); setShowFeedback(false); vibrate(10); }}
                    className={`px-2 py-2 rounded text-sm font-medium border transition-colors ${answered ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                    aria-label={`${t('quiz.ui:question')} ${i + 1}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 text-right">
              <button
                type="button"
                onClick={() => setShowJump(false)}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
              >
                {t('quiz.ui:cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
