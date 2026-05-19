import React from 'react';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';
import Lumio from '../quiz/Lumio.jsx';
import ChatWindow from './ChatWindow.jsx';
import DrainScreen from './DrainScreen.jsx';
import TimeSkipScreen from './TimeSkipScreen.jsx';
import DecisionButtons from './DecisionButtons.jsx';
import ResultScreen from './ResultScreen.jsx';
import useScamSimulator from './hooks/useScamSimulator.js';
import { buildPath } from '../../utils/basePath.js';
import { recordScamSimulatorResult, readProgressV1 } from '../../utils/learnProgress.js';

/** Emoji icon per scenario category */
const CATEGORY_ICONS = {
  'fake-support': '🎭',
  'fake-website': '🌐',
  'fake-airdrop': '🎁',
  'romance-scam': '💔',
  'fake-job':     '💼',
};

/** kebab-case category → camelCase i18n key */
function categoryKey(category) {
  return category?.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) ?? 'fakeSupport';
}

/** Returns a Set of scenarioIds that the user completed correctly */
function getCompletedScenarios() {
  try {
    const checks = readProgressV1().lessons['scam-simulator']?.checks || {};
    const done = new Set();
    for (const [key, val] of Object.entries(checks)) {
      if (val === true && key.startsWith('scenario_')) {
        done.add(key.slice('scenario_'.length));
      }
    }
    return done;
  } catch { return new Set(); }
}

/**
 * ScamSimulatorPage
 *
 * Props:
 *   scenarios – array of scenario objects from scenarios.js
 *   onBack    – optional callback; if omitted, navigates to the main page
 */
