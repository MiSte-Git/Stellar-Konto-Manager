import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FEEDBACK_EMAIL } from '../config.js';
import { openMailto } from '../utils/openMailto.js';
import { apiUrl } from '../utils/apiBase.js';
import { useSettings } from '../utils/useSettings.js';

// Renders the feedback page allowing users to send issues via email.
export default function FeedbackPage({ onBack }) {
  const { t, i18n } = useTranslation(['common', 'menu']);
  void i18n;
  const { feedbackCategories = [], feedbackAreas = [] } = useSettings();
  const [category, setCategory] = useState(() => feedbackCategories[0]?.id || '');
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
      if (s.includes('multisig')) return 'createAccount';
      if (s.includes('settings')) return 'settings';
      if (s.includes('feedback')) return 'feedback';
      return 'other';
    } catch {
      return 'other';
    }
  }, []);
  const [areaId, setAreaId] = useState(() => feedbackAreas[0]?.id || defaultPage);

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

  const canSend = subject.trim().length > 0 && message.trim().length > 0 && Boolean(category) && Boolean(areaId);

  // Resolves a feedback category id to a translated label (falls back to the id if unknown).
  const getCategoryLabel = (id) => {
    if (!id) return '';
    const cat = (feedbackCategories || []).find((c) => c.id === id);
    if (!cat) return id;
    if (cat.labelKey) return t(cat.labelKey, cat.fallback || cat.id);
    return cat.label || cat.id;
  };

  // Resolves a feedback area value to a translated label (falls back to the value if unknown).
  const getAreaLabel = (value) => {
    if (!value) return '';
    const opt = (feedbackAreas || []).find((a) => a.id === value);
    if (opt?.labelKey) return t(opt.labelKey, opt.fallback || opt.value);
    return value;
  };

  // Keeps selected category/area in sync with current lists and resets invalid selections.
  React.useEffect(() => {
    if (category && feedbackCategories.some((c) => c.id === category)) return;
    setCategory(feedbackCategories[0]?.id || '');
  }, [category, feedbackCategories]);

  React.useEffect(() => {
    if (areaId && feedbackAreas.some((c) => c.id === areaId)) return;
    if (!areaId && defaultPage && feedbackAreas.some((c) => c.id === defaultPage)) {
      setAreaId(defaultPage);
      return;
    }
    setAreaId(feedbackAreas[0]?.id || '');
  }, [areaId, feedbackAreas, defaultPage]);

  // Resets all form fields back to their initial state for quick successive entries.
  const handleClearForm = () => {
    setCategory(feedbackCategories[0]?.id || '');
    setAreaId(feedbackAreas.some((c) => c.id === defaultPage) ? defaultPage : (feedbackAreas[0]?.id || ''));
    setSubject('');
    setMessage('');
    setContactEmail('');
    subjectInputRef.current?.focus();
  };

  // Builds the support mail payload including contextual information.
  const buildMailPayload = useCallback(() => {
    const lines = [];
    const categoryLabel = getCategoryLabel(category) || t('common:feedback.categoryUnknown');
    const areaLabel = getAreaLabel(areaId) || t('common:feedback.areaUnknown');
    lines.push(`Kategorie: ${categoryLabel}`);
    lines.push(`Bereich: ${areaLabel}`);
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
    const subj = `[SKM Feedback] ${categoryLabel}: ${subject.trim()}`;
    const body = lines.join('\r\n');
    return { subject: subj, body };
  }, [category, message, subject, t, reportToken, contactEmail, areaId, feedbackAreas, feedbackCategories]);

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
        page: areaId,
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
  }, [category, reportToken, contactEmail, areaId]);

  // Handles sending the feedback mail only (no backend bugtracker).
  const handleSend = useCallback(async () => {
    try {
      setNotices([t('common:bugReport.toast.sent')]);
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
      setNotices([t('common:feedback.error') + ': ' + (e?.message || '')]);
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
        <h2 className="text-xl font-semibold">{t('common:feedback.title')}</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
          {t('common:feedback.form.multiEntryHint')}
        </p>
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
          <label className="block text-sm mb-1">{t('common:feedback.category')}</label>
          {feedbackCategories.length ? (
            <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={category} onChange={(e)=>setCategory(e.target.value)}>
              <option value="">{t('common:feedback.categoryPlaceholder')}</option>
              {feedbackCategories.map((c) => (
                <option key={c.id} value={c.id}>{getCategoryLabel(c.id)}</option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-400">{t('common:feedback.noCategoriesConfigured')}</div>
          )}
        </div>
        <div>
          <label className="block text-sm mb-1">{t('common:feedback.area')}</label>
          {feedbackAreas.length ? (
            <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={areaId} onChange={(e)=>setAreaId(e.target.value)}>
              <option value="">{t('common:feedback.areaPlaceholder')}</option>
              {feedbackAreas.map((c) => (
                <option key={c.id} value={c.id}>{getAreaLabel(c.id) || c.id}</option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-400">{t('common:feedback.noAreasConfigured')}</div>
          )}
        </div>
        <div>
          <label className="block text-sm mb-1">{t('common:feedback.subject')}</label>
          <input ref={subjectInputRef} className="border rounded w-full px-2 py-1 text-base md:text-sm" value={subject} onChange={(e)=>setSubject(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">{t('common:feedback.message')}</label>
          <textarea className="border rounded w-full px-2 py-1 text-base md:text-sm min-h-[160px]" value={message} onChange={(e)=>setMessage(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm mb-1">{t('common:feedback.contactEmailOptional', 'Email (optional)')}</label>
          <input
            type="email"
            className="border rounded w-full px-2 py-1 text-base md:text-sm"
            value={contactEmail}
            onChange={(e)=>setContactEmail(e.target.value)}
            placeholder={t('common:feedback.emailPlaceholder', 'e.g. name@example.com')}
          />
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {t('common:feedback.emailHint', 'Optional: If you want a reply, add your email.')}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            className="px-3 py-1 rounded border text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
            type="button"
            onClick={handleClearForm}
          >
            {t('common:feedback.form.clearButton')}
          </button>
          <button className="px-3 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onBack}>{t('common:option.cancel')}</button>
          <button className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!canSend} onClick={handleSend}>{t('common:feedback.sendButton')}</button>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          {t('common:feedback.sentTo', { email: emailTo })}
        </div>
      </div>
    </div>
  );
}
