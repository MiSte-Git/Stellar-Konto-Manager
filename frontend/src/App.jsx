import './i18n';
import 'flag-icons/css/flag-icons.min.css';
import React from 'react';
import { useTranslation } from 'react-i18next';
import Main from './main';
import LanguageSelector from './components/LanguageSelector';
import BugTrackerAdmin from './routes/BugTrackerAdmin.tsx';
import SmallAdminLink from './components/SmallAdminLink.jsx';
import { isBugtrackerPath, isGlossaryPath } from './utils/basePath.js';
import { buildPath } from './utils/basePath.js';
import GlossaryPage from './pages/GlossaryPage.tsx';

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
      return (
        <div className="text-red-500 p-4">
          <h2>{t('app.errorBoundary.title')}</h2>
          <p>{t(this.state.error, this.state.error)}</p>
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
    // Default: PUBLIC on first load (override any stale state)
    try { if (typeof window !== 'undefined' && window.localStorage) { window.localStorage.setItem('STM_NETWORK', 'PUBLIC'); window.dispatchEvent(new CustomEvent('stm-network-changed', { detail: 'PUBLIC' })); } } catch { /* noop */ }
    const handler = (e) => {
      try { const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('STM_NETWORK') || 'PUBLIC'); setDevTestnet(v === 'TESTNET'); } catch { /* noop */ }
    };
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);

  const isBugTrackerRoute = React.useMemo(() => {
    try {
      return isBugtrackerPath(typeof window !== 'undefined' ? window.location.pathname : '');
    } catch {
      return false;
    }
  }, []);

  const isGlossaryRoute = React.useMemo(() => {
    try {
      return isGlossaryPath(typeof window !== 'undefined' ? window.location.pathname : '');
    } catch {
      return false;
    }
  }, []);

  return (
    <ErrorBoundary t={t}>
      {isBugTrackerRoute ? (
        <BugTrackerAdmin />
      ) : isGlossaryRoute ? (
        <GlossaryPage />
      ) : (
        <>
          {/* Sprachleiste */}
          <div className="max-w-4xl mx-auto p-4 mt-4 mb-4 text-center shadow-md bg-white dark:bg-gray-800 dark:shadow-gray-900/50 rounded relative">
            <div className="flex justify-center">
              <LanguageSelector />
            </div>
            {/* Glossary and Settings buttons in the language bar (right side) */}
            <div className="absolute right-3 top-2 flex flex-col items-end gap-2">
              <a
                href={buildPath('glossar')}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-indigo-400"
                title={t('glossary.pageTitle', 'Glossary')}
              >
                {t('glossary.pageTitle', 'Glossary')}
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

          <Main />
          <SmallAdminLink />
        </>
      )}
    </ErrorBoundary>
  );
}

export default App;
