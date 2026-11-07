import React from 'react';
import { formatErrorForUi } from '../utils/formatErrorForUi.js';

// Error Boundary Component
// Bei einem Renderfehler wird die ganze Ansicht entfernt, auch noch nicht gesicherte Schluessel
// (Konto erstellen): Sie liegen nur im Zustand der Seite und bewusst nirgends sonst. Deshalb
// warnt die Meldung davor, und Neuladen geht nur nach ausdruecklicher Bestaetigung.
export default class ErrorBoundary extends React.Component {
  state = { error: null, reloadAck: false };
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
        <div className="text-red-500 p-4" role="alert">
          <h2>{t('common:app.errorBoundary.title')}</h2>
          <p>{display}</p>
          <p className="mt-3 text-sm text-gray-800 dark:text-gray-100" data-testid="error-boundary-keys-warning">
            {t('common:app.errorBoundary.keysWarning')}
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
            <input
              type="checkbox"
              checked={this.state.reloadAck}
              onChange={(e) => this.setState({ reloadAck: e.target.checked })}
              data-testid="error-boundary-ack"
            />
            <span>{t('common:app.errorBoundary.reloadAck')}</span>
          </label>
          <button
            type="button"
            disabled={!this.state.reloadAck}
            onClick={() => window.location.reload()}
            className="mt-3 rounded-sm bg-blue-600 px-4 py-2 text-sm text-white enabled:hover:bg-blue-700 disabled:opacity-50"
            data-testid="error-boundary-reload"
          >
            {t('common:app.errorBoundary.reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
