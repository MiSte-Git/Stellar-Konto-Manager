import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";

/**
 * GlossaryPopup
 *
 * Props:
 *   termKey  – string   key in the glossary namespace (e.g. "publicKey")
 *   onClose  – () => void
 */
export default function GlossaryPopup({ termKey, onClose }) {
  const { t: tGlossary, i18n } = useTranslation("glossary");
  const { t: tStory } = useTranslation("story");

  // Check if the term exists in the current language bundle
  const bundle = i18n.getResourceBundle(i18n.language, "glossary") ?? {};
  const termExists = !!(termKey && bundle[termKey]);

  const title = termExists
    ? tGlossary(`${termKey}.title`)
    : tStory("ui.glossary_title", "Glossar");
  const short = termExists ? tGlossary(`${termKey}.short`) : null;
  const desc = termExists
    ? tGlossary(`${termKey}.desc`)
    : tStory("ui.glossary_not_found", "Begriff nicht gefunden.");

  return (
    <motion.div
      key="glossary-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <motion.div
        key="glossary-panel"
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, #1a1a2e, #0f1a2e)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "20px",
          padding: "24px",
          maxWidth: "560px",
          width: "calc(100% - 32px)",
          maxHeight: "75vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          fontFamily: "'Nunito', 'Poppins', sans-serif",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}>
          <div>
            <p style={{
              margin: "0 0 4px",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#FFD93D",
              textTransform: "uppercase",
            }}>
              {tStory("ui.glossary_title", "Glossar")}
            </p>
            <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "white" }}>
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "8px",
              padding: "6px 10px",
              color: "rgba(255,255,255,0.5)",
              fontSize: "14px",
              cursor: "pointer",
              fontFamily: "inherit",
              flexShrink: 0,
              marginLeft: "12px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Short description */}
        {short && (
          <p style={{
            margin: "0 0 14px",
            fontSize: "14px",
            fontWeight: 600,
            color: "#a0c4ff",
            padding: "10px 14px",
            background: "rgba(160,196,255,0.08)",
            borderRadius: "8px",
            lineHeight: 1.5,
          }}>
            {short}
          </p>
        )}

        {/* Full description */}
        <p style={{
          margin: 0,
          fontSize: "14px",
          color: "rgba(255,255,255,0.75)",
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
        }}>
          {desc}
        </p>
      </motion.div>
    </motion.div>
  );
}
