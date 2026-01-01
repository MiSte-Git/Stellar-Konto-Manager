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

function stripBase(pathname) {
  const base = getBasePath();
  if (pathname && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length);
    return '/' + String(rest).replace(/^\/+/, '');
  }
  return pathname;
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
  const norm = normalizePath(current);
  return norm === normalizePath(target) || norm.endsWith('/learn') || norm.startsWith(normalizePath(target + '/'));
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
  const p = normalizePath(stripBase(current));
  const rest = p.replace(/^\/?quiz\//, ''); // e.g. "1/run"
  return /^([A-Za-z0-9_-]+\/run)$/.test(rest);
}

/**
 * isQuizLandingPath: Pfad zur Quiz-Landing-Route (/quiz/:id)
 * (ohne /run, /settings oder /achievements)
 */
export function isQuizLandingPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const p = normalizePath(stripBase(current));
  const rest = p.replace(/^\/?quiz\//, ''); // e.g. "1"
  return /^([A-Za-z0-9_-]+)$/.test(rest);
}

/**
 * isQuizSettingsPath: Pfad zur Quiz-Einstellungen-Route (/quiz/:id/settings)
 */
export function isQuizSettingsPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const p = normalizePath(stripBase(current));
  const rest = p.replace(/^\/?quiz\//, ''); // e.g. "1/settings"
  return /^([A-Za-z0-9_-]+\/settings)$/.test(rest);
}

/**
 * isQuizAchievementsPath: Pfad zur Quiz-Erfolge-Route (/quiz/:id/achievements)
 */
export function isQuizAchievementsPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const p = normalizePath(stripBase(current));
  const rest = p.replace(/^\/?quiz\//, ''); // e.g. "1/achievements"
  return /^([A-Za-z0-9_-]+\/achievements)$/.test(rest);
}

export function quizLandingPath(lessonId) {
  return buildPath(`quiz/${lessonId}`);
}

export function quizRunPath(lessonId) {
  return buildPath(`quiz/${lessonId}/run`);
}

export function quizSettingsPath(lessonId) {
  return buildPath(`quiz/${lessonId}/settings`);
}

export function quizAchievementsPath(lessonId) {
  return buildPath(`quiz/${lessonId}/achievements`);
}

/**
 * isTradingAssetsPath: Pfad zur Trading-Asset-Suche (/trading/assets)
 */
export function isTradingAssetsPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const target = buildPath('trading/assets');
  return normalizePath(current) === normalizePath(target) || normalizePath(current).endsWith('/trading/assets');
}

export function tradingAssetsPath() {
  return buildPath('trading/assets');
}

/**
 * Extracts multisig job id from path /multisig/jobs/:id
 */
export function getMultisigJobId(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const p = normalizePath(stripBase(current));
  const m = p.match(/^\/?multisig\/jobs\/([^/]+)$/);
 return m ? m[1] : null;
}

/**
 * Checks whether the current path points to the multisig job list (/multisig/jobs)
 */
export function isMultisigJobsListPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const target = buildPath('multisig/jobs');
  const normCurrent = normalizePath(current);
  const normTarget = normalizePath(target);
  return normCurrent === normTarget || normCurrent.endsWith('/multisig/jobs');
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
 * isSettingsPath: Pfad zur gemeinsamen Einstellungsseite (/settings)
 */
export function isSettingsPath(pathname) {
  const current = typeof pathname === 'string'
    ? pathname
    : (typeof window !== 'undefined' ? window.location.pathname : '');
  const target = buildPath('settings');
  const normCurrent = normalizePath(current);
  const normTarget = normalizePath(target);
  return normCurrent === normTarget || normCurrent.endsWith('/settings');
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
