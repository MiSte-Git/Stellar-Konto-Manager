import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FEEDBACK_EMAIL } from '../config.js';
import { openMailto } from '../utils/openMailto.js';

// Renders the feedback page allowing users to send issues via email.
export default function FeedbackPage({ onBack }) {
  const { t, i18n } = useTranslation();
  void i18n;
  const [category, setCategory] = useState('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [notices, setNotices] = useState([]);
  const subjectInputRef = useRef(null);

  const emailTo = useMemo(() => FEEDBACK_EMAIL || 'support@example.com', []);

  const canSend = subject.trim().length > 0 && message.trim().length > 0;

  // Builds the support mail payload including contextual information.
  const buildMailPayload = useCallback(() => {
    const lines = [];
    lines.push(`Kategorie: ${t(`feedback.categories.${category}`)}`);
    lines.push('');
    lines.push('Nachricht:');
    lines.push(message.trim());
    lines.push('');
    lines.push('---');
    lines.push('App: Stellar Trustline Manager');
    try { lines.push(`URL: ${window.location.href}`); } catch { /* noop */ }
    try { lines.push(`Browser: ${navigator.userAgent}`); } catch { /* noop */ }
    const subj = `[STM Feedback] ${t(`feedback.categories.${category}`)}: ${subject.trim()}`;
    const body = lines.join('\r\n');
    return { subject: subj, body };
  }, [category, message, subject, t]);

  const buildMailto = useCallback(() => {
    const { subject: subj, body } = buildMailPayload();
    const href = `mailto:${emailTo}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
    return { href, subject: subj, body };
  }, [buildMailPayload, emailTo]);

  // Sends the bug report payload to the backend via beacon/fetch.
  const logBugReport = useCallback((description) => {
    try {
      const payload = {
        url: window.location.href,
        userAgent: navigator.userAgent,
        language: navigator.language,
        description,
        ts: new Date().toISOString(),
        appVersion: import.meta.env.VITE_APP_VERSION ?? null,
        status: 'open',
        priority: 'normal'
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const beaconSupported = typeof navigator.sendBeacon === 'function';
      const sent = beaconSupported ? navigator.sendBeacon('/api/bugreport', blob) : false;
      if (!sent) {
        return fetch('/api/bugreport', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then((res) => {
          if (!res.ok) {
            throw new Error(`status_${res.status}`);
          }
        });
      }
      return Promise.resolve();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      return Promise.reject(new Error('bugReport.send.failed:' + detail));
    }
  }, []);

  // Handles sending the feedback mail and logging to the backend.
  const handleSend = useCallback(async () => {
    try {
      setNotices([t('bugReport.toast.sent')]);
      const { href, subject: subj, body } = buildMailto();
      await openMailto({
        to: emailTo,
        subject: subj,
        body,
        mailtoHref: href,
        forceBackendCompose: true,
      });
      const description = [
        `Kategorie: ${t(`feedback.categories.${category}`)}`,
        message.trim()
      ].filter(Boolean).join('\n');
      try {
        await logBugReport(description);
        setNotices((prev) => [...prev, t('bugReport.toast.logOk')]);
      } catch (err) {
        console.error(err);
        setNotices((prev) => [...prev, t('bugReport.toast.logFallback')]);
      }
    } catch (e) {
      setNotices([t('feedback.error') + ': ' + (e?.message || '')]);
    }
  }, [buildMailto, category, emailTo, logBugReport, message, t]);

  // Focuses the feedback form when Alt+B is pressed.
  useEffect(() => {
    const handler = (event) => {
      if (event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        subjectInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-3">
        <h2 className="text-xl font-semibold">{t('feedback.title')}</h2>
      </div>
      {notices.length > 0 && (
        <div className="mb-3 space-y-1">
          {notices.map((msg, idx) => (
            <div key={idx} className="text-sm bg-green-100 dark:bg-green-900/30 border border-green-300/60 text-green-800 dark:text-green-200 rounded p-2">{msg}</div>
          ))}
        </div>
      )}
      <div className="bg-white dark:bg-gray-800 border rounded p-4 space-y-3">
        <div>
          <label className="block text-sm mb-1">{t('feedback.category')}</label>
          <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={category} onChange={(e)=>setCategory(e.target.value)}>
            <option value="bug">{t('feedback.categories.bug')}</option>
            <option value="idea">{t('feedback.categories.idea')}</option>
            <option value="improve">{t('feedback.categories.improve')}</option>
            <option value="other">{t('feedback.categories.other')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">{t('feedback.subject')}</label>
          <input ref={subjectInputRef} className="border rounded w-full px-2 py-1 text-base md:text-sm" value={subject} onChange={(e)=>setSubject(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">{t('feedback.message')}</label>
          <textarea className="border rounded w-full px-2 py-1 text-base md:text-sm min-h-[160px]" value={message} onChange={(e)=>setMessage(e.target.value)} />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onBack}>{t('option.cancel')}</button>
          <button className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!canSend} onClick={handleSend}>{t('feedback.sendButton')}</button>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          {t('feedback.sentTo', { email: emailTo })}
        </div>
      </div>
    </div>
  );
}
