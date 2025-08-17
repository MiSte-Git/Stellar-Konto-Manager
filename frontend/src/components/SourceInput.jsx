import React from 'react';
import { useTranslation } from 'react-i18next';

function SourceInput({ sourceInput, setSourceInput, onSubmit }) {
  const { t } = useTranslation();

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit();
  };

  const handleChange = (e) => setSourceInput(e.target.value); // <--- hier!

  return (
    <form onSubmit={handleSubmit} className="mb-4">
      <label htmlFor="source" className="block font-bold mb-1">
        {t('publicKey.label')}
      </label>
      <input
        id="source"
        type="text"
        value={sourceInput}
        onChange={handleChange} // <--- und hier verwenden
        placeholder={t('publicKey.placeholder')}
        className="w-full border border-gray-300 rounded p-2"
      />
      <button
        type="submit"
        className="mt-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {t('publicKey.submit.button')}
      </button>
    </form>
  );
}

export default SourceInput;