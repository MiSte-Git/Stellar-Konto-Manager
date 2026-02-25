import React, { lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { StoryProvider, useStory } from "./StoryContext";
import GlossaryPopup from "./GlossaryPopup";
import ChapterSelect from "./ChapterSelect";

// ─── Lazy-load chapters ───────────────────────────────────────────────────────

const chapters = {
  1: lazy(() => import("./chapters/Chapter1")),
  2: lazy(() => import("./chapters/Chapter2")),
  3: lazy(() => import("./chapters/Chapter3")),
  4: lazy(() => import("./chapters/Chapter4")),
  5: lazy(() => import("./chapters/Chapter5")),
};

// ─── HUD – Hearts, XP, Chapter indicator ─────────────────────────────────────

function StoryHUD() {
  const {
    currentChapter, xp, hearts, lumioMood, accountFunded,
    openGlossary, showChapterSelect, setShowChapterSelect,
  } = useStory();
  const { t } = useTranslation("story");
  const TOTAL_CHAPTERS = 5;

  const moodEmoji = {
    happy:   "⭐",
    excited: "🌟",
    worried: "😟",
    sad:     "💔",
  }[lumioMood] ?? "⭐";

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        background: "rgba(0,0,0,0.3)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Hearts + TESTNET badge */}
      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        {[...Array(3)].map((_, i) => (
          <motion.span
            key={i}
            animate={i >= hearts ? {} : { scale: [1, 1.2, 1] }}
            transition={{ delay: i * 0.1 }}
            style={{ fontSize: "18px", opacity: i < hearts ? 1 : 0.25 }}
          >
            ❤️
          </motion.span>
        ))}
        {accountFunded && (
          <motion.button
            onClick={() => openGlossary("testnet")}
            whileHover={{ opacity: 0.8 }}
            whileTap={{ scale: 0.95 }}
            style={{
              fontSize: "9px",
              fontWeight: 700,
              color: "#ff5b5b",
              background: "rgba(255,91,91,0.15)",
              border: "1px solid rgba(255,91,91,0.4)",
              borderRadius: "4px",
              padding: "1px 5px",
              letterSpacing: "0.06em",
              marginLeft: "2px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            TESTNET
          </motion.button>
        )}
      </div>

      {/* Kap. X + chapter progress – clickable to open chapter select */}
      <div
        onClick={() => !showChapterSelect && setShowChapterSelect(true)}
        title={!showChapterSelect ? t("nav.to_chapters", "Kapitel") : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          cursor: showChapterSelect ? "default" : "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: "16px" }}>{moodEmoji}</span>
        <span style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "rgba(255,255,255,0.55)",
          whiteSpace: "nowrap",
        }}>
          {t("hud.chapter_short", "Kap.")} {currentChapter}
        </span>
        <div style={{ display: "flex", gap: "4px" }}>
          {[...Array(TOTAL_CHAPTERS)].map((_, i) => (
            <div
              key={i}
              style={{
                width: i + 1 === currentChapter ? "20px" : "8px",
                height: "8px",
                borderRadius: "4px",
                background: i + 1 < currentChapter
                  ? "#48c78e"
                  : i + 1 === currentChapter
                  ? "#FFD93D"
                  : "rgba(255,255,255,0.2)",
                transition: "all 0.4s",
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", marginLeft: "2px" }}>
          {currentChapter}/{TOTAL_CHAPTERS}
        </span>
      </div>

      {/* XP */}
      <motion.div
        key={xp}
        initial={{ scale: 1.3 }}
        animate={{ scale: 1 }}
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "#FFD93D",
          background: "rgba(255,217,61,0.1)",
          padding: "4px 10px",
          borderRadius: "20px",
          border: "1px solid rgba(255,217,61,0.25)",
        }}
      >
        ⭐ {xp} XP
      </motion.div>
    </motion.div>
  );
}

// ─── Chapter Loading Skeleton ─────────────────────────────────────────────────

function ChapterLoading() {
  return (
    <div style={{ padding: "40px", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
      <motion.div
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        style={{ fontSize: "40px" }}
      >
        ⭐
      </motion.div>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px" }}>Kapitel lädt...</p>
    </div>
  );
}

// ─── Inner Story (has access to context) ─────────────────────────────────────

function StoryInner() {
  const { currentChapter, glossaryOpen, glossaryTerm, closeGlossary, showChapterSelect } = useStory();
  const ChapterComponent = chapters[currentChapter];

  return (
    <div style={{
      minHeight: "100dvh",
      background: "linear-gradient(160deg, #0d0d1a 0%, #1a1a2e 50%, #0f1a2e 100%)",
      display: "flex",
      flexDirection: "column",
      color: "white",
      fontFamily: "'Nunito', 'Poppins', sans-serif",
    }}>
      <StoryHUD />

      <div style={{
        flex: 1,
        maxWidth: "640px",
        width: "100%",
        margin: "0 auto",
        padding: "24px 16px 40px",
        display: "flex",
        flexDirection: "column",
      }}>
        <AnimatePresence mode="wait">
          {showChapterSelect ? (
            <motion.div
              key="chapter-select"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
              style={{ flex: 1 }}
            >
              <ChapterSelect />
            </motion.div>
          ) : (
            <motion.div
              key={`chapter-${currentChapter}`}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
              style={{ flex: 1 }}
            >
              {ChapterComponent ? (
                <Suspense fallback={<ChapterLoading />}>
                  <ChapterComponent />
                </Suspense>
              ) : (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.4)" }}>
                  <p style={{ fontSize: "40px", marginBottom: "12px" }}>🚧</p>
                  <p>Kapitel {currentChapter} wird noch gebaut.</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Glossary popup */}
      <AnimatePresence>
        {glossaryOpen && (
          <GlossaryPopup termKey={glossaryTerm} onClose={closeGlossary} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

/**
 * Props:
 *   onExit – () => void   optional – called when user exits story mode
 */
export default function StoryMode({ onExit }) {
  return (
    <StoryProvider onExit={onExit}>
      <StoryInner />
    </StoryProvider>
  );
}
