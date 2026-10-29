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
  { id: 'tradingAssets', labelKey: 'menu:swap', group: 2, glossaryTerm: 'tokenTrading' },

  // Gruppe 3
  { id: 'multisigEdit', labelKey: 'menu:multisigEdit', group: 3 },
  { id: 'multisigJobs', labelKey: 'menu:multisigJobs', group: 3 },
  { id: 'muxed', labelKey: 'menu:muxed', group: 3, glossaryTerm: 'addressMuxed' },

  // Gruppe 4
  { id: 'listAll', labelKey: 'menu:listAll', group: 4, glossaryTerm: 'trustline' },
  { id: 'compare', labelKey: 'menu:compareTrustlines', group: 4, glossaryTerm: 'trustline' },
];

/** @type {MainNavItem[]} */
export const MAINPAGE_EXTRA_NAV = [
  { id: 'beginnerQuiz', labelKey: 'quiz:entry.beginnerQuizTitle' },
  { id: 'learnOverview', labelKey: 'learn:menuHint' },
  { id: 'scamSimulator', labelKey: 'scamSimulator:ui.title', to: 'learn/scam-simulator' },
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

/**
 * Seitenleisten-Navigation (App-Shell).
 * kind: 'main'  -> Ansicht innerhalb von Main (menuSelection), geoeffnet ueber stm:openMenu
 * kind: 'route' -> eigene Route (pushState auf buildPath(to))
 * parent: id eines Eintrags im selben Abschnitt -> wird eingerueckt als Unterpunkt darunter gerendert
 * badge: optionales dekoratives Emoji hinter dem Label (aria-hidden)
 * Abschnitte ohne titleKey werden ohne Ueberschrift gerendert.
 *
 * @typedef {{ id: string, kind: 'main'|'route', labelKey: string, fallback?: string, icon: string, to?: string, glossaryTerm?: string, activeFor?: string[], requiresFlag?: string, parent?: string, badge?: string }} SidebarItem
 * @typedef {{ id: string, titleKey?: string, titleFallback?: string, items: SidebarItem[] }} SidebarSection
 */

/** @type {SidebarSection[]} */
export const SIDEBAR_SECTIONS = [
  {
    id: 'start',
    items: [
      { id: 'home', kind: 'main', labelKey: 'menu:wallet', fallback: 'Wallet', icon: 'wallet', activeFor: ['home', 'balance'] },
    ],
  },
  {
    id: 'account',
    titleKey: 'menu:sections.account',
    titleFallback: 'Konto',
    items: [
      { id: 'sendPayment', kind: 'main', labelKey: 'menu:sendPayment', icon: 'send' },
      { id: 'receive', kind: 'main', labelKey: 'menu:receive', fallback: 'Empfangen', icon: 'receive' },
      { id: 'createAccount', kind: 'main', labelKey: 'menu:createAccount', icon: 'plusCircle' },
    ],
  },
  {
    id: 'trade',
    titleKey: 'menu:sections.trade',
    titleFallback: 'Handel',
    items: [
      { id: 'tradingAssets', kind: 'main', labelKey: 'menu:swap', icon: 'swap', glossaryTerm: 'tokenTrading' },
      { id: 'liquidityPools', kind: 'main', labelKey: 'liquidity:menu', fallback: 'Liquidity Pools', icon: 'droplet' },
    ],
  },
  {
    id: 'reports',
    titleKey: 'menu:sections.reports',
    titleFallback: 'Auswertungen',
    items: [
      { id: 'payments', kind: 'main', labelKey: 'menu:tokenPurchases', icon: 'receipt' },
      { id: 'xlmByMemo', kind: 'main', labelKey: 'menu:xlmByMemo', icon: 'search' },
    ],
  },
  {
    id: 'trustlines',
    titleKey: 'menu:sections.trustlines',
    titleFallback: 'Token-Freigaben',
    items: [
      { id: 'listAll', kind: 'main', labelKey: 'menu:listAll', icon: 'list', glossaryTerm: 'trustline', activeFor: ['listAll', 'deleteAll', 'deleteByIssuer'] },
      { id: 'compare', kind: 'main', labelKey: 'menu:compareTrustlines', icon: 'compare', glossaryTerm: 'trustline' },
    ],
  },
  {
    id: 'advanced',
    titleKey: 'menu:sections.advanced',
    titleFallback: 'Erweitert',
    items: [
      { id: 'multisigEdit', kind: 'main', labelKey: 'menu:multisigEdit', icon: 'users' },
      { id: 'multisigJobs', kind: 'main', labelKey: 'menu:multisigJobs', icon: 'clock' },
      { id: 'muxed', kind: 'main', labelKey: 'menu:muxed', icon: 'branch', glossaryTerm: 'addressMuxed' },
    ],
  },
  {
    id: 'learn',
    titleKey: 'menu:sections.learn',
    titleFallback: 'Lernen',
    items: [
      { id: 'discover', kind: 'route', to: 'discover', labelKey: 'home:learn.button', icon: 'compass', badge: '🎮' },
      { id: 'quiz', kind: 'route', to: 'quiz', labelKey: 'navigation:quiz', fallback: 'Quiz', icon: 'quiz', parent: 'discover' },
      { id: 'scamSimulator', kind: 'route', to: 'learn/scam-simulator', labelKey: 'scamSimulator:ui.title', icon: 'shieldAlert', parent: 'discover' },
      { id: 'story', kind: 'route', to: 'story', labelKey: 'home:learn.story_title', icon: 'bookOpen', parent: 'discover' },
      { id: 'glossary', kind: 'route', to: 'glossar', labelKey: 'menu:glossary', icon: 'book', rememberPrevPath: true },
    ],
  },
];

/** Fussbereich der Seitenleiste (Feedback, Spenden, Einstellungen, Rechtliches). */
/** @type {SidebarItem[]} */
export const SIDEBAR_FOOTER_ITEMS = [
  { id: 'feedback', kind: 'main', labelKey: 'menu:feedback', icon: 'message' },
  { id: 'donate', kind: 'main', labelKey: 'menu:donate', icon: 'heart', requiresFlag: 'donate' },
  { id: 'settings', kind: 'main', labelKey: 'menu:settings', icon: 'settings' },
  { id: 'legal', kind: 'route', to: 'legal', labelKey: 'legal:footer.imprintLink', icon: 'info' },
];
