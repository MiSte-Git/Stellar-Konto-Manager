/**
 * Kapitel 7 – Der Tresor
 * Thema: Multisignature – geteilte Wallet-Kontrolle, Thresholds, Anwendungsfälle
 */
import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { useTranslation } from "react-i18next";
import { useStory } from "../StoryContext";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";
import Lumio from "../../quiz/Lumio";

// ─── XP constants ─────────────────────────────────────────────────────────────

const CHAPTER_XP = [100, 110, 120, 150, 200, 160, 200];
const TOTAL_XP = CHAPTER_XP.reduce((a, b) => a + b, 0); // 1040

// ─── MultisigExplainCard ──────────────────────────────────────────────────────

function MultisigExplainCard({ next, t, openGlossary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#FF9A3D" }}>
          {t("chapter7.explain_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter7.explain_title")}</h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{t("chapter7.explain_desc")}</p>
      </div>

      {/* 1-of-1 vs N-of-M visual */}
      <div style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px",
      }}>
        {/* Normal: 1-of-1 */}
        <div style={{
          display: "flex", alignItems: "center", gap: "10px",
          background: "rgba(255,91,91,0.07)", border: "1px solid rgba(255,91,91,0.2)",
          borderRadius: "10px", padding: "10px 12px",
        }}>
          <span style={{ fontSize: "22px" }}>🔑</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: "12px", fontWeight: 700, color: "#ff5b5b" }}>{t("chapter7.explain_1of1_label")}</p>
            <p style={{ margin: "2px 0 0", fontSize: "11px", color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{t("chapter7.explain_1of1_desc")}</p>
          </div>
        </div>

        {/* Multisig: N-of-M */}
        <div style={{
          display: "flex", alignItems: "center", gap: "10px",
          background: "rgba(72,199,142,0.07)", border: "1px solid rgba(72,199,142,0.25)",
          borderRadius: "10px", padding: "10px 12px",
        }}>
          <span style={{ fontSize: "22px" }}>🔐</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: "12px", fontWeight: 700, color: "#48c78e" }}>{t("chapter7.explain_multisig_label")}</p>
            <p style={{ margin: "2px 0 0", fontSize: "11px", color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{t("chapter7.explain_multisig_desc")}</p>
          </div>
          <button
            onClick={() => openGlossary("multisig")}
            style={{
              background: "rgba(72,199,142,0.12)", border: "1px solid rgba(72,199,142,0.3)",
              borderRadius: "50%", width: "20px", height: "20px", fontSize: "11px", color: "#48c78e",
              cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center",
              justifyContent: "center", padding: 0, flexShrink: 0,
            }}
          >?</button>
        </div>
      </div>

      {/* Threshold concept */}
      <div style={{
        background: "rgba(255,217,61,0.06)", border: "1px solid rgba(255,217,61,0.2)",
        borderRadius: "12px", padding: "14px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <span style={{ fontSize: "20px" }}>⚖️</span>
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#FFD93D" }}>{t("chapter7.explain_threshold_label")}</p>
          <button
            onClick={() => openGlossary("signing")}
            style={{
              background: "rgba(255,217,61,0.12)", border: "1px solid rgba(255,217,61,0.3)",
              borderRadius: "50%", width: "18px", height: "18px", fontSize: "10px", color: "#FFD93D",
              cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center",
              justifyContent: "center", padding: 0, flexShrink: 0,
            }}
          >?</button>
        </div>
        <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
          {t("chapter7.explain_threshold_desc")}
        </p>
      </div>

      {/* Vault visual: 🏦🔒🔒 */}
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px", padding: "14px", textAlign: "center",
      }}>
        <p style={{ margin: "0 0 8px", fontSize: "28px" }}>🏦&thinsp;🔒&thinsp;🔒</p>
        <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
          {t("chapter7.explain_vault_desc")}
        </p>
      </div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "linear-gradient(135deg, #FF9A3D, #FFD93D)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
          boxShadow: "0 4px 16px rgba(255,154,61,0.3)",
        }}
      >{t("chapter7.explain_cta")}</motion.button>
    </motion.div>
  );
}

// ─── FamilySavingsCard ─────────────────────────────────────────────────────────

