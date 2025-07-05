import React from 'react';
import Main from './main';
import LanguageSelector from './components/LanguageSelector';
import './App.css';

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
    if (this.state.error) {
      return (
        <div className="text-red-500 p-4">
          <h2>Something went wrong.</h2>
          <p>{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
		<div style={{ position: 'absolute', top: '1rem', right: '1rem' }}>
		  <LanguageSelector />
		</div>
        <Main />
      </div>
    </ErrorBoundary>
  );
}

export default App;
