// Reine Datenquelle für die Hauptseiten-Navigation (kein React, kein i18n-Aufruf).
// Einträge werden in UI-Komponenten über t(labelKey) gerendert.

/**
 * @typedef {{ id: string, labelKey: string, to?: string }} MainNavItem
 */

/** @type {MainNavItem[]} */
export const MAIN_MENU_NAV = [
  { id: 'createAccount', labelKey: 'menu:createAccount' },
  { id: 'sendPayment', labelKey: 'menu:sendPayment' },
  { id: 'balance', labelKey: 'menu:balance' },
  { id: 'payments', labelKey: 'menu:tokenPurchases' },
  { id: 'xlmByMemo', labelKey: 'menu:xlmByMemo' },
  { id: 'tradingAssets', labelKey: 'trading:assetSearch.title' },
  { id: 'multisigEdit', labelKey: 'menu:multisigEdit' },
  { id: 'multisigJobs', labelKey: 'menu:multisigJobs' },
  { id: 'muxed', labelKey: 'menu:muxed' },
  { id: 'listAll', labelKey: 'menu:listAll' },
  { id: 'compare', labelKey: 'menu:compareTrustlines' },
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
