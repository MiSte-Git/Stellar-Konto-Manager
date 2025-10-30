import type { TFunction } from 'i18next';

/**
 * getGlossaryParts: returns the translated title and the English original for a given glossary slug.
 * Throws if the required title key is missing, so the UI can translate the error.
 */
export function getGlossaryParts(slug: string, t: TFunction) {
  const titleKey = `glossary.${slug}.title`;
  const originalKey = `glossary.${slug}.original`;

  // Do NOT pass a default for title so a missing de.json key becomes visible
  const title = t(titleKey) as string;
  if (!title || title === titleKey) {
    // Let the ErrorBoundary/UI handle translation via t('glossary.missingKey')
    throw new Error('glossary.missingKey:' + slug);
  }
  // original can be missing; then we simply do not show the parenthetical
  // We do pass a blank default to avoid echoing the key on screen
  const original = t(originalKey, '') as string;
  return { title, original: original?.trim() || undefined } as const;
}

/**
 * getGlossaryDisplayTitle: "Übersetzung (Englisch)" or just "Übersetzung" when original is missing.
 * Safe to use for aria-labels, tooltip titles, etc.
 */
export function getGlossaryDisplayTitle(slug: string, t: TFunction) {
  const { title, original } = getGlossaryParts(slug, t);
  return original ? `${title} (${original})` : title;
}
