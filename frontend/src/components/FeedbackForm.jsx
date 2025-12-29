import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiUrl } from '../utils/apiBase.js';

/**
 * FeedbackForm: Schreibt das Feedback direkt in den Bugtracker (kein Mailto).
 */
export default function FeedbackForm(props) {
  const { t } = useTranslation(['common']);
  const [desc, setDesc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitBugReport() {
    const description = (desc || '').trim();
    const title = description || t('common:bugReport.title');
    try {
      const payload = {
        url: window.location.href,
        userAgent: navigator.userAgent,
        language: navigator.language,
        subject: title,
        description,
        appVersion: import.meta.env.VITE_APP_VERSION ?? null,
        status: 'open',
        priority: 'normal',
        page: 'feedback',
      };
      const endpoints = ['bugreport.php', 'bugreport'];
      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          const res = await fetch(apiUrl(endpoint), {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          let data = null;
          try { data = await res.json(); } catch { data = null; }
          if (res.ok && data?.ok !== false) return;
          lastError = new Error(data?.error || `status_${res.status}`);
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError) throw lastError;
      throw new Error('bugreport.unknown');
    } catch (error) {
      console.warn('bugReport.send.failed', error);
      throw error;
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (isSubmitting) return;
    try {
      setIsSubmitting(true);
      await submitBugReport();
      setDesc('');
      props.onInfo?.(t('common:bugReport.toast.logOk'));
    } catch (err) {
      props.onError?.(err);
      throw new Error('bugReport.submit.failed:' + (err?.message || 'unknown'));
    } finally {
      setIsSubmitting(false);
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
        disabled={isSubmitting}
        title={t('common:bugReport.send')}
      >
        {isSubmitting ? t('common:main.processing', 'Bitte warten…') : t('common:bugReport.send')}
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
