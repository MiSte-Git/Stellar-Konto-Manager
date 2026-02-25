import React from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { buildPath } from "../../utils/basePath.js";

function nav(path) {
  try {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch { /* noop */ }
}

const CARDS = [
  {
    icon: "🧠",
    titleKey: "learn.quiz_title",
    subKey: "learn.quiz_sub",
    iconBg: "rgba(99,102,241,0.2)",
    iconBorder: "rgba(99,102,241,0.5)",
    path: "quiz",
  },
  {
    icon: "🛡️",
    titleKey: "learn.scam_title",
    subKey: "learn.scam_sub",
    iconBg: "rgba(239,68,68,0.2)",
    iconBorder: "rgba(239,68,68,0.5)",
    path: "learn/scam-simulator",
  },
  {
    icon: "⭐",
    titleKey: "learn.story_title",
    subKey: "learn.story_sub",
    iconBg: "rgba(255,217,61,0.2)",
    iconBorder: "rgba(255,217,61,0.5)",
    path: "story",
  },
];

export default function LearnHub({ onBack }) {
  const { t } = useTranslation("home");
  const handleBack = onBack ?? (() => nav(buildPath('')));

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "linear-gradient(160deg, #0d0d1a 0%, #1a1a2e 50%, #0f1a2e 100%)",
        color: "white",
        fontFamily: "'Nunito', 'Poppins', sans-serif",
        padding: "24px 16px 40px",
      }}
    >
      <div style={{ maxWidth: "480px", margin: "0 auto" }}>
        {/* Back button */}
        <button
          type="button"
          onClick={handleBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            fontSize: "14px",
            cursor: "pointer",
            padding: "4px 0",
            marginBottom: "28px",
            fontFamily: "inherit",
          }}
        >
          ← {t("learn.back", "Zurück")}
        </button>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ fontSize: "48px", marginBottom: "8px" }}>⭐</div>
          <h1 style={{ margin: "0 0 8px", fontSize: "26px", fontWeight: 800, color: "white" }}>
            {t("learn.page_title", "Stellar entdecken")}
          </h1>
          <p style={{ margin: 0, fontSize: "15px", color: "rgba(255,255,255,0.5)" }}>
            {t("learn.page_sub", "Wähl deinen Einstieg")}
          </p>
        </div>

        {/* Cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {CARDS.map((card, i) => (
            <motion.button
              key={card.path}
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              whileHover={{ x: 2, borderColor: "rgba(255,255,255,0.3)" }}
              onClick={() => nav(buildPath(card.path))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                background: "rgba(255,255,255,0.05)",
                border: "1.5px solid rgba(255,255,255,0.12)",
                borderRadius: "16px",
                padding: "18px 20px",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                width: "100%",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "12px",
                  background: card.iconBg,
                  border: `1.5px solid ${card.iconBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  flexShrink: 0,
                }}
              >
                {card.icon}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "white", lineHeight: 1.2 }}>
                  {t(card.titleKey)}
                </span>
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>
                  {t(card.subKey)}
                </span>
              </div>
              <span style={{ opacity: 0.4, fontSize: "20px", color: "white" }}>›</span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
