import './i18n';
import React from 'react';
import { useTranslation } from 'react-i18next';
import Main from './main';
import LanguageSelector from './components/LanguageSelector';
import BugTrackerAdmin from './routes/BugTrackerAdmin.tsx';
import SmallAdminLink from './components/SmallAdminLink.jsx';

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
  const [isBugTrackerRoute, setIsBugTrackerRoute] = React.useState(false);

  React.useEffect(() => {
    try {
      setIsBugTrackerRoute(window.location.pathname === '/bugtracker');
    } catch {
      setIsBugTrackerRoute(false);
    }
  }, []);

  if (isBugTrackerRoute) {
    return (
      <ErrorBoundary t={t}>
        <BugTrackerAdmin />
      </ErrorBoundary>
    );
  }

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
  return (
    <ErrorBoundary t={t}>
		  {/* Sprachleiste */}
      <div className="max-w-4xl mx-auto p-4 mt-4 mb-4 text-center shadow-md bg-white dark:bg-gray-800 dark:shadow-gray-900/50 rounded relative">
        <div className="flex justify-center">
          <LanguageSelector />
        </div>
        {devTestnet && (
          <span className="absolute right-3 top-2 inline-block bg-yellow-500 text-white text-xs font-semibold px-2 py-0.5 rounded">
            {t('badges.testnet')}
          </span>
        )}
      </div>

      <Main />
      <SmallAdminLink />
    </ErrorBoundary>
  );
}

export default App;
