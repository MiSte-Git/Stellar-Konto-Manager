#!/usr/bin/env node
// Sync learn keys from lessons.json into locales/de.json (reference) and mirror to locales/de/learn.json
// - de.json is the reference; add missing learn.lesson{N}.* keys from lessons.json
// - do not overwrite existing different values; log differences
// - mirror the learn subtree from de.json to de/learn.json (do not overwrite differences)
// - optionally create/update locales/<lang>/learn.json for other languages based on the German reference

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../');

const deMainPath = path.join(root, 'frontend/src/locales/de.json');
const deLearnPath = path.join(root, 'frontend/src/locales/de/learn.json');
const lessonsPath = path.join(root, 'frontend/src/data/learn/lessons.json');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
function deepMergeMissing(target, source, diffs, parent = '') {
  // copy only missing keys; track differences without overwriting
  Object.entries(source || {}).forEach(([k, v]) => {
    const keyPath = parent ? `${parent}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMergeMissing(target[k], v, diffs, keyPath);
    } else {
      if (!(k in target)) {
        target[k] = v;
      } else if (target[k] !== v) {
        diffs.push({ key: keyPath, from: target[k], to: v });
      }
    }
  });
}

function main() {
  // 1) Build learn subtree from lessons.json
  let lessons = [];
  try { lessons = JSON.parse(fs.readFileSync(lessonsPath, 'utf8')); } catch (e) {
    console.error(`[sync-learn] Unable to read lessons at ${lessonsPath}:`, e.message);
    process.exit(1);
  }
  const learnFromLessons = {};
  for (const l of lessons) {
    const id = l.id; // e.g., lesson1
    if (!id || typeof id !== 'string') continue;
    learnFromLessons[id] = {
      title: l.title ?? '',
      goal: l.goal ?? '',
      task: l.task ?? '',
      learningOutcome: l.learningOutcome ?? '',
      reward: l.reward ?? ''
    };
  }

  // 2) Apply into de.json under learn.* without overwriting existing values
  const de = readJson(deMainPath);
  const beforeDe = JSON.stringify(de);
  if (!de.learn || typeof de.learn !== 'object') de.learn = {};
  const diffsDe = [];
  deepMergeMissing(de.learn, learnFromLessons, diffsDe, 'learn');
  if (JSON.stringify(de) !== beforeDe) {
    writeJson(deMainPath, de);
    console.log(`[sync-learn] wrote ${deMainPath}`);
  } else {
    console.log('[sync-learn] de.json already contains all learn keys');
  }
  if (diffsDe.length) {
    console.warn(`[sync-learn] ${diffsDe.length} differing keys in de.json (values not overwritten)`);
  }

  // 3) Mirror learn subtree to de/learn.json without overwriting differences
  const deLearnExisting = readJson(deLearnPath);
  const deLearnNext = JSON.parse(JSON.stringify(deLearnExisting));
  const diffsDeLearn = [];
  deepMergeMissing(deLearnNext, de.learn, diffsDeLearn);
  if (JSON.stringify(deLearnExisting) !== JSON.stringify(deLearnNext)) {
    writeJson(deLearnPath, deLearnNext);
    console.log(`[sync-learn] wrote ${deLearnPath}`);
  } else {
    console.log('[sync-learn] de/learn.json up to date');
  }
  if (diffsDeLearn.length) {
    console.warn(`[sync-learn] de/learn.json has ${diffsDeLearn.length} differing keys (kept existing values)`);
  }

  // 4) Optionally mirror for other languages
  const langs = ['en', 'es', 'fr', 'it', 'nl', 'ru', 'fi', 'hr'];
  langs.forEach((lng) => {
    const p = path.join(root, `frontend/src/locales/${lng}/learn.json`);
    const existing = readJson(p);
    const next = JSON.parse(JSON.stringify(existing));
    const diffs = [];
    deepMergeMissing(next, de.learn, diffs);
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      writeJson(p, next);
      console.log(`[sync-learn] wrote ${p}`);
    }
    if (diffs.length) {
      console.warn(`[sync-learn] ${p} differs for ${diffs.length} keys (left untouched)`);
    }
  });
}

main();
