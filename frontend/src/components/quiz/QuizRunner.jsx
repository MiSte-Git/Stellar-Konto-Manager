import React from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.div> etc.
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import QuestionCard from './QuestionCard.jsx';
import Lumio from './Lumio.jsx';
import { recordQuizResult } from '../../utils/learnProgress.js';
import { useToast } from '../Toast.jsx';
import { buildPath } from '../../utils/basePath.js';
import { getQuizSettings, setQuizSettings } from '../../utils/quiz/settings.js';
import { getWarnOnActiveQuiz } from '../../utils/quiz/globalSettings.js';
import { getAchievements } from '../../utils/quiz/storage.js';
import { getNextQuizId, getQuizIndex, getTotalQuizCount } from '../../utils/quiz/quizNavigation.js';

function computeHash(str) {
  try {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return String(h >>> 0);
  } catch { return '0'; }
}

// --- XP helpers ---------------------------------------------------------
function readTotalXP() {
  try { return Math.max(0, Number(localStorage.getItem('quiz_total_xp')) || 0); } catch { return 0; }
}
function writeTotalXP(v) {
  try { localStorage.setItem('quiz_total_xp', String(Math.max(0, v))); } catch { /* noop */ }
}
function readStreak() {
  try { return Math.max(0, Number(localStorage.getItem('quiz_streak')) || 0); } catch { return 0; }
}
function writeStreak(v) {
  try { localStorage.setItem('quiz_streak', String(Math.max(0, v))); } catch { /* noop */ }
}

