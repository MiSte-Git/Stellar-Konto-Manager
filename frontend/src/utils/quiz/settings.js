import { getPerQuizSettings, setPerQuizSettings } from './storage.js';

export function getQuizSettings(lessonId) {
  return getPerQuizSettings(lessonId);
}

export function setQuizSettings(lessonId, settings) {
  return setPerQuizSettings(lessonId, settings);
}
