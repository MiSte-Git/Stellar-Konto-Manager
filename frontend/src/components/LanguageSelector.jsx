import React from 'react';
import { useTranslation } from 'react-i18next';

function LanguageSelector() {
  const { i18n } = useTranslation();

  const changeLanguage = (e) => {
    i18n.changeLanguage(e.target.value);
  };

  return (
    <div className="mb-4 text-right">
      <select onChange={changeLanguage} value={i18n.language}>
        <option value="en">English</option>
        <option value="de">Deutsch</option>
        <option value="es">Español</option>
        <option value="fr">Français</option>
        <option value="it">Italiano</option>
        <option value="nl">Nederlands</option>
        <option value="ru">Русский</option>
        <option value="fi">Suomi</option>
        <option value="hr">Hrvatski</option>
      </select>
    </div>
  );
}

export default LanguageSelector;

