import './i18n';
import 'flag-icons/css/flag-icons.min.css';
import React from 'react';
import { useTranslation } from 'react-i18next';
import Main from './main';
import LanguageSelector from './components/LanguageSelector';
import BugTrackerAdmin from './routes/BugTrackerAdmin.tsx';
import SmallAdminLink from './components/SmallAdminLink.jsx';
import { isBugtrackerPath, isGlossaryPath, isLearnPath, buildPath } from './utils/basePath.js';
import GlossaryPage from './pages/GlossaryPage.tsx';
import LearnPage from './pages/LearnPage.jsx';
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
          <h2>{t('app.errorBoundary.title')}</h2>
          <p>{display}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const { t } = useTranslation();

  // Always register hooks in the same order
  const [devTestnet, setDevTestnet] = React.useState(false);
  React.useEffect(() => {
    // Only listen for changes; default is set before mount in main.jsx
    const handler = (e) => {
      try { const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('STM_NETWORK') || 'PUBLIC'); setDevTestnet(v === 'TESTNET'); } catch { /* noop */ }
    };
    window.addEventListener('stm-network-changed', handler);
    // Initialize state based on current storage without emitting a new event
    try { const v = window.localStorage?.getItem('STM_NETWORK') || 'PUBLIC'; setDevTestnet(v === 'TESTNET'); } catch { /* noop */ }
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  const isBugTrackerRoute = React.useMemo(() => {
    try {
      return isBugtrackerPath(typeof window !== 'undefined' ? window.location.pathname : '');
    } catch {
      return false;
    }
  }, []);

  // Track current path so we can react to pushState/popstate without full reload
  const [pathname, setPathname] = React.useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'));
  React.useEffect(() => {
    const onPop = () => {
      try { setPathname(window.location.pathname); } catch { /* noop */ }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('stm:location-changed', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('stm:location-changed', onPop);
    };
  }, []);

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

  return (
    <ErrorBoundary t={t}>
      {isBugTrackerRoute ? (
        <BugTrackerAdmin />
      ) : (
        <>
          {/* Sprachleiste */}
          <div className="max-w-4xl mx-auto p-3 sm:p-4 mt-4 mb-4 text-center shadow-md bg-white dark:bg-gray-800 dark:shadow-gray-900/50 rounded relative">
            <div className="flex justify-center">
              <LanguageSelector />
            </div>
            {/* Glossary, Learn and Settings buttons under the language bar on all screens */}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <a
                href={buildPath('glossar')}
                onClick={(e) => {
                  try {
                    e.preventDefault();
                    const url = buildPath('glossar');
                    // remember previous path to restore on back
                    try { if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.setItem('STM_PREV_PATH', window.location.pathname); } } catch { /* noop */ }
                    window.history.pushState({}, '', url);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  } catch { /* noop */ }
                }}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
                title={t('glossary.pageTitle', 'Glossary')}
              >
                {t('glossary.pageTitle', 'Glossary')}
              </a>
              <a
                href={buildPath('learn')}
                onClick={(e) => {
                  try {
                    e.preventDefault();
                    const url = buildPath('learn');
                    try { if (typeof window !== 'undefined' && window.sessionStorage) { window.sessionStorage.setItem('STM_PREV_PATH', window.location.pathname); } } catch { /* noop */ }
                    window.history.pushState({}, '', url);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  } catch { /* noop */ }
                }}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
                title={t('learn.pageTitle', 'Learn')}
              >
                {t('learn.pageTitle', 'Learn')}
              </a>
              <button
                type="button"
                onClick={() => {
                  try {
                    const root = document.querySelector('#root');
                    if (!root) { window.location.hash = '#settings'; return; }
                    const evt = new CustomEvent('stm:openSettings');
                    window.dispatchEvent(evt);
                  } catch {
                    /* noop */
                  }
                }}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
                title={t('settings.label', 'Settings')}
              >
                {t('settings.label')}
              </button>
            </div>
            {devTestnet && (
              <span className="absolute right-3 top-[72px] inline-block bg-yellow-500 text-white text-xs font-semibold px-2 py-0.5 rounded">
                {t('badges.testnet')}
              </span>
            )}
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
        </>
      )}
    </ErrorBoundary>
  );
}

export default App;
