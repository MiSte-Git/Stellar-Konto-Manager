import './i18n';
import 'flag-icons/css/flag-icons.min.css';
import React, { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, useLocation } from 'react-router-dom';
import Main from './main.jsx';
const BugTrackerAdmin   = lazy(() => import('./routes/BugTrackerAdmin.tsx'));
const GlossaryPage      = lazy(() => import('./pages/GlossaryPage.tsx'));
const LearnHub          = lazy(() => import('./components/learn/LearnHub.jsx'));
const QuizPage          = lazy(() => import('./pages/QuizPage.jsx'));
const QuizIndex         = lazy(() => import('./pages/QuizIndex.jsx'));
const BackupSettings    = lazy(() => import('./pages/BackupSettings.jsx'));
const Legal             = lazy(() => import('./pages/Legal.jsx'));
const ScamSimulatorPage = lazy(() => import('./components/scam-simulator/ScamSimulatorPage.jsx'));
const StoryMode         = lazy(() => import('./components/story/StoryMode.jsx'));
import SmallAdminLink from './components/SmallAdminLink.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import { isBugtrackerPath, isGlossaryPath, isLearnPath, isLessonQuizPath, isQuizRunPath, isQuizSettingsPath, isQuizAchievementsPath, isSettingsBackupPath, buildPath, isQuizDetailPath, isQuizIndexPath, isScamSimulatorPath, isStoryPath, isDiscoverPath } from './utils/basePath.js';
import scenarios from './data/learn/scam-scenarios/scenarios.js';

import { formatErrorForUi } from './utils/formatErrorForUi.js';

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
    });
  }

  const content = (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[200px] text-gray-400 text-sm"><span className="animate-pulse">...</span></div>}>
    <ErrorBoundary t={t}>
      {isBugTrackerRoute ? (
        <BugTrackerAdmin />
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
          {/* Haupt-App bleibt gemountet, damit Eingaben erhalten bleiben */}
          <Main />
          <SmallAdminLink />

          {/* Glossar als Overlay im Inhaltsbereich (unter TopBar, neben Sidebar), ohne Main zu unmounten */}
          {isGlossaryRoute && (
            <div id="stm-glossary-overlay" className="fixed inset-x-0 bottom-0 top-14 lg:left-64 z-30 bg-white dark:bg-gray-900 overflow-y-auto">
              <div className="max-w-5xl mx-auto p-4">
                <GlossaryPage />
              </div>
            </div>
          )}

          {/* /learn → /quiz Redirect */}
          {isLearnRoute && <LearnRedirect />}

          {isSettingsBackupRoute && (
            <div id="stm-settings-backup-overlay" className="fixed inset-x-0 bottom-0 top-14 lg:left-64 z-30 bg-white dark:bg-gray-900 overflow-y-auto">
              <div className="max-w-4xl mx-auto p-4">
                <BackupSettings />
              </div>
            </div>
          )}
        </>
      )}
    </ErrorBoundary>
    </Suspense>
  );

  return (
    <AppLayout>
      {content}
    </AppLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppShell />
    </BrowserRouter>
  );
}
