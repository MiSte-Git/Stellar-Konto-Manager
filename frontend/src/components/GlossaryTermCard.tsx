import React from "react";
import ExternalDomainNote from "./ExternalDomainNote.tsx";

// GlossaryTermCard zeigt einen einzelnen Glossar-Begriff mit Titel und Beschreibung.
// Props:
// - titleNode:       Sichtbarer Begriff (React-Node für Formatierung)
// - titleAttr:       Reiner Text für aria-label / title
// - desc:            Einfache Erklärung für Einsteiger
// - externalDomains: Optionale Liste von Klartext-Domains für externe Ressourcen
// - domainsHeading:  Optionale Überschrift über der Domain-Liste
export default function GlossaryTermCard({
  titleNode,
  titleAttr,
  desc,
  externalDomains,
  domainsHeading,
}: {
  titleNode: React.ReactNode;
  titleAttr: string;
  desc: string;
  externalDomains?: string[];
  domainsHeading?: string;
}) {
  return (
    <article className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <h2
        className="text-lg font-semibold text-gray-900 dark:text-gray-100 break-words"
        title={titleAttr}
        aria-label={titleAttr}
      >
        {titleNode}
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 whitespace-pre-line">
        {desc}
      </p>
      {externalDomains && externalDomains.length > 0 && (
        <ExternalDomainNote domains={externalDomains} heading={domainsHeading} />
      )}
    </article>
  );
}
