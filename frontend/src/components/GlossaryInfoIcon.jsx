import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';

// Kleines (i)-Icon, das auf einen konkreten Glossar-Eintrag verlinkt (Anker #g-<term>).
// Wird als Geschwister-Element neben Buttons platziert, nie als Kind eines <button>,
// da <a> in <button> ungültiges/kaputtes HTML wäre.
function GlossaryInfoIcon({ term, className = '' }) {
  const { t } = useTranslation('glossary');
  const title = t(`${term}.short`, t(`${term}.title`, term));

  return (
    <a
      href={`${buildPath('glossar')}#g-${term}`}
      onClick={(e) => e.stopPropagation()}
      title={title}
      aria-label={title}
      className={
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ' +
        'border border-white/70 bg-black/40 text-[10px] font-bold leading-none text-white ' +
        'opacity-80 hover:opacity-100 hover:bg-black/60 ' +
        className
      }
    >
      i
    </a>
  );
}

export default GlossaryInfoIcon;
