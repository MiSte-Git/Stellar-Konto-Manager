import React, { useState } from "react";
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

const TOTAL_CHAPTERS = 9;
const ADVANCED_CHAPTERS = [8, 9];

// ─── Chapter registry (tested flag) ──────────────────────────────────────────
const CHAPTER_REGISTRY = {
  1: { tested: true },
  2: { tested: true },
  3: { tested: false },
  4: { tested: false },
  5: { tested: false },
  6: { tested: false },
  7: { tested: false },
  8: { tested: false },
  9: { tested: false },
};

const isDev =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || import.meta.env.DEV);

const UNTESTED_TOOLTIP = {
  de: "Noch nicht getestet. Bitte Story durchspielen und danach 'tested: true' im Chapter-Registry setzen.",
  en: "Not yet tested. Please play through the story and then set 'tested: true' in the chapter registry.",
  es: "Aún no probado. Por favor juega la historia completa y luego establece 'tested: true' en el registro de capítulos.",
  fi: "Ei vielä testattu. Pelaa tarina läpi ja aseta sitten 'tested: true' luvun rekisterissä.",
  fr: "Pas encore testé. Veuillez jouer toute l'histoire puis définir 'tested: true' dans le registre des chapitres.",
  hr: "Još nije testirano. Molimo odigrajte priču i zatim postavite 'tested: true' u registru poglavlja.",
  it: "Non ancora testato. Gioca tutta la storia e poi imposta 'tested: true' nel registro dei capitoli.",
  nl: "Nog niet getest. Speel het verhaal door en zet daarna 'tested: true' in het hoofdstukregister.",
  ru: "Ещё не протестировано. Пройдите историю и затем установите 'tested: true' в реестре глав.",
};

export default function ChapterSelect() {
  const { t, i18n } = useTranslation("story");
  const { currentChapter, chaptersCompleted, sceneIndex, goToChapter, setShowChapterSelect, onExit } = useStory();
  const [hoveredBadge, setHoveredBadge] = useState(null);

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
          const isAdvanced = ADVANCED_CHAPTERS.includes(n);

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
                position: "relative",
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
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px", flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: isCurrent ? "#FFD93D" : isCompleted ? "#48c78e" : isLocked ? "rgba(255,255,255,0.4)" : "white",
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
                        {UNTESTED_TOOLTIP[i18n.language] ?? UNTESTED_TOOLTIP.en}
                      </motion.div>
                    )}
                  </div>
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
