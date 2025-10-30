import React from "react";

// GlossaryTermCard zeigt einen einzelnen Glossar-Begriff mit Titel und Beschreibung.
// Props:
// - title: Sichtbarer Begriff
// - desc: Einfache Erklärung für Einsteiger
export default function GlossaryTermCard({
  titleNode,
  titleAttr,
  desc,
}: {
  titleNode: React.ReactNode;
  titleAttr: string;
  desc: string;
}) {
  return (
    <article className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <h2
        className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        title={titleAttr}
        aria-label={titleAttr}
      >
        {titleNode}
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 whitespace-pre-line">
        {desc}
      </p>
    </article>
  );
}
