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

// Additional German namespaces (do not touch en.json; English stays via defaults in t())
import deLearn from './locales/de/learn.json';
import deGlossary from './locales/de/glossary.json';
import deHome from './locales/de/home.json';
import deErrors from './locales/de/errors.json';
import deCommon from './locales/de/common.json';

const resources = {
  de: {
    translation: de,
    learn: deLearn,
    glossary: deGlossary,
    home: deHome,
    errors: deErrors,
    common: deCommon
  },
  // Other languages keep a single default namespace for now.
  // Missing keys and namespaces will fall back to German due to fallbackLng below.
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  it: { translation: it },
  nl: { translation: nl },
  ru: { translation: ru },
  fi: { translation: fi },
  hr: { translation: hr }
};

// Register known namespaces to allow t('ns:key') access without dynamic loading.
const namespaces = ['translation', 'learn', 'glossary', 'home', 'errors', 'common'];

i18n
  .use(initReactI18next)
  .init({
    resources,
    ns: namespaces,
    defaultNS: 'translation',
    fallbackNS: 'translation',
    lng: 'de', // Standardsprache
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;

