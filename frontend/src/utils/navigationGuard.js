// Navigationswaechter fuer Seiten mit Zustand, der nicht verloren gehen darf (z. B. die
// erzeugten Schluessel auf "Neues Konto erstellen").
//
// Eine Seite meldet sich mit useNavigationGuard(aktiv, text) an. Solange ein Waechter
// angemeldet ist:
// - Menuewechsel in main.jsx (setMenuSelection) fragt per confirmNavigation() nach.
// - Wechsel auf eigene Routen (navigateToPath in appNavigation.js) fragt nach.
// - Browser-Zurueck/Vor innerhalb der App (popstate) fragt nach. Bei Abbrechen geht der
//   Browser an den alten Eintrag zurueck, ohne einen neuen anzulegen, und das Ereignis
//   erreicht Router und Main nicht.
// - Klicks auf Links innerhalb der App (React-Router-Link, <a href> gleicher Origin unter der
//   Basis der App, ohne target, ohne Modifier-Taste) fragen in der Capture-Phase nach, bevor
//   Router oder Browser navigieren (KS-6). Bei Abbrechen passiert nichts.
// - Overlays ueber Main (Glossar, Backup) lassen die Seite gemountet: keine Rueckfrage, auch
//   nicht beim Schliessen zurueck auf die Route, von der aus das Overlay geoeffnet wurde.
// - Nur der Anker aendert sich (#...): gleiche Ansicht, keine Rueckfrage.
// - Reload, Tab schliessen und Verlassen der App: beforeunload-Warnung des Browsers.
//
// Damit Abbrechen den alten Eintrag ohne neuen Eintrag wiederherstellen kann, bekommt jeder
// Eintrag der App eine laufende Nummer (__skmIdx im history.state, bestehender State bleibt).
//
// Der Waechter speichert nichts, er haelt nur die Seite gemountet.
import { useEffect, useRef } from 'react';
import { buildPath, isGlossaryPath, isSettingsBackupPath } from './basePath.js';

const IDX_KEY = '__skmIdx';
const guards = []; // { id, getMessage }
let nextId = 1;
// Eintrag, den die Ansicht gerade zeigt (zuletzt bestaetigt oder ohne Waechter erreicht)
let lastUrl = '';
let lastIdx = null;
let lastState = null;
// Pfad, von dem aus das offene Overlay geoeffnet wurde (nur mit Waechter gemerkt, dann liegt
// darunter sicher Main mit der bewachten Seite). Schliessen dorthin laesst Main gemountet.
let overlayOrigin = null;
let bypassPopState = 0;
// Abbrechen per history.go laeuft asynchron: das zugehoerige popstate nicht pruefen. Kommt
// es nicht (go ohne Wirkung), verfaellt die Erwartung, damit ein spaeteres popstate auf einen
// Eintrag gleicher Nummer nicht verschluckt wird.
let restoringIdx = null;
let restoringTimer = null;
export const RESTORE_TIMEOUT_MS = 1000;
// Nach einer bestaetigten Rueckfrage gilt sie fuer den Rest dieses Ereignisses (z. B.
// popstate-Waechter und danach setMenuSelection in main.jsx), damit nicht doppelt gefragt wird.
let approvedUntilNextTask = false;

function currentUrl() {
  try {
    const { pathname, search, hash } = window.location;
    return `${pathname}${search}${hash}`;
  } catch {
    return '';
  }
}