// --- Floating +XP component --------------------------------------------
function FloatingXP({ amount, id }) {
  return (
    <motion.div
      key={id}
      initial={{ y: 0, opacity: 1 }}
      animate={{ y: -30, opacity: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className="absolute -top-2 right-0 text-sm font-bold text-indigo-500 pointer-events-none select-none"
    >
      +{amount} XP
    </motion.div>
  );
}

// --- Animated counter ---------------------------------------------------
function AnimatedCounter({ value, duration = 1.2 }) {
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    let start = 0;
    const end = value;
    if (end === start) { setDisplay(end); return; }
    const startTime = performance.now();
    let raf;
    const step = (now) => {
      const elapsed = Math.min((now - startTime) / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (elapsed < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{display}</>;
}

// --- Star rating component ----------------------------------------------
function StarRating({ stars }) {
  return (
    <div className="flex justify-center gap-3 my-4">
      {[1, 2, 3].map((i) => (
        <motion.div
          key={i}
          initial={{ scale: 0, rotate: -180, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ delay: 0.3 + i * 0.25, duration: 0.5, type: 'spring', stiffness: 200 }}
        >
          <svg viewBox="0 0 24 24" className={`w-12 h-12 ${i <= stars ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>
            <path fill="currentColor" d="M12 2l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17l-5.8 3-1.1-6.5L.4 8.8l6.5-.9z"/>
          </svg>
        </motion.div>
      ))}
    </div>
  );
}

// --- Hearts display -----------------------------------------------------
function Hearts({ lives, maxLives = 3 }) {
  return (
    <div className="flex gap-0.5" aria-label={`${lives} / ${maxLives}`}>
      {Array.from({ length: maxLives }, (_, i) => (
        <motion.span
          key={i}
          animate={i < lives ? { scale: [1, 1.2, 1] } : { scale: 1 }}
          transition={{ duration: 0.3 }}
          className="text-lg select-none"
        >
          {i < lives ? '\u2764\uFE0F' : '\uD83D\uDDA4'}
        </motion.span>
      ))}
    </div>
  );
}

// ========================================================================
// QuizRunner
// ========================================================================
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

  // Hearts / lives
  const MAX_LIVES = 3;
  const [lives, setLives] = React.useState(MAX_LIVES);
  const [gameOver, setGameOver] = React.useState(false);

  // XP
  const [sessionXP, setSessionXP] = React.useState(0);
  const [floatingXPs, setFloatingXPs] = React.useState([]);
  const [hintsUsed, setHintsUsed] = React.useState({});

  // Lumio state
  const [lumioState, setLumioState] = React.useState('idle');

  // Settings
  const [settings, setSettings] = React.useState(() => getQuizSettings(lessonId));
  React.useEffect(() => {
    setSettings(getQuizSettings(lessonId));
  }, [lessonId]);

  const [stickyEnabled, setStickyEnabled] = React.useState(() => (settings?.stickyNav ?? stickyFooterEnabled));
  React.useEffect(() => {
    setStickyEnabled(settings?.stickyNav ?? stickyFooterEnabled);
  }, [settings?.stickyNav, stickyFooterEnabled]);

  // Haptics
  const hapticsEnabled = !!(settings?.haptics ?? true);
  const vibrate = React.useCallback((pattern) => {
    try {
      if (!hapticsEnabled) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch { /* noop */ }
  }, [hapticsEnabled]);

  // Shuffle questions
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

  // Time limit
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
      finishQuiz(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, timeLimitMin]);

  // Warn before unload
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

  // Track hint usage per question
  const trackHintUsage = React.useCallback(() => {
    if (current) {
      setHintsUsed((prev) => ({ ...prev, [current.id]: true }));
    }
  }, [current]);

  // Watch for hint button clicks (a simple approach: detect if hint is enabled and used)
  React.useEffect(() => {
    if (!current) return;
    const observer = new MutationObserver(() => {
      const hintBtn = document.querySelector('[aria-expanded="true"][aria-controls*="hint"]');
      if (hintBtn) trackHintUsage();
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['aria-expanded'] });
    return () => observer.disconnect();
  }, [current, trackHintUsage]);

  const handleAnswer = (id) => {
    setSelected((s) => ({ ...s, [current.id]: id }));
    setShowFeedback(true);

    const opt = (current?.options || []).find((o) => o.id === id);
    const isCorrect = opt && opt.correct;

    if (isCorrect) {
      vibrate(10);
      setLumioState('happy');
      // XP: +15 without hint, +10 with hint
      const xpGain = hintsUsed[current.id] ? 10 : 15;
      setSessionXP((prev) => prev + xpGain);
      writeTotalXP(readTotalXP() + xpGain);
      setFloatingXPs((prev) => [...prev, { id: Date.now(), amount: xpGain }]);
      // Update streak
      writeStreak(readStreak() + 1);
    } else {
      vibrate(30);
      setLumioState('sad');
      setLives((prev) => Math.max(0, prev - 1));
      // Reset streak on wrong answer
      writeStreak(0);
    }

    try { setTimeout(() => { try { nextBtnRef.current && nextBtnRef.current.focus(); } catch { /* noop */ } }, 0); } catch { /* noop */ }
  };

  // Clear floating XPs after animation
  React.useEffect(() => {
    if (floatingXPs.length === 0) return;
    const timer = setTimeout(() => setFloatingXPs([]), 1000);
    return () => clearTimeout(timer);
  }, [floatingXPs]);

  // Check for game over
  React.useEffect(() => {
    if (lives === 0 && !finished && !gameOver) {
      setGameOver(true);
      setLumioState('sad');
    }
  }, [lives, finished, gameOver]);

  const readLocalAchievements = (numId) => {
    try {
      return getAchievements(numId) || [];
    } catch { return []; }
  };

  const finishQuiz = (timeUp = false) => {
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

    // Confetti on pass
    const passPct = passRaw <= 1 ? passRaw * 100 : passRaw;
    if (pct >= passPct) {
      setLumioState('celebrate');
      const isLastQuiz = !getNextQuizId(lessonId);
      try {
        confetti({ particleCount: isLastQuiz ? 250 : 120, spread: isLastQuiz ? 120 : 80, origin: { y: 0.7 } });
        if (isLastQuiz) {
          setTimeout(() => { try { confetti({ particleCount: 150, spread: 100, origin: { y: 0.5 } }); } catch { /* noop */ } }, 600);
        }
      } catch { /* noop */ }
    } else {
      setLumioState('sad');
    }

    try { onComplete && onComplete(res); } catch { /* noop */ }
  };

  const goNext = () => {
    if (index < total - 1) {
      setShowFeedback(false);
      setIndex((i) => i + 1);
      setLumioState('idle');
      vibrate(10);
    } else {
      finishQuiz(false);
    }
  };

  const resetQuiz = () => {
    setIndex(0);
    setSelected({});
    setShowFeedback(false);
    setFinished(false);
    setScore(0);
    setCorrectCount(0);
    setNewAchievements([]);
    setEarnedStars(0);
    setLives(MAX_LIVES);
    setGameOver(false);
    setSessionXP(0);
    setHintsUsed({});
    setLumioState('idle');
  };

  // ESC closes jump dialog
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

  // Sticky toggle
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

  const progressPercent = Math.round(((index + (showFeedback ? 1 : 0)) / Math.max(1, total)) * 100);

  // ---- No data ----
  if (!data || !Array.isArray(q) || q.length === 0) {
    return (
      <div className="text-sm text-gray-600 dark:text-gray-300">
        <div>{t('learn:status.noData', 'No quiz data')}</div>
        <button
          type="button"
          onClick={() => { try { onExit && onExit(); } catch { /* noop */ } }}
          className="mt-3 inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-xs font-medium px-3 py-1.5 rounded"
        >
          {t('quiz.ui:backToLearn')}
        </button>
      </div>
    );
  }

  // ---- Game Over (0 hearts) ----
  if (gameOver && !finished) {
    return (
      <div className="max-w-lg mx-auto text-center py-12 px-4">
        <ToastHost />
        <Lumio state="sad" size={120} />
        <h2 className="text-2xl font-bold mt-6 text-gray-900 dark:text-gray-100">
          {t('quiz:result.failed')}
        </h2>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          {t('quiz:result.summary', { correct: Object.entries(selected).filter(([qId]) => {
            const question = q.find((item) => item.id === qId);
            const opt = question?.options?.find((o) => o.id === selected[qId]);
            return opt?.correct;
          }).length, total })}
        </p>
        <p className="mt-2 text-lg font-medium text-indigo-600 dark:text-indigo-400">
          {sessionXP} XP
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <button
            type="button"
            onClick={resetQuiz}
            className="px-6 py-3 rounded-2xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            {t('quiz:result.retry')}
          </button>
          <button
            type="button"
            onClick={() => { try { onExit && onExit(); } catch { /* noop */ } }}
            className="px-6 py-3 rounded-2xl text-sm font-bold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors"
          >
            {t('quiz:result.backToOverview')}
          </button>
        </div>
      </div>
    );
  }

  // ---- Completion screen ----
  if (finished) {
    const pass = (data?.meta?.passPercent ?? 80);
    const passPct = pass <= 1 ? pass * 100 : pass;
    const passed = score >= passPct;
    const goBackToOverview = () => {
      try {
        const url = buildPath('');
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch { /* noop */ }
    };

    return (
      <div className="max-w-lg mx-auto text-center py-8 px-4">
        <ToastHost />
        <Lumio state={passed ? 'celebrate' : 'sad'} size={120} />
        <StarRating stars={earnedStars} />
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.5, type: 'spring' }}
        >
          <div className="text-4xl font-bold text-gray-900 dark:text-gray-100">
            <AnimatedCounter value={score} />%
          </div>
          <div className="text-sm mt-1 text-gray-600 dark:text-gray-400">
            {t('quiz:result.summary', { correct: correctCount, total })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.8, duration: 0.4 }}
          className="mt-4"
        >
          <div className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold ${passed ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
            {passed ? t('quiz:result.passed') : t('quiz:result.failed')}
          </div>

          <div className="mt-4 flex justify-center gap-6 text-sm text-gray-600 dark:text-gray-400">
            <div>
              <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{sessionXP}</div>
              <div>XP</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{earnedStars}/3</div>
              <div>{t('quiz:result.stars', { stars: '' }).replace(/[: ]*$/, '')}</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {t('quiz:result.passInfo', { pass: Math.round(passPct), status: passed ? t('quiz:result.passed') : t('quiz:result.failed') })}
            {typeof threeDisplay === 'number' && (
              <span className="ml-2">{t('quiz:result.threeStarThreshold', { value: threeDisplay })}</span>
            )}
          </div>
        </motion.div>

        {/* Achievements */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.2, duration: 0.4 }}
          className="mt-5"
        >
          {newAchievements.length > 0 && (
            <div className="text-left bg-yellow-50 dark:bg-yellow-900/20 rounded-2xl p-4 border border-yellow-200 dark:border-yellow-800">
              <div className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">{t('quiz:result.newAchievementsTitle')}</div>
              <ul className="mt-2 space-y-1">
                {newAchievements.map((a, idx) => (
                  <li key={idx} className="text-sm text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
                    <svg viewBox="0 0 20 20" className="w-4 h-4 text-yellow-400 flex-shrink-0" aria-hidden="true" focusable="false">
                      <path fill="currentColor" d="M10 1.5l2.39 4.84 5.34.78-3.86 3.76.91 5.32L10 13.77l-4.78 2.51.91-5.32L2.27 7.12l5.34-.78L10 1.5z"/>
                    </svg>
                    {t('quiz:achievements.badge', { name: t(`quiz:achievements.${a.id}`, a.name || a.id || String(idx + 1)) })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(!newAchievements || newAchievements.length === 0) && (
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('quiz:result.noNewAchievements')}</div>
          )}
        </motion.div>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.5, duration: 0.4 }}
          className="mt-8 flex flex-col sm:flex-row justify-center gap-3"
        >
          <button
            type="button"
            className="px-6 py-3 rounded-2xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            onClick={resetQuiz}
          >
            {t('quiz:result.retry')}
          </button>
          {(() => {
            const nextId = getNextQuizId(lessonId);
            if (nextId) {
              return (
                <button
                  type="button"
                  className="px-6 py-3 rounded-2xl text-sm font-bold bg-green-600 hover:bg-green-700 text-white transition-colors"
                  onClick={() => {
                    try {
                      const url = buildPath(`quiz/${nextId}`);
                      window.history.pushState({}, '', url);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    } catch { /* noop */ }
                  }}
                >
                  {t('quiz.ui:nextQuiz')} →
                </button>
              );
            }
            return (
              <div className="px-6 py-3 rounded-2xl text-sm font-bold bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 border border-yellow-300 dark:border-yellow-700">
                🎉 {t('quiz.ui:allDone')}
              </div>
            );
          })()}
          <button
            type="button"
            className="px-6 py-3 rounded-2xl text-sm font-bold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors"
            onClick={goBackToOverview}
          >
            {t('quiz:result.backToOverview')}
          </button>
        </motion.div>
      </div>
    );
  }

  const selId = selected[current?.id];
  const currentOpt = selId ? (current?.options || []).find((o) => o.id === selId) : null;
  const isCorrect = currentOpt?.correct;

  // ---- Active quiz ----
  return (
    <div className={`max-w-2xl mx-auto px-3 sm:px-0 ${stickyEnabled ? 'pb-24 sm:pb-0' : ''}`}>
      <ToastHost />

      {/* 1. HEADER BAR */}
      <div className="flex items-center gap-3 py-3">
        {/* Back / X button */}
        {index > 0 ? (
          <button
            type="button"
            onClick={() => { setShowFeedback(false); setIndex((i) => Math.max(0, i - 1)); setLumioState('idle'); vibrate(10); }}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors"
            aria-label={t('quiz.ui:prev')}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 5 5 12 12 19" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { try { onExit && onExit(); } catch { /* noop */ } }}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors"
            aria-label={t('quiz.ui:cancel')}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}

        {/* Progress bar */}
        <div className="flex-1">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-valuetext={`${index + 1} ${t('quiz.ui:of')} ${total}`}
            className="h-3 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
          >
            <motion.div
              className="h-full bg-indigo-500 rounded-full"
              initial={false}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Hearts */}
        <Hearts lives={lives} maxLives={MAX_LIVES} />
      </div>

      {/* 2. XP + META BAR */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
        <div className="relative font-semibold text-indigo-600 dark:text-indigo-400">
          {sessionXP} XP
          <AnimatePresence>
            {floatingXPs.map((f) => (
              <FloatingXP key={f.id} id={f.id} amount={f.amount} />
            ))}
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-3">
          {timeLimitMin > 0 && (
            <span>{t('quiz.ui:timeRemaining')}: {formatTime(timeLeft)}</span>
          )}
          <span>{index + 1} {t('quiz.ui:of')} {total}</span>
          <button
            type="button"
            onClick={() => setShowJump(true)}
            className="px-2 py-1 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
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
            className="px-2 py-1 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
            title={t('quiz:landing.settings', 'Einstellungen')}
            aria-label={t('quiz:landing.settings', 'Einstellungen')}
          >
            <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 inline" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Meta thresholds */}
      <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 mb-4">
        <span>{t('quiz:meta.passThreshold')}: {passDisplay}%</span>
        {typeof threeDisplay === 'number' && (
          <span>{t('quiz:meta.threeStarThreshold')}: {threeDisplay}%</span>
        )}
      </div>

      {/* 3. MASCOT + QUESTION */}
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0 pt-1">
          <Lumio state={lumioState} size={64} />
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id || index}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex-1 min-w-0"
          >
            {/* Speech bubble */}
            <div className="relative bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
              <div className="absolute -left-2 top-5 w-3 h-3 bg-white dark:bg-gray-800 border-l border-b border-gray-200 dark:border-gray-700 rotate-45" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t(current?.questionKey)}</h3>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 4. ANSWER AREA */}
      <div>
        <QuestionCard
          type={current?.type}
          questionKey={current?.questionKey}
          hintKey={current?.hintKey}
          options={current?.options}
          onAnswer={handleAnswer}
          selectedOptionId={selId}
          showFeedback={showFeedback}
          disabled={showFeedback}
          hintsEnabled={settings?.hints !== false}
        />
      </div>

      {/* 5. FEEDBACK BANNER (slide from bottom) */}
      <AnimatePresence>
        {showFeedback && selId && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={`mt-4 rounded-2xl p-5 ${isCorrect
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
            }`}
            role="status"
            aria-live="polite"
          >
            <div className={`text-lg font-bold ${isCorrect ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
              {isCorrect ? t('quiz.ui:correct') : t('quiz.ui:incorrect')}
            </div>
            <div className={`mt-1 text-sm ${isCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {currentOpt?.feedbackKey && t(currentOpt.feedbackKey)}
            </div>
            <button
              type="button"
              ref={nextBtnRef}
              onClick={goNext}
              className={`mt-3 w-full py-3 rounded-2xl text-sm font-bold text-white transition-colors ${isCorrect
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {index < total - 1 ? t('quiz.ui:next') : t('quiz.ui:finish')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky mobile bar (only shown when no feedback banner) */}
      {stickyEnabled && !showFeedback && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 px-3 py-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1 cursor-pointer select-none">
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('quiz.ui:stickyNav')}</span>
              <button
                type="button"
                onClick={toggleSticky}
                aria-pressed={stickyEnabled}
                className={`px-2 py-1 rounded text-xs font-semibold border ${stickyEnabled ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600'}`}
                aria-label={stickyEnabled ? t('quiz.ui:on') : t('quiz.ui:off')}
              >
                {stickyEnabled ? t('quiz.ui:on') : t('quiz.ui:off')}
              </button>
            </label>
          </div>
        </div>
      )}

      {/* Jump dialog */}
      {showJump && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="jump-title">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowJump(false)} />
          <div className="relative mx-auto mt-[10vh] max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-5">
            <div id="jump-title" className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('quiz.ui:jumpToQuestion')}</div>
            <div className="grid grid-cols-5 gap-2" role="list">
              {q.map((_, i) => {
                const answered = !!selected[q[i].id];
                return (
                  <button
                    key={q[i].id}
                    type="button"
                    onClick={() => { setIndex(i); setShowJump(false); setShowFeedback(false); setLumioState('idle'); vibrate(10); }}
                    className={`px-2 py-2 rounded-xl text-sm font-medium border transition-colors ${answered ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                    aria-label={`${t('quiz.ui:question')} ${i + 1}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 text-right">
              <button
                type="button"
                onClick={() => setShowJump(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
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
