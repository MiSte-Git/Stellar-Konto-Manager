/**
 * Kapitel 6 – Der Buchhalter
 * Thema: Muxed Accounts – virtuelle Sub-Adressen für Lohnbuchhaltung
 */
import React, { useState } from "react";
import { motion } from "framer-motion";
import * as StellarSdk from "@stellar/stellar-sdk";
import { useTranslation } from "react-i18next";
import { useStory } from "../StoryContext";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";

// ─── Testnet constants ────────────────────────────────────────────────────────

// TESTNET ONLY – Muxed Account Demo-Basisadresse (dieselbe wie Cosmo/Lena)
const DEMO_BASE_KEY = "GDTGA55CCRAMSW4KZFAIOCTYYS7H6UI7X7VWKOVPAYQSGEG6QI2ZCC4R";
const DEMO_MUXED_ID = "42"; // numerische ID für die Muxed-Demo
const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";

/** Konstruiert die M-Adresse aus Basis-G-Adresse + ID */
function getMuxedAddress() {
  // TESTNET ONLY – StellarSdk.MuxedAccount verbindet G-Adresse + numerische ID zu M-Adresse
  const kp = StellarSdk.Keypair.fromPublicKey(DEMO_BASE_KEY);
  return new StellarSdk.MuxedAccount(kp, DEMO_MUXED_ID).accountId();
}

async function ensureDemoFunded() {
  try {
    const res = await fetch(`${HORIZON_TESTNET}/accounts/${DEMO_BASE_KEY}`);
    if (!res.ok) await fetch(`${FRIENDBOT_URL}?addr=${DEMO_BASE_KEY}`);
  } catch {
    try { await fetch(`${FRIENDBOT_URL}?addr=${DEMO_BASE_KEY}`); } catch { /* ignore */ }
  }
}

async function sendMuxedPayment(sourceKeypair) {
  if (!sourceKeypair) throw new Error("no_keypair");
  await ensureDemoFunded();

  // TESTNET ONLY – Zahlung an die M-Adresse (Basis + Muxed-ID)
  const mAddress = getMuxedAddress();
  const server = new StellarSdk.Horizon.Server(HORIZON_TESTNET);
  const account = await server.loadAccount(sourceKeypair.publicKey());

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: mAddress, // TESTNET ONLY – M-Adresse als Ziel
      asset: StellarSdk.Asset.native(),
      amount: "1",
    }))
    .setTimeout(30)
    .build();

  tx.sign(sourceKeypair);
  const result = await server.submitTransaction(tx);
  return { result, mAddress };
}

// ─── MuxedVisualCard ──────────────────────────────────────────────────────────

