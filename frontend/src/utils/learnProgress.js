// utils/learnProgress.js
// Fortschritts- und Validierungslogik für die Lernseite
// Speichert stabil unter dem Key skm.learn.progress.v1
// Alle UI-Texte sollen über t() kommen; hier nur Defaults an Call-Sites nutzen.

import { getHorizonServer, getAccountSummary, loadTrustlines, sumIncomingXLMByMemo } from './stellar/stellarUtils.js';

export const STORAGE_KEY = 'skm.learn.progress.v1';
export const PROGRESS_VERSION = 'v1';

// Typen der Lektionen (konservativ gewählt, erweiterbar)
// theory = Quiz-basiert; practice = on-chain Checks; mixed = Kombination
const LESSON_TYPE = {
  lesson1: 'theory',
  lesson2: 'theory',
  lesson3: 'theory',
  lesson4: 'theory',
  lesson5: 'mixed',
  lesson6: 'theory',
  lesson7: 'theory',
  lesson8: 'theory',
  lesson9: 'theory',
  lesson10: 'practice',
  lesson11: 'theory',
  lesson12: 'theory',
};

// Praxis-Prüfungen je Lektion (Mindest-Checks)
// Für lesson10 definieren wir exemplarisch drei Subziele
const REQUIRED_CHECKS = {
  lesson10: ['accountActivated', 'trustline', 'payment'],
};

// Kapitel-Zuordnung für Badges
const CHAPTERS = {
  grundlagen: ['lesson1', 'lesson2', 'lesson3'],
  sicherheit: ['lesson7', 'lesson8', 'lesson9'],
  praxis: ['lesson10'],
};

// Badge IDs und Ableitung der Namen gemäß Vorgabe
export const BADGE_IDS = {
  chapter_grundlagen: 'chapter_grundlagen',
  chapter_sicherheit: 'chapter_sicherheit',
  chapter_praxis: 'chapter_praxis',
  master: 'master', // „Stellar-Profi“
};

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

function readRaw() {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const obj = raw ? safeParse(raw) : null;
  if (!obj || typeof obj !== 'object') return null;
  return obj;
}

