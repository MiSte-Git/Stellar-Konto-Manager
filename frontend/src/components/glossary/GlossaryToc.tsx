import React from 'react';
import { useTranslation } from 'react-i18next';
import { getGlossaryDisplayTitle } from '../../utils/glossary.ts';

type Props = {
  slugs?: string[];
  groups?: { id: string; slugs: string[] }[];
  idPrefix?: string;
  className?: string;
  sortByTitle?: boolean;
};

export default function GlossaryToc({
  slugs = [],
  groups = [],
  idPrefix = 'g-',
  className = '',
  sortByTitle = true,
}: Props) {
  const { t } = useTranslation('glossary');

  const orderedGroups = React.useMemo(() => {
    const sourceGroups = groups.length ? groups : [{ id: 'all', slugs }];
    return sourceGroups.map((group) => {
      if (!sortByTitle) return group;
      const copy = [...group.slugs];
      copy.sort((a, b) => {
        const ta = (t(`${a}.title`, '') as string).toLocaleLowerCase();
        const tb = (t(`${b}.title`, '') as string).toLocaleLowerCase();
        return ta.localeCompare(tb);
      });
      return { ...group, slugs: copy };
    });
  }, [groups, slugs, sortByTitle, t]);

  return (
    <nav className={className}>
      <h2 className="text-base font-semibold mb-2">{t('toc', 'Inhaltsverzeichnis')}</h2>
      <div className="space-y-3">
        {orderedGroups.map((group) => (
          <div key={`toc-${group.id}`}>
            {group.id !== 'all' && (
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {t(`groups.${group.id}`, group.id)}
              </div>
            )}
            <ul className="list-disc list-outside pl-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
              {group.slugs.map((slug) => {
                const display = getGlossaryDisplayTitle(slug, t);
                const targetId = `${idPrefix}${slug}`;
                return (
                  <li key={`toc-${group.id}-${slug}`}>
                    <a
                      href={`#${targetId}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                      aria-label={display}
                      title={display}
                      onClick={(event) => {
                        const target = document.getElementById(targetId);
                        if (target) {
                          event.preventDefault();
                          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          try {
                            window.history.replaceState(null, '', `#${targetId}`);
                          } catch {
                            /* noop */
                          }
                        }
                      }}
                    >
                      {display}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
