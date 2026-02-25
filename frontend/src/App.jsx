import './i18n';
import 'flag-icons/css/flag-icons.min.css';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, useLocation } from 'react-router-dom';
import Main from './main.jsx';
import LanguageSelector from './components/LanguageSelector';
import BugTrackerAdmin from './routes/BugTrackerAdmin.tsx';
import SmallAdminLink from './components/SmallAdminLink.jsx';
import { isBugtrackerPath, isGlossaryPath, isLearnPath, isLessonQuizPath, isQuizRunPath, isQuizSettingsPath, isQuizAchievementsPath, isSettingsBackupPath, buildPath, isQuizDetailPath, isQuizIndexPath, getMultisigJobId, isSettingsPath, isTradingAssetsPath, isMultisigJobsListPath, isScamSimulatorPath, isStoryPath, isDiscoverPath } from './utils/basePath.js';
import GlossaryPage from './pages/GlossaryPage.tsx';
import LearnHub from './components/learn/LearnHub.jsx';

import QuizPage from './pages/QuizPage.jsx';
import QuizIndex from './pages/QuizIndex.jsx';
import BackupSettings from './pages/BackupSettings.jsx';
import MultisigJobDetail from './pages/MultisigJobDetail.jsx';
import MultisigJobList from './pages/MultisigJobList.jsx';
import Legal from './pages/Legal.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import TradingAssetsPage from './pages/TradingAssetsPage.jsx';
import ScamSimulatorPage from './components/scam-simulator/ScamSimulatorPage.jsx';
import scenarios from './data/learn/scam-scenarios/scenarios.js';
import StoryMode from './components/story/StoryMode.jsx';
import { motion, AnimatePresence } from 'framer-motion';

import { formatErrorForUi } from './utils/formatErrorForUi.js';
import { SHOW_DONATE_BUTTON } from './config.js';

console.log('App.jsx loaded');