export default function ScamSimulatorPage({ scenarios = [], onBack, onGoHome }) {
  const { t } = useTranslation('scamSimulator');
  const scrollRef = React.useRef(null);

  // null = show scenario selection screen; a scenario object = play that scenario
  const [selectedScenario, setSelectedScenario] = React.useState(null);

  // Which scenarios have been completed correctly (used to show ✅ badge)
  const [completedScenarios, setCompletedScenarios] = React.useState(() => getCompletedScenarios());

  const {
    phase,
    visibleMessages,
    chosen,
    currentOptions,
    followUpDone,
    isTyping,
    sessionXP,
    demoTokens,
    demoPhase,
    txHash,
    explorerUrl,
    start,
    choose,
    completeTimeskip,
    completeDrain,
    continueToResult,
    reset,
  } = useScamSimulator(selectedScenario);

  // Record progress exactly once when the result phase is reached
  const resultRecorded = React.useRef(false);
  React.useEffect(() => {
    if (phase !== 'result' || !chosen || !selectedScenario) return;
    if (resultRecorded.current) return;
    resultRecorded.current = true;

    const correct = !chosen.isScam;
    recordScamSimulatorResult('scam-simulator', {
      correct,
      scenarioId: selectedScenario.id,
      xp: sessionXP,
    });
    if (correct) {
      setCompletedScenarios((prev) => new Set([...prev, selectedScenario.id]));
    }
  }, [phase, chosen, selectedScenario, sessionXP]);

  // Lumio reacts to phase & outcome
  const lumioState = React.useMemo(() => {
    if (phase === 'result') {
      if (!chosen) return 'idle';
      return chosen.isScam ? 'sad' : 'celebrate';
    }
    if (phase === 'intro') return 'idle';
    return 'happy';
  }, [phase, chosen]);

  const goToMain = React.useCallback(() => {
    if (onBack) { onBack(); return; }
    try {
      window.history.pushState({}, '', buildPath('discover'));
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* noop */ }
  }, [onBack]);

  const goToHome = React.useCallback(() => {
    if (onGoHome) { onGoHome(); return; }
    try {
      window.history.pushState({}, '', buildPath(''));
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* noop */ }
  }, [onGoHome]);

  const goToSelection = React.useCallback(() => {
    resultRecorded.current = false;
    reset();
    setSelectedScenario(null);
  }, [reset]);

  const handleSelectScenario = React.useCallback((sc) => {
    resultRecorded.current = false;
    reset();
    setSelectedScenario(sc);
  }, [reset]);

  // ── Selection screen ────────────────────────────────────────────────────────
  if (!selectedScenario) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Nav row: HOME → / | BACK → /discover */}
        <div className="mb-6 flex gap-2">
          <button
            type="button"
            onClick={goToHome}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            🏠
          </button>
          <button
            type="button"
            onClick={goToMain}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            ←
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Header */}
          <div className="flex flex-col items-center gap-3 mb-6">
            <Lumio state="idle" size={72} />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('ui.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t('ui.subtitle')}</p>
          </div>

          {/* Scenario cards */}
          <div className="flex flex-col gap-3">
            {scenarios.map((sc, i) => {
              const icon = CATEGORY_ICONS[sc.category] ?? '💬';
              const catKey = categoryKey(sc.category);
              const isDone = completedScenarios.has(sc.id);

              return (
                <motion.button
                  key={sc.id}
                  type="button"
                  onClick={() => handleSelectScenario(sc)}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="w-full text-left flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-md transition-all"
                >
                  <span className="text-3xl select-none shrink-0" aria-hidden="true">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                      {t(sc.contact.nameKey)}
                    </div>
                    <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium">
                      {t(`ui.category.${catKey}`)}
                    </span>
                  </div>
                  <div className="relative shrink-0 flex items-center justify-center w-6 h-6">
                    <span className="text-gray-300 dark:text-gray-600 text-lg">›</span>
                    {isDone && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center ring-2 ring-white dark:ring-gray-800">
                        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1.5 5 L4 7.5 L8.5 2.5" />
                        </svg>
                      </div>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Intro screen ────────────────────────────────────────────────────────────
  if (phase === 'intro') {
    const catKey = categoryKey(selectedScenario.category);

    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Back to selection */}
        <button
          type="button"
          onClick={goToSelection}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          ←
        </button>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden"
        >
          {/* Header with Lumio */}
          <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-4 bg-gradient-to-b from-indigo-50 dark:from-indigo-950/30 to-transparent">
            <Lumio state="idle" size={80} />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t('ui.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              {t('ui.subtitle')}
            </p>
          </div>

          {/* Scenario info */}
          <div className="px-6 pb-6 pt-2">
            <div className="mb-4">
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium">
                {t(`ui.category.${catKey}`)}
              </span>
            </div>

            {/* Contact preview */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 mb-5">
              <span className="text-3xl select-none" aria-hidden="true">{selectedScenario.contact?.avatar ?? '💬'}</span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                    {t(selectedScenario.contact?.nameKey ?? '')}
                  </span>
                  {selectedScenario.contact?.verified === false && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium">
                      ?
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t(selectedScenario.contact?.subtitleKey ?? '')}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={start}
              className="w-full py-3 rounded-2xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              {t('ui.startButton')}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Result screen ───────────────────────────────────────────────────────────
  if (phase === 'result') {
    return (
      <div className="max-w-lg mx-auto px-4 py-4">
        <div className="flex justify-center mb-2">
          <Lumio state={lumioState} size={80} />
        </div>
        <ResultScreen
          scenario={selectedScenario}
          chosen={chosen}
          sessionXP={sessionXP}
          txHash={txHash}
          explorerUrl={explorerUrl}
          onRestart={reset}
          onBack={goToSelection}
        />
      </div>
    );
  }

  // ── Timeskip screen (shown after clicking a key-compromise option) ────────────
  if (phase === 'timeskip') {
    return (
      <div className="max-w-lg mx-auto px-4 py-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl shadow-xl border border-gray-800 overflow-hidden"
          style={{ minHeight: '520px', maxHeight: '72vh' }}
        >
          <TimeSkipScreen demoPhase={demoPhase} onComplete={completeTimeskip} />
        </motion.div>
      </div>
    );
  }

  // ── Drain screen (replaces chat during account drain animation) ─────────────
  if (phase === 'drain') {
    return (
      <div className="max-w-lg mx-auto px-4 py-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
          className="rounded-2xl shadow-xl border border-gray-800 overflow-hidden"
          style={{ minHeight: '520px', maxHeight: '72vh' }}
        >
          <DrainScreen demoTokens={demoTokens} onComplete={completeDrain} />
        </motion.div>
      </div>
    );
  }

  // ── Chat screen (chat | decision | followup phases) ─────────────────────────
  return (
    <div className="max-w-lg mx-auto px-4 py-4 flex flex-col gap-3">
      {/* Lumio + back button row */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goToSelection}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          ←
        </button>
        <Lumio state={lumioState} size={48} />
      </div>

      {/* Chat frame */}
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
          style={{ minHeight: '420px', maxHeight: '65vh' }}
        >
          {/* Message area – min-h-0 allows flex child to shrink and scroll */}
          <div className="flex-1 min-h-0 flex flex-col">
            <ChatWindow
              contact={selectedScenario.contact}
              messages={visibleMessages}
              isTyping={isTyping}
              scrollRef={scrollRef}
              disableAutoScroll={phase === 'decision' || (phase === 'followup' && followUpDone)}
              demoTokens={demoTokens}
            />
          </div>

          {/* Decision buttons – shown during 'decision' phase */}
          {phase === 'decision' && (
            <DecisionButtons
              options={currentOptions}
              chosen={chosen}
              onChoose={choose}
              label={t('ui.yourChoice')}
            />
          )}

          {/* "Weiter" button – shown after all follow-up messages are done */}
          {phase === 'followup' && followUpDone && (
            <div className="px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={continueToResult}
                className="w-full py-2.5 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              >
                {t('ui.nextButton')} →
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
