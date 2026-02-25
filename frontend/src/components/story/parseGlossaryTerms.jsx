import React from "react";

/**
 * Utilities for parsing [[display|key]] glossary markers in i18n strings.
 *
 * Syntax:
 *   [[display|key]]   – clickable span, opens glossary entry "key", shows "display"
 *   [[display]]       – clickable span, uses "display" as both key and label
 *
 * Exported:
 *   stripGlossaryMarkers(text)               – plain text for typewriter
 *   renderWithGlossaryLinks(text, openGlossary) – React elements with clickable spans
 */

const MARKER_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Strip [[display|key]] markers, returning plain text.
 * Used to feed the typewriter hook (character-by-character display).
 */
export function stripGlossaryMarkers(text) {
  if (!text || typeof text !== "string") return text ?? "";
  return text.replace(MARKER_RE, (_, display) => display);
}

/**
 * Parse text with [[display|key]] markers into an array of React elements.
 * Each marked term becomes a clickable yellow span that calls openGlossary(key).
 * Returns the original string unchanged if no markers are found.
 */
export function renderWithGlossaryLinks(text, openGlossary) {
  if (!text || typeof text !== "string") return text ?? "";

  const parts = [];
  let lastIndex = 0;
  let match;
  MARKER_RE.lastIndex = 0;

  while ((match = MARKER_RE.exec(text)) !== null) {
    const [full, display, key] = match;
    const termKey = key ?? display;

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    parts.push(
      <span
        key={match.index}
        onClick={(e) => { e.stopPropagation(); openGlossary?.(termKey); }}
        style={{
          color: "#FFD93D",
          cursor: "pointer",
          fontWeight: 600,
          textDecoration: "underline",
          textUnderlineOffset: "2px",
          textDecorationColor: "rgba(255,217,61,0.45)",
        }}
      >
        {display}
      </span>
    );

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 0 ? text : parts;
}
