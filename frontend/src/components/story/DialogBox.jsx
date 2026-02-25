import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "./StoryContext";
import { stripGlossaryMarkers, renderWithGlossaryLinks } from "./parseGlossaryTerms";

// ─── Lumio Moods → Expressions ────────────────────────────────────────────────

const MOOD_CONFIG = {
  happy:   { bg: "#FFF9E6", border: "#FFD93D", glow: "rgba(255,217,61,0.3)"   },
  excited: { bg: "#E6F9FF", border: "#3DD6FF", glow: "rgba(61,214,255,0.3)"   },
  worried: { bg: "#FFF3E6", border: "#FF9A3D", glow: "rgba(255,154,61,0.3)"   },
  sad:     { bg: "#F0E6FF", border: "#9A3DFF", glow: "rgba(154,61,255,0.3)"   },
};

// ─── Lumio SVG Avatar (animated per mood) ────────────────────────────────────

function LumioAvatar({ mood = "happy", size = 80 }) {
  const eyeAnim = mood === "sad"
    ? { scaleY: [1, 0.3, 1], transition: { duration: 2, repeat: Infinity } }
    : mood === "worried"
    ? { y: [0, -2, 0], transition: { duration: 0.5, repeat: Infinity } }
    : { scaleY: [1, 0.1, 1], transition: { duration: 3, repeat: Infinity, repeatDelay: 2 } };

  const starPoints = mood === "excited"
    ? "50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35"
    : "50,8 61,35 92,35 68,56 78,88 50,68 22,88 32,56 8,35 39,35";

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      animate={mood === "excited" ? { rotate: [0, -5, 5, 0], scale: [1, 1.05, 1] } : {}}
      transition={{ duration: 0.5, repeat: mood === "excited" ? Infinity : 0, repeatDelay: 1 }}
    >
      {/* Glow */}
      <motion.ellipse
        cx="50" cy="95" rx="30" ry="6"
        fill={MOOD_CONFIG[mood].glow}
        animate={{ scaleX: [1, 1.1, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      />

      {/* Star body */}
      <motion.polygon
        points={starPoints}
        fill="#FFD93D"
        stroke={MOOD_CONFIG[mood].border}
        strokeWidth="2"
        animate={{ filter: [`drop-shadow(0 0 4px ${MOOD_CONFIG[mood].glow})`, `drop-shadow(0 0 8px ${MOOD_CONFIG[mood].glow})`, `drop-shadow(0 0 4px ${MOOD_CONFIG[mood].glow})`] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />

      {/* Eyes */}
      <motion.g animate={eyeAnim}>
        <ellipse cx="40" cy="48" rx={mood === "sad" ? 5 : 4} ry={mood === "sad" ? 3 : 5} fill="#333" />
        <ellipse cx="60" cy="48" rx={mood === "sad" ? 5 : 4} ry={mood === "sad" ? 3 : 5} fill="#333" />
        {/* Shine */}
        <circle cx="42" cy="46" r="1.2" fill="white" />
        <circle cx="62" cy="46" r="1.2" fill="white" />
      </motion.g>

      {/* Mouth */}
      {mood === "happy" || mood === "excited" ? (
        <path d="M 38 58 Q 50 68 62 58" stroke="#333" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      ) : mood === "worried" ? (
        <path d="M 38 62 Q 50 56 62 62" stroke="#333" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M 40 64 Q 50 58 60 64" stroke="#333" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      )}
    </motion.svg>
  );
}

// ─── Typewriter Hook ───────────────────────────────────────────────────────────

function useTypewriter(text, speed = 28, onDone) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    ref.current = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(ref.current);
        setDone(true);
        onDone?.();
      }
    }, speed);
    return () => clearInterval(ref.current);
  }, [text]); // eslint-disable-line

  const skip = () => {
    clearInterval(ref.current);
    setDisplayed(text);
    setDone(true);
    onDone?.();
  };

  return { displayed, done, skip };
}

// ─── DialogBox ────────────────────────────────────────────────────────────────

/**
 * Props:
 *   lines      – string | string[]   text to display (cycles through array)
 *   speaker    – "lumio" | "narrator" | string
 *   onDone     – () => void           called after last line
 *   autoAdvance– number (ms) | false  auto-advance after this delay
 */