function FamilySavingsCard({ next, t }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#3DD6FF" }}>
          {t("chapter7.family_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter7.family_title")}</h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{t("chapter7.family_desc")}</p>
      </div>

      {/* 2-of-2 badge */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          background: "rgba(61,214,255,0.1)", border: "1.5px solid rgba(61,214,255,0.35)",
          borderRadius: "30px", padding: "6px 20px",
          fontSize: "15px", fontWeight: 800, color: "#3DD6FF",
        }}>2-von-2</div>
      </div>

      {/* Signers */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        {[
          { name: "Elena", icon: "👩", color: "#FF9A3D" },
          { name: "David", icon: "👨", color: "#3DD6FF" },
        ].map((s, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.1 }}
            style={{
              background: `rgba(${s.color === "#FF9A3D" ? "255,154,61" : "61,214,255"},0.07)`,
              border: `1px solid ${s.color}33`, borderRadius: "12px", padding: "12px",
              textAlign: "center",
            }}
          >
            <p style={{ margin: "0 0 4px", fontSize: "24px" }}>{s.icon}</p>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: s.color }}>{s.name}</p>
            <p style={{ margin: "2px 0 0", fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>Unterzeichner</p>
          </motion.div>
        ))}
      </div>

      {/* Scenario */}
      <div style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px", padding: "14px",
      }}>
        <p style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {t("chapter7.family_scenario_title")}
        </p>
        <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
          {t("chapter7.family_scenario_text")}
        </p>
      </div>

      {/* Risk warning */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        style={{
          background: "rgba(255,91,91,0.07)", border: "1px solid rgba(255,91,91,0.2)",
          borderRadius: "10px", padding: "10px 14px",
        }}
      >
        <p style={{ margin: 0, fontSize: "12px", color: "#ff5b5b", lineHeight: 1.6 }}>
          ⚠️ {t("chapter7.family_risk")}
        </p>
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
          borderRadius: "14px", padding: "13px 24px", fontSize: "14px", fontWeight: 600,
          color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
        }}
      >{t("chapter7.family_cta")}</motion.button>
    </motion.div>
  );
}

// ─── CompanyVaultCard ──────────────────────────────────────────────────────────

function CompanyVaultCard({ next, t }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#48c78e" }}>
          {t("chapter7.company_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter7.company_title")}</h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{t("chapter7.company_desc")}</p>
      </div>

      {/* 2-of-3 badge */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{
          background: "rgba(72,199,142,0.1)", border: "1.5px solid rgba(72,199,142,0.35)",
          borderRadius: "30px", padding: "6px 20px",
          fontSize: "15px", fontWeight: 800, color: "#48c78e",
        }}>2-von-3</div>
      </div>

      {/* Signers */}
      <div style={{ display: "flex", gap: "8px" }}>
        {[
          { name: "Marco", icon: "☕", color: "#FF9A3D" },
          { name: "Rosa", icon: "👩‍💼", color: "#3DD6FF" },
          { name: "Dr. Weber", icon: "⚖️", color: "#FFD93D" },
        ].map((s, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.1 }}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px", padding: "10px 8px", textAlign: "center",
            }}
          >
            <p style={{ margin: "0 0 4px", fontSize: "22px" }}>{s.icon}</p>
            <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: s.color }}>{s.name}</p>
          </motion.div>
        ))}
      </div>

      {/* Scenario */}
      <div style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px", padding: "14px",
      }}>
        <p style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {t("chapter7.company_scenario_title")}
        </p>
        <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
          {t("chapter7.company_scenario_text")}
        </p>
      </div>

      {/* Risk */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        style={{
          background: "rgba(255,171,0,0.07)", border: "1px solid rgba(255,171,0,0.2)",
          borderRadius: "10px", padding: "10px 14px",
        }}
      >
        <p style={{ margin: 0, fontSize: "12px", color: "#ffab00", lineHeight: 1.6 }}>
          💡 {t("chapter7.company_risk")}
        </p>
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "linear-gradient(135deg, #48c78e, #3DD6FF)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
        }}
      >{t("chapter7.company_cta")}</motion.button>
    </motion.div>
  );
}

// ─── DecisionScene ─────────────────────────────────────────────────────────────

