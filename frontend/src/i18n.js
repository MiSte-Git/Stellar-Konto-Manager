import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import nl from './locales/nl.json';
import ru from './locales/ru.json';
import fi from './locales/fi.json';
import hr from './locales/hr.json';

const resources = {
  de: { translation: de },
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  it: { translation: it },
  nl: { translation: nl },
  ru: { translation: ru },
  fi: { translation: fi },
  hr: { translation: hr }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // Standardsprache
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;