function MuxedVisualCard({ next, t, openGlossary }) {
  const baseShort = `${DEMO_BASE_KEY.slice(0, 6)}…${DEMO_BASE_KEY.slice(-4)}`;
  const employees = [
    { id: "0001", name: "Anna", role: t("chapter6.explain_anna"), color: "#FF9A3D" },
    { id: "0002", name: "Ben",  role: t("chapter6.explain_ben"),  color: "#3DD6FF" },
    { id: "0003", name: "Clara",role: t("chapter6.explain_clara"), color: "#48c78e" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#FFD93D" }}>
          {t("chapter6.explain_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter6.explain_title")}</h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{t("chapter6.explain_desc")}</p>
      </div>

      {/* Visual: G-Adresse → M-Adressen */}
      <div style={{
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "14px", padding: "16px",
      }}>
        {/* Basis-G-Adresse */}
        <div style={{
          display: "flex", alignItems: "center", gap: "10px",
          background: "rgba(255,217,61,0.08)", border: "1px solid rgba(255,217,61,0.25)",
          borderRadius: "10px", padding: "10px 12px", marginBottom: "4px",
        }}>
          <span style={{ fontSize: "18px" }}>🏢</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,217,61,0.7)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("chapter6.explain_base_label")}
            </p>
            <p style={{ margin: 0, fontFamily: "monospace", fontSize: "12px", color: "#FFD93D" }}>{baseShort}</p>
          </div>
          <button
            onClick={() => openGlossary("muxedAccount")}
            style={{
              background: "rgba(255,217,61,0.12)", border: "1px solid rgba(255,217,61,0.3)",
              borderRadius: "50%", width: "20px", height: "20px", fontSize: "11px", color: "#FFD93D",
              cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center",
              justifyContent: "center", padding: 0, flexShrink: 0,
            }}
          >?</button>
        </div>

        {/* Arrow */}
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0", fontSize: "18px", color: "rgba(255,255,255,0.3)" }}>↓</div>

        {/* M-Adressen */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {employees.map((emp, i) => (
            <motion.div
              key={emp.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.1 }}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                background: `rgba(${emp.color === "#FF9A3D" ? "255,154,61" : emp.color === "#3DD6FF" ? "61,214,255" : "72,199,142"},0.07)`,
                border: `1px solid ${emp.color}33`,
                borderRadius: "8px", padding: "8px 10px",
              }}
            >
              <span style={{
                fontFamily: "monospace", fontSize: "10px", fontWeight: 700,
                color: emp.color, background: `${emp.color}18`,
                padding: "2px 6px", borderRadius: "4px", flexShrink: 0,
              }}>
                M-…-{emp.id}
              </span>
              <span style={{ fontSize: "13px", color: "white", fontWeight: 600 }}>{emp.name}</span>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", flex: 1 }}>{emp.role}</span>
            </motion.div>
          ))}
        </div>

        <p style={{ margin: "10px 0 0", fontSize: "12px", color: "rgba(255,255,255,0.5)", lineHeight: 1.6, textAlign: "center" }}>
          {t("chapter6.explain_flow_desc")}
        </p>
      </div>

      {/* Memo vs. Muxed */}
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px", padding: "14px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "white" }}>{t("chapter6.explain_memo_vs_title")}</p>
          <button
            onClick={() => openGlossary("memo")}
            style={{
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "50%", width: "18px", height: "18px", fontSize: "10px", color: "rgba(255,255,255,0.6)",
              cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center",
              justifyContent: "center", padding: 0, flexShrink: 0,
            }}
          >?</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <div style={{
            background: "rgba(255,91,91,0.07)", border: "1px solid rgba(255,91,91,0.2)",
            borderRadius: "8px", padding: "10px",
          }}>
            <p style={{ margin: "0 0 5px", fontSize: "12px", fontWeight: 700, color: "#ff5b5b" }}>Memo ✗</p>
            <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>{t("chapter6.explain_memo_desc")}</p>
          </div>
          <div style={{
            background: "rgba(72,199,142,0.07)", border: "1px solid rgba(72,199,142,0.25)",
            borderRadius: "8px", padding: "10px",
          }}>
            <p style={{ margin: "0 0 5px", fontSize: "12px", fontWeight: 700, color: "#48c78e" }}>Muxed ✓</p>
            <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>{t("chapter6.explain_muxed_desc")}</p>
          </div>
        </div>
      </div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "linear-gradient(135deg, #FFD93D, #FF9A3D)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
          boxShadow: "0 4px 16px rgba(255,217,61,0.3)",
        }}
      >{t("chapter6.explain_cta")}</motion.button>
    </motion.div>
  );
}

// ─── PayrollCard ──────────────────────────────────────────────────────────────

function PayrollCard({ next, t }) {
  const steps = [
    t("chapter6.payroll_step1"),
    t("chapter6.payroll_step2"),
    t("chapter6.payroll_step3"),
    t("chapter6.payroll_step4"),
    t("chapter6.payroll_step5"),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#48c78e" }}>
          {t("chapter6.payroll_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter6.payroll_title")}</h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {steps.map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
            style={{
              display: "flex", gap: "12px", alignItems: "flex-start",
              background: "rgba(72,199,142,0.05)", border: "1px solid rgba(72,199,142,0.12)",
              borderRadius: "10px", padding: "11px 13px",
            }}
          >
            <span style={{
              width: "22px", height: "22px", borderRadius: "50%",
              background: "rgba(72,199,142,0.18)", border: "1px solid rgba(72,199,142,0.3)",
              color: "#48c78e", fontSize: "12px", fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>{i + 1}</span>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.8)", lineHeight: 1.6 }}>{step}</p>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.65 }}
        style={{
          background: "rgba(255,217,61,0.06)", border: "1px solid rgba(255,217,61,0.2)",
          borderRadius: "10px", padding: "10px 14px",
        }}
      >
        <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,217,61,0.85)", lineHeight: 1.6 }}>
          💡 {t("chapter6.payroll_note")}
        </p>
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.75 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "linear-gradient(135deg, #48c78e, #3DD6FF)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
        }}
      >{t("chapter6.payroll_cta")}</motion.button>
    </motion.div>
  );
}

// ─── UseCasesCard ─────────────────────────────────────────────────────────────