function DecisionScene({ questionKey, options, correctValue, wrongPanels, correctFeedbackKey, retryBtnKey, correctCtaKey, t, next }) {
  const [chosen, setChosen] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [wrongPath, setWrongPath] = useState(null);

  if (wrongPath) {
    const panel = wrongPanels[wrongPath];
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <div style={{
          background: "rgba(255,91,91,0.08)", border: "1px solid rgba(255,91,91,0.2)",
          borderRadius: "14px", padding: "16px",
        }}>
          <p style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 700, color: "#ff5b5b" }}>
            ✗ {t(panel.titleKey)}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
            {t(panel.textKey)}
          </p>
        </div>
        {attempts >= 2 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{
              background: "rgba(255,171,0,0.08)", border: "1px solid rgba(255,171,0,0.25)",
              borderRadius: "10px", padding: "10px 14px",
            }}
          >
            <p style={{ margin: 0, fontSize: "12px", color: "#ffab00", lineHeight: 1.55 }}>
              💡 {t(panel.hint2Key)}
            </p>
          </motion.div>
        )}
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => { setWrongPath(null); setChosen(null); }}
          style={{
            background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.2)",
            borderRadius: "12px", padding: "12px 28px", fontSize: "14px", fontWeight: 700,
            color: "white", fontFamily: "inherit", cursor: "pointer",
          }}
        >🔄 {t(retryBtnKey)}</motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "white", lineHeight: 1.5 }}>
        {t(questionKey)}
      </p>
      {options.map((opt) => {
        const isChosen = chosen === opt.value;
        const isCorrect = opt.value === correctValue;
        return (
          <motion.button
            key={opt.value}
            whileHover={!chosen ? { scale: 1.02 } : {}}
            whileTap={!chosen ? { scale: 0.98 } : {}}
            disabled={!!chosen && !isChosen}
            onClick={() => {
              if (chosen) return;
              setChosen(opt.value);
              if (!isCorrect) {
                setAttempts(a => a + 1);
                setTimeout(() => setWrongPath(opt.value), 500);
              }
            }}
            style={{
              background: isChosen ? (isCorrect ? "rgba(72,199,142,0.15)" : "rgba(255,91,91,0.15)") : "rgba(255,255,255,0.05)",
              border: isChosen ? (isCorrect ? "1.5px solid #48c78e" : "1.5px solid #ff5b5b") : "1.5px solid rgba(255,255,255,0.12)",
              borderRadius: "12px", padding: "13px 16px", textAlign: "left",
              cursor: chosen ? "default" : "pointer", fontFamily: "inherit", width: "100%",
              opacity: (!chosen || isChosen) ? 1 : 0.4, transition: "all 0.2s",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: isChosen ? 700 : 500, color: "white" }}>{t(opt.labelKey)}</span>
          </motion.button>
        );
      })}
      {chosen === correctValue && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "#48c78e", lineHeight: 1.55 }}>
            ✓ {t(correctFeedbackKey)}
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
            style={{
              background: "linear-gradient(135deg, #48c78e, #3DD6FF)", border: "none",
              borderRadius: "12px", padding: "13px 28px", fontSize: "14px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >{t(correctCtaKey)} →</motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── UseCasesCard ──────────────────────────────────────────────────────────────

function UseCasesCard({ next, t }) {
  const cases = [
    { icon: "🏢", title: t("chapter7.usecase1_title"), text: t("chapter7.usecase1_text"), color: "#FF9A3D" },
    { icon: "👨‍👩‍👧", title: t("chapter7.usecase2_title"), text: t("chapter7.usecase2_text"), color: "#3DD6FF" },
    { icon: "🌐", title: t("chapter7.usecase3_title"), text: t("chapter7.usecase3_text"), color: "#48c78e" },
    { icon: "🔐", title: t("chapter7.usecase4_title"), text: t("chapter7.usecase4_text"), color: "#FFD93D" },
    { icon: "🤝", title: t("chapter7.usecase5_title"), text: t("chapter7.usecase5_text"), color: "#c77aff" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#c77aff" }}>
          {t("chapter7.usecases_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter7.usecases_title")}</h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {cases.map((uc, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.08 }}
            style={{
              display: "flex", gap: "12px", alignItems: "flex-start",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px", padding: "12px 14px",
            }}
          >
            <span style={{ fontSize: "22px", flexShrink: 0, marginTop: "1px" }}>{uc.icon}</span>
            <div>
              <p style={{ margin: "0 0 3px", fontSize: "13px", fontWeight: 700, color: uc.color }}>{uc.title}</p>
              <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>{uc.text}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
          borderRadius: "14px", padding: "13px 24px", fontSize: "14px", fontWeight: 600,
          color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
        }}
      >{t("chapter7.usecases_cta")}</motion.button>
    </motion.div>
  );
}

// ─── QuizQuestion ──────────────────────────────────────────────────────────────

function QuizQuestion({ question, choices, correctValue, explanation, hint2, next, t }) {
  const [chosen, setChosen] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [showExplanation, setShowExplanation] = useState(false);

  if (showExplanation) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <div style={{
          background: "rgba(255,91,91,0.08)", border: "1px solid rgba(255,91,91,0.2)",
          borderRadius: "14px", padding: "16px",
        }}>
          <p style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 700, color: "#ff5b5b" }}>
            ✗ {t("chapter7.quiz_wrong")}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>{explanation}</p>
        </div>
        {attempts >= 2 && hint2 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{
              background: "rgba(255,171,0,0.08)", border: "1px solid rgba(255,171,0,0.25)",
              borderRadius: "10px", padding: "10px 14px",
            }}
          >
            <p style={{ margin: 0, fontSize: "12px", color: "#ffab00", lineHeight: 1.55 }}>💡 {hint2}</p>
          </motion.div>
        )}
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => { setChosen(null); setShowExplanation(false); }}
          style={{
            background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.2)",
            borderRadius: "12px", padding: "12px 28px", fontSize: "14px", fontWeight: 700,
            color: "white", fontFamily: "inherit", cursor: "pointer",
          }}
        >🔄 {t("chapter7.quiz_retry")}</motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "white", lineHeight: 1.5 }}>{question}</p>
      {choices.map((c, i) => {
        const isChosen = chosen === c.value;
        const isCorrect = c.value === correctValue;
        return (
          <motion.button
            key={i}
            whileHover={!chosen ? { scale: 1.02 } : {}}
            whileTap={!chosen ? { scale: 0.98 } : {}}
            disabled={!!chosen && !isChosen}
            onClick={() => {
              if (chosen) return;
              setChosen(c.value);
              if (c.value !== correctValue) {
                setAttempts(a => a + 1);
                setTimeout(() => { setChosen(null); setShowExplanation(true); }, 500);
              }
            }}
            style={{
              background: isChosen ? (isCorrect ? "rgba(72,199,142,0.15)" : "rgba(255,91,91,0.15)") : "rgba(255,255,255,0.05)",
              border: isChosen ? (isCorrect ? "1.5px solid #48c78e" : "1.5px solid #ff5b5b") : "1.5px solid rgba(255,255,255,0.12)",
              borderRadius: "12px", padding: "13px 16px", textAlign: "left",
              cursor: chosen ? "default" : "pointer", fontFamily: "inherit", width: "100%",
              opacity: (!chosen || isChosen) ? 1 : 0.4, transition: "all 0.2s",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: isChosen ? 700 : 500, color: "white" }}>{c.label}</span>
          </motion.button>
        );
      })}
      {chosen && chosen === correctValue && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "#48c78e", lineHeight: 1.55 }}>
            ✓ {choices.find(c => c.value === correctValue)?.hint}
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
            style={{
              background: "linear-gradient(135deg, #48c78e, #3DD6FF)", border: "none",
              borderRadius: "12px", padding: "13px 28px", fontSize: "14px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >{t("chapter7.quiz_correct_cta")} →</motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── AdvancedCertificateScreen ─────────────────────────────────────────────────

function AdvancedCertificateScreen({ t, i18n, keypair, onHome }) {
  useEffect(() => {
    const fire = (opts) => confetti({
      particleCount: 120, spread: 90,
      colors: ["#FFD93D", "#3DD6FF", "#48c78e", "#FF9A3D", "#c77aff", "#ffffff"],
      ...opts,
    });
    fire({ origin: { x: 0.25, y: 0.7 } });
    setTimeout(() => fire({ origin: { x: 0.75, y: 0.7 } }), 200);
    setTimeout(() => fire({ origin: { x: 0.5, y: 0.2 }, particleCount: 200 }), 500);
    setTimeout(() => fire({ origin: { x: 0.3, y: 0.5 } }), 900);
    setTimeout(() => fire({ origin: { x: 0.7, y: 0.5 } }), 1100);

    const style = document.createElement("style");
    style.id = "ch7-print-style";
    style.textContent = `@media print {
      body > * { visibility: hidden !important; }
      #ch7-certificate { visibility: visible !important; position: fixed !important;
        top: 0 !important; left: 0 !important; width: 100% !important;
        background: white !important; color: #111 !important;
        border: 2px solid #4a0080 !important; border-radius: 0 !important;
        padding: 40px !important; box-shadow: none !important; }
      #ch7-certificate * { visibility: visible !important; color: #111 !important; }
      #ch7-certificate .cert-xp-badge { background: #f0e8ff !important; border: 1px solid #4a0080 !important; }
    }`;
    document.head.appendChild(style);
    return () => document.getElementById("ch7-print-style")?.remove();
  }, []);

  const pubKey = keypair?.publicKey();
  const truncatedKey = pubKey ? `${pubKey.slice(0, 8)}...${pubKey.slice(-8)}` : "—";
  const dateStr = new Date().toLocaleDateString(i18n.language);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}
    >
      <div
        id="ch7-certificate"
        style={{
          width: "100%",
          background: "linear-gradient(160deg, #1a1a2e, #0f0a1e)",
          border: "2px solid rgba(199,122,255,0.45)", borderRadius: "20px", padding: "28px 24px",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: "16px", textAlign: "center", boxShadow: "0 0 40px rgba(199,122,255,0.15)",
        }}
      >
        <Lumio state="celebrate" size={72} />
        <div>
          <p style={{ margin: "0 0 4px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", color: "rgba(199,122,255,0.7)", textTransform: "uppercase" }}>
            Stellar Konto Manager
          </p>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 900, color: "#c77aff", lineHeight: 1.3 }}>
            {t("chapter7.cert_title")}
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: "14px", color: "#48c78e", fontWeight: 700 }}>{t("chapter7.cert_tagline")}</p>

        <div style={{ width: "100%", height: "1px", background: "rgba(199,122,255,0.15)" }} />

        {/* Public key */}
        <div style={{ width: "100%" }}>
          <p style={{ margin: "0 0 4px", fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("chapter7.cert_public_key_label")}
          </p>
          <p style={{
            margin: 0, fontFamily: "monospace", fontSize: "12px", color: "#a0c4ff",
            background: "rgba(160,196,255,0.08)", padding: "6px 10px", borderRadius: "6px", wordBreak: "break-all",
          }}>
            {truncatedKey}
          </p>
        </div>

        {/* Date */}
        <div style={{ width: "100%" }}>
          <p style={{ margin: "0 0 4px", fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("chapter7.cert_date_label")}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.8)" }}>{dateStr}</p>
        </div>

        {/* Chapters list */}
        <div style={{ width: "100%" }}>
          <p style={{ margin: "0 0 8px", fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("chapter7.cert_chapters_label")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                <span style={{ color: "#48c78e", width: "16px", flexShrink: 0 }}>✓</span>
                <span style={{ color: "rgba(255,255,255,0.75)", flex: 1, textAlign: "left" }}>{t(`chapter${n}.title`)}</span>
                <span style={{ color: "#FFD93D", fontSize: "11px", fontWeight: 700 }}>+{CHAPTER_XP[n - 1]} XP</span>
              </div>
            ))}
          </div>
        </div>

        {/* Badges */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            background: "rgba(255,217,61,0.1)", border: "1px solid rgba(255,217,61,0.3)",
            borderRadius: "20px", padding: "5px 14px", fontSize: "12px",
          }}>
            <span>🥇</span>
            <span style={{ fontWeight: 700, color: "#FFD93D" }}>{t("chapter7.cert_badge1")}</span>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            background: "rgba(199,122,255,0.1)", border: "1px solid rgba(199,122,255,0.3)",
            borderRadius: "20px", padding: "5px 14px", fontSize: "12px",
          }}>
            <span>🏆</span>
            <span style={{ fontWeight: 700, color: "#c77aff" }}>{t("chapter7.cert_badge2")}</span>
          </div>
        </div>

        {/* Total XP */}
        <div
          className="cert-xp-badge"
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            background: "rgba(199,122,255,0.1)", border: "1px solid rgba(199,122,255,0.25)",
            borderRadius: "30px", padding: "8px 20px",
          }}
        >
          <span style={{ fontSize: "20px" }}>⭐</span>
          <span style={{ fontSize: "18px", fontWeight: 800, color: "#c77aff" }}>{TOTAL_XP} {t("chapter7.cert_xp_label")}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => window.print()}
          style={{
            background: "linear-gradient(135deg, #c77aff, #3DD6FF)", border: "none",
            borderRadius: "14px", padding: "14px 24px", fontSize: "15px", fontWeight: 700,
            color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            boxShadow: "0 4px 16px rgba(199,122,255,0.3)",
          }}
        >🖨️ {t("chapter7.cert_print_btn")}</motion.button>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onHome}
          style={{
            background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
            borderRadius: "14px", padding: "13px 24px", fontSize: "14px", fontWeight: 600,
            color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
          }}
        >🏠 {t("chapter7.cert_home_btn")}</motion.button>
      </div>
    </motion.div>
  );
}

