import React from 'react';
import { useTranslation } from 'react-i18next';
import { getGlossaryDisplayTitle } from '../../utils/glossary.ts';

type Props = {
  slugs: string[];
  idPrefix?: string;
  className?: string;
  sortByTitle?: boolean;
};

export default function GlossaryToc({ slugs, idPrefix = 'g-', className = '', sortByTitle = true }: Props) {
  const { t } = useTranslation('glossary');

  const orderedSlugs = React.useMemo(() => {
    if (!sortByTitle) return slugs;
    const copy = [...slugs];
    copy.sort((a, b) => {
      const ta = (t(`${a}.title`, '') as string).toLocaleLowerCase();
      const tb = (t(`${b}.title`, '') as string).toLocaleLowerCase();
      return ta.localeCompare(tb);
    });
    return copy;
  }, [slugs, sortByTitle, t]);

  return (
    <nav className={className}>
      <h2 className="text-base font-semibold mb-2">{t('toc', 'Inhaltsverzeichnis')}</h2>
      <ul className="list-disc list-inside grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
        {orderedSlugs.map((slug) => {
          const display = getGlossaryDisplayTitle(slug, t);
          return (
            <li key={`toc-${slug}`}>
              <a
                href={`#${idPrefix}${slug}`}
                className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                aria-label={display}
                title={display}
              >
                {display}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
