import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Legacy root files (de.json, en.json, nl.json, ...) are no longer used.
// We load only namespaced resources under ./locales/<lang>/*.json

// Extra namespaces for other languages
// EN
import enMenu from './locales/en/menu.json';
import enLearn from './locales/en/learn.json';
import enGlossary from './locales/en/glossary.json';
import enMultisigEdit from './locales/en/multisigEdit.json';
// ES
import esMenu from './locales/es/menu.json';
import esLearn from './locales/es/learn.json';
import esGlossary from './locales/es/glossary.json';
import esMultisigEdit from './locales/es/multisigEdit.json';
// FR
import frMenu from './locales/fr/menu.json';
import frLearn from './locales/fr/learn.json';
import frGlossary from './locales/fr/glossary.json';
import frMultisigEdit from './locales/fr/multisigEdit.json';
// IT
import itMenu from './locales/it/menu.json';
import itLearn from './locales/it/learn.json';
import itGlossary from './locales/it/glossary.json';
import itMultisigEdit from './locales/it/multisigEdit.json';
// NL
import nlMenu from './locales/nl/menu.json';
import nlLearn from './locales/nl/learn.json';
import nlGlossary from './locales/nl/glossary.json';
import nlMultisigEdit from './locales/nl/multisigEdit.json';
// RU
import ruMenu from './locales/ru/menu.json';
import ruLearn from './locales/ru/learn.json';
import ruGlossary from './locales/ru/glossary.json';
import ruMultisigEdit from './locales/ru/multisigEdit.json';
// FI
import fiMenu from './locales/fi/menu.json';
import fiLearn from './locales/fi/learn.json';
import fiGlossary from './locales/fi/glossary.json';
import fiMultisigEdit from './locales/fi/multisigEdit.json';
// HR
import hrMenu from './locales/hr/menu.json';
import hrLearn from './locales/hr/learn.json';
import hrGlossary from './locales/hr/glossary.json';
import hrMultisigEdit from './locales/hr/multisigEdit.json';

// German namespaces (source of truth). Do not modify other languages here; they fall back to DE as needed.
import deLearn from './locales/de/learn.json';
import deGlossary from './locales/de/glossary.json';
import deHome from './locales/de/home.json';
import deErrors from './locales/de/errors.json';
import deCommon from './locales/de/common.json';
import deMenu from './locales/de/menu.json';
import deTrustline from './locales/de/trustline.json';
import deToken from './locales/de/token.json';
import deCreateAccount from './locales/de/createAccount.json';
import deMultisigEdit from './locales/de/multisigEdit.json';
import dePublicKey from './locales/de/publicKey.json';
import deNetwork from './locales/de/network.json';
import deWallet from './locales/de/wallet.json';
import deNavigation from './locales/de/navigation.json';
import deSecretKey from './locales/de/secretKey.json';
import deSubmitTransaction from './locales/de/submitTransaction.json';
import deXlmByMemo from './locales/de/xlmByMemo.json';
import deInvestedTokens from './locales/de/investedTokens.json';
import deQuiz from './locales/de/quiz.json';
import deSettings from './locales/de/settings.json';
import deSettingsBackup from './locales/de/settings.backup.json';

const resources = {
  de: {
    learn: deLearn,
    glossary: deGlossary,
    home: deHome,
    errors: deErrors,
    common: deCommon,
    menu: deMenu,
    trustline: deTrustline,
    token: deToken,
    createAccount: deCreateAccount,
    multisigEdit: deMultisigEdit,
    publicKey: dePublicKey,
    network: deNetwork,
    wallet: deWallet,
    navigation: deNavigation,
    secretKey: deSecretKey,
    submitTransaction: deSubmitTransaction,
    xlmByMemo: deXlmByMemo,
    investedTokens: deInvestedTokens,
    quiz: deQuiz,
    settings: { ...deSettings, backup: deSettingsBackup }
  },
  // Other languages provide selected namespaces; all missing keys fall back to German (fallbackLng: 'de').
  en: { menu: enMenu, learn: enLearn, glossary: enGlossary, multisigEdit: enMultisigEdit },
  es: { menu: esMenu, learn: esLearn, glossary: esGlossary, multisigEdit: esMultisigEdit },
  fr: { menu: frMenu, learn: frLearn, glossary: frGlossary, multisigEdit: frMultisigEdit },
  it: { menu: itMenu, learn: itLearn, glossary: itGlossary, multisigEdit: itMultisigEdit },
  nl: { menu: nlMenu, learn: nlLearn, glossary: nlGlossary, multisigEdit: nlMultisigEdit },
  ru: { menu: ruMenu, learn: ruLearn, glossary: ruGlossary, multisigEdit: ruMultisigEdit },
  fi: { menu: fiMenu, learn: fiLearn, glossary: fiGlossary, multisigEdit: fiMultisigEdit },
  hr: { menu: hrMenu, learn: hrLearn, glossary: hrGlossary, multisigEdit: hrMultisigEdit }
};

// Register known namespaces to allow t('ns:key') access without dynamic loading.
const namespaces = ['learn', 'glossary', 'home', 'errors', 'common', 'menu', 'trustline', 'token', 'createAccount', 'multisigEdit', 'publicKey', 'network', 'wallet', 'navigation', 'secretKey', 'submitTransaction', 'xlmByMemo', 'investedTokens', 'quiz', 'settings'];

i18n
  .use(initReactI18next)
  .init({
    resources,
    ns: namespaces,
    defaultNS: 'common',
    fallbackNS: ['common'],
    lng: 'de', // Standardsprache
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;

