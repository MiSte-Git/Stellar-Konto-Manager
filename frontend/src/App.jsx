import './i18n';
import React from 'react';
import { useTranslation } from 'react-i18next';
import Main from './main';
import LanguageSelector from './components/LanguageSelector';

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
  return (
    <ErrorBoundary t={t}>
		  {/* Sprachleiste: garantiert zentriert, unabhängig vom äußeren Layout */}
      <div className="max-w-4xl mx-auto p-4 mt-4 mb-4 text-center shadow-md bg-white dark:bg-gray-800 dark:shadow-gray-900/50 rounded">
        <div className="flex justify-center">
          <LanguageSelector />
        </div>
      </div>

      <Main />
    </ErrorBoundary>
  );
}

export default App;