// ─── Scene builder ─────────────────────────────────────────────────────────────

function buildScenes({ keypair, completeChapter, openGlossary, setShowChapterSelect, onExit, t, i18n }) {
  return [
    // 0 – Intro narrator
    {
      type: "narrator",
      sectionTitle: t("chapter7.section_intro"),
      lines: [t("chapter7.intro_narrator1"), t("chapter7.intro_narrator2")],
    },
    // 1 – Marco: das Problem
    {
      type: "dialog",
      speaker: "marco",
      lines: [t("chapter7.marco_problem1"), t("chapter7.marco_problem2")],
    },
    // 2 – Rosa: Bedenken
    {
      type: "dialog",
      speaker: "rosa",
      lines: [t("chapter7.rosa_concern")],
    },
    // 3 – Lumio: Lösung
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter7.lumio_solution")],
    },
    // 4 – Was ist Multisig?
    {
      type: "custom",
      sectionTitle: t("chapter7.section_explain"),
      render: (next) => <MultisigExplainCard next={next} t={t} openGlossary={openGlossary} />,
    },
    // 5 – Familien-Sparkasse 2-von-2
    {
      type: "custom",
      sectionTitle: t("chapter7.section_family"),
      render: (next) => <FamilySavingsCard next={next} t={t} />,
    },
    // 6 – Entscheidungsszene 1: Was passiert wenn Elena ihren Key verliert?
    {
      type: "custom",
      sectionTitle: t("chapter7.section_decision1"),
      render: (next) => (
        <DecisionScene
          questionKey="chapter7.d1_question"
          correctValue="a3"
          options={[
            { value: "a1", labelKey: "chapter7.d1_a1" },
            { value: "a2", labelKey: "chapter7.d1_a2" },
            { value: "a3", labelKey: "chapter7.d1_a3" },
          ]}
          wrongPanels={{
            a1: { titleKey: "chapter7.d1_wrong_a1_title", textKey: "chapter7.d1_wrong_a1_text", hint2Key: "chapter7.d1_wrong_a1_hint2" },
            a2: { titleKey: "chapter7.d1_wrong_a2_title", textKey: "chapter7.d1_wrong_a2_text", hint2Key: "chapter7.d1_wrong_a2_hint2" },
          }}
          correctFeedbackKey="chapter7.d1_correct_lumio"
          retryBtnKey="chapter7.retry_btn"
          correctCtaKey="chapter7.quiz_correct_cta"
          t={t} next={next}
        />
      ),
    },
    // 7 – Firmen-Tresor 2-von-3
    {
      type: "custom",
      sectionTitle: t("chapter7.section_company"),
      render: (next) => <CompanyVaultCard next={next} t={t} />,
    },
    // 8 – Entscheidungsszene 2: Welches Setup wählt Marco?
    {
      type: "custom",
      sectionTitle: t("chapter7.section_decision2"),
      render: (next) => (
        <DecisionScene
          questionKey="chapter7.d2_question"
          correctValue="a3"
          options={[
            { value: "a1", labelKey: "chapter7.d2_a1" },
            { value: "a2", labelKey: "chapter7.d2_a2" },
            { value: "a3", labelKey: "chapter7.d2_a3" },
          ]}
          wrongPanels={{
            a1: { titleKey: "chapter7.d2_wrong_a1_title", textKey: "chapter7.d2_wrong_a1_text", hint2Key: "chapter7.d2_wrong_a1_hint2" },
            a2: { titleKey: "chapter7.d2_wrong_a2_title", textKey: "chapter7.d2_wrong_a2_text", hint2Key: "chapter7.d2_wrong_a2_hint2" },
          }}
          correctFeedbackKey="chapter7.d2_correct_lumio"
          retryBtnKey="chapter7.retry_btn"
          correctCtaKey="chapter7.quiz_correct_cta"
          t={t} next={next}
        />
      ),
    },
    // 9 – Anwendungsfälle
    {
      type: "custom",
      sectionTitle: t("chapter7.section_usecases"),
      render: (next) => <UseCasesCard next={next} t={t} />,
    },
    // 10–13 – Quiz (4 Fragen)
    {
      type: "custom",
      sectionTitle: t("chapter7.section_quiz"),
      render: (next) => (
        <QuizQuestion
          question={t("chapter7.quiz1_q")} correctValue="a2"
          choices={[
            { value: "a1", label: t("chapter7.quiz1_a1"), hint: t("chapter7.quiz1_a1_hint") },
            { value: "a2", label: t("chapter7.quiz1_a2"), hint: t("chapter7.quiz1_a2_hint") },
            { value: "a3", label: t("chapter7.quiz1_a3"), hint: t("chapter7.quiz1_a3_hint") },
          ]}
          explanation={t("chapter7.quiz1_explanation")} hint2={t("chapter7.quiz1_hint2")}
          next={next} t={t}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter7.quiz2_q")} correctValue="a2"
          choices={[
            { value: "a1", label: t("chapter7.quiz2_a1"), hint: t("chapter7.quiz2_a1_hint") },
            { value: "a2", label: t("chapter7.quiz2_a2"), hint: t("chapter7.quiz2_a2_hint") },
            { value: "a3", label: t("chapter7.quiz2_a3"), hint: t("chapter7.quiz2_a3_hint") },
          ]}
          explanation={t("chapter7.quiz2_explanation")} hint2={t("chapter7.quiz2_hint2")}
          next={next} t={t}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter7.quiz3_q")} correctValue="a1"
          choices={[
            { value: "a1", label: t("chapter7.quiz3_a1"), hint: t("chapter7.quiz3_a1_hint") },
            { value: "a2", label: t("chapter7.quiz3_a2"), hint: t("chapter7.quiz3_a2_hint") },
            { value: "a3", label: t("chapter7.quiz3_a3"), hint: t("chapter7.quiz3_a3_hint") },
          ]}
          explanation={t("chapter7.quiz3_explanation")} hint2={t("chapter7.quiz3_hint2")}
          next={next} t={t}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter7.quiz4_q")} correctValue="a3"
          choices={[
            { value: "a1", label: t("chapter7.quiz4_a1"), hint: t("chapter7.quiz4_a1_hint") },
            { value: "a2", label: t("chapter7.quiz4_a2"), hint: t("chapter7.quiz4_a2_hint") },
            { value: "a3", label: t("chapter7.quiz4_a3"), hint: t("chapter7.quiz4_a3_hint") },
          ]}
          explanation={t("chapter7.quiz4_explanation")} hint2={t("chapter7.quiz4_hint2")}
          next={next} t={t}
        />
      ),
    },
    // 14 – ChapterSummary (isLast → "Zertifikat ansehen"-Button)
    {
      type: "custom",
      render: (next) => (
        <ChapterSummary
          chapter={7}
          title={t("chapter7.title")}
          xpEarned={200}
          isLast
          onNext={() => { completeChapter(7, 200); next(); }}
          learnings={[
            t("chapter7.learning1"),
            t("chapter7.learning2"),
            t("chapter7.learning3"),
            { text: t("chapter7.learning4"), type: "warning" },
          ]}
        />
      ),
    },
    // 15 – Fortgeschrittenen-Zertifikat
    {
      type: "custom",
      sectionTitle: t("chapter7.section_cert"),
      render: () => (
        <AdvancedCertificateScreen t={t} i18n={i18n} keypair={keypair} onHome={onExit} />
      ),
    },
  ];
}

// ─── Chapter7 component ────────────────────────────────────────────────────────

export default function Chapter7() {
  const { keypair, completeChapter, openGlossary, setShowChapterSelect, onExit } = useStory();
  const { t, i18n } = useTranslation("story");

  const scenes = buildScenes({
    keypair, completeChapter, openGlossary, setShowChapterSelect, onExit, t, i18n,
  });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => setShowChapterSelect(true)}
    />
  );
}
