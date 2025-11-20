export function getStartInNewTabGlobal() {
  try {
    const raw = window.localStorage.getItem('quiz.startInNewTab');
    return String(raw) === 'true';
  } catch {
    return false;
  }
}

export function setStartInNewTabGlobal(value) {
  try {
    window.localStorage.setItem('quiz.startInNewTab', String(!!value));
  } catch {
    // ignore write errors, e.g., private mode or quota
  }
}

export function getStartInNewTabForId(id) {
  try {
    const key = `quiz.${String(id)}.startInNewTab`;
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null; // undefined -> fall back to global
    return String(raw) === 'true';
  } catch {
    return null;
  }
}

export function setStartInNewTabForId(id, value) {
  try {
    const key = `quiz.${String(id)}.startInNewTab`;
    window.localStorage.setItem(key, String(!!value));
  } catch {
    // ignore write errors
  }
}
