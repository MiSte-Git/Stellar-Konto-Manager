/**
 * Quiz navigation helpers – ordered list of all quiz IDs and
 * functions to navigate between them.
 */

export const QUIZ_ORDER = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'multisig',
];

/**
 * Normalise any lesson-id variant ("L3", "3", "lesson3", "multisig") to the
 * canonical id used in QUIZ_ORDER.
 */
function normalise(id) {
  const s = String(id ?? '').trim().toLowerCase();
  if (s === 'multisig') return 'multisig';
  const digits = s.replace(/[^0-9]/g, '');
  return digits || null;
}

/** Next quiz id or `null` when already at the last quiz. */
export function getNextQuizId(currentId) {
  const key = normalise(currentId);
  if (!key) return null;
  const idx = QUIZ_ORDER.indexOf(key);
  if (idx === -1 || idx >= QUIZ_ORDER.length - 1) return null;
  return QUIZ_ORDER[idx + 1];
}

/** Previous quiz id or `null` when already at the first quiz. */
export function getPrevQuizId(currentId) {
  const key = normalise(currentId);
  if (!key) return null;
  const idx = QUIZ_ORDER.indexOf(key);
  if (idx <= 0) return null;
  return QUIZ_ORDER[idx - 1];
}

/** 0-based index inside QUIZ_ORDER, or -1 if not found. */
export function getQuizIndex(currentId) {
  const key = normalise(currentId);
  if (!key) return -1;
  return QUIZ_ORDER.indexOf(key);
}

/** Total number of quizzes. */
export function getTotalQuizCount() {
  return QUIZ_ORDER.length;
}