export default function DialogBox({
  lines,
  speaker = "lumio",
  onDone,
  autoAdvance = false,
}) {
  const { lumioMood, openGlossary } = useStory();
  const { t } = useTranslation("story");
  const linesArr = Array.isArray(lines) ? lines : [lines];
  const [lineIndex, setLineIndex] = useState(0);
  const isLast = lineIndex >= linesArr.length - 1;
  const mood = MOOD_CONFIG[lumioMood] || MOOD_CONFIG.happy;

  const handleLineDone = () => {
    if (autoAdvance && !isLast) {
      setTimeout(() => advance(), autoAdvance);
    }
  };

  // Strip [[...]] markers so the typewriter types plain text, then render
  // with clickable glossary links once typing is done.
  const rawText = linesArr[lineIndex];
  const plainText = stripGlossaryMarkers(rawText);
  const { displayed, done, skip } = useTypewriter(plainText, 28, handleLineDone);

  const advance = () => {
    if (!done) { skip(); return; }
    if (!isLast) {
      setLineIndex((i) => i + 1);
    } else {
      onDone?.();
    }
  };

  // Reset when lines change externally
  useEffect(() => { setLineIndex(0); }, [lines]);

  const isNarrator = speaker === "narrator";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={lineIndex}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        onClick={advance}
        style={{
          cursor: "pointer",
          userSelect: "none",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {/* Avatar + Bubble row */}
        <div style={{ display: "flex", gap: "16px", alignItems: "flex-end", padding: "4px 0" }}>
          {/* Lumio Avatar */}
          {!isNarrator && (
            <motion.div
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{ flexShrink: 0 }}
            >
              <LumioAvatar mood={lumioMood} size={72} />
            </motion.div>
          )}

          {/* Speech bubble / narrator box */}
          <motion.div
            style={{
              flex: 1,
              background: isNarrator ? "rgba(255,255,255,0.08)" : mood.bg,
              border: `2px solid ${isNarrator ? "rgba(255,255,255,0.2)" : mood.border}`,
              borderRadius: isNarrator ? "12px" : "16px 16px 16px 4px",
              padding: "14px 18px",
              position: "relative",
              boxShadow: isNarrator ? "none" : `0 0 16px ${mood.glow}`,
            }}
          >
            {/* Speaker name */}
            {!isNarrator && (
              <div style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: mood.border,
                marginBottom: "6px",
              }}>
                Lumio
              </div>
            )}

            {/* Text */}
            <p style={{
              margin: 0,
              fontSize: "15px",
              lineHeight: 1.6,
              color: isNarrator ? "rgba(255,255,255,0.85)" : "#1a1a2e",
              fontStyle: isNarrator ? "italic" : "normal",
              minHeight: "24px",
            }}>
              {done ? renderWithGlossaryLinks(rawText, openGlossary) : displayed}
              {!done && (
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                  style={{ display: "inline-block", width: "2px", height: "1em", background: mood.border, verticalAlign: "text-bottom", marginLeft: "2px" }}
                />
              )}
            </p>

            {/* Advance arrow inside bubble */}
            {done && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{
                  position: "absolute",
                  bottom: "10px",
                  right: "14px",
                  fontSize: "18px",
                  color: mood.border,
                }}
              >
                <motion.span
                  animate={{ x: [0, 4, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                >
                  {isLast ? "✓" : "›"}
                </motion.span>
              </motion.div>
            )}

            {/* Line indicator */}
            {linesArr.length > 1 && (
              <div style={{ display: "flex", gap: "4px", marginTop: "10px" }}>
                {linesArr.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: i === lineIndex ? "16px" : "6px",
                      height: "4px",
                      borderRadius: "2px",
                      background: i <= lineIndex ? mood.border : "rgba(0,0,0,0.15)",
                      transition: "all 0.3s",
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </div>

        {/* Tap to continue hint – shown when typewriter is done */}
        <AnimatePresence>
          {done && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, y: [0, -3, 0] }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: 0.3 },
                y: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
              }}
              style={{
                margin: 0,
                textAlign: "center",
                fontSize: "12px",
                color: "rgba(255,255,255,0.38)",
                letterSpacing: "0.03em",
                paddingBottom: "2px",
              }}
            >
              {t("ui.tap_to_continue", "Tippe um weiterzumachen")} ›
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
