import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FEEDBACK_EMAIL } from '../config.js';

export default function FeedbackPage({ onBack }) {
  const { t, i18n } = useTranslation();
  void i18n;
  const [category, setCategory] = useState('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');

  const emailTo = useMemo(() => FEEDBACK_EMAIL || 'support@example.com', []);

  const canSend = subject.trim().length > 0 && message.trim().length > 0;

  const handleSend = () => {
    try {
      setStatus('');
      const lines = [];
      lines.push(`Kategorie: ${t(`feedback.categories.${category}`)}`);
      if (email.trim()) lines.push(`Kontakt: ${email.trim()}`);
      lines.push('');
      lines.push('Nachricht:');
      lines.push(message.trim());
      lines.push('');
      lines.push('---');
      lines.push(`App: Stellar Trustline Manager`);
      try { lines.push(`URL: ${window.location.href}`); } catch { /* noop */ }
      try { lines.push(`Browser: ${navigator.userAgent}`); } catch { /* noop */ }
      const subj = `[STM Feedback] ${t(`feedback.categories.${category}`)}: ${subject.trim()}`;
      const body = lines.join('\n');
      const href = `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
      window.location.href = href;
      setStatus(t('feedback.openedMailClient'));
    } catch (e) {
      setStatus(t('feedback.error') + ': ' + (e?.message || ''));
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">{t('feedback.title')}</h2>
        <button className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onBack}>{t('navigation.backToMainMenu')}</button>
      </div>
      {status && (
        <div className="mb-3 text-sm bg-green-100 dark:bg-green-900/30 border border-green-300/60 text-green-800 dark:text-green-200 rounded p-2">{status}</div>
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
          <input className="border rounded w-full px-2 py-1 text-base md:text-sm" value={subject} onChange={(e)=>setSubject(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">{t('feedback.message')}</label>
          <textarea className="border rounded w-full px-2 py-1 text-base md:text-sm min-h-[160px]" value={message} onChange={(e)=>setMessage(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">{t('feedback.contactEmailOptional')}</label>
          <input type="email" className="border rounded w-full px-2 py-1 text-base md:text-sm" placeholder="you@example.com" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t('feedback.privacyHint')}</div>
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