// Error Boundary Component
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    if (error?.name === 'NotFoundError' || String(error?.message || '').includes('removeChild')) {
      return { error: null };
    }
    return { error: error.message };
  }
  componentDidCatch(error, info) {
    if (error?.name === 'NotFoundError' || String(error?.message || '').includes('removeChild')) {
      console.warn('Ignored NotFound/removeChild error', error);
      return;
    }
    console.error('Uncaught error:', error, info);
  }
  render() {
    const { t } = this.props;
    if (this.state.error) {
      const display = formatErrorForUi(t, this.state.error);
      return (
        <div className="text-red-500 p-4">
          <h2>{t('common:app.errorBoundary.title')}</h2>
          <p>{display}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function LearnRedirect() {
  React.useEffect(() => {
    try {
      const url = buildPath('quiz');
      window.history.replaceState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* noop */ }
  }, []);
  return null;
}

function AppShell() {
  const { t } = useTranslation(['common', 'glossary', 'home', 'learn', 'menu', 'navigation', 'settings', 'scamSimulator', 'story']);
  const location = useLocation();
  const [discoverHovered, setDiscoverHovered] = React.useState(false);
  const isPointerFine = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== 'undefined' && window.innerWidth <= 480
  );
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 480);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const isBugTrackerRoute = React.useMemo(() => {
    try {
      return isBugtrackerPath(typeof window !== 'undefined' ? window.location.pathname : '');
    } catch {
      return false;
    }
  }, []);

  const pathname = location?.pathname || '/';

  const isGlossaryRoute = React.useMemo(() => {
    try {
      return isGlossaryPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isLearnRoute = React.useMemo(() => {
    try {
      return isLearnPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  // Backward compatibility for legacy quiz route: /learn/lesson/:id/quiz
  const isLessonQuizRoute = React.useMemo(() => {
    try {
      return isLessonQuizPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isQuizRunRoute = React.useMemo(() => {
    try {
      return isQuizRunPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isQuizLandingRoute = React.useMemo(() => {
    try {
      const match = isQuizDetailPath(pathname);
      if (import.meta.env?.DEV) {
        console.debug('DEBUG quiz matchers', {
          path: pathname,
          landing: match,
          run: isQuizRunPath(pathname),
          settings: isQuizSettingsPath(pathname),
          achievements: isQuizAchievementsPath(pathname),
          legacy: isLessonQuizPath(pathname)
        });
      }
      return match;
    } catch {
      return false;
    }
  }, [pathname]);

  const isQuizSettingsRoute = React.useMemo(() => {
    try {
      return isQuizSettingsPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isQuizAchievementsRoute = React.useMemo(() => {
    try {
      return isQuizAchievementsPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const multisigJobId = React.useMemo(() => {
    try {
      return getMultisigJobId(pathname);
    } catch {
      return null;
    }
  }, [pathname]);

  const isMultisigJobListRoute = React.useMemo(() => {
    try {
      return isMultisigJobsListPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isScamSimulatorRoute = React.useMemo(() => {
    try {
      return isScamSimulatorPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isStoryRoute = React.useMemo(() => {
    try {
      return isStoryPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isQuizIndexRoute = React.useMemo(() => {
    try {
      return isQuizIndexPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isQuizRoute = React.useMemo(
    () =>
      isQuizIndexRoute ||
      isQuizLandingRoute ||
      isQuizRunRoute ||
      isQuizSettingsRoute ||
      isQuizAchievementsRoute ||
      isLessonQuizRoute,
    [
      isQuizIndexRoute,
      isQuizLandingRoute,
      isQuizRunRoute,
      isQuizSettingsRoute,
      isQuizAchievementsRoute,
      isLessonQuizRoute
    ]
  );

  const isSettingsBackupRoute = React.useMemo(() => {
    try {
      return isSettingsBackupPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isSettingsRoute = React.useMemo(() => {
    try {
      return isSettingsPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isTradingAssetsRoute = React.useMemo(() => {
    try {
      return isTradingAssetsPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  const isLegalRoute = React.useMemo(() => {
    try {
      const target = buildPath('legal');
      const normTarget = target.replace(/\/+$/, '');
      const normCurrent = String(pathname || '').replace(/\/+$/, '');
      return normCurrent === normTarget || normCurrent.endsWith('/legal');
    } catch {
      return false;
    }
  }, [pathname]);

  const isDiscoverRoute = React.useMemo(() => {
    try {
      return isDiscoverPath(pathname);
    } catch {
      return false;
    }
  }, [pathname]);

  if (import.meta.env?.DEV) {
    console.log('DEBUG SKM Router', {
      pathname,
      isBugTrackerRoute,
      isLessonQuizRoute,
      isQuizLandingRoute,
      isQuizRunRoute,
      isQuizSettingsRoute,
      isQuizAchievementsRoute,
      isQuizRoute,
      isSettingsRoute,
      isTradingAssetsRoute,
      multisigJobId,
      isMultisigJobListRoute,
    });
  }

  const content = (
    <ErrorBoundary t={t}>
      {isBugTrackerRoute ? (
        <BugTrackerAdmin />
      ) : multisigJobId ? (
        <div className="max-w-4xl mx-auto p-4">
          <MultisigJobDetail jobId={multisigJobId} />
        </div>
      ) : isMultisigJobListRoute ? (
        <div className="max-w-5xl mx-auto p-4">
          <MultisigJobList />
        </div>
      ) : isScamSimulatorRoute ? (
        <div className="max-w-lg mx-auto p-4">
          <ScamSimulatorPage
            scenarios={scenarios}
            onBack={() => {
              try {
                window.history.pushState({}, '', buildPath('discover'));
                window.dispatchEvent(new PopStateEvent('popstate'));
              } catch { /* noop */ }
            }}
            onGoHome={() => {
              try {
                window.history.pushState({}, '', buildPath(''));
                window.dispatchEvent(new PopStateEvent('popstate'));
              } catch { /* noop */ }
            }}
          />
        </div>
      ) : isStoryRoute ? (
        <StoryMode
          onExit={() => {
            try {
              const url = buildPath('');
              window.history.pushState({}, '', url);
              window.dispatchEvent(new PopStateEvent('popstate'));
            } catch { /* noop */ }
          }}
        />
      ) : isQuizIndexRoute ? (
        <div className="max-w-4xl mx-auto p-4">
          <QuizIndex />
        </div>
      ) : isQuizRoute ? (
        <div className="max-w-4xl mx-auto p-4">
          <QuizPage />
        </div>
      ) : isTradingAssetsRoute ? (
        <TradingAssetsPage />
      ) : isSettingsRoute ? (
        <div className="max-w-4xl mx-auto p-4">
          <SettingsPage />
        </div>
      ) : isLegalRoute ? (
        <div className="max-w-4xl mx-auto p-4">
          <Legal />
        </div>
      ) : isDiscoverRoute ? (
        <LearnHub
          onBack={() => {
            try {
              const url = buildPath('');
              window.history.pushState({}, '', url);
              window.dispatchEvent(new PopStateEvent('popstate'));
            } catch { /* noop */ }
          }}
        />
      ) : (
        <>
          {/* Sprachleiste */}
          <div className="max-w-4xl mx-auto p-3 sm:p-4 mt-4 mb-4 text-center shadow-md bg-white dark:bg-gray-800 dark:shadow-gray-900/50 rounded relative">
            <div className="flex justify-center">
              <LanguageSelector />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap" style={{ position: "relative" }}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const url = buildPath('glossar');
                      try { if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.setItem('SKM_PREV_PATH', window.location.pathname); } } catch { /* noop */ }
                      window.history.pushState({}, '', url);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    } catch { /* noop */ }
                  }}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  title={t('menu:glossary', 'Glossar')}
                >
                  <span aria-hidden>i</span>
                  <span>{t('menu:glossary', 'Glossar')}</span>
                </button>
              </div>

              <div className="flex items-center justify-center flex-1">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const url = buildPath('settings');
                      try { if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.setItem('SKM_PREV_PATH', window.location.pathname); } } catch { /* noop */ }
                      window.history.pushState({}, '', url);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    } catch { /* noop */ }
                  }}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  title={t('settings:label', 'Settings')}
                >
                  {t('settings:label', 'Settings')}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('stm:openMenu', { detail: 'feedback' }))}
                  title={t('menu:feedback', 'Feedback')}
                  className="inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 text-[11px] sm:text-xs rounded-full shadow focus:outline-none focus:ring-2 focus:ring-purple-400"
                >
                  <span>✉</span>
                  <span>{t('menu:feedback', 'Feedback')}</span>
                </button>
                {SHOW_DONATE_BUTTON && (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('stm:openMenu', { detail: 'donate' }))}
                    title={t('menu:donate', 'Spenden')}
                    className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-2 py-1 text-[11px] sm:text-xs rounded-full shadow focus:outline-none focus:ring-2 focus:ring-green-400"
                  >
                    <span aria-hidden>♥</span>
                    <span>{t('menu:donate', 'Spenden')}</span>
                  </button>
                )}
              </div>

              {/* Stellar entdecken – out of flex flow on desktop, second row on mobile */}
              <div style={isMobile
                ? { width: "100%", display: "flex", justifyContent: "center", marginTop: "10px" }
                : { position: "absolute", top: "50%", transform: "translateY(-50%)", right: "calc(25% - 50px)" }
              }>
                <div style={{ position: "relative" }}>
                  <motion.button
                    type="button"
                    onMouseEnter={() => setDiscoverHovered(true)}
                    onMouseLeave={() => setDiscoverHovered(false)}
                    whileHover={{ borderColor: "rgba(255,217,61,0.7)" }}
                    onClick={() => {
                      try {
                        const url = buildPath('discover');
                        window.history.pushState({}, '', url);
                        window.dispatchEvent(new PopStateEvent('popstate'));
                      } catch { /* noop */ }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "linear-gradient(135deg, rgba(255,217,61,0.15), rgba(61,214,255,0.15))",
                      border: "1.5px solid rgba(255,217,61,0.4)",
                      borderRadius: "9999px",
                      padding: "5px 12px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "#FFD93D",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }}
                  >
                    <span>⭐</span>
                    <span>{t('home:learn.button', 'Stellar entdecken')}</span>
                  </motion.button>
                  <AnimatePresence>
                    {discoverHovered && isPointerFine && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 8px)",
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "rgba(0,0,0,0.85)",
                          border: "1px solid rgba(255,217,61,0.3)",
                          borderRadius: "8px",
                          padding: "6px 12px",
                          fontSize: "12px",
                          color: "rgba(255,255,255,0.85)",
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                          zIndex: 100,
                        }}
                      >
                        {t('home:learn.button_sub', 'Quiz · Scam-Schutz · Story')}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

          </div>

          {/* Haupt-App bleibt gemountet, damit Eingaben erhalten bleiben */}
          <Main />
          <SmallAdminLink />

          {/* Glossar als Overlay anzeigen, ohne Main zu unmounten */}
          {isGlossaryRoute && (
            <div id="stm-glossary-overlay" className="fixed inset-0 z-50 bg-white dark:bg-gray-900 overflow-y-auto">
              <div className="max-w-5xl mx-auto p-4">
                <GlossaryPage />
              </div>
            </div>
          )}

          {/* /learn → /quiz Redirect */}
          {isLearnRoute && <LearnRedirect />}

          {isSettingsBackupRoute && (
            <div id="stm-settings-backup-overlay" className="fixed inset-0 z-50 bg-white dark:bg-gray-900 overflow-y-auto">
              <div className="max-w-4xl mx-auto p-4">
                <BackupSettings />
              </div>
            </div>
          )}
        </>
      )}
    </ErrorBoundary>
  );

  return (
    content
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppShell />
    </BrowserRouter>
  );
}