function UseCasesCard({ next, t }) {
  const cases = [
    { icon: "🏦", title: t("chapter6.exchange_title"), text: t("chapter6.exchange_text"), color: "#3DD6FF" },
    { icon: "🛒", title: t("chapter6.shop_title"),    text: t("chapter6.shop_text"),    color: "#FF9A3D" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#3DD6FF" }}>
          {t("chapter6.usecases_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>{t("chapter6.usecases_title")}</h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {cases.map((uc, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.15 }}
            style={{
              background: "rgba(255,255,255,0.04)", border: `1px solid ${uc.color}22`,
              borderRadius: "14px", padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "24px", flexShrink: 0 }}>{uc.icon}</span>
              <div>
                <p style={{ margin: "0 0 5px", fontSize: "14px", fontWeight: 700, color: uc.color }}>{uc.title}</p>
                <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>{uc.text}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
          borderRadius: "14px", padding: "13px 24px", fontSize: "14px", fontWeight: 600,
          color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
        }}
      >{t("chapter6.usecases_cta")}</motion.button>
    </motion.div>
  );
}

// ─── DecisionScene ────────────────────────────────────────────────────────────

function DecisionScene({ next, t }) {
  const [chosen, setChosen] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [wrongPath, setWrongPath] = useState(null); // "a1" | "a2" | null

  const options = [
    { value: "a1", label: t("chapter6.decision_a1") },
    { value: "a2", label: t("chapter6.decision_a2") },
    { value: "a3", label: t("chapter6.decision_a3") },
  ];

  if (wrongPath) {
    const isA1 = wrongPath === "a1";
    const titleKey = isA1 ? "chapter6.wrong_a1_title" : "chapter6.wrong_a2_title";
    const textKey  = isA1 ? "chapter6.wrong_a1_text"  : "chapter6.wrong_a2_text";
    const hint2Key = isA1 ? "chapter6.wrong_a1_hint2" : "chapter6.wrong_a2_hint2";

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        {/* Wrong path panel */}
        <div style={{
          background: "rgba(255,91,91,0.08)", border: "1px solid rgba(255,91,91,0.2)",
          borderRadius: "14px", padding: "16px",
        }}>
          <p style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 700, color: "#ff5b5b" }}>
            ✗ {t(titleKey)}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
            {t(textKey)}
          </p>
        </div>

        {/* Extra hint after 2 attempts */}
        {attempts >= 2 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{
              background: "rgba(255,171,0,0.08)", border: "1px solid rgba(255,171,0,0.25)",
              borderRadius: "10px", padding: "10px 14px",
            }}
          >
            <p style={{ margin: 0, fontSize: "12px", color: "#ffab00", lineHeight: 1.55 }}>
              💡 {t(hint2Key)}
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
        >🔄 {t("chapter6.retry_btn")}</motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "white", lineHeight: 1.5 }}>
        {t("chapter6.decision_question")}
      </p>

      {options.map((opt) => {
        const isChosen = chosen === opt.value;
        const isCorrect = opt.value === "a3";
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
            <span style={{ fontSize: "14px", fontWeight: isChosen ? 700 : 500, color: "white" }}>{opt.label}</span>
          </motion.button>
        );
      })}

      {/* Correct path feedback */}
      {chosen === "a3" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "#48c78e", lineHeight: 1.55 }}>
            ✓ {t("chapter6.correct_sofia")}
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
            style={{
              background: "linear-gradient(135deg, #48c78e, #3DD6FF)", border: "none",
              borderRadius: "12px", padding: "13px 28px", fontSize: "14px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >{t("chapter6.quiz_correct_cta")} →</motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── QuizQuestion ─────────────────────────────────────────────────────────────

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
            ✗ {t("chapter6.quiz_wrong")}
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
        >🔄 {t("chapter6.quiz_retry")}</motion.button>
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
          >{t("chapter6.quiz_correct_cta")} →</motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Scene builder ────────────────────────────────────────────────────────────

function buildScenes({ keypair, completeChapter, openGlossary, setShowChapterSelect, t }) {
  return [
    // 0 – Intro narrator
    {
      type: "narrator",
      sectionTitle: t("chapter6.section_intro"),
      lines: [t("chapter6.intro_narrator1"), t("chapter6.intro_narrator2")],
    },
    // 1 – Marco klagt
    {
      type: "dialog",
      speaker: "marco",
      lines: [t("chapter6.marco_chaos1"), t("chapter6.marco_chaos2")],
    },
    // 2 – Sofia frustriert
    {
      type: "dialog",
      speaker: "sofia",
      lines: [t("chapter6.sofia_frustrated1"), t("chapter6.sofia_frustrated2")],
    },
    // 3 – Lumio kennt die Lösung
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter6.lumio_fix")],
    },
    // 4 – Muxed Account Erklärung
    {
      type: "custom",
      sectionTitle: t("chapter6.section_explain"),
      render: (next) => <MuxedVisualCard next={next} t={t} openGlossary={openGlossary} />,
    },
    // 5 – Lohnbuchhaltungs-Workflow
    {
      type: "custom",
      sectionTitle: t("chapter6.section_payroll"),
      render: (next) => <PayrollCard next={next} t={t} />,
    },
    // 6 – Weitere Anwendungsfälle
    {
      type: "custom",
      sectionTitle: t("chapter6.section_usecases"),
      render: (next) => <UseCasesCard next={next} t={t} />,
    },
    // 7 – Entscheidungsszene
    {
      type: "custom",
      sectionTitle: t("chapter6.section_decision"),
      render: (next) => <DecisionScene next={next} t={t} />,
    },
    // 8 – TestnetAction: Muxed Payment
    {
      type: "action",
      sectionTitle: t("chapter6.section_action"),
      actionId: "muxed_payment_ch6",
      icon: "🏷️",
      label: t("chapter6.action_label"),
      description: t("chapter6.action_desc"),
      xpReward: 50,
      execute: async (kp) => {
        if (!kp) throw new Error(t("chapter6.action_error"));
        return sendMuxedPayment(kp);
      },
      onSuccess: (res) => {
        // res.mAddress is available for display – TestnetAction shows the TX hash
        // The M-address is part of res.result
      },
    },
    // 9 – Lumio nach der Aktion
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter6.lumio_after_action")],
    },
    // 10 – Quiz 1
    {
      type: "custom",
      sectionTitle: t("chapter6.section_quiz"),
      render: (next) => (
        <QuizQuestion
          question={t("chapter6.quiz1_q")} correctValue="a2"
          choices={[
            { value: "a1", label: t("chapter6.quiz1_a1"), hint: t("chapter6.quiz1_a1_hint") },
            { value: "a2", label: t("chapter6.quiz1_a2"), hint: t("chapter6.quiz1_a2_hint") },
            { value: "a3", label: t("chapter6.quiz1_a3"), hint: t("chapter6.quiz1_a3_hint") },
          ]}
          explanation={t("chapter6.quiz1_explanation")} hint2={t("chapter6.quiz1_hint2")}
          next={next} t={t}
        />
      ),
    },
    // 11 – Quiz 2
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter6.quiz2_q")} correctValue="a3"
          choices={[
            { value: "a1", label: t("chapter6.quiz2_a1"), hint: t("chapter6.quiz2_a1_hint") },
            { value: "a2", label: t("chapter6.quiz2_a2"), hint: t("chapter6.quiz2_a2_hint") },
            { value: "a3", label: t("chapter6.quiz2_a3"), hint: t("chapter6.quiz2_a3_hint") },
          ]}
          explanation={t("chapter6.quiz2_explanation")} hint2={t("chapter6.quiz2_hint2")}
          next={next} t={t}
        />
      ),
    },
    // 12 – Quiz 3
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter6.quiz3_q")} correctValue="a1"
          choices={[
            { value: "a1", label: t("chapter6.quiz3_a1"), hint: t("chapter6.quiz3_a1_hint") },
            { value: "a2", label: t("chapter6.quiz3_a2"), hint: t("chapter6.quiz3_a2_hint") },
            { value: "a3", label: t("chapter6.quiz3_a3"), hint: t("chapter6.quiz3_a3_hint") },
          ]}
          explanation={t("chapter6.quiz3_explanation")} hint2={t("chapter6.quiz3_hint2")}
          next={next} t={t}
        />
      ),
    },
    // 13 – ChapterSummary
    {
      type: "custom",
      render: (next) => (
        <ChapterSummary
          chapter={6}
          title={t("chapter6.title")}
          xpEarned={160}
          isLast={false}
          onNext={() => { completeChapter(6, 160); next(); }}
          learnings={[
            t("chapter6.learning1"),
            t("chapter6.learning2"),
            t("chapter6.learning3"),
            { text: t("chapter6.learning4"), type: "warning" },
          ]}
        />
      ),
    },
  ];
}

// ─── Chapter6 component ───────────────────────────────────────────────────────

export default function Chapter6() {
  const { keypair, completeChapter, openGlossary, setShowChapterSelect } = useStory();
  const { t } = useTranslation("story");

  const scenes = buildScenes({
    keypair, completeChapter, openGlossary, setShowChapterSelect, t,
  });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => setShowChapterSelect(true)}
    />
  );
}
