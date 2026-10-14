// Navigation zwischen App-Shell (TopBar/Sidebar) und Main.
//
// Main haelt den State menuSelection. Die Shell oeffnet Ansichten ueber das
// bestehende Event stm:openMenu (inkl. Identity-Guard in handleMenuSelect).
// Ist Main gerade nicht gemountet (z.B. auf Quiz-, Lern- oder Rechtsseiten),
// wird die gewuenschte Ansicht vorgemerkt, zur Startroute navigiert und von
// Main beim Mounten uebernommen.

import {
  buildPath,
  isDiscoverPath,
  isGlossaryPath,
  isLessonQuizPath,
  isQuizAchievementsPath,
  isQuizDetailPath,
  isQuizIndexPath,
  isQuizRunPath,
  isQuizSettingsPath,
  isScamSimulatorPath,
  isSettingsBackupPath,
  isStoryPath,
} from './basePath.js';
import { SIDEBAR_FOOTER_ITEMS, SIDEBAR_SECTIONS } from '../config/mainNavigation.js';

export const MENU_CHANGED_EVENT = 'stm:menuChanged';

let mainMounted = false;
let pendingMainView = null;
let activeMainView = null;

export function setMainMounted(value) {
  mainMounted = !!value;
}

export function isMainMounted() {
  return mainMounted;
}

/** Liefert eine vorgemerkte Ansicht genau einmal. */
export function consumePendingMainView() {
  const next = pendingMainView;
  pendingMainView = null;
  return next;
}

/** Von Main aufgerufen, wenn sich menuSelection aendert. */
export function publishActiveMainView(selection) {
  activeMainView = selection || null;
  try {
    window.dispatchEvent(new CustomEvent(MENU_CHANGED_EVENT, { detail: activeMainView }));
  } catch { /* noop */ }
}

export function getActiveMainView() {
  return activeMainView;
}

/** Navigiert per pushState und informiert Router/Listener. */
export function navigateToPath(subpath, { rememberPrevPath = false } = {}) {
  try {
    if (rememberPrevPath && window.sessionStorage) {
      window.sessionStorage.setItem('SKM_PREV_PATH', window.location.pathname);
    }
  } catch { /* noop */ }
  try {
    const url = buildPath(subpath || '');
    if (window.location.pathname !== url) {
      window.history.pushState({}, '', url);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}

function isOverlayPath(pathname) {
  try {
    return isGlossaryPath(pathname) || isSettingsBackupPath(pathname);
  } catch {
    return false;
  }
}

/** Oeffnet eine Main-Ansicht (menuSelection) aus der Shell heraus. */
export function openMainView(id) {
  if (!id) return;
  if (!mainMounted) {
    pendingMainView = id;
    navigateToPath('');
    return;
  }
  // Glossar/Backup liegen als Overlay ueber Main: zuerst schliessen.
  if (typeof window !== 'undefined' && isOverlayPath(window.location.pathname)) {
    navigateToPath('');
  }
  try {
    window.dispatchEvent(new CustomEvent('stm:openMenu', { detail: id }));
  } catch { /* noop */ }
}

/** Ermittelt den Sidebar-Eintrag einer eigenen Route (oder null). */
export function getActiveRouteItemId(pathname) {
  const p = String(pathname || '');
  try {
    if (isScamSimulatorPath(p)) return 'scamSimulator';
    if (isStoryPath(p)) return 'story';
    if (isDiscoverPath(p)) return 'discover';
    if (isGlossaryPath(p)) return 'glossary';
    if (
      isQuizIndexPath(p) ||
      isQuizDetailPath(p) ||
      isQuizRunPath(p) ||
      isQuizSettingsPath(p) ||
      isQuizAchievementsPath(p) ||
      isLessonQuizPath(p)
    ) return 'quiz';
    const norm = p.replace(/\/+$/, '');
    if (norm === buildPath('legal').replace(/\/+$/, '') || norm.endsWith('/legal')) return 'legal';
  } catch { /* noop */ }
  return null;
}

const ALL_SIDEBAR_ITEMS = [...SIDEBAR_SECTIONS.flatMap((s) => s.items), ...SIDEBAR_FOOTER_ITEMS];

/** Ordnet eine Main-Ansicht (menuSelection) dem passenden Sidebar-Eintrag zu. */
export function resolveMainItemId(selection) {
  const sel = selection || 'home';
  const match = ALL_SIDEBAR_ITEMS.find(
    (item) => item.kind === 'main' && (item.id === sel || (item.activeFor || []).includes(sel))
  );
  return match ? match.id : null;
}
