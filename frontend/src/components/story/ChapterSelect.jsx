import React from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "./StoryContext";
import { buildPath } from "../../utils/basePath.js";

function navTo(subpath) {
  try {
    window.history.pushState({}, '', buildPath(subpath));
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}

const TOTAL_CHAPTERS = 7;

export default function ChapterSelect() {
  const { t } = useTranslation("story");
  const { currentChapter, chaptersCompleted, sceneIndex, goToChapter, setShowChapterSelect, onExit } = useStory();

  const handleSelect = (n) => {
    if (n === currentChapter) {
      // Resume current chapter
      setShowChapterSelect(false);
    } else {
      goToChapter(n);
    }
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
      {/* Nav row: HOME → / | BACK → /discover */}
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
          const isLocked = n > 1 && !chaptersCompleted.includes(n - 1) && !isCurrent;

          return (
            <motion.button
              key={n}
              whileHover={!isLocked ? { scale: 1.02, x: 2 } : {}}
              whileTap={!isLocked ? { scale: 0.98 } : {}}
              onClick={() => !isLocked && handleSelect(n)}
              style={{
                background: isCurrent
                  ? "rgba(255,217,61,0.12)"
                  : isCompleted
                  ? "rgba(72,199,142,0.08)"
                  : isLocked
                  ? "rgba(255,255,255,0.03)"
                  : "rgba(255,255,255,0.05)",
                border: `1.5px solid ${
                  isCurrent
                    ? "rgba(255,217,61,0.5)"
                    : isCompleted
                    ? "rgba(72,199,142,0.4)"
                    : isLocked
                    ? "rgba(255,255,255,0.07)"
                    : "rgba(255,255,255,0.13)"
                }`,
                borderRadius: "14px",
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: "14px",
                cursor: isLocked ? "default" : "pointer",
                fontFamily: "inherit",
                opacity: isLocked ? 0.4 : 1,
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
                {isCompleted ? "✓" : isLocked ? "🔒" : n}
              </div>

              {/* Title + status */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: isCurrent ? "#FFD93D" : isCompleted ? "#48c78e" : isLocked ? "rgba(255,255,255,0.4)" : "white",
                  marginBottom: "2px",
                }}>
                  {t(`chapter${n}.title`, `Kapitel ${n}`)}
                </div>
                <div style={{
                  fontSize: "11px",
                  color: isCurrent
                    ? "rgba(255,217,61,0.7)"
                    : isCompleted
                    ? "rgba(72,199,142,0.7)"
                    : "rgba(255,255,255,0.35)",
                }}>
                  {isLocked
                    ? t("nav.chapter_locked", "Gesperrt")
                    : isCurrent && sceneIndex > 0
                    ? t("nav.chapter_current", "Weiter spielen")
                    : isCurrent
                    ? t("nav.chapter_start", "Starten")
                    : isCompleted
                    ? t("nav.chapter_completed", "Abgeschlossen")
                    : t("nav.chapter_start", "Starten")}
                </div>
              </div>

              {/* Arrow */}
              {!isLocked && (
                <span style={{ fontSize: "16px", color: isCurrent ? "#FFD93D" : isCompleted ? "#48c78e" : "rgba(255,255,255,0.3)" }}>
                  ›
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
