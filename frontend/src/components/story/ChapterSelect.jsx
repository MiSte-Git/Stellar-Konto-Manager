import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "./StoryContext";
import { buildPath } from "../../utils/basePath.js";
import { TOTAL_CHAPTERS, ADVANCED_CHAPTERS, CHAPTER_REGISTRY } from "./storyChapters.config.js";

function navTo(subpath) {
  try {
    window.history.pushState({}, '', buildPath(subpath));
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}

const isDev =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || import.meta.env.DEV);

// ─── Hint Dialog ──────────────────────────────────────────────────────────────

function ChapterHintDialog({ t, onContinue, onGoTo1 }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onContinue}
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
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
          <span style={{ fontSize: "22px", flexShrink: 0 }}>💡</span>
          <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.85)", lineHeight: 1.6 }}>
            {t("chapterHint")}
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={onContinue}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "8px",
              padding: "10px 12px",
              color: "rgba(255,255,255,0.6)",
              fontSize: "13px",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {t("chapterHintContinue")}
          </button>
          <button
            onClick={onGoTo1}
            style={{
              flex: 1,
              background: "rgba(255,217,61,0.15)",
              border: "1.5px solid #FFD93D",
              borderRadius: "8px",
              padding: "10px 12px",
              color: "#FFD93D",
              fontSize: "13px",
              fontWeight: 700,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {t("chapterHintGoTo1")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── ChapterSelect ────────────────────────────────────────────────────────────

export default function ChapterSelect() {
  const { t } = useTranslation("story");
  const { currentChapter, chaptersCompleted, sceneIndex, goToChapter, setShowChapterSelect, onExit } = useStory();
  const [hoveredBadge, setHoveredBadge] = useState(null);
  const [pendingChapter, setPendingChapter] = useState(null);

  const ch1Done = chaptersCompleted.includes(1);

  const proceed = (n) => {
    if (n === currentChapter) setShowChapterSelect(false);
    else goToChapter(n);
  };

  const handleSelect = (n) => {
    // Show hint when chapter 1 not yet finished and user picks n > 1
    if (n > 1 && !ch1Done) {
      setPendingChapter(n);
      return;
    }
    proceed(n);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
        padding: "40px 20px",
      }}
    >
      {/* Nav row */}
      <div style={{ display: "flex", gap: "8px", alignSelf: "flex-start" }}>
        <motion.button
          whileHover={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.8)" }}
          whileTap={{ scale: 0.96 }}
          onClick={onExit}
          style={{
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
          }}
        >
          🏠
        </motion.button>

        <motion.button
          whileHover={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.8)" }}
          whileTap={{ scale: 0.96 }}
          onClick={() => navTo("discover")}
          style={{
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
          }}
        >
          ←
        </motion.button>
      </div>

      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <motion.div
          animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.05, 1] }}
          transition={{ duration: 3, repeat: Infinity }}
          style={{ fontSize: "52px", marginBottom: "12px" }}
        >
          ⭐
        </motion.div>
        <h2 style={{ margin: "0 0 6px", fontSize: "22px", fontWeight: 800, color: "white" }}>
          {t("nav.chapter_select_title", "Kapitelauswahl")}
        </h2>
        <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.5)" }}>
          {t("nav.chapter_select_sub", "Wähle ein Kapitel zum Spielen")}
        </p>
      </div>

      {/* Chapter list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", maxWidth: "360px" }}>
        {[...Array(TOTAL_CHAPTERS)].map((_, i) => {
          const n = i + 1;
          const isCompleted = chaptersCompleted.includes(n);
          const isCurrent = n === currentChapter;
          const isAdvanced = ADVANCED_CHAPTERS.includes(n);
          const duration = CHAPTER_REGISTRY[n]?.durationMinutes;

          return (
            <motion.button
              key={n}
              whileHover={{ scale: 1.02, x: 2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelect(n)}
              style={{
                background: isCurrent
                  ? "rgba(255,217,61,0.12)"
                  : isCompleted
                  ? "rgba(72,199,142,0.08)"
                  : "rgba(255,255,255,0.05)",
                border: `1.5px solid ${
                  isCurrent
                    ? "rgba(255,217,61,0.5)"
                    : isCompleted
                    ? "rgba(72,199,142,0.4)"
                    : "rgba(255,255,255,0.13)"
                }`,
                borderRadius: "14px",
                padding: "14px 18px",
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: "14px",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.25s",
                width: "100%",
                textAlign: "left",
              }}
            >
              {/* Chapter number badge */}
              <div style={{
                width: "34px",
                height: "34px",
                borderRadius: "10px",
                background: isCurrent
                  ? "rgba(255,217,61,0.2)"
                  : isCompleted
                  ? "rgba(72,199,142,0.18)"
                  : "rgba(255,255,255,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "15px",
                fontWeight: 800,
                color: isCurrent ? "#FFD93D" : isCompleted ? "#48c78e" : "rgba(255,255,255,0.5)",
                flexShrink: 0,
              }}>
                {isCompleted ? "✓" : n}
              </div>

              {/* Title + status */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* "Kapitel N" label */}
                <div style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: isCurrent ? "rgba(255,217,61,0.6)" : isCompleted ? "rgba(72,199,142,0.55)" : "rgba(255,255,255,0.3)",
                  marginBottom: "1px",
                }}>
                  {t("chapterLabel")} {n}
                </div>

                {/* Title + Advanced badge */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px", flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: isCurrent ? "#FFD93D" : isCompleted ? "#48c78e" : "white",
                  }}>
                    {t(`chapter${n}.title`, `Kapitel ${n}`)}
                  </span>
                  {isAdvanced && (
                    <span style={{
                      fontSize: "9px", fontWeight: 700, letterSpacing: "0.05em",
                      color: "#ff5b5b", background: "rgba(255,91,91,0.15)",
                      border: "1px solid rgba(255,91,91,0.3)",
                      borderRadius: "4px", padding: "1px 5px", flexShrink: 0,
                    }}>
                      🔴 {t("ui.difficulty.advanced", "Fortgeschritten")}
                    </span>
                  )}
                </div>

                {/* Subtitle */}
                <div style={{
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.42)",
                  marginBottom: "3px",
                  fontStyle: "italic",
                }}>
                  {t(`chapter${n}.subtitle`)}
                </div>

                {/* Status + duration */}
                <div style={{
                  fontSize: "11px",
                  color: isCurrent
                    ? "rgba(255,217,61,0.7)"
                    : isCompleted
                    ? "rgba(72,199,142,0.7)"
                    : "rgba(255,255,255,0.35)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}>
                  <span>
                    {isCurrent && sceneIndex > 0
                      ? t("nav.chapter_current", "Weiter spielen")
                      : isCurrent
                      ? t("nav.chapter_start", "Starten")
                      : isCompleted
                      ? t("nav.chapter_completed", "Abgeschlossen")
                      : t("nav.chapter_start", "Starten")}
                  </span>
                  {duration && (
                    <span style={{ opacity: 0.6 }}>
                      · {t("nav.duration_min", "~{{count}} Min.", { count: duration })}
                    </span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <span style={{ fontSize: "16px", color: isCurrent ? "#FFD93D" : isCompleted ? "#48c78e" : "rgba(255,255,255,0.3)" }}>
                ›
              </span>

              {/* Dev: untested badge (top-left, localhost/dev only) */}
              {isDev && !CHAPTER_REGISTRY[n]?.tested && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ position: "absolute", top: "8px", left: "8px", zIndex: 10 }}
                >
                  <div
                    onMouseEnter={() => setHoveredBadge(n)}
                    onMouseLeave={() => setHoveredBadge(null)}
                    style={{ position: "relative", display: "inline-block" }}
                  >
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: "10px", lineHeight: 1,
                      background: "rgba(255,140,0,0.18)", border: "1px solid rgba(255,140,0,0.4)",
                      borderRadius: "4px", padding: "2px 5px", cursor: "help",
                      userSelect: "none", color: "rgba(255,180,60,0.9)",
                    }}>
                      🔧
                    </span>
                    {hoveredBadge === n && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15 }}
                        style={{
                          position: "absolute", top: "calc(100% + 4px)", left: 0,
                          background: "rgba(15,15,25,0.97)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: "8px", padding: "8px 10px",
                          fontSize: "11px", color: "rgba(255,255,255,0.65)",
                          maxWidth: "260px", lineHeight: 1.5,
                          whiteSpace: "normal", zIndex: 50,
                          pointerEvents: "none",
                          boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
                        }}
                      >
                        {t("dev.untestedHint")}
                      </motion.div>
                    )}
                  </div>
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Chapter 1 hint dialog */}
      <AnimatePresence>
        {pendingChapter !== null && (
          <ChapterHintDialog
            t={t}
            onContinue={() => { const n = pendingChapter; setPendingChapter(null); proceed(n); }}
            onGoTo1={() => { setPendingChapter(null); goToChapter(1); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
