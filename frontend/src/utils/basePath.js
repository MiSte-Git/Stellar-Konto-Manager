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

function normalizePath(value) {
  return String(value || '').replace(/\/+$/, '');
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
  return normalizePath(current) === normalizePath(target) || normalizePath(current).endsWith('/bugtracker');
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
  return normalizePath(current) === normalizePath(target) || normalizePath(current).endsWith('/glossar');
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
  return normalizePath(current) === normalizePath(target) || normalizePath(current).endsWith('/learn');
}

/**
 * isLessonQuizPath: Pfad zu einem Quiz einer Lektion (/learn/lesson/:id/quiz)
 */
export function isLessonQuizPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const base = buildPath('learn/lesson/');
  const p = normalizePath(current);
  return p.startsWith(normalizePath(base)) && p.endsWith('/quiz');
}

/**
 * isQuizRunPath: Pfad zur neuen Runner-Route (/quiz/:id/run)
 */
export function isQuizRunPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const p = normalizePath(current);
  const base = normalizePath(buildPath('quiz/'));
  if (!p.startsWith(base)) return false;
  const rest = p.slice(base.length); // e.g. "1/run"
  return /^\d+\/run$/.test(rest);
}

/**
 * isQuizLandingPath: Pfad zur Quiz-Landing-Route (/quiz/:id)
 * (ohne /run, /settings oder /achievements)
 */
export function isQuizLandingPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const p = normalizePath(current);
  const base = normalizePath(buildPath('quiz/'));
  if (!p.startsWith(base)) return false;
  const rest = p.slice(base.length); // e.g. "1"
  return /^\d+$/.test(rest);
}

/**
 * isQuizSettingsPath: Pfad zur Quiz-Einstellungen-Route (/quiz/:id/settings)
 */
export function isQuizSettingsPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const p = normalizePath(current);
  const base = normalizePath(buildPath('quiz/'));
  if (!p.startsWith(base)) return false;
  const rest = p.slice(base.length); // e.g. "1/settings"
  return /^\d+\/settings$/.test(rest);
}

/**
 * isQuizAchievementsPath: Pfad zur Quiz-Erfolge-Route (/quiz/:id/achievements)
 */
export function isQuizAchievementsPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const p = normalizePath(current);
  const base = normalizePath(buildPath('quiz/'));
  if (!p.startsWith(base)) return false;
  const rest = p.slice(base.length); // e.g. "1/achievements"
  return /^\d+\/achievements$/.test(rest);
}

/**
 * isLessonPracticePath: Pfad zur Praxis einer Lektion (/learn/lesson/:id/practice)
 */
export function isLessonPracticePath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const base = buildPath('learn/lesson/');
  const p = normalizePath(current);
  return p.startsWith(normalizePath(base)) && p.endsWith('/practice');
}

/**
 * isSettingsBackupPath: Pfad zur Sicherung in den App-Einstellungen (/settings/backup)
 */
export function isSettingsBackupPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const target = buildPath('settings/backup');
  return normalizePath(current) === normalizePath(target) || normalizePath(current).endsWith('/settings/backup');
}
