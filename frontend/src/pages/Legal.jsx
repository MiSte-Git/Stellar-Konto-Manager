import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export default function Legal() {
  const { t, i18n } = useTranslation('legal');
  const navigate = useNavigate();
  const buildDateRaw = import.meta.env.VITE_BUILD_DATE;
  let formattedBuildDate;

  if (buildDateRaw) {
    const parsed = new Date(buildDateRaw);
    if (!isNaN(parsed.getTime())) {
      const locale = i18n.language || 'de-CH';
      formattedBuildDate = new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(parsed);
    }
  }

  const fallbackDate = t('meta.lastUpdated.fallbackDate');
  const displayDate = formattedBuildDate || fallbackDate || '–';
  const fromI18n = t('lastUpdated', { date: displayDate });
  const lastUpdatedText =
    fromI18n && fromI18n.trim().length > 0
      ? fromI18n
      : `Zuletzt aktualisiert: ${displayDate}`;

  console.log('[Legal Debug]', { buildDate: formattedBuildDate, fallbackDate, displayDate, fromI18n });

  const addressLines = t('imprint.addressLines', { returnObjects: true }) || [];
  const disclaimerLines = t('disclaimer.body', { returnObjects: true }) || [];
  const privacySections = t('privacy.sections', { returnObjects: true }) || [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <header className="space-y-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 px-3 py-1 text-sm font-semibold"
        >
          ← {t('backToApp')}
        </button>
        <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('subtitle')}</p>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          {lastUpdatedText}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{t('imprint.title')}</h2>
        <p className="text-sm">
          <span className="font-semibold">{t('imprint.providerLabel')}</span>{' '}
          {t('imprint.providerName')}
        </p>
        <div className="text-sm">
          <div className="font-semibold">{t('imprint.addressLabel')}</div>
          <div className="space-y-0.5">
            {addressLines.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </div>
        </div>
        <p className="text-sm">
          <span className="font-semibold">{t('imprint.emailLabel')}</span>{' '}
          {t('imprint.email')}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{t('disclaimer.title')}</h2>
        <div className="space-y-2 text-sm">
          {disclaimerLines.map((line, idx) => (
            <p key={idx}>{line}</p>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t('privacy.title')}</h2>
        <p className="text-sm">{t('privacy.intro')}</p>
        <div className="space-y-3 text-sm">
          {privacySections.map((section, idx) => (
            <div key={idx} className="space-y-1">
              <div className="font-semibold">{section.title}</div>
              {(section.body || []).map((line, innerIdx) => (
                <p key={innerIdx}>{line}</p>
              ))}
            </div>
          ))}
        </div>
      </section>

      <footer className="text-sm text-gray-600 dark:text-gray-300" />
    </div>
  );
}
