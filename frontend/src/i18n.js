import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Legacy root files (de.json, en.json, nl.json, ...) are no longer used.
// We load only namespaced resources under ./locales/<lang>/*.json
const localeModules = import.meta.glob('./locales/*/*.json', { eager: true });

const resources = {};

function mergeResource(lang, namespace, value) {
  resources[lang] ??= {};

  // Merge into the namespace (allow multiple files to extend one namespace, e.g., settings + settings.backup)
  resources[lang][namespace] = {
    ...(resources[lang][namespace] || {}),
    ...(value.default ?? value)
  };

  // If the namespace contains dots, also merge into the base namespace for existing usages like t('settings:backup.title')
  if (namespace.includes('.')) {
    const [base, ...rest] = namespace.split('.');
    const nestedKey = rest.join('.');
    const baseNamespace = resources[lang][base] || {};
    resources[lang][base] = {
      ...baseNamespace,
      [nestedKey]: {
        ...(baseNamespace[nestedKey] || {}),
        ...(value.default ?? value)
      }
    };
  }
}

Object.entries(localeModules).forEach(([path, module]) => {
  // path looks like ./locales/de/menu.json
  const [, , lang, file] = path.split('/');
  if (!lang || lang.startsWith('.')) return;

  const namespace = file.replace(/\.json$/, '');
  mergeResource(lang, namespace, module);
});

// Namespaces are derived from the German source files to mirror ./locales/de/*.json
const namespaces = resources.de ? Object.keys(resources.de) : [];

i18n
  .use(initReactI18next)
  .init({
    resources,
    ns: namespaces,
    defaultNS: 'common',
    fallbackNS: ['common', 'menu'],
    lng: 'de', // Standardsprache
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
