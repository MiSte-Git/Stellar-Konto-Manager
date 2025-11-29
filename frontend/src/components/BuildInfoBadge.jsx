import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Zeigt Build-Informationen (Commit/Branch/Umgebung) aus build-info.json.
 * Holt die Datei aus dem Build-Output und zeigt sie kompakt an.
 * Alle Texte werden über i18n t() gesteuert.
 */
export default function BuildInfoBadge() {
  const { t } = useTranslation(['common']);
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const url = `${import.meta.env.BASE_URL}build-info.json`; // Subfolder-sicher
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('loadFailed:' + res.status);
        const data = await res.json();
        setInfo(data);
      } catch (e) {
        setErr(e.message || 'unknown');
        // UI-Komponente fängt den Fehler ab und übersetzt ihn mit t()
        throw new Error('buildInfo.loadFailed:' + (e.message || 'unknown'));
      }
    })();
  }, []);

  if (err) return <div className="text-xs text-red-600">{t('common:buildInfo.error')}</div>;
  if (!info) return <div className="text-xs opacity-60">{t('common:buildInfo.loading')}</div>;

  const short = info.commit?.slice(0, 7);
  return (
    <div className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">
      {t('common:buildInfo.env')}: {info.environment} · {t('common:buildInfo.commit')}: {short} · {t('common:buildInfo.branch')}: {info.branch}
    </div>
  );
}
