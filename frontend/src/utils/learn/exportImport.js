// frontend/src/utils/learn/exportImport.js
// Simple export/import helpers for Learn progress.
// Security: Only exports the learn progress (skm.learn.progress.v1) and optional practice meta.
// No secrets, no other storage keys.

import { readProgressV1, importProgressV1 } from '../learnProgress.js';

const PRACTICE_META_KEY = 'skm.learn.progress.v1.practiceMeta';


export function readPracticeMetaSafe() {
  try {
    const raw = localStorage.getItem(PRACTICE_META_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    // Only allow shallow primitives/dates numbers/strings
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch { return null; }
}

export function writePracticeMetaSafe(meta) {
  try {
    if (!meta || typeof meta !== 'object') return false;
    localStorage.setItem(PRACTICE_META_KEY, JSON.stringify(meta));
    return true;
  } catch { return false; }
}

export function buildExportData({ includePracticeMeta = false } = {}) {
  const progress = readProgressV1();
  const payload = {
    type: 'stm.learn.export',
    schema: 1,
    createdAt: new Date().toISOString(),
    progress: {
      version: progress.version,
      lessons: progress.lessons || {},
      badges: progress.badges || [],
    },
  };
  if (includePracticeMeta) {
    const meta = readPracticeMetaSafe();
    if (meta) payload.practiceMeta = meta;
  }
  return payload;
}

export function downloadJsonFile(obj, filename = 'learn-progress.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function parseLearnExport(text) {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return { ok: false, error: 'invalid_json' };
    if (data.type !== 'stm.learn.export' || data.schema !== 1) return { ok: false, error: 'invalid_format' };
    const progress = data.progress;
    if (!progress || typeof progress !== 'object' || progress.version !== 'v1') return { ok: false, error: 'invalid_progress' };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

export function summarizeExportData(data) {
  try {
    const lessons = data?.progress?.lessons || {};
    const ids = Object.keys(lessons);
    const starsSum = ids.reduce((s, id) => s + Math.max(0, Math.min(3, Number(lessons[id]?.stars || 0))), 0);
    const hasMeta = !!data.practiceMeta;
    return { countLessons: ids.length, starsSum, hasPracticeMeta: hasMeta, createdAt: data.createdAt };
  } catch { return { countLessons: 0, starsSum: 0, hasPracticeMeta: false }; }
}

// Import wrapper that also optionally imports practiceMeta
export function importLearnData(data, { strategy = 'merge', includePracticeMeta = false } = {}) {
  const incoming = data?.progress;
  if (!incoming || incoming.version !== 'v1') {
    throw new Error('learn:import.invalid');
  }
  const res = importProgressV1(incoming, strategy);
  if (includePracticeMeta && data.practiceMeta) {
    writePracticeMetaSafe(data.practiceMeta);
  }
  return res;
}
