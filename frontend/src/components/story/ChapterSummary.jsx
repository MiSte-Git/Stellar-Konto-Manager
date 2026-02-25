import React, { useEffect } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { useStory } from "./StoryContext";

/**
 * Props:
 *   chapter    – number
 *   title      – string
 *   learnings  – string[]    bullet points of what was learned
 *   xpEarned   – number      XP gained in this chapter
 *   onNext     – () => void  continue to next chapter or home
 *   isLast     – bool        last chapter → show completion screen
 */
export default function ChapterSummary({
  chapter,
  title,
  learnings = [],
  xpEarned,
  onNext,
  isLast = false,
}) {
  const { xp } = useStory();

  useEffect(() => {
    // Fire confetti
    const fire = (opts) => confetti({
      particleCount: 80,
      spread: 70,
      colors: ["#FFD93D", "#3DD6FF", "#48c78e", "#FF9A3D"],
      ...opts,
    });

    fire({ origin: { x: 0.25, y: 0.6 } });
    setTimeout(() => fire({ origin: { x: 0.75, y: 0.6 } }), 200);
    if (isLast) setTimeout(() => fire({ origin: { x: 0.5, y: 0.3 }, particleCount: 150 }), 500);
  }, [isLast]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
        padding: "32px 24px",
        textAlign: "center",
      }}
    >
      {/* Chapter badge */}
      <motion.div
        initial={{ scale: 0, rotate: -15 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
        style={{
          background: "linear-gradient(135deg, #FFD93D, #FF9A3D)",
          borderRadius: "50%",
          width: "90px",
          height: "90px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 32px rgba(255,217,61,0.4)",
        }}
      >
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#1a1a2e", letterSpacing: "0.06em" }}>
          KAPITEL
        </span>
        <span style={{ fontSize: "32px", fontWeight: 900, color: "#1a1a2e", lineHeight: 1 }}>
          {chapter}
        </span>
      </motion.div>

      {/* Title */}
      <div>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ margin: "0 0 4px", fontSize: "13px", color: "#48c78e", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          {isLast ? "🎉 Story abgeschlossen!" : "Kapitel abgeschlossen!"}
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          style={{ margin: 0, fontSize: "22px", fontWeight: 800, color: "white" }}
        >
          {title}
        </motion.h2>
      </div>

      {/* XP earned */}
      {xpEarned != null && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, type: "spring" }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(255,217,61,0.12)",
            border: "1.5px solid rgba(255,217,61,0.35)",
            borderRadius: "40px",
            padding: "10px 24px",
          }}
        >
          <span style={{ fontSize: "22px" }}>⭐</span>
          <span style={{ fontSize: "20px", fontWeight: 800, color: "#FFD93D" }}>
            +{xpEarned} XP
          </span>
          <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)" }}>
            · Gesamt: {xp}
          </span>
        </motion.div>
      )}

      {/* Learnings */}
      {learnings.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.05)",
            border: "1.5px solid rgba(255,255,255,0.1)",
            borderRadius: "14px",
            padding: "16px 20px",
            textAlign: "left",
          }}
        >
          <p style={{ margin: "0 0 12px", fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Das hast du gelernt
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {learnings.map((item, i) => {
              const text = typeof item === "string" ? item : item.text;
              const isWarning = typeof item === "object" && item.type === "warning";
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 + i * 0.07 }}
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "flex-start",
                    ...(isWarning ? {
                      background: "rgba(255,171,0,0.08)",
                      borderLeft: "3px solid #ffab00",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      marginTop: "4px",
                    } : {}),
                  }}
                >
                  <span style={{ color: isWarning ? "#ffab00" : "#48c78e", flexShrink: 0, marginTop: "2px" }}>
                    {isWarning ? "⚠️" : "✓"}
                  </span>
                  <span style={{ fontSize: "14px", color: isWarning ? "#ffab00" : "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>
                    {text}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* CTA */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={onNext}
        style={{
          background: "linear-gradient(135deg, #FFD93D, #FF9A3D)",
          border: "none",
          borderRadius: "14px",
          padding: "15px 40px",
          fontSize: "16px",
          fontWeight: 700,
          color: "#1a1a2e",
          fontFamily: "inherit",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(255,217,61,0.3)",
        }}
      >
        {isLast ? "🏆 Abschlusszertifikat ansehen" : "Weiter zu Kapitel " + (chapter + 1) + " →"}
      </motion.button>
    </motion.div>
  );
}
