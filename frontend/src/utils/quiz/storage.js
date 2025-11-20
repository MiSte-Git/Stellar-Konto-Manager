// Centralized quiz storage and migrations
// Schema:
// - Per quiz: quiz.<id>.settings, quiz.<id>.achievements, quiz.<id>.progress
// - Global: quiz.startInNewTab, quiz.globalSettings.*

function ls() {
  try { return window.localStorage; } catch { return null; }
}

export function normalizeLessonId(lessonId) {
  return String(lessonId ?? '1').replace(/[^0-9]/g, '') || '1';
}

// --- Settings ---
const SETTINGS_KEY = (id) => `quiz.${id}.settings`;

function tryParse(json, fallback = null) {
  try { const v = JSON.parse(json); return v; } catch { return fallback; }
}

function migrateSettingsCandidates(id) {
  const s = ls(); if (!s) return null;
  const candidates = [
    `quiz:${id}:settings`,
    `quiz.settings.${id}`,
    `settings.quiz.${id}`,
    `quiz_settings_${id}`,
    `quiz.${id}.config`
  ];
  for (const key of candidates) {
    const raw = s.getItem(key);
    if (!raw) continue;
    const obj = tryParse(raw, null);
    if (obj && typeof obj === 'object') {
      // write new and remove old
      try { s.setItem(SETTINGS_KEY(id), JSON.stringify(obj)); } catch { /* noop */ }
      try { s.removeItem(key); } catch { /* noop */ }
      return obj;
    }
  }
  return null;
}

export function getPerQuizSettings(lessonId) {
  const id = normalizeLessonId(lessonId);
  const s = ls();
  const defaults = { stickyNav: true, hints: true, haptics: true, shuffle: false, timeLimit: 0 };
  if (!s) return defaults;
  const raw = s.getItem(SETTINGS_KEY(id));
  if (raw) {
    const obj = tryParse(raw, null);
    if (obj && typeof obj === 'object') {
      return {
        stickyNav: obj.stickyNav !== false,
        hints: obj.hints !== false,
        haptics: obj.haptics !== false,
        shuffle: !!obj.shuffle,
        timeLimit: Number.isFinite(obj.timeLimit) ? Math.max(0, obj.timeLimit) : 0
      };
    }
  }
  // migrations
  const mig = migrateSettingsCandidates(id);
  if (mig) {
    return {
      stickyNav: mig.stickyNav !== false,
      hints: mig.hints !== false,
      haptics: mig.haptics !== false,
      shuffle: !!mig.shuffle,
      timeLimit: Number.isFinite(mig.timeLimit) ? Math.max(0, mig.timeLimit) : 0
    };
  }
  return defaults;
}

export function setPerQuizSettings(lessonId, settings) {
  const id = normalizeLessonId(lessonId);
  const s = ls(); if (!s) return;
  try { s.setItem(SETTINGS_KEY(id), JSON.stringify(settings || {})); } catch { /* noop */ }
}

// --- Achievements ---
const ACH_KEY = (id) => `quiz.${id}.achievements`;

export function getAchievements(lessonId) {
  const id = normalizeLessonId(lessonId);
  const s = ls(); if (!s) return [];

  const raw = s.getItem(ACH_KEY(id));
  if (raw) {
    const obj = tryParse(raw, []);
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === 'object') return Object.values(obj);
  }

  // migrate from older guesses
  const candidates = [
    `achievements.quiz.${id}`,
    `quiz:${id}:achievements`,
    `quiz.achievements.${id}`
  ];
  for (const key of candidates) {
    const r = s.getItem(key);
    if (!r) continue;
    const obj = tryParse(r, []);
    const list = Array.isArray(obj) ? obj : (obj && typeof obj === 'object' ? Object.values(obj) : []);
    try { s.setItem(ACH_KEY(id), JSON.stringify(list)); } catch { /* noop */ }
    try { s.removeItem(key); } catch { /* noop */ }
    return list;
  }

  return [];
}

export function setAchievements(lessonId, list) {
  const id = normalizeLessonId(lessonId);
  const s = ls(); if (!s) return;
  try { s.setItem(ACH_KEY(id), JSON.stringify(Array.isArray(list) ? list : [])); } catch { /* noop */ }
}

// --- Per-quiz progress ---
const PROG_KEY = (id) => `quiz.${id}.progress`;

export function getPerQuizProgress(lessonId) {
  const id = normalizeLessonId(lessonId);
  const s = ls(); if (!s) return null;
  const raw = s.getItem(PROG_KEY(id));
  if (!raw) return null;
  const obj = tryParse(raw, null);
  return (obj && typeof obj === 'object') ? obj : null;
}

export function setPerQuizProgress(lessonId, prog) {
  const id = normalizeLessonId(lessonId);
  const s = ls(); if (!s) return;
  const safe = prog && typeof prog === 'object' ? prog : {};
  try { s.setItem(PROG_KEY(id), JSON.stringify(safe)); } catch { /* noop */ }
}

// --- Global settings ---
export function getGlobalSetting(key, fallback = null) {
  const s = ls(); if (!s) return fallback;
  try {
    const raw = s.getItem(`quiz.globalSettings.${key}`);
    if (raw == null) return fallback;
    return tryParse(raw, raw);
  } catch {
    return fallback;
  }
}

export function setGlobalSetting(key, value) {
  const s = ls(); if (!s) return;
  try {
    const v = (typeof value === 'string') ? value : JSON.stringify(value);
    s.setItem(`quiz.globalSettings.${key}`, v);
  } catch { /* noop */ }
}

export function getStartInNewTab() {
  const s = ls(); if (!s) return false;
  try {
    const v = s.getItem('quiz.startInNewTab');
    if (v == null) return false;
    return String(v) === 'true' || v === true;
  } catch { return false; }
}

export function setStartInNewTab(flag) {
  const s = ls(); if (!s) return;
  try { s.setItem('quiz.startInNewTab', String(!!flag)); } catch { /* noop */ }
}

// --- Migrations from global learn progress to per-quiz progress ---
export function migrateProgressFromGlobal() {
  const s = ls(); if (!s) return;
  try {
    const raw = s.getItem('skm.learn.progress.v1');
    if (!raw) return;
    const obj = tryParse(raw, null);
    if (!obj || typeof obj !== 'object' || !obj.lessons) return;
    const lessons = obj.lessons || {};
    for (const [lessonKey, st] of Object.entries(lessons)) {
      const id = String(lessonKey).replace(/[^0-9]/g, '') || '1';
      const exists = s.getItem(PROG_KEY(id));
      if (exists) continue; // don't override existing per-quiz progress
      const proj = {
        score: Number(st?.score || 0),
        stars: Math.max(0, Math.min(3, Number(st?.stars || 0))),
        attempts: Math.max(0, Number(st?.attempts || 0)),
        errors: Math.max(0, Number(st?.errors || 0)),
        completed: !!st?.completed,
        lastUpdated: st?.lastUpdated || new Date().toISOString(),
        thresholds: st?.thresholds || undefined
      };
      try { s.setItem(PROG_KEY(id), JSON.stringify(proj)); } catch { /* noop */ }
    }
  } catch { /* noop */ }
}

export function migrateAllOnInit() {
  try { migrateProgressFromGlobal(); } catch { /* noop */ }
}
