import React from "react";
import { motion } from "framer-motion";
import { useStory } from "../StoryContext";
import { useTranslation } from "react-i18next";
import StoryNavButtons from "../StoryNavButtons";

export default function Chapter3() {
  const { goToChapter, setShowChapterSelect } = useStory();
  const { t } = useTranslation("story");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "20px",
        padding: "40px 20px",
        textAlign: "center",
      }}
    >
      <motion.div
        animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.05, 1] }}
        transition={{ duration: 3, repeat: Infinity }}
        style={{ fontSize: "64px" }}
      >
        ⭐
      </motion.div>

      <div style={{
        background: "rgba(255,217,61,0.15)",
        border: "1.5px solid rgba(255,217,61,0.35)",
        borderRadius: "20px",
        padding: "4px 14px",
        fontSize: "12px",
        fontWeight: 700,
        color: "#FFD93D",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}>
        {t("placeholder.chapter_label")} 3
      </div>

      <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 800, color: "white" }}>
        {t("chapter3.title")}
      </h2>

      <div style={{
        background: "rgba(255,255,255,0.05)",
        border: "1.5px solid rgba(255,255,255,0.12)",
        borderRadius: "16px",
        padding: "20px 24px",
        maxWidth: "340px",
        width: "100%",
      }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>🚧</div>
        <p style={{ margin: "0 0 8px", fontSize: "16px", fontWeight: 700, color: "white" }}>
          {t("placeholder.wip_title")}
        </p>
        <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
          {t("placeholder.wip_text")}
        </p>
      </div>

      <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.35)", fontStyle: "italic", lineHeight: 1.6 }}>
        {t("placeholder.wip_hint", { next: 4 })}
      </p>

      {/* Navigation buttons */}
      <StoryNavButtons />

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", maxWidth: "280px" }}>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => goToChapter(4)}
          style={{
            background: "rgba(255,217,61,0.15)",
            border: "1.5px solid #FFD93D",
            borderRadius: "12px",
            padding: "11px 24px",
            color: "#FFD93D",
            fontSize: "14px",
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {t("placeholder.next_chapter", { n: 4 })}
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowChapterSelect(true)}
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1.5px solid rgba(255,255,255,0.15)",
            borderRadius: "12px",
            padding: "11px 24px",
            color: "rgba(255,255,255,0.6)",
            fontSize: "14px",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {t("placeholder.to_chapter_select")}
        </motion.button>
      </div>
    </motion.div>
  );
}
