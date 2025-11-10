/**
 * getBasePath: Liefert die öffentliche Basis-URL der App.
 * Nutzt Vites import.meta.env.BASE_URL und sorgt für führenden/abschließenden Slash.
 */
export function getBasePath() {
  let base = (import.meta.env?.BASE_URL ?? '/').trim();
  if (!base.startsWith('/')) base = '/' + base;
  if (!base.endsWith('/')) base += '/';
  return base;
}

/**
 * buildPath: Fügt einem Unterpfad die Basis-URL voran und entfernt doppelte Slashes.
 */
export function buildPath(subpath = '') {
  const base = getBasePath();
  const clean = String(subpath).replace(/^\/+/, '');
  return base + clean;
}

/**
 * isBugtrackerPath: Prüft, ob ein Pfad zur Bugtracker-Ansicht gehört.
 * Unterstützt sowohl dev (/bugtracker) als auch prod (/BASE_URL/bugtracker).
 */
export function isBugtrackerPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const target = buildPath('bugtracker');
  const normalize = (value) => String(value || '').replace(/\/+$/, '');
  return normalize(current) === normalize(target) || normalize(current).endsWith('/bugtracker');
}

/**
 * isGlossaryPath: Prüft, ob ein Pfad zur Glossar-Seite gehört.
 * Unterstützt sowohl dev (/glossar) als auch prod (/BASE_URL/glossar).
 */
export function isGlossaryPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const target = buildPath('glossar');
  const normalize = (value) => String(value || '').replace(/\/+$/, '');
  return normalize(current) === normalize(target) || normalize(current).endsWith('/glossar');
}

/**
 * isLearnPath: Prüft, ob ein Pfad zur Lern-Seite gehört.
 * Unterstützt sowohl dev (/learn) als auch prod (/BASE_URL/learn).
 */
export function isLearnPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const target = buildPath('learn');
  const normalize = (value) => String(value || '').replace(/\/+$/, '');
  return normalize(current) === normalize(target) || normalize(current).endsWith('/learn');
}
