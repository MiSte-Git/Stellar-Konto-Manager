import React from 'react';
import { useTranslation } from 'react-i18next';

interface ExternalDomainNoteProps {
  /** Plain-text domain strings, e.g. "jumio.com" or "ethereum.org/en/zero-knowledge-proofs" */
  domains: string[];
  /** Optional section heading shown above the domain list */
  heading?: string;
}

/**
 * ExternalDomainNote
 *
 * Reusable component for displaying external resource domains as plain monospace
 * text (never as clickable links). Appended below any glossary entry or content
 * block that references external URLs.
 *
 * Security rationale: links inside apps or chat messages can be outdated,
 * manipulated, or lead to phishing sites. By displaying only the domain as
 * Klartext the user is prompted to type the address manually.
 */
export default function ExternalDomainNote({ domains, heading }: ExternalDomainNoteProps) {
  const { t } = useTranslation('common');

  if (!domains || domains.length === 0) return null;

  const warning = t(
    'externalDomain.warning',
    'Tippe diese Adresse selbst in deinen Browser ein – klicke nie auf Links aus einer App oder Nachricht.',
  );

  return (
    <div className="mt-3 rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
      {heading && (
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{heading}</p>
      )}

      <ul className="flex flex-wrap gap-2">
        {domains.map((domain) => (
          <li key={domain}>
            <code className="text-[0.78rem] font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded select-all">
              {domain}
            </code>
          </li>
        ))}
      </ul>

      <p className="text-[0.72rem] leading-snug text-amber-800 dark:text-amber-300 flex items-start gap-1">
        <span aria-hidden="true" className="shrink-0">⚠️</span>
        <span>{warning}</span>
      </p>
    </div>
  );
}
