import React from 'react';
import { useTranslation } from 'react-i18next';

function DestinationInput({ destination, setDestination, onSubmit }) {
  const { t } = useTranslation();

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4">
      <label htmlFor="destination" className="block font-bold mb-1">
        {t('destLabel')}
      </label>
      <input
        id="destination"
        type="text"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder={t('destPlaceholder')}
        className="w-full border border-gray-300 rounded p-2"
      />
      <button
        type="submit"
        className="mt-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {t('submitButton')}
      </button>
    </form>
  );
}

export default DestinationInput;
