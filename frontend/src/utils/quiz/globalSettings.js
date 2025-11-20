const KEY_PREFIX = 'quiz.globalSettings.';

export function getGlobalSetting(name, fallback) {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${name}`);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return fallback;
  }
}

export function setGlobalSetting(name, value) {
  try {
    const key = `${KEY_PREFIX}${name}`;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    window.localStorage.setItem(key, str);
  } catch {
    // ignore
  }
}

export function getWarnOnActiveQuiz() {
  return !!getGlobalSetting('warnOnActiveQuiz', true);
}

export function setWarnOnActiveQuiz(value) {
  setGlobalSetting('warnOnActiveQuiz', !!value);
}
