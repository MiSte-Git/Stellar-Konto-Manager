import React from 'react';

/**
 * usePageMeta
 *
 * Small helper hook to set the document title and meta description.
 * Call it from any page component with already translated strings.
 *
 * Example:
 *   const title = t('page.key.title', 'Default title');
 *   const desc = t('page.key.description', 'Default description');
 *   usePageMeta(title, desc);
 */
export default function usePageMeta(title, description) {
  React.useEffect(() => {
    if (typeof document === 'undefined') return;

    try {
      if (title) document.title = title;
      const head = document.head || document.getElementsByTagName('head')[0];
      if (!head) return;

      let meta = document.querySelector('meta[name="description"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'description');
        head.appendChild(meta);
      }
      if (description) meta.setAttribute('content', description);
    } catch {
      // noop – updating the title/description should never break the page
    }
  }, [title, description]);
}
