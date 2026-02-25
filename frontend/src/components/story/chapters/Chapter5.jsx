/**
 * Kapitel 5 – Lumios Mission
 */
import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { useTranslation } from "react-i18next";
import { useStory } from "../StoryContext";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";
import Lumio from "../../quiz/Lumio";
import { sendPayment, friendbotFund } from "../TestnetAction";

// TESTNET ONLY – Lena's simulated address (same as Cosmo in Ch2)
const LENA_PUBLIC_KEY = "GDTGA55CCRAMSW4KZFAIOCTYYS7H6UI7X7VWKOVPAYQSGEG6QI2ZCC4R";

async function ensureLenaFunded() {
  try {
    const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${LENA_PUBLIC_KEY}`);
    if (res.ok) return;
    await friendbotFund(LENA_PUBLIC_KEY);
  } catch {
    try { await friendbotFund(LENA_PUBLIC_KEY); } catch { /* ignore */ }
  }
}

// ─── RecapCard ──────────────────────────────────────────────────────────────

function RecapCard({ next, t, openGlossary }) {
  const lessons = [
    { icon: "🏦", title: t("chapter5.lesson1_title"), text: t("chapter5.lesson1_text"), glossary: "wallet" },
    { icon: "⚡", title: t("chapter5.lesson2_title"), text: t("chapter5.lesson2_text"), glossary: "transaction" },
    { icon: "🔗", title: t("chapter5.lesson3_title"), text: t("chapter5.lesson3_text"), glossary: "trustLine" },
    { icon: "⚓", title: t("chapter5.lesson4_title"), text: t("chapter5.lesson4_text"), glossary: "anchor" },
    { icon: "🔑", title: t("chapter5.lesson5_title"), text: t("chapter5.lesson5_text"), glossary: "privateKey" },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#FFD93D" }}>
          {t("chapter5.recap_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter5.recap_title")}</h3>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {lessons.map((lesson, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
            style={{
              display: "flex", gap: "12px", alignItems: "flex-start",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px", padding: "12px 14px",
            }}
          >
            <span style={{ fontSize: "22px", flexShrink: 0, marginTop: "1px" }}>{lesson.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "white" }}>{lesson.title}</p>
                <button
                  onClick={() => openGlossary(lesson.glossary)}
                  style={{
                    background: "rgba(255,217,61,0.12)", border: "1px solid rgba(255,217,61,0.3)",
                    borderRadius: "50%", width: "18px", height: "18px", fontSize: "10px", color: "#FFD93D",
                    cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0, padding: 0,
                  }}
                >?</button>
              </div>
              <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>{lesson.text}</p>
            </div>
          </motion.div>
        ))}
      </div>
      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "linear-gradient(135deg, #FFD93D, #FF9A3D)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
          boxShadow: "0 4px 16px rgba(255,217,61,0.3)",
        }}
      >{t("chapter5.recap_cta")}</motion.button>
    </motion.div>
  );
}

// ─── UseCasesCard ────────────────────────────────────────────────────────────

function UseCasesCard({ next, t }) {
  const usecases = [
    { icon: "🌍", title: t("chapter5.usecase1_title"), text: t("chapter5.usecase1_text") },
    { icon: "☕", title: t("chapter5.usecase2_title"), text: t("chapter5.usecase2_text") },
    { icon: "🏧", title: t("chapter5.usecase3_title"), text: t("chapter5.usecase3_text") },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#3DD6FF" }}>
          {t("chapter5.usecases_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter5.usecases_title")}</h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{t("chapter5.usecases_desc")}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {usecases.map((uc, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.12 }}
            style={{
              background: "linear-gradient(135deg, rgba(61,214,255,0.06), rgba(72,199,142,0.06))",
              border: "1px solid rgba(61,214,255,0.15)", borderRadius: "14px", padding: "14px 16px",
            }}
          >
            <p style={{ margin: "0 0 5px", fontSize: "22px" }}>{uc.icon}</p>
            <p style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 700, color: "white" }}>{uc.title}</p>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.55 }}>{uc.text}</p>
          </motion.div>
        ))}
      </div>
      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "linear-gradient(135deg, #3DD6FF, #48c78e)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
        }}
      >{t("chapter5.usecases_cta")}</motion.button>
    </motion.div>
  );
}

// ─── QuizQuestion ────────────────────────────────────────────────────────────

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
            ✗ {t("chapter5.quiz_wrong")}
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
        >🔄 {t("chapter5.quiz_retry")}</motion.button>
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
              background: isChosen
                ? (isCorrect ? "rgba(72,199,142,0.15)" : "rgba(255,91,91,0.15)")
                : "rgba(255,255,255,0.05)",
              border: isChosen
                ? (isCorrect ? "1.5px solid #48c78e" : "1.5px solid #ff5b5b")
                : "1.5px solid rgba(255,255,255,0.12)",
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
          >{t("chapter5.quiz_correct_cta")} →</motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── CertificateScreen ───────────────────────────────────────────────────────

const CHAPTER_XP = [100, 110, 120, 150, 200];
const TOTAL_XP = CHAPTER_XP.reduce((a, b) => a + b, 0); // 680

function CertificateScreen({ t, i18n, keypair, onHome }) {
  useEffect(() => {
    const fire = (opts) => confetti({
      particleCount: 100, spread: 80,
      colors: ["#FFD93D", "#3DD6FF", "#48c78e", "#FF9A3D", "#ffffff"],
      ...opts,
    });
    fire({ origin: { x: 0.3, y: 0.6 } });
    setTimeout(() => fire({ origin: { x: 0.7, y: 0.6 } }), 250);
    setTimeout(() => fire({ origin: { x: 0.5, y: 0.3 }, particleCount: 160 }), 600);

    const style = document.createElement("style");
    style.id = "ch5-print-style";
    style.textContent = `@media print {
      body > * { visibility: hidden !important; }
      #ch5-certificate { visibility: visible !important; position: fixed !important;
        top: 0 !important; left: 0 !important; width: 100% !important;
        background: white !important; color: #111 !important;
        border: 2px solid #b8860b !important; border-radius: 0 !important;
        padding: 40px !important; box-shadow: none !important; }
      #ch5-certificate * { visibility: visible !important; color: #111 !important; }
      #ch5-certificate .cert-xp-badge { background: #f5f0d0 !important; border: 1px solid #b8860b !important; }
    }`;
    document.head.appendChild(style);
    return () => document.getElementById("ch5-print-style")?.remove();
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
        id="ch5-certificate"
        style={{
          width: "100%",
          background: "linear-gradient(160deg, #1a1a2e, #0f1a2e)",
          border: "2px solid rgba(255,217,61,0.45)", borderRadius: "20px", padding: "28px 24px",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: "16px", textAlign: "center", boxShadow: "0 0 40px rgba(255,217,61,0.15)",
        }}
      >
        <Lumio state="celebrate" size={72} />
        <div>
          <p style={{ margin: "0 0 4px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,217,61,0.7)", textTransform: "uppercase" }}>
            Stellar Konto Manager
          </p>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 900, color: "#FFD93D", lineHeight: 1.3 }}>
            {t("chapter5.cert_title")}
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: "14px", color: "#48c78e", fontWeight: 700 }}>{t("chapter5.cert_tagline")}</p>
        <div style={{ width: "100%", height: "1px", background: "rgba(255,217,61,0.15)" }} />
        <div style={{ width: "100%" }}>
          <p style={{ margin: "0 0 4px", fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("chapter5.cert_public_key_label")}
          </p>
          <p style={{
            margin: 0, fontFamily: "monospace", fontSize: "12px", color: "#a0c4ff",
            background: "rgba(160,196,255,0.08)", padding: "6px 10px", borderRadius: "6px", wordBreak: "break-all",
          }}>
            {truncatedKey}
          </p>
        </div>
        <div style={{ width: "100%" }}>
          <p style={{ margin: "0 0 4px", fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("chapter5.cert_date_label")}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.8)" }}>{dateStr}</p>
        </div>
        <div style={{ width: "100%" }}>
          <p style={{ margin: "0 0 8px", fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("chapter5.cert_chapters_label")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {[1, 2, 3, 4, 5].map(n => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                <span style={{ color: "#48c78e", width: "16px", flexShrink: 0 }}>✓</span>
                <span style={{ color: "rgba(255,255,255,0.75)", flex: 1, textAlign: "left" }}>{t(`chapter${n}.title`)}</span>
                <span style={{ color: "#FFD93D", fontSize: "11px", fontWeight: 700 }}>+{CHAPTER_XP[n - 1]} XP</span>
              </div>
            ))}
          </div>
        </div>
        <div
          className="cert-xp-badge"
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            background: "rgba(255,217,61,0.1)", border: "1px solid rgba(255,217,61,0.25)",
            borderRadius: "30px", padding: "8px 20px",
          }}
        >
          <span style={{ fontSize: "20px" }}>⭐</span>
          <span style={{ fontSize: "18px", fontWeight: 800, color: "#FFD93D" }}>{TOTAL_XP} {t("chapter5.cert_xp_label")}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => window.print()}
          style={{
            background: "linear-gradient(135deg, #FFD93D, #FF9A3D)", border: "none",
            borderRadius: "14px", padding: "14px 24px", fontSize: "15px", fontWeight: 700,
            color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            boxShadow: "0 4px 16px rgba(255,217,61,0.3)",
          }}
        >🖨️ {t("chapter5.cert_print_btn")}</motion.button>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onHome}
          style={{
            background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
            borderRadius: "14px", padding: "13px 24px", fontSize: "14px", fontWeight: 600,
            color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
          }}
        >🏠 {t("chapter5.cert_home_btn")}</motion.button>
      </div>
    </motion.div>
  );
}

// ─── Scene builder ───────────────────────────────────────────────────────────

function buildScenes({ keypair, completeChapter, openGlossary, setShowChapterSelect, onExit, t, i18n }) {
  return [
    // 0 – Intro narrator
    {
      type: "narrator",
      sectionTitle: t("chapter5.section_intro"),
      lines: [t("chapter5.intro_narrator1"), t("chapter5.intro_narrator2")],
    },
    // 1 – Lumio dialog
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter5.lumio_intro1"), t("chapter5.lumio_intro2")],
    },
    // 2 – Lena introduction (custom)
    {
      type: "custom",
      render: (next) => (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: "10px",
            background: "rgba(72,199,142,0.07)", border: "1px solid rgba(72,199,142,0.2)",
            borderRadius: "14px", padding: "12px 14px",
          }}>
            <span style={{ fontSize: "28px" }}>👧</span>
            <div>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#48c78e" }}>Lena</p>
              <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{t("chapter5.lena_age")}</p>
            </div>
          </div>
          {[t("chapter5.lena_greeting"), t("chapter5.lena_request")].map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.2 }}
              style={{
                background: "rgba(72,199,142,0.07)", border: "1px solid rgba(72,199,142,0.15)",
                borderRadius: "0 12px 12px 12px", padding: "10px 13px", maxWidth: "90%",
              }}
            >
              <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.85)", lineHeight: 1.55 }}>{msg}</p>
            </motion.div>
          ))}
          <motion.button
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
            style={{
              background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
              borderRadius: "12px", padding: "13px 24px", fontSize: "14px", fontWeight: 600,
              color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
            }}
          >{t("chapter5.lumio_accept")} →</motion.button>
        </motion.div>
      ),
    },
    // 3 – Recap card
    {
      type: "custom",
      sectionTitle: t("chapter5.section_recap"),
      render: (next) => <RecapCard next={next} t={t} openGlossary={openGlossary} />,
    },
    // 4 – Use cases card
    {
      type: "custom",
      sectionTitle: t("chapter5.section_usecases"),
      render: (next) => <UseCasesCard next={next} t={t} />,
    },
    // 5 – Marco action dialog
    {
      type: "dialog",
      speaker: "marco",
      sectionTitle: t("chapter5.section_action"),
      lines: [t("chapter5.marco_action1"), t("chapter5.marco_action2")],
    },
    // 6 – Send XLM to Lena
    {
      type: "action",
      actionId: "send_lena_ch5",
      icon: "💫",
      label: t("chapter5.action_label"),
      description: t("chapter5.action_desc"),
      xpReward: 50,
      execute: async (kp) => {
        if (!kp) throw new Error(t("chapter5.action_error"));
        await ensureLenaFunded();
        return sendPayment({
          sourceKeypair: kp,
          destinationPublicKey: LENA_PUBLIC_KEY, // TESTNET ONLY
          amount: "1",
          memo: "Hi Lena",
        });
      },
    },
    // 7 – Lumio after action
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter5.after_action")],
    },
    // 8-12 – Quiz questions
    {
      type: "custom",
      sectionTitle: t("chapter5.section_quiz"),
      render: (next) => (
        <QuizQuestion
          question={t("chapter5.quiz1_q")} correctValue="a2"
          choices={[
            { value: "a1", label: t("chapter5.quiz1_a1"), hint: t("chapter5.quiz1_a1_hint") },
            { value: "a2", label: t("chapter5.quiz1_a2"), hint: t("chapter5.quiz1_a2_hint") },
            { value: "a3", label: t("chapter5.quiz1_a3"), hint: t("chapter5.quiz1_a3_hint") },
          ]}
          explanation={t("chapter5.quiz1_explanation")} hint2={t("chapter5.quiz1_hint2")}
          next={next} t={t}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter5.quiz2_q")} correctValue="a2"
          choices={[
            { value: "a1", label: t("chapter5.quiz2_a1"), hint: t("chapter5.quiz2_a1_hint") },
            { value: "a2", label: t("chapter5.quiz2_a2"), hint: t("chapter5.quiz2_a2_hint") },
            { value: "a3", label: t("chapter5.quiz2_a3"), hint: t("chapter5.quiz2_a3_hint") },
          ]}
          explanation={t("chapter5.quiz2_explanation")} hint2={t("chapter5.quiz2_hint2")}
          next={next} t={t}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter5.quiz3_q")} correctValue="a3"
          choices={[
            { value: "a1", label: t("chapter5.quiz3_a1"), hint: t("chapter5.quiz3_a1_hint") },
            { value: "a2", label: t("chapter5.quiz3_a2"), hint: t("chapter5.quiz3_a2_hint") },
            { value: "a3", label: t("chapter5.quiz3_a3"), hint: t("chapter5.quiz3_a3_hint") },
          ]}
          explanation={t("chapter5.quiz3_explanation")} hint2={t("chapter5.quiz3_hint2")}
          next={next} t={t}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter5.quiz4_q")} correctValue="a3"
          choices={[
            { value: "a1", label: t("chapter5.quiz4_a1"), hint: t("chapter5.quiz4_a1_hint") },
            { value: "a2", label: t("chapter5.quiz4_a2"), hint: t("chapter5.quiz4_a2_hint") },
            { value: "a3", label: t("chapter5.quiz4_a3"), hint: t("chapter5.quiz4_a3_hint") },
          ]}
          explanation={t("chapter5.quiz4_explanation")} hint2={t("chapter5.quiz4_hint2")}
          next={next} t={t}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter5.quiz5_q")} correctValue="a2"
          choices={[
            { value: "a1", label: t("chapter5.quiz5_a1"), hint: t("chapter5.quiz5_a1_hint") },
            { value: "a2", label: t("chapter5.quiz5_a2"), hint: t("chapter5.quiz5_a2_hint") },
            { value: "a3", label: t("chapter5.quiz5_a3"), hint: t("chapter5.quiz5_a3_hint") },
          ]}
          explanation={t("chapter5.quiz5_explanation")} hint2={t("chapter5.quiz5_hint2")}
          next={next} t={t}
        />
      ),
    },
    // 13 – Chapter summary (isLast triggers certificate CTA)
    {
      type: "custom",
      render: (next) => (
        <ChapterSummary
          chapter={5}
          title={t("chapter5.title")}
          xpEarned={200}
          isLast
          onNext={() => { completeChapter(5, 200); next(); }}
          learnings={[
            t("chapter5.learning1"),
            t("chapter5.learning2"),
            t("chapter5.learning3"),
            { text: t("chapter5.learning4"), type: "warning" },
            { text: t("chapter5.learning5"), type: "warning" },
          ]}
        />
      ),
    },
    // 14 – Certificate
    {
      type: "custom",
      sectionTitle: t("chapter5.section_cert"),
      render: () => (
        <CertificateScreen t={t} i18n={i18n} keypair={keypair} onHome={onExit} />
      ),
    },
  ];
}

// ─── Chapter5 component ──────────────────────────────────────────────────────

export default function Chapter5() {
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