function writeRaw(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

// Import helper: merge/replace incoming v1 progress into storage
export function importProgressV1(incoming, strategy = 'merge') {
  const cur = readProgressV1();
  const nowIso = new Date().toISOString();

  if (!incoming || typeof incoming !== 'object' || incoming.version !== PROGRESS_VERSION) {
    throw new Error('learn:import.invalid');
  }

  if (strategy === 'replace') {
    const normalized = { version: PROGRESS_VERSION, lessons: {}, badges: [] };
    for (const [id, st] of Object.entries(incoming.lessons || {})) {
      const safeStars = Math.max(0, Math.min(3, Number(st?.stars || 0)));
      const merged = {
        version: 1,
        completed: !!st?.completed,
        stars: safeStars,
        attempts: Math.max(0, Number(st?.attempts || 0)),
        errors: Math.max(0, Number(st?.errors || 0)),
        lastUpdated: nowIso,
        checks: { ...(st?.checks || {}) },
        score: Math.max(0, Math.min(100, Number(st?.score || 0))),
        manual: { ...(st?.manual || {}) },
      };
      normalized.lessons[id] = merged;
    }
    return persistBadges(normalized);
  }

  // Merge strategy
  const next = { ...cur, lessons: { ...(cur.lessons || {}) } };
  const allIds = new Set([
    ...Object.keys(cur.lessons || {}),
    ...Object.keys(incoming.lessons || {}),
  ]);

  for (const id of allIds) {
    const a = cur.lessons?.[id] || {};
    const b = incoming.lessons?.[id] || {};
    const stars = applyMonotonicStars(a.stars, b.stars, (a.manual?.stars || b.manual?.stars));
    const attempts = Math.max(0, Number(a.attempts || 0)) + Math.max(0, Number(b.attempts || 0));
    const errors = Math.max(0, Number(a.errors || 0)) + Math.max(0, Number(b.errors || 0));
    const checks = { ...(a.checks || {}) };
    for (const [k, v] of Object.entries(b.checks || {})) {
      checks[k] = !!(v || checks[k]); // true wins
    }
    const manual = { ...(a.manual || {}), ...(b.manual || {}) };
    const score = Math.max(
      0,
      Math.min(100, Math.max(Number(a.score || 0), Number(b.score || 0)))
    );

    next.lessons[id] = {
      version: 1,
      attempts,
      errors,
      checks,
      score,
      manual,
      completed: false,
      stars: Math.max(0, Math.min(3, Number(stars || 0))),
      lastUpdated: nowIso,
    };
  }

  // Recompute completion and stars like writeLesson would do
  const recomputed = { ...next, lessons: { ...next.lessons } };
  for (const [id, st] of Object.entries(recomputed.lessons)) {
    const derived = computeDerivedCompletion(st, id);
    const computedStars = computeStars(st, id);
    const nextStars = applyMonotonicStars(st.stars, computedStars, st.manual?.stars);
    st.completed = st.manual?.completed === true ? true : derived.completed;
    st.stars = nextStars;
    st.lastUpdated = nowIso;
  }

  return persistBadges(recomputed);
}

function migrateToV1(oldObj) {
  // Altes Schema: { [id]: { completed, stars } }
  // Neues Schema: { version: 'v1', lessons: { [id]: {completed, stars, attempts, errors, lastUpdated, checks, score, version: 1} }, badges?: string[] }
  if (!oldObj || typeof oldObj !== 'object') return { version: PROGRESS_VERSION, lessons: {}, badges: [] };
  if (oldObj.version === PROGRESS_VERSION && oldObj.lessons) return { badges: [], ...oldObj };

  const lessons = {};
  for (const [k, v] of Object.entries(oldObj)) {
    if (!v || typeof v !== 'object') continue;
    const stars = Math.max(0, Math.min(3, Number(v.stars || 0)));
    const completed = !!v.completed;
    lessons[k] = {
      version: 1,
      completed,
      stars,
      attempts: 0,
      errors: 0,
      lastUpdated: new Date().toISOString(),
      checks: {},
      score: typeof v.score === 'number' ? v.score : undefined,
      manual: { completed, stars },
    };
  }
  return { version: PROGRESS_VERSION, lessons, badges: [] };
}

export function readProgressV1() {
  const raw = readRaw();
  if (!raw) return { version: PROGRESS_VERSION, lessons: {}, badges: [] };
  if (raw.version === PROGRESS_VERSION && raw.lessons) return { badges: raw.badges || [], ...raw };
  const migrated = migrateToV1(raw);
  // Schreibe migriertes Schema sofort zurück (best effort)
  writeRaw(migrated);
  return migrated;
}

export function getFlattenedProgress() {
  const p = readProgressV1();
  const flat = {};
  for (const [id, st] of Object.entries(p.lessons || {})) {
    flat[id] = { completed: !!st.completed, stars: Math.max(0, Math.min(3, Number(st.stars || 0))) };
  }
  return flat;
}

function lessonType(id) { return LESSON_TYPE[id] || 'theory'; }

function computeDerivedCompletion(state, id) {
  const type = lessonType(id);
  const score = Number(state.score || 0);
  const checks = state.checks || {};
  const required = REQUIRED_CHECKS[id] || [];

  const checksTrueCount = Object.values(checks).filter(Boolean).length;
  const hasAllRequired = required.length === 0 ? true : required.every((c) => !!checks[c]);
  const hasAnyPractice = checksTrueCount > 0;

  let completed = false;
  if (type === 'theory') {
    completed = score >= 80;
  } else if (type === 'practice') {
    completed = hasAllRequired;
  } else { // mixed
    completed = (score >= 60) && hasAnyPractice;
  }

  return { completed, hasAllRequired, checksTrueCount };
}

function computeStars(state, id) {
  const type = lessonType(id);
  const score = Number(state.score || 0);
  const errors = Number(state.errors || 0);
  const { completed, hasAllRequired } = computeDerivedCompletion(state, id);
  if (!completed) return 0;

  // 3 Sterne: Abschluss ohne Fehler, alle Teilziele, Quiz >= 90 % (wenn vorhanden)
  const hasQuiz = (type === 'theory' || type === 'mixed');
  const quizOk90 = !hasQuiz || score >= 90;
  if (quizOk90 && errors === 0 && (type !== 'practice' || hasAllRequired)) {
    return 3;
  }

  // 2 Sterne: Abschluss mit einem Fehler-Retry ODER Quiz 80–89 %
  const quiz80to89 = hasQuiz && score >= 80 && score < 90;
  if (errors === 1 || quiz80to89) {
    return 2;
  }

  // 1 Stern: Mindestabschluss (unter 80 % oder ≥ 2 Retries)
  return 1;
}

function applyMonotonicStars(prevStars, nextStars, manualStars) {
  return Math.max(0, Math.min(3, Math.max(prevStars || 0, nextStars || 0, manualStars || 0)));
}

function computeBadgesInternal(v1) {
  const lessons = v1.lessons || {};
  const getStars = (id) => Math.max(0, Math.min(3, Number(lessons[id]?.stars || 0)));

  const chapters = {};
  for (const [chap, ids] of Object.entries(CHAPTERS)) {
    const ok = ids.length > 0 && ids.every((lid) => getStars(lid) >= 2);
    chapters[chap] = ok;
  }

  // Final-Badge: alle Lektionen ≥ 2 Sterne ODER Schnitt ≥ 2,3 und keine offenen Praxischecks
  const idsAll = Object.keys(lessons);
  let avg = 0;
  if (idsAll.length) {
    avg = idsAll.reduce((s, id) => s + getStars(id), 0) / idsAll.length;
  }
  const allGe2 = idsAll.length > 0 && idsAll.every((id) => getStars(id) >= 2);
  const anyOpenPractice = idsAll.some((id) => {
    if (lessonType(id) !== 'practice') return false;
    const req = REQUIRED_CHECKS[id] || [];
    const st = lessons[id] || {};
    const checks = st.checks || {};
    return req.some((c) => !checks[c]);
  });
  const pro = (allGe2 || (avg >= 2.3 && !anyOpenPractice));

  const ids = [];
  if (chapters.grundlagen) ids.push(BADGE_IDS.chapter_grundlagen);
  if (chapters.sicherheit) ids.push(BADGE_IDS.chapter_sicherheit);
  if (chapters.praxis) ids.push(BADGE_IDS.chapter_praxis);
  if (pro) ids.push(BADGE_IDS.master);

  const map = Object.fromEntries(ids.map((b) => [b, true]));
  return { ids, map, chapters, pro };
}

function persistBadges(nextObj) {
  const { ids } = computeBadgesInternal(nextObj);
  const withBadges = { ...nextObj, badges: ids };
  writeRaw(withBadges);
  return withBadges;
}

function writeLesson(id, patch) {
  const cur = readProgressV1();
  const prev = cur.lessons[id] || {
    version: 1,
    completed: false,
    stars: 0,
    attempts: 0,
    errors: 0,
    lastUpdated: new Date().toISOString(),
    checks: {},
    score: 0,
    manual: {},
  };
  const merged = { ...prev, ...patch, checks: { ...(prev.checks || {}), ...(patch.checks || {}) }, manual: { ...(prev.manual || {}), ...(patch.manual || {}) } };

  // Ableitung: completed und Sterne nach Regeln ermitteln, Sterne monoton
  const derived = computeDerivedCompletion(merged, id);
  const computedStars = computeStars(merged, id);
  const nextStars = applyMonotonicStars(prev.stars, computedStars, merged.manual?.stars);

  merged.completed = merged.manual?.completed === true ? true : derived.completed;
  merged.stars = nextStars;
  merged.lastUpdated = new Date().toISOString();

  const next = { ...cur, lessons: { ...cur.lessons, [id]: merged } };
  return persistBadges(next);
}

export function setManualStars(id, stars) {
  const s = Math.max(0, Math.min(3, Number(stars || 0)));
  const next = writeLesson(id, { manual: { stars: s } });
  return { v1: next, flat: getFlattenedProgress() };
}

export function toggleManualCompleted(id) {
  const cur = readProgressV1();
  const prev = cur.lessons[id] || {};
  const nextManual = { completed: !(prev.manual?.completed === true) };
  const next = writeLesson(id, { manual: nextManual });
  return { v1: next, flat: getFlattenedProgress() };
}

export function recordQuizResult(id, { score, answersHash, aborted } = {}) {
  const prev = readProgressV1().lessons[id] || {};
  const prevHash = prev.lastHashes?.quiz || '';
  const idempotent = answersHash && prevHash && answersHash === prevHash && prev.score === score;
  const incAttempt = 1;
  const incError = aborted ? 1 : 0;
  const patch = {
    attempts: Math.max(0, Number(prev.attempts || 0)) + incAttempt,
    errors: Math.max(0, Number(prev.errors || 0)) + incError,
    score: Math.max(0, Math.min(100, Number(score || 0))),
    lastHashes: { ...(prev.lastHashes || {}), quiz: answersHash || prevHash },
  };
  if (idempotent) {
    // keine Doppelbewertung
    patch.attempts = prev.attempts || 0;
    patch.errors = prev.errors || 0;
  }
  const next = writeLesson(id, patch);
  return { v1: next, flat: getFlattenedProgress(), idempotent };
}

// Praxisprüfungen (Testnet). Rückgabe enthält Status und optionale Detail-Info.
export async function recordPracticeCheck(id, checkId, params = {}, t /* i18n */) {
  // Offline? → Pending markieren
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    const next = writeLesson(id, { pending: { [checkId]: true } });
    return {
      status: 'pending',
      message: (t && typeof t === 'function') ? t('learn:offline.waitingForValidation', 'Waiting for connection to validate…') : 'Waiting for connection to validate…',
      v1: next,
      flat: getFlattenedProgress(),
    };
  }

  const server = getHorizonServer('https://horizon-testnet.stellar.org');
  let ok = false;
  let detail = '';

  try {
    if (checkId === 'accountActivated') {
      const acc = await getAccountSummary(params.accountId, server);
      ok = !!acc && typeof acc.sequence !== 'undefined';
      detail = ok ? 'account_found' : 'not_found';
    } else if (checkId === 'trustline') {
      const { accountId, assetCode, assetIssuer } = params;
      const tls = await loadTrustlines(accountId, server);
      ok = (tls || []).some((a) => a.assetCode === assetCode && a.assetIssuer === assetIssuer);
      detail = ok ? 'trustline_present' : 'trustline_missing';
    } else if (checkId === 'payment') {
      const { accountId, memoIncludes } = params;
      if (!memoIncludes || !accountId) throw new Error('learn.missingParams');
      const total = await sumIncomingXLMByMemo({ server, accountId, memoQuery: String(memoIncludes), limitPerPage: 100 });
      ok = total > 0;
      detail = ok ? 'payment_received' : 'payment_not_found';
    } else {
      throw new Error('learn.validationFailed');
    }
  } catch (e) {
    const key = String(e?.message || 'learn.validationFailed');
    const msg = (t && typeof t === 'function') ? t(`errors:${key}`, 'Validation failed') : 'Validation failed';
    const next0 = readProgressV1();
    const next = writeLesson(id, { attempts: (next0.lessons[id]?.attempts || 0) + 1, errors: (next0.lessons[id]?.errors || 0) + 1 });
    return { status: 'error', message: msg, detail: key, v1: next, flat: getFlattenedProgress() };
  }

  // Idempotenz: bereits true → nicht doppelt zählen
  const prev = readProgressV1().lessons[id] || {};
  const wasTrue = !!prev.checks?.[checkId];
  const patch = {
    attempts: Math.max(0, Number(prev.attempts || 0)) + (wasTrue ? 0 : 1),
    errors: Math.max(0, Number(prev.errors || 0)),
    checks: { [checkId]: !!ok },
  };
  const next = writeLesson(id, patch);
  const message = ok
    ? ((t && typeof t === 'function') ? t('learn:status.success', 'Success') : 'Success')
    : ((t && typeof t === 'function') ? t('learn:status.validation', 'Validation error') : 'Validation error');

  return { status: ok ? 'success' : 'partial', message, detail, v1: next, flat: getFlattenedProgress(), idempotent: wasTrue };
}

export function computeBadges(v1 = readProgressV1()) {
  return computeBadgesInternal(v1);
}

export function getBadges() {
  const v1 = readProgressV1();
  const res = computeBadgesInternal(v1);
  // Synchronisiere persistierte IDs, falls abweichend (best-effort)
  if (Array.isArray(v1.badges)) {
    const same = v1.badges.length === res.ids.length && v1.badges.every((x, i) => res.ids[i] === x);
    if (!same) writeRaw({ ...v1, badges: res.ids });
  } else {
    writeRaw({ ...v1, badges: res.ids });
  }
  return res;
}
