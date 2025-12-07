import React from 'react';
import { useTranslation } from 'react-i18next';

function SourceInput({ sourceInput, setSourceInput, onSubmit }) {
  const { t } = useTranslation(['publicKey', 'common']);
  const handleChange = (e) => setSourceInput(e.target.value);
  const handleClear = () => setSourceInput('');

  const handleSubmit = (e) => {
    e.preventDefault();
    
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4">
      <label htmlFor="source" className="block font-bold mb-1">
        {t('publicKey:label')}
      </label>

      <div className="relative">
        <input
          id="source"
          type="text"
          value={sourceInput}
          onChange={handleChange}
          placeholder={t('publicKey:placeholder')}
          className="w-full border border-gray-300 rounded p-2 pr-8"
        />

        {sourceInput && (
          <button
            type="button"
            onClick={handleClear}
            title={t('common:common.clear')}
            aria-label={t('common:common.clear')}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-300 hover:bg-red-500
               text-gray-600 hover:text-white text-xs flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>

      <button
        type="submit"
        className="mt-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {t('publicKey:submit.button')}
      </button>
    </form>
  );
}

export default SourceInput;