function pathOnly(url) {
  return String(url || '').split(/[?#]/)[0];
}

// Pfad und Query ohne Anker
function withoutHash(url) {
  return String(url || '').split('#')[0];
}

function appBasePath() {
  try { return buildPath(''); } catch { return '/'; }
}

/** Glossar und Backup liegen als Overlay ueber Main (Main bleibt gemountet). */
export function isOverlayPath(url) {
  const p = pathOnly(url);
  if (!p) return false;
  try {
    return isGlossaryPath(p) || isSettingsBackupPath(p);
  } catch {
    return false;
  }
}

/**
 * Wechsel von from nach to laesst Main samt aktueller Ansicht gemountet: Overlay oeffnen,
 * oder Overlay schliessen zurueck auf die Startroute von Main.
 */
export function keepsMainMounted(from, to) {
  if (isOverlayPath(to)) return true;
  if (!isOverlayPath(from)) return false;
  const target = pathOnly(to);
  return target === appBasePath() || (overlayOrigin !== null && target === overlayOrigin);
}

function idxOf(state) {
  const v = state && typeof state === 'object' ? state[IDX_KEY] : undefined;
  return Number.isInteger(v) ? v : null;
}

function withIdx(state, idx) {
  if (idx === null) return state;
  if (state === null || state === undefined) return { [IDX_KEY]: idx };
  if (typeof state === 'object' && !Array.isArray(state)) return { ...state, [IDX_KEY]: idx };
  return state; // fremder State-Typ: unnummeriert lassen
}

function rememberCurrent() {
  const prevUrl = lastUrl;
  lastUrl = currentUrl();
  if (!isOverlayPath(lastUrl)) overlayOrigin = null;
  else if (prevUrl && !isOverlayPath(prevUrl)) overlayOrigin = guards.length ? pathOnly(prevUrl) : null;
  try {
    lastState = window.history.state;
    lastIdx = idxOf(lastState);
  } catch {
    lastState = null;
    lastIdx = null;
  }
}

function onBeforeUnload(event) {
  // Link innerhalb der App mit Seitenwechsel, gerade bestaetigt: nicht zweimal fragen
  if (approvedUntilNextTask) return undefined;
  event.preventDefault();
  // Aeltere Browser zeigen die Warnung nur mit gesetztem returnValue
  event.returnValue = '';
  return '';
}

function syncBeforeUnload() {
  if (typeof window === 'undefined') return;
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (guards.length) window.addEventListener('beforeunload', onBeforeUnload);
}

/** Meldet einen Waechter an. getMessage: Text oder Funktion, die den Text liefert. Rueckgabe: Abmelden. */
export function registerNavigationGuard(getMessage) {
  const guard = { id: nextId++, getMessage };
  guards.push(guard);
  rememberCurrent();
  syncBeforeUnload();
  return () => {
    const idx = guards.findIndex((g) => g.id === guard.id);
    if (idx >= 0) guards.splice(idx, 1);
    syncBeforeUnload();
  };
}

export function hasNavigationGuard() {
  return guards.length > 0;
}

/**
 * Vor einem Wechsel weg von der aktuellen Ansicht aufrufen. true: Wechsel erlaubt (kein
 * Waechter oder Nutzer hat bestaetigt), false: auf der Seite bleiben.
 */
export function confirmNavigation() {
  if (!guards.length || approvedUntilNextTask) return true;
  const guard = guards[guards.length - 1];
  const raw = typeof guard.getMessage === 'function' ? guard.getMessage() : guard.getMessage;
  let ok = false;
  try {
    ok = !!window.confirm(String(raw || ''));
  } catch {
    ok = false;
  }
  if (ok) {
    approvedUntilNextTask = true;
    setTimeout(() => { approvedUntilNextTask = false; }, 0);
  }
  return ok;
}

/**
 * Fuer Code, der selbst pushState + popstate ausloest und vorher schon confirmNavigation()
 * gefragt hat: Das folgende popstate wird nicht erneut geprueft.
 */
export function runWithoutPopStateGuard(fn) {
  bypassPopState += 1;
  try {
    return fn();
  } finally {
    bypassPopState -= 1;
    rememberCurrent();
  }
}

// Abbrechen: zurueck auf den Eintrag, den die Ansicht zeigt, ohne neuen Eintrag.
function expectRestore(idx) {
  restoringIdx = idx;
  if (restoringTimer) clearTimeout(restoringTimer);
  restoringTimer = setTimeout(() => { restoringIdx = null; restoringTimer = null; }, RESTORE_TIMEOUT_MS);
}

function clearRestore() {
  restoringIdx = null;
  if (restoringTimer) clearTimeout(restoringTimer);
  restoringTimer = null;
}

function withoutIdx(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !(IDX_KEY in state)) return state;
  const { [IDX_KEY]: _drop, ...rest } = state;
  return rest;
}

function restoreLastEntry(targetIdx) {
  try {
    if (lastIdx !== null && targetIdx !== null) {
      const delta = lastIdx - targetIdx;
      if (delta === 0) {
        // URL des aktuellen Eintrags wurde ersetzt (replaceState + popstate): zuruecksetzen
        window.history.replaceState(lastState, '', lastUrl);
      } else {
        // Browser-Zurueck/Vor oder pushState + popstate: Schritt rueckgaengig machen
        expectRestore(lastIdx);
        window.history.go(delta);
      }
      return;
    }
    // Eintrag ohne Nummer (Position unbekannt): alte URL als neuen Eintrag, ebenfalls ohne
    // Nummer. Die alte Nummer mitzunehmen ergaebe zwei Eintraege mit derselben Nummer und
    // spaeter falsche Schritte bei history.go.
    window.history.pushState(withoutIdx(lastState), '', lastUrl);
  } catch { /* noop */ }
}

// Anker-Sprung: neuer Eintrag direkt nach dem bisherigen, vom Browser ohne State angelegt.
// Nummerieren, sonst bleiben alle folgenden Eintraege ohne Nummer.
function numberFragmentEntry(target) {
  try {
    const h = window.history;
    if (idxOf(h.state) !== null || lastIdx === null) return;
    const raw = h.__skmRawReplace;
    if (typeof raw !== 'function') return;
    raw(withIdx(h.state, target === lastUrl ? lastIdx : lastIdx + 1), '');
  } catch { /* noop */ }
}

function onPopState(event) {
  if (restoringIdx !== null) {
    const arrived = idxOf(event.state ?? window.history.state);
    if (arrived === restoringIdx) {
      // Rueckweg nach Abbrechen: Ansicht hat sich nie geaendert
      clearRestore();
      event.stopImmediatePropagation();
      return;
    }
    clearRestore();
  }
  const target = currentUrl();
  if (lastUrl && withoutHash(target) === withoutHash(lastUrl)) numberFragmentEntry(target);
  if (!guards.length || bypassPopState > 0) {
    rememberCurrent();
    return;
  }
  if (withoutHash(target) === withoutHash(lastUrl)) {
    // Nur der Anker (oder nichts) hat sich geaendert: dieselbe Ansicht
    rememberCurrent();
    return;
  }
  if (keepsMainMounted(lastUrl, target) || confirmNavigation()) {
    rememberCurrent();
    return;
  }
  // Abbrechen: Router und Main sehen das Ereignis nicht.
  event.stopImmediatePropagation();
  restoreLastEntry(idxOf(event.state ?? window.history.state));
}

// Jeder Eintrag der App bekommt eine laufende Nummer, damit Abbrechen den Schritt mit
// history.go rueckgaengig machen kann. Bestehender State (React Router: usr, key, idx)
// bleibt unveraendert erhalten.
function installHistoryNumbering() {
  const h = window.history;
  if (!h || h.__skmNumbered) return;
  const origPush = h.pushState.bind(h);
  const origReplace = h.replaceState.bind(h);
  try {
    const cur = idxOf(h.state);
    origReplace(withIdx(h.state, cur === null ? 0 : cur), '');
  } catch { /* noop */ }
  h.pushState = function pushState(state, title, url) {
    const cur = idxOf(h.state);
    // Ohne Nummer am aktuellen Eintrag ist die Position unbekannt: unnummeriert lassen
    return origPush(withIdx(state, cur === null ? null : cur + 1), title, url);
  };
  h.replaceState = function replaceState(state, title, url) {
    return origReplace(withIdx(state, idxOf(h.state)), title, url);
  };
  Object.defineProperty(h, '__skmNumbered', { value: true });
  Object.defineProperty(h, '__skmRawReplace', { value: origReplace });
}

// Ziel eines Link-Klicks innerhalb der App, sonst null (extern, neuer Tab, Download,
// Modifier-Taste, schon von anderer Stelle behandelt).
function inAppLinkTarget(event) {
  if (event.defaultPrevented) return null;
  if (event.button !== undefined && event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const start = event.target;
  const el = start && typeof start.closest === 'function'
    ? start.closest('a[href]')
    : start?.parentElement?.closest?.('a[href]');
  if (!el) return null;
  const target = String(el.getAttribute('target') || '').trim().toLowerCase();
  if (target && target !== '_self') return null;
  if (el.hasAttribute('download')) return null;
  let url;
  try { url = new URL(el.href, window.location.href); } catch { return null; }
  if (url.origin !== window.location.origin) return null;
  // Andere Anwendung auf derselben Origin: Seitenwechsel, dafuer gibt es beforeunload
  const base = appBasePath();
  const basePrefix = base.endsWith('/') ? base : `${base}/`;
  if (url.pathname !== base && !url.pathname.startsWith(basePrefix)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

// KS-6: Links innerhalb der App (React-Router-Link, normale <a>) wie einen Menuewechsel
// behandeln. Capture-Phase am document: vor dem onClick von React (Root-Container) und vor
// der Standardaktion des Browsers.
function onDocumentClick(event) {
  if (!guards.length) return;
  const to = inAppLinkTarget(event);
  if (!to) return;
  const from = currentUrl();
  if (withoutHash(to) === withoutHash(from)) return; // nur Anker: gleiche Ansicht
  if (keepsMainMounted(from, to)) return;
  if (confirmNavigation()) return;
  event.preventDefault();
  event.stopPropagation();
}

// Einmal beim ersten Import: vor dem Listener von react-router (der erst beim Mounten von
// BrowserRouter kommt) und vor Main, damit stopImmediatePropagation beide erreicht.
if (typeof window !== 'undefined') {
  try { installHistoryNumbering(); } catch { /* noop */ }
  rememberCurrent();
  window.addEventListener('popstate', onPopState, true);
  if (typeof document !== 'undefined') document.addEventListener('click', onDocumentClick, true);
}

/** Hook: Waechter angemeldet, solange active wahr ist und die Komponente gemountet. */
export function useNavigationGuard(active, message) {
  const messageRef = useRef(message);
  messageRef.current = message;
  useEffect(() => {
    if (!active) return undefined;
    return registerNavigationGuard(() => messageRef.current);
  }, [active]);
}
