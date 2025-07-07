import React, { useState, useEffect } from 'react';
import reactLogo from './assets/react.svg';
import { Horizon } from '@stellar/stellar-sdk';
import './App.css';

function App() {
  const [status, setStatus] = useState('Nicht getestet');

  useEffect(() => {
    try {
	    const server = new Horizon.Server('https://horizon.stellar.org');
			setStatus('Initialisierung erfolgreich');
    } catch (error) {
      console.error('Initialisierungsfehler:', error);
      setStatus(`Initialisierungsfehler: ${error.message}`);
    }
  }, []);

  return (
    <div className="App">
			<div>
		    <a href="https://react.dev" target="_blank">
		      <img src={reactLogo} className="logo react" alt="React logo" />
		    </a>
		  </div>    	
      <h1>Stellar Test</h1>
      <p>Status: {status}</p>
    </div>
  );
}

export default App;
