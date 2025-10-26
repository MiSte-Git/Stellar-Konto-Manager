import { BACKEND_URL } from '../config.js';
import { getApiBase } from './apiBase.js';

/**
 * Öffnet einen Mail-Composer via Backend-Compose-Hook (Linux) oder klassischem mailto: Fallback.
 */
export async function openMailto({
  to,
  subject = '',
  body = '',
  mailtoHref,
  forceBackendCompose = false,
}) {
  const safeTo = typeof to === 'string' ? to : '';
  const href = mailtoHref || `mailto:${encodeURIComponent(safeTo)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  // const composeBase = (BACKEND_URL || '').trim(); // unused; getApiBase handles it centrally
  // Prefer central API base resolution for consistency
  const composeUrl = `${getApiBase().replace(/\/+$/, '')}/composeMail`;

  if (forceBackendCompose && safeTo) {
    try {
      const res = await fetch(composeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: safeTo, subject, body }),
      });
      if (res.ok) {
        return;
      }
      console.warn('composeMail backend responded with', res.status);
    } catch (error) {
      console.warn('composeMail backend request failed, falling back to mailto', error);
    }
  }

  const attempts = [
    () => {
      if (typeof window === 'undefined') throw new Error('bugReport.mailto.failed:window.unavailable');
      const opened = window.open(href, '_blank', 'noopener,noreferrer');
      if (opened && typeof opened === 'object') {
        try { opened.close(); } catch { /* noop */ }
      }
    },
    () => {
      if (typeof document === 'undefined' || !document.body) {
        throw new Error('bugReport.mailto.failed:document.unavailable');
      }
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = href;
      document.body.appendChild(iframe);
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch { /* noop */ }
      }, 3000);
    },
    () => {
      if (typeof document === 'undefined' || !document.body) {
        throw new Error('bugReport.mailto.failed:document.unavailable');
      }
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.style.position = 'absolute';
      anchor.style.left = '-9999px';
      anchor.style.width = '1px';
      anchor.style.height = '1px';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      anchor.dispatchEvent(event);
      document.body.removeChild(anchor);
    },
    () => {
      if (typeof window === 'undefined') throw new Error('bugReport.mailto.failed:window.unavailable');
      window.location.href = href;
    }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      attempt();
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error('bugReport.mailto.failed:' + (lastError?.message || 'unknown'));
}
