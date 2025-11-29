import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StrKey } from '@stellar/stellar-sdk';

function DestinationInput({ destination, setDestination, onSubmit }) {
  const { t } = useTranslation(['trustline', 'publicKey']);
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const val = (destination || '').trim();
    if (!StrKey.isValidEd25519PublicKey(val)) {
      setError(t('trustline:destination.error'));
      return;
    }
    setError('');
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4">
      <label htmlFor="destination" className={`block font-bold mb-1 ${error ? 'text-red-700 inline-block border border-red-500 rounded px-2 py-0.5' : ''}`}>
        {t('trustline:destination.label')}
      </label>
      {error && (
        <div className="text-center text-xs text-red-700 mb-1">{error}</div>
      )}
      <input
        id="destination"
        type="text"
        value={destination}
        onChange={(e) => { setDestination(e.target.value); if (error) setError(''); }}
        placeholder={t('trustline:destination.placeholder')}
        className={`w-full border rounded p-2 ${error ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300'}`}
      />
      <button
        type="submit"
        className="mt-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {t('publicKey:submit.button')}
      </button>
    </form>
  );
}

export default DestinationInput;
