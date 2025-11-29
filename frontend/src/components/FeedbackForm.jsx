import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openMailto } from '../utils/openMailto.js';
import { apiUrl } from '../utils/apiBase.js';

/**
 * FeedbackForm: Öffnet den E-Mail-Client über mailto: bzw. Backend-Compose (DEV/Linux)
 * und erstellt parallel still einen Eintrag im Bugtracker.
 */
export default function FeedbackForm(props) {
  const { t } = useTranslation(['common']);
  const [desc, setDesc] = useState('');

  function buildMailto() {
    const to = import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.org';
    const subjectText = t('common:bugReport.title');
    const lines = [
      `URL: ${window.location.href}`,
      `Zeit: ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
      `Sprache: ${navigator.language}`,
      desc ? `Beschreibung: ${desc}` : '',
    ].filter(Boolean);
    const bodyText = lines.join('\n');
    return {
      to,
      subject: subjectText,
      body: bodyText,
      href: `mailto:${to}?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(bodyText)}`,
    };
  }

  async function sendSilentLog() {
    try {
      const payload = {
        url: window.location.href,
        userAgent: navigator.userAgent,
        language: navigator.language,
        description: desc || '',
        ts: new Date().toISOString(),
        appVersion: import.meta.env.VITE_APP_VERSION ?? null,
        status: 'open',
        priority: 'normal',
      };
      const json = JSON.stringify(payload);
      const blob = new Blob([json], { type: 'application/json' });
      const endpoint = apiUrl('bugreport');
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, blob);
      } else {
        await fetch(endpoint, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: json,
        });
      }
    } catch (error) {
      console.warn('bugReport.send.failed', error);
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    try {
      const mail = buildMailto();
      const isLikelyLinuxDesktop = navigator.platform?.toLowerCase?.().includes('linux');
      const allowBackendCompose = Boolean(isLikelyLinuxDesktop && import.meta.env.DEV);

      await openMailto({
        to: mail.to,
        subject: mail.subject,
        body: mail.body,
        mailtoHref: mail.href,
        forceBackendCompose: allowBackendCompose,
      });

      void sendSilentLog();
      props.onInfo?.(t('common:bugReport.toast.sent'));
    } catch (err) {
      throw new Error('bugReport.mailto.failed:' + (err?.message || 'unknown'));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-sm font-medium">
        {t('common:bugReport.descLabel')}
      </label>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder={t('common:bugReport.descPlaceholder')}
        className="w-full rounded border p-2"
        rows={4}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          title={t('common:bugReport.send')}
        >
          {t('common:bugReport.send')}
        </button>
        <button
          type="button"
          onClick={() => props.onCancel?.()}
          className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t('common:bugReport.cancel')}
        >
          {t('common:bugReport.cancel')}
        </button>
      </div>
    </form>
  );
}
