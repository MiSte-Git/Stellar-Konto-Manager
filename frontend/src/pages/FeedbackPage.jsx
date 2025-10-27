import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FEEDBACK_EMAIL } from '../config.js';
import { openMailto } from '../utils/openMailto.js';
import { apiUrl } from '../utils/apiBase.js';

// Renders the feedback page allowing users to send issues via email.
export default function FeedbackPage({ onBack }) {
  const { t, i18n } = useTranslation();
  void i18n;
  const [category, setCategory] = useState('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [notices, setNotices] = useState([]);
  const [contactEmail, setContactEmail] = useState('');
  const subjectInputRef = useRef(null);

  // Try to guess the current page for better bug reports
  const defaultPage = useMemo(() => {
    try {
      const href = String(window.location?.href || '');
      const path = (window.location?.pathname || '') + (window.location?.hash || '');
      const s = (href || path).toLowerCase();
      if (s.includes('compare')) return 'trustlineCompare';
      if (s.includes('listall') || s.includes('trustline')) return 'trustlines';
      if (s.includes('balance')) return 'balance';
      if (s.includes('xlm') || s.includes('memo')) return 'xlmByMemo';
      if (s.includes('send')) return 'sendPayment';
      if (s.includes('invested')) return 'investedTokens';
      if (s.includes('multisig') && s.includes('edit')) return 'multisigEdit';
      if (s.includes('multisig')) return 'multisigCreate';
      if (s.includes('settings')) return 'settings';
      if (s.includes('feedback')) return 'feedback';
      return 'other';
    } catch {
      return 'other';
    }
  }, []);
  const [pageId, setPageId] = useState(defaultPage);

  const [reportToken] = useState(() => {
    try {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    }
  });

  const emailTo = useMemo(() => FEEDBACK_EMAIL || 'support@example.com', []);

  const canSend = subject.trim().length > 0 && message.trim().length > 0;

  // Builds the support mail payload including contextual information.
  const buildMailPayload = useCallback(() => {
    const lines = [];
    const pageLabel = (
      {
        start: t('feedback.pages.start', 'Start'),
        trustlines: t('feedback.pages.trustlines', 'Trustline(s) anzeigen'),
        trustlineCompare: t('feedback.pages.trustlineCompare', 'Trustline(s) vergleichen'),
        balance: t('feedback.pages.balance', 'Balance'),
        xlmByMemo: t('feedback.pages.xlmByMemo', 'XLM by memo'),
        sendPayment: t('feedback.pages.sendPayment', 'Send payment'),
        investedTokens: t('feedback.pages.investedTokens', 'Invested tokens'),
        multisigCreate: t('feedback.pages.multisigCreate', 'Multisig create'),
        multisigEdit: t('feedback.pages.multisigEdit', 'Multisig edit'),
        settings: t('feedback.pages.settings', 'Settings'),
        feedback: t('feedback.pages.feedback', 'Feedback'),
        other: t('feedback.pages.other', 'Other')
      }[pageId] || t('feedback.pages.other', 'Other')
    );
    lines.push(`Kategorie: ${t(`feedback.categories.${category}`)}`);
    lines.push(`Seite: ${pageLabel}`);
    lines.push('');
    lines.push('Nachricht:');
    lines.push(message.trim());
    const emailTrim = (contactEmail || '').trim();
    if (emailTrim) {
      lines.push('');
      lines.push(`Kontakt: ${emailTrim}`);
    }
    lines.push('');
    lines.push('---');
    lines.push(`Report-ID: ${reportToken}`);
    lines.push('App: Stellar Trustline Manager');
    try { lines.push(`URL: ${window.location.href}`); } catch { /* noop */ }
    try { lines.push(`Browser: ${navigator.userAgent}`); } catch { /* noop */ }
    const subj = `[STM Feedback] ${t(`feedback.categories.${category}`)}: ${subject.trim()}`;
    const body = lines.join('\r\n');
    return { subject: subj, body };
  }, [category, message, subject, t, reportToken, contactEmail, pageId]);

  const buildMailto = useCallback(() => {
    const { subject: subj, body } = buildMailPayload();
    const href = `mailto:${emailTo}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
    return { href, subject: subj, body };
  }, [buildMailPayload, emailTo]);

  // Create a silent bugtracker entry on the backend
  const logBugReport = useCallback(async (description) => {
    try {
      const payload = {
        url: window.location.href,
        userAgent: navigator.userAgent,
        language: navigator.language,
        reportToken,
        description,
        ts: new Date().toISOString(),
        appVersion: import.meta.env.VITE_APP_VERSION ?? null,
        status: 'open',
        priority: 'normal',
        category,
        page: pageId,
      };
      const emailTrim = (contactEmail || '').trim();
      if (emailTrim) payload.contactEmail = emailTrim;
      const res = await fetch(apiUrl('bugreport'), {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`status_${res.status}`);
    } catch (err) {
      console.warn('bugReport.send.failed', err);
    }
  }, [category, reportToken, contactEmail, pageId]);

  // Handles sending the feedback mail only (no backend bugtracker).
  const handleSend = useCallback(async () => {
    try {
      setNotices([t('bugReport.toast.sent')]);
      // 1) Log first to avoid browser mailto/unload cancelling the request
      const description = message.trim();
      try {
        await logBugReport(description);
      } catch (e) {
        console.warn('bugReport.log.beforeMailto.failed', e);
      }
      // 2) Open the user's mail client
      const { href, subject: subj, body } = buildMailto();
      const isLikelyLinuxDesktop = navigator.platform?.toLowerCase?.().includes('linux');
      const allowBackendCompose = Boolean(isLikelyLinuxDesktop && import.meta.env.DEV);
      await openMailto({
        to: emailTo,
        subject: subj,
        body,
        mailtoHref: href,
        forceBackendCompose: allowBackendCompose,
      });
    } catch (e) {
      setNotices([t('feedback.error') + ': ' + (e?.message || '')]);
    }
  }, [buildMailto, emailTo, t, message, logBugReport]);

  // Focuses the feedback form when Alt+B is pressed.
  React.useEffect(() => {
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
          <label className="block text-sm mb-1">{t('feedback.page', 'Seite')}</label>
          <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={pageId} onChange={(e)=>setPageId(e.target.value)}>
            <option value="start">{t('feedback.pages.start', 'Start')}</option>
            <option value="trustlines">{t('feedback.pages.trustlines', 'Trustline(s) anzeigen')}</option>
            <option value="trustlineCompare">{t('feedback.pages.trustlineCompare', 'Trustline(s) vergleichen')}</option>
            <option value="balance">{t('feedback.pages.balance', 'Balance')}</option>
            <option value="xlmByMemo">{t('feedback.pages.xlmByMemo', 'XLM by memo')}</option>
            <option value="sendPayment">{t('feedback.pages.sendPayment', 'Send payment')}</option>
            <option value="investedTokens">{t('feedback.pages.investedTokens', 'Invested tokens')}</option>
            <option value="multisigCreate">{t('feedback.pages.multisigCreate', 'Multisig create')}</option>
            <option value="multisigEdit">{t('feedback.pages.multisigEdit', 'Multisig edit')}</option>
            <option value="settings">{t('feedback.pages.settings', 'Settings')}</option>
            <option value="feedback">{t('feedback.pages.feedback', 'Feedback')}</option>
            <option value="other">{t('feedback.pages.other', 'Other')}</option>
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
        <div>
          <label className="block text-sm mb-1">{t('feedback.contactEmailOptional', 'Email (optional)')}</label>
          <input
            type="email"
            className="border rounded w-full px-2 py-1 text-base md:text-sm"
            value={contactEmail}
            onChange={(e)=>setContactEmail(e.target.value)}
            placeholder={t('feedback.emailPlaceholder', 'e.g. name@example.com')}
          />
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {t('feedback.emailHint', 'Optional: If you want a reply, add your email.')}
          </div>
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
