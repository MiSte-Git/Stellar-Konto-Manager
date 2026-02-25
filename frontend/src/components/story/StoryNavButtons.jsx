import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "./StoryContext";
import { buildPath } from "../../utils/basePath.js";

function navTo(subpath) {
  try {
    window.history.pushState({}, '', buildPath(subpath));
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ text, cancelLabel, confirmLabel, onCancel, onConfirm }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, #1a1a2e, #0f1a2e)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "16px",
          padding: "24px",
          maxWidth: "340px",
          width: "100%",
          fontFamily: "'Nunito', 'Poppins', sans-serif",
        }}
      >
        <p style={{
          margin: "0 0 20px",
          fontSize: "15px",
          color: "rgba(255,255,255,0.85)",
          lineHeight: 1.6,
        }}>
          {text}
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "8px",
              padding: "9px 18px",
              color: "rgba(255,255,255,0.6)",
              fontSize: "14px",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: "rgba(255,217,61,0.2)",
              border: "1.5px solid #FFD93D",
              borderRadius: "8px",
              padding: "9px 18px",
              color: "#FFD93D",
              fontSize: "14px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── StoryNavButtons ──────────────────────────────────────────────────────────

/**
 * Three compact nav buttons: 🏠 Home | 📖 Kapitel | ← Zurück
 * Reads onExit, sceneIndex, setSceneIndex, setShowChapterSelect from StoryContext.
 */
export default function StoryNavButtons() {
  const { onExit, setShowChapterSelect } = useStory();
  const { t } = useTranslation("story");
  const [confirm, setConfirm] = useState(null); // null | "home" | "chapters" | "back"

  const handleConfirm = () => {
    const action = confirm;
    setConfirm(null);
    if (action === "home") onExit();
    else if (action === "chapters") setShowChapterSelect(true);
    else if (action === "back") navTo("discover");
  };

  const btnBase = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "8px",
    padding: "6px 14px",
    fontSize: "12px",
    color: "rgba(255,255,255,0.55)",
    fontFamily: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "5px",
    transition: "border-color 0.15s, color 0.15s",
  };

  return (
    <>
      <div style={{
        display: "flex",
        justifyContent: "center",
        gap: "10px",
        marginTop: "16px",
        marginBottom: "8px",
      }}>
        {/* 🏠 Home */}
        <motion.button
          whileHover={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.8)" }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setConfirm("home")}
          style={btnBase}
        >
          🏠
        </motion.button>

        {/* 📖 Kapitel */}
        <motion.button
          whileHover={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.8)" }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setConfirm("chapters")}
          style={btnBase}
        >
          📖 {t("nav.to_chapters", "Kapitel")}
        </motion.button>

        {/* ← Zurück → /discover */}
        <motion.button
          whileHover={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.8)" }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setConfirm("back")}
          style={btnBase}
        >
          ←
        </motion.button>
      </div>

      <AnimatePresence>
        {confirm && (
          <ConfirmDialog
            text={t("nav.confirm_leave", "Dein Fortschritt in diesem Kapitel bleibt gespeichert.")}
            cancelLabel={t("nav.confirm_leave_cancel", "Abbrechen")}
            confirmLabel={t("nav.confirm_leave_ok", "Verlassen")}
            onCancel={() => setConfirm(null)}
            onConfirm={handleConfirm}
          />
        )}
      </AnimatePresence>
    </>
  );
}
