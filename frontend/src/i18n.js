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
import deMenu from './locales/de/menu.json';
import deTrustline from './locales/de/trustline.json';
import deToken from './locales/de/token.json';
import deMultisigCreate from './locales/de/multisigCreate.json';
import deMultisigEdit from './locales/de/multisigEdit.json';
import dePublicKey from './locales/de/publicKey.json';
import deNetwork from './locales/de/network.json';
import deWallet from './locales/de/wallet.json';
import deNavigation from './locales/de/navigation.json';
import deSecretKey from './locales/de/secretKey.json';
import deSubmitTransaction from './locales/de/submitTransaction.json';
import deXlmByMemo from './locales/de/xlmByMemo.json';
import deInvestedTokens from './locales/de/investedTokens.json';

const resources = {
  de: {
    translation: de,
    learn: deLearn,
    glossary: deGlossary,
    home: deHome,
    errors: deErrors,
    common: deCommon,
    menu: deMenu,
    trustline: deTrustline,
    token: deToken,
    multisigCreate: deMultisigCreate,
    multisigEdit: deMultisigEdit,
    publicKey: dePublicKey,
    network: deNetwork,
    wallet: deWallet,
    navigation: deNavigation,
    secretKey: deSecretKey,
    submitTransaction: deSubmitTransaction,
    xlmByMemo: deXlmByMemo,
    investedTokens: deInvestedTokens
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
const namespaces = ['translation', 'learn', 'glossary', 'home', 'errors', 'common', 'menu', 'trustline', 'token', 'multisigCreate', 'multisigEdit', 'publicKey', 'network', 'wallet', 'navigation', 'secretKey', 'submitTransaction', 'xlmByMemo', 'investedTokens'];

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

