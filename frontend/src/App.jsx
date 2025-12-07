import './i18n';
import 'flag-icons/css/flag-icons.min.css';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, useLocation } from 'react-router-dom';
import Main from './main.jsx';
import LanguageSelector from './components/LanguageSelector';
import BugTrackerAdmin from './routes/BugTrackerAdmin.tsx';
import SmallAdminLink from './components/SmallAdminLink.jsx';
import { isBugtrackerPath, isGlossaryPath, isLearnPath, isLessonQuizPath, isQuizRunPath, isQuizSettingsPath, isQuizAchievementsPath, isSettingsBackupPath, buildPath, isQuizLandingPath, getMultisigJobId, isSettingsPath, isTradingAssetsPath } from './utils/basePath.js';
import GlossaryPage from './pages/GlossaryPage.tsx';
import LearnPage from './pages/LearnPage.jsx';
import QuizPage from './pages/QuizPage.jsx';
import BackupSettings from './pages/BackupSettings.jsx';
import MultisigJobDetail from './pages/MultisigJobDetail.jsx';
import Legal from './pages/Legal.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import TradingAssetsPage from './pages/TradingAssetsPage.jsx';

import { formatErrorForUi } from './utils/formatErrorForUi.js';

console.log('App.jsx loaded');

// Error Boundary Component
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error: error.message };
  }
  componentDidCatch(error, info) {
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

function AppShell() {
  const { t } = useTranslation(['common', 'glossary', 'learn', 'menu', 'settings']);
  const location = useLocation();

  // Always register hooks in the same order
  const [devTestnet, setDevTestnet] = React.useState(false);
  React.useEffect(() => {
    // Only listen for changes; default is set before mount in main.jsx
    const handler = (e) => {
      try { const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('SKM_NETWORK') || 'PUBLIC'); setDevTestnet(v === 'TESTNET'); } catch { /* noop */ }
    };
    window.addEventListener('stm-network-changed', handler);
    // Initialize state based on current storage without emitting a new event
    try { const v = window.localStorage?.getItem('SKM_NETWORK') || 'PUBLIC'; setDevTestnet(v === 'TESTNET'); } catch { /* noop */ }
    return () => window.removeEventListener('stm-network-changed', handler);
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
      const match = isQuizLandingPath(pathname);
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

  const isQuizRoute = React.useMemo(
    () =>
      isQuizLandingRoute ||
      isQuizRunRoute ||
      isQuizSettingsRoute ||
      isQuizAchievementsRoute ||
      isLessonQuizRoute,
    [
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
      ) : (
        <>
          {/* Sprachleiste */}
          <div className="max-w-4xl mx-auto p-3 sm:p-4 mt-4 mb-4 text-center shadow-md bg-white dark:bg-gray-800 dark:shadow-gray-900/50 rounded relative">
            <div className="flex justify-center">
              <LanguageSelector />
            </div>
            <div className="mt-3 relative flex items-center justify-center">
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
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('stm:openMenu', { detail: 'feedback' }))}
                  title={t('menu:feedback', 'Feedback')}
                  className="inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 text-[11px] sm:text-xs rounded-full shadow focus:outline-none focus:ring-2 focus:ring-purple-400"
                >
                  <span>✉</span>
                  <span>{t('menu:feedback', 'Feedback')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('stm:openMenu', { detail: 'donate' }))}
                  title={t('menu:donate', 'Spenden')}
                  className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-2 py-1 text-[11px] sm:text-xs rounded-full shadow focus:outline-none focus:ring-2 focus:ring-green-400"
                >
                  <span aria-hidden>♥</span>
                  <span>{t('menu:donate', 'Spenden')}</span>
                </button>
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

          {/* Lernseite als Overlay anzeigen, ohne Main zu unmounten */}
          {isLearnRoute && (
            <div id="stm-learn-overlay" className="fixed inset-0 z-50 bg-white dark:bg-gray-900 overflow-y-auto">
              <div className="max-w-5xl mx-auto p-4">
                <LearnPage />
              </div>
            </div>
          )}

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
