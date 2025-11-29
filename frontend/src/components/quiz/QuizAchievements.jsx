import React from 'react';
import { useTranslation } from 'react-i18next';

function parseLessonIdFromPath(p) {
  try {
    const m = String(p || '').match(/quiz\/(\d+)\//);
    return m ? m[1] : '1';
  } catch { return '1'; }
}

import { getAchievements } from '../../utils/quiz/storage.js';

function loadAchievements(id) {
  try {
    return getAchievements(id);
  } catch { /* noop */ }
  return [];
}

export default function QuizAchievements() {
  const { t } = useTranslation(['quiz']);
  const lessonId = React.useMemo(() => parseLessonIdFromPath(typeof window !== 'undefined' ? window.location.pathname : ''), []);
  const [items, setItems] = React.useState([]);

  React.useEffect(() => {
    setItems(loadAchievements(lessonId));
  }, [lessonId]);

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-3">{t('quiz:achievements.title')}</h2>
      {(!items || items.length === 0) ? (
        <div className="text-sm text-gray-600 dark:text-gray-300">{t('quiz:achievements.none')}</div>
      ) : (
        <ul className="space-y-2">
          {items.map((a, idx) => (
            <li key={idx} className="border border-gray-200 dark:border-gray-700 rounded p-3">
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {t('quiz:achievements.badge', { name: t(`quiz:achievements.${a.id}`, a.name || a.id || String(idx + 1)) })}
              </div>
              {a.date && (
                <div className="text-xs text-gray-600 dark:text-gray-400">{t('quiz:achievements.unlockedAt', { date: a.date })}</div>
              )}
              {a.descKey && (
                <div className="text-sm text-gray-700 dark:text-gray-300 mt-1">{t(a.descKey)}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
