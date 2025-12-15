// Reine Datenquelle für die Hauptseiten-Navigation (kein React, kein i18n-Aufruf).
// Einträge werden in UI-Komponenten über t(labelKey) gerendert.

/**
 * @typedef {{ id: string, labelKey: string, to?: string }} MainNavItem
 */

/** @type {MainNavItem[]} */
export const MAIN_MENU_NAV = [
  // Gruppe 1
  { id: 'createAccount', labelKey: 'menu:createAccount', group: 1 },
  { id: 'sendPayment', labelKey: 'menu:sendPayment', group: 1 },
  { id: 'balance', labelKey: 'menu:balance', group: 1 },

  // Gruppe 2
  { id: 'payments', labelKey: 'menu:tokenPurchases', group: 2 },
  { id: 'xlmByMemo', labelKey: 'menu:xlmByMemo', group: 2 },
  { id: 'tradingAssets', labelKey: 'trading:assetSearch.title', group: 2 },

  // Gruppe 3
  { id: 'multisigEdit', labelKey: 'menu:multisigEdit', group: 3 },
  { id: 'multisigJobs', labelKey: 'menu:multisigJobs', group: 3 },
  { id: 'muxed', labelKey: 'menu:muxed', group: 3 },

  // Gruppe 4
  { id: 'listAll', labelKey: 'menu:listAll', group: 4 },
  { id: 'compare', labelKey: 'menu:compareTrustlines', group: 4 },
];

/** @type {MainNavItem[]} */
export const MAINPAGE_EXTRA_NAV = [
  { id: 'beginnerQuiz', labelKey: 'quiz:entry.beginnerQuizTitle' },
  { id: 'learnOverview', labelKey: 'learn:menuHint' },
  { id: 'glossary', labelKey: 'glossary:pageTitle' },
  { id: 'feedback', labelKey: 'common:feedback.pages.feedback' },
  { id: 'settings', labelKey: 'common:feedback.pages.settings' },
];

/** @type {MainNavItem[]} */
export const ADMIN_NAV = [
  { id: 'bugtracker', to: 'bugtracker', labelKey: 'common:feedback.pages.bugtracker' },
];

/** @type {MainNavItem[]} */
export const STATIC_FEEDBACK_AREAS = [
  { id: 'global', labelKey: 'common:feedback.pages.global' },
  { id: 'other', labelKey: 'common:feedback.pages.other' },
];
