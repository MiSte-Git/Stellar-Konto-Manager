/**
 * Kapitel 9 – Die Rückruf-Macht
 * Thema: Clawback – Schutz oder Macht?
 */
import React, { useState, useRef } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "../StoryContext";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";

// ─── Constants ────────────────────────────────────────────────────────────────

const TRUST_CODE = "TRUST";
const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org/?addr=";
const ACTION1_ID = "chapter9_create_clawback_asset";
const ACTION2_ID = "chapter9_execute_clawback";
const XP_ACTION = 60;
const XP_CHOICE = 25;
const XP_SUMMARY = 175;

// ─── Character styles ─────────────────────────────────────────────────────────

const SPEAKER = {
  lumio: {
    color: "#FFD93D",
    bg: "rgba(255,217,61,0.06)",
    border: "rgba(255,217,61,0.2)",
    avatar: "⭐",
    name: "Lumio",
  },
  sofia: {
    color: "#ff8fab",
    bg: "rgba(255,143,171,0.06)",
    border: "rgba(255,143,171,0.2)",
    avatar: "🌸",
    name: "Sofia",
  },
  erik: {
    color: "#3DD6FF",
    bg: "rgba(61,214,255,0.06)",
    border: "rgba(61,214,255,0.2)",
    avatar: "💻",
    name: "Erik",
  },
};

// ─── CharacterDialog ──────────────────────────────────────────────────────────

function CharacterDialog({ speaker, text, next, t }) {
  const s = SPEAKER[speaker] || SPEAKER.lumio;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      <div style={{
        display: "flex", gap: "12px", alignItems: "flex-start",
        background: s.bg, border: `1px solid ${s.border}`,
        borderRadius: "0 14px 14px 14px", padding: "14px 16px",
      }}>
        <div style={{
          width: "34px", height: "34px", borderRadius: "50%", flexShrink: 0,
          background: s.bg, border: `2px solid ${s.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "16px",
        }}>
          {s.avatar}
        </div>
        <div>
          <p style={{
            margin: "0 0 5px", fontSize: "10px", fontWeight: 800, letterSpacing: "0.09em",
            textTransform: "uppercase", color: s.color,
          }}>
            {s.name}
          </p>
          <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.85)", lineHeight: 1.65 }}>
            {text}
          </p>
        </div>
      </div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={next}
        style={{
          background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
          borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
          color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {t("chapter9.cta_continue")} →
      </motion.button>
    </motion.div>
  );
}

// ─── ClawbackGlossaryScene ────────────────────────────────────────────────────

function ClawbackGlossaryScene({ next, t, openGlossary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      <motion.button
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => openGlossary("clawback")}
        style={{
          background: "rgba(61,214,255,0.08)", border: "1.5px solid rgba(61,214,255,0.25)",
          borderRadius: "12px", padding: "12px 16px", textAlign: "left",
          cursor: "pointer", fontFamily: "inherit", width: "100%",
          display: "flex", alignItems: "center", gap: "10px",
        }}
      >
        <span style={{ fontSize: "18px" }}>📖</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#3DD6FF" }}>
          {t("chapter9.scene2.glossary_btn")}
        </span>
        <span style={{ marginLeft: "auto", fontSize: "16px", color: "rgba(61,214,255,0.5)" }}>?</span>
      </motion.button>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={next}
        style={{
          background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
          borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
          color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {t("chapter9.cta_continue")} →
      </motion.button>
    </motion.div>
  );
}

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function StepRow({ label, done, active }) {
  const color = done ? "#4ade80" : active ? "#FFD93D" : "rgba(255,255,255,0.3)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color }}>
      <span>{done ? "✓" : active ? "⏳" : "○"}</span>
      <span>{label}</span>
    </div>
  );
}

function TxHashRow({ hash }) {
  if (!hash) return null;
  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  return (
    <p style={{ margin: "6px 0 0", fontSize: "11px", color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
      TX: {short}
    </p>
  );
}

// ─── CreateClawbackAssetScene ─────────────────────────────────────────────────

function CreateClawbackAssetScene({ next, t, keypair, addXP, hasCompleted, completeAction, sofiaRef }) {
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [step, setStep] = useState(0); // 0-4: tracks progress through 4 async steps
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [sofiaPub, setSofiaPub] = useState("");

  const isCompleted = hasCompleted(ACTION1_ID);

  async function handleCreate() {
    if (!keypair) return;
    setStatus("loading");
    setStep(0);
    setError("");

    try {
      const server = new StellarSdk.Horizon.Server(HORIZON);
      const asset = new StellarSdk.Asset(TRUST_CODE, keypair.publicKey());

      // Step 1 – prepare Sofia demo account
      setStep(1);
      const sofiaKp = StellarSdk.Keypair.random();
      setSofiaPub(sofiaKp.publicKey());
      sofiaRef.current = sofiaKp.publicKey();
      await fetch(`${FRIENDBOT}${encodeURIComponent(sofiaKp.publicKey())}`);

      // Step 2 – enable AuthRevocableFlag + AuthClawbackEnabledFlag on issuer
      setStep(2);
      const issuerAcc1 = await server.loadAccount(keypair.publicKey());
      const AUTH_REVOCABLE = StellarSdk.AuthRevocableFlag ?? 2;
      const AUTH_CLAWBACK = StellarSdk.AuthClawbackEnabledFlag ?? 8;
      const setOptsTx = new StellarSdk.TransactionBuilder(issuerAcc1, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.setOptions({
          setFlags: AUTH_REVOCABLE | AUTH_CLAWBACK,
        }))
        .setTimeout(30)
        .build();
      setOptsTx.sign(keypair);
      await server.submitTransaction(setOptsTx);

      // Step 3 – Sofia establishes trustline
      setStep(3);
      const sofiaAcc = await server.loadAccount(sofiaKp.publicKey());
      const trustTx = new StellarSdk.TransactionBuilder(sofiaAcc, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.changeTrust({ asset, limit: "1000" }))
        .setTimeout(30)
        .build();
      trustTx.sign(sofiaKp);
      await server.submitTransaction(trustTx);

      // Step 4 – payment: 100 TRUST from issuer to Sofia
      setStep(4);
      const issuerAcc2 = await server.loadAccount(keypair.publicKey());
      const payTx = new StellarSdk.TransactionBuilder(issuerAcc2, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: sofiaKp.publicKey(),
          asset,
          amount: "100",
        }))
        .setTimeout(30)
        .build();
      payTx.sign(keypair);
      const payResult = await server.submitTransaction(payTx);

      setTxHash(payResult.hash);
      setStatus("success");
      completeAction(ACTION1_ID);
      addXP(XP_ACTION);
    } catch (e) {
      console.error("Chapter9 Action1 error:", e);
      const ops = e?.response?.data?.extras?.result_codes?.operations;
      setError(ops ? ops.join(", ") : (e.message || "Unbekannter Fehler"));
      setStatus("error");
    }
  }

  if (isCompleted || status === "success") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <div style={{
          background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.2)",
          borderRadius: "14px", padding: "16px",
        }}>
          <p style={{ margin: "0 0 6px", fontSize: "12px", fontWeight: 700, color: "#4ade80" }}>
            ✓ {t("chapter9.scene4.action1.header")}
          </p>
          <p style={{ margin: "0 0 8px", fontSize: "13px", color: "rgba(255,255,255,0.75)" }}>
            {t("chapter9.scene4.action1.success")}
          </p>
          {sofiaPub && (
            <p style={{ margin: "0 0 4px", fontSize: "11px", color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
              Demo: {sofiaPub.slice(0, 10)}…{sofiaPub.slice(-6)}
            </p>
          )}
          <TxHashRow hash={txHash} />
          <p style={{ margin: "8px 0 0", fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>
            {t("chapter9.scene4.action1.testnet_note")}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={next}
          style={{
            background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
            borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
            color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
          }}
        >
          {t("chapter9.cta_continue")} →
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      <div style={{
        background: "rgba(255,217,61,0.05)", border: "1px solid rgba(255,217,61,0.15)",
        borderRadius: "14px", padding: "16px",
      }}>
        <p style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: 700, color: "#FFD93D", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {t("chapter9.scene4.action1.header")}
        </p>
        <p style={{ margin: "0 0 14px", fontSize: "13px", color: "rgba(255,255,255,0.65)" }}>
          {t("chapter9.scene4.action1.description")}
        </p>

        {status === "loading" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
            <StepRow label={t("chapter9.scene4.action1.step_friendbot")} done={step > 1} active={step === 1} />
            <StepRow label={t("chapter9.scene4.action1.step_setflags")} done={step > 2} active={step === 2} />
            <StepRow label={t("chapter9.scene4.action1.step_trustline")} done={step > 3} active={step === 3} />
            <StepRow label={t("chapter9.scene4.action1.step_payment")} done={step > 4} active={step === 4} />
          </div>
        )}

        {status === "error" && (
          <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#f87171" }}>
            {t("chapter9.scene4.action1.error")}<br />
            <span style={{ fontSize: "11px", opacity: 0.7 }}>{error}</span>
          </p>
        )}

        <motion.button
          whileHover={status !== "loading" ? { scale: 1.02 } : {}}
          whileTap={status !== "loading" ? { scale: 0.98 } : {}}
          onClick={status !== "loading" ? handleCreate : undefined}
          disabled={status === "loading"}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: "10px",
            background: status === "loading" ? "rgba(255,217,61,0.08)" : "rgba(255,217,61,0.15)",
            border: "1.5px solid rgba(255,217,61,0.3)",
            color: "#FFD93D", fontFamily: "inherit", fontWeight: 700,
            fontSize: "13px", cursor: status === "loading" ? "wait" : "pointer",
          }}
        >
          {status === "loading" ? "⏳ …" : status === "error" ? `↺ ${t("chapter9.cta_retry")}` : `🔑 ${t("chapter9.scene4.action1.label")}`}
        </motion.button>

        <p style={{ margin: "8px 0 0", fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>
          {t("chapter9.scene4.action1.testnet_note")}
        </p>
      </div>
    </motion.div>
  );
}

// ─── ExecuteClawbackScene ─────────────────────────────────────────────────────

function ExecuteClawbackScene({ next, t, keypair, addXP, hasCompleted, completeAction, sofiaRef }) {
  const [status, setStatus] = useState("idle");
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");

  const isCompleted = hasCompleted(ACTION2_ID);
  const step1Done = hasCompleted(ACTION1_ID);

  async function handleClawback() {
    if (!keypair || !sofiaRef.current) return;
    setStatus("loading");
    setError("");

    try {
      const server = new StellarSdk.Horizon.Server(HORIZON);
      const asset = new StellarSdk.Asset(TRUST_CODE, keypair.publicKey());
      const account = await server.loadAccount(keypair.publicKey());

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.clawback({
          asset,
          from: sofiaRef.current,
          amount: "100",
        }))
        .setTimeout(30)
        .build();
      tx.sign(keypair);
      const result = await server.submitTransaction(tx);

      setTxHash(result.hash);
      setStatus("success");
      completeAction(ACTION2_ID);
      addXP(XP_ACTION);
    } catch (e) {
      console.error("Chapter9 Action2 error:", e);
      const ops = e?.response?.data?.extras?.result_codes?.operations;
      setError(ops ? ops.join(", ") : (e.message || "Unbekannter Fehler"));
      setStatus("error");
    }
  }

  if (isCompleted || status === "success") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <div style={{
          background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.2)",
          borderRadius: "14px", padding: "16px",
        }}>
          <p style={{ margin: "0 0 6px", fontSize: "12px", fontWeight: 700, color: "#4ade80" }}>
            ✓ {t("chapter9.scene5.action2.header")}
          </p>
          <p style={{ margin: "0 0 8px", fontSize: "13px", color: "rgba(255,255,255,0.75)" }}>
            {t("chapter9.scene5.action2.success")}
          </p>
          <TxHashRow hash={txHash} />
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={next}
          style={{
            background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
            borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
            color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
          }}
        >
          {t("chapter9.cta_continue")} →
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      <div style={{
        background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.15)",
        borderRadius: "14px", padding: "16px",
      }}>
        <p style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {t("chapter9.scene5.action2.header")}
        </p>
        <p style={{ margin: "0 0 14px", fontSize: "13px", color: "rgba(255,255,255,0.65)" }}>
          {t("chapter9.scene5.action2.description")}
        </p>

        {!step1Done && (
          <p style={{ margin: "0 0 10px", fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>
            🔒 {t("chapter9.scene5.action2.locked")}
          </p>
        )}

        {status === "error" && (
          <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#f87171" }}>
            {t("chapter9.scene5.action2.error")}<br />
            <span style={{ fontSize: "11px", opacity: 0.7 }}>{error}</span>
          </p>
        )}

        <motion.button
          whileHover={step1Done && status !== "loading" ? { scale: 1.02 } : {}}
          whileTap={step1Done && status !== "loading" ? { scale: 0.98 } : {}}
          onClick={step1Done && status !== "loading" ? handleClawback : undefined}
          disabled={!step1Done || status === "loading"}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: "10px",
            background: !step1Done ? "rgba(255,255,255,0.04)" : status === "loading" ? "rgba(248,113,113,0.08)" : "rgba(248,113,113,0.15)",
            border: `1.5px solid ${!step1Done ? "rgba(255,255,255,0.1)" : "rgba(248,113,113,0.3)"}`,
            color: !step1Done ? "rgba(255,255,255,0.3)" : "#f87171",
            fontFamily: "inherit", fontWeight: 700,
            fontSize: "13px", cursor: !step1Done || status === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {status === "loading" ? "⏳ …" : status === "error" ? `↺ ${t("chapter9.cta_retry")}` : `⚡ ${t("chapter9.scene5.action2.label")}`}
        </motion.button>
      </div>
    </motion.div>
  );
}

// ─── Scene6Choice ─────────────────────────────────────────────────────────────

const CHOICE_OPTIONS = ["a", "b", "c", "d"];
const CHOICE_CORRECT = "c";

function Scene6Choice({ next, t, addXP }) {
  const [selected, setSelected] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [xpGiven, setXpGiven] = useState(false);

  function handleSelect(val) {
    setSelected(val);
    if (val === CHOICE_CORRECT && !xpGiven) {
      addXP(XP_CHOICE);
      setXpGiven(true);
    } else if (val !== CHOICE_CORRECT) {
      setAttempts((a) => a + 1);
    }
  }

  function retry() {
    setSelected(null);
  }

  const isCorrect = selected === CHOICE_CORRECT;
  const isWrong = selected !== null && !isCorrect;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.9)", lineHeight: 1.5 }}>
        {t("chapter9.scene6.choice.question")}
      </p>

      {!selected && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {CHOICE_OPTIONS.map((opt) => (
            <motion.button
              key={opt}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelect(opt)}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.12)",
                borderRadius: "10px", padding: "10px 14px", textAlign: "left",
                cursor: "pointer", fontFamily: "inherit", fontSize: "13px",
                color: "rgba(255,255,255,0.8)",
              }}
            >
              <span style={{ fontWeight: 700, marginRight: "8px", opacity: 0.5 }}>{opt.toUpperCase()})</span>
              {t(`chapter9.scene6.choice.${opt}`)}
            </motion.button>
          ))}
        </div>
      )}

      {isCorrect && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{
            background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
            borderRadius: "12px", padding: "12px 14px",
          }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#4ade80" }}>
              ✓ {t("chapter9.scene6.choice.correct")}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={next}
            style={{
              background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
              borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
              color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter9.cta_continue")} →
          </motion.button>
        </motion.div>
      )}

      {isWrong && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{
            background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "12px", padding: "12px 14px",
          }}>
            <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#f87171" }}>
              {t("chapter9.scene6.choice.wrong")}
            </p>
            {attempts >= 2 && (
              <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>
                {t("chapter9.scene6.choice.hint2")}
              </p>
            )}
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={retry}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.12)",
              borderRadius: "10px", padding: "10px 20px", fontSize: "13px", fontWeight: 600,
              color: "rgba(255,255,255,0.6)", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            ↺ {t("chapter9.scene6.choice.retry_btn")}
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── QuizQuestion ─────────────────────────────────────────────────────────────

function QuizQuestion({ question, choices, correctValue, explanation, hint2, wrongMsg, retryBtn, correctCta, next }) {
  const [selected, setSelected] = useState(null);
  const [attempts, setAttempts] = useState(0);

  function handleSelect(val) {
    setSelected(val);
    if (val !== correctValue) setAttempts((a) => a + 1);
  }

  function retry() {
    setSelected(null);
  }

  const isCorrect = selected === correctValue;
  const isWrong = selected !== null && !isCorrect;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.9)", lineHeight: 1.5 }}>
        {question}
      </p>

      {!selected && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {choices.map((c) => (
            <motion.button
              key={c.value}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelect(c.value)}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.12)",
                borderRadius: "10px", padding: "10px 14px", textAlign: "left",
                cursor: "pointer", fontFamily: "inherit", fontSize: "13px",
                color: "rgba(255,255,255,0.8)",
              }}
            >
              {c.label}
            </motion.button>
          ))}
        </div>
      )}

      {isCorrect && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{
            background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
            borderRadius: "12px", padding: "12px 14px",
          }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#4ade80" }}>
              ✓ {choices.find((c) => c.value === correctValue)?.label}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={next}
            style={{
              background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
              borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
              color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {correctCta} →
          </motion.button>
        </motion.div>
      )}

      {isWrong && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{
            background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "12px", padding: "12px 14px",
          }}>
            <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#f87171" }}>{wrongMsg}</p>
            <p style={{ margin: "0 0 4px", fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>{explanation}</p>
            {attempts >= 2 && (
              <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>{hint2}</p>
            )}
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={retry}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.12)",
              borderRadius: "10px", padding: "10px 20px", fontSize: "13px", fontWeight: 600,
              color: "rgba(255,255,255,0.6)", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            ↺ {retryBtn}
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Scene builder ─────────────────────────────────────────────────────────────

function buildScenes({ openGlossary, setShowChapterSelect, t, keypair, addXP, hasCompleted, completeAction, completeChapter, sofiaRef }) {
  const cd = (speaker, textKey) =>
    (next) => <CharacterDialog speaker={speaker} text={t(textKey)} next={next} t={t} />;

  return [
    // ── SZENE 1 – Sofia trifft Lumio ─────────────────────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene1.section"), render: cd("sofia", "chapter9.scene1.dialog1") },
    { type: "custom", render: cd("lumio", "chapter9.scene1.dialog2") },
    { type: "custom", render: cd("sofia", "chapter9.scene1.dialog3") },
    { type: "custom", render: cd("lumio", "chapter9.scene1.dialog4") },
    { type: "custom", render: cd("sofia", "chapter9.scene1.dialog5") },
    { type: "custom", render: cd("lumio", "chapter9.scene1.dialog6") },

    // ── SZENE 2 – Was ist Clawback? ──────────────────────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene2.section"), render: cd("lumio", "chapter9.scene2.dialog1") },
    { type: "custom", render: cd("sofia", "chapter9.scene2.dialog2") },
    { type: "custom", render: cd("lumio", "chapter9.scene2.dialog3") },
    { type: "custom", render: cd("sofia", "chapter9.scene2.dialog4") },
    { type: "custom", render: cd("lumio", "chapter9.scene2.dialog5") },
    { type: "custom", render: cd("sofia", "chapter9.scene2.dialog6") },
    {
      type: "custom",
      render: (next) => <ClawbackGlossaryScene next={next} t={t} openGlossary={openGlossary} />,
    },
    { type: "custom", render: cd("lumio", "chapter9.scene2.dialog7") },

    // ── SZENE 3 – Erik erscheint ─────────────────────────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene3.section"), render: cd("erik", "chapter9.scene3.dialog1") },
    { type: "custom", render: cd("sofia", "chapter9.scene3.dialog2") },
    { type: "custom", render: cd("erik", "chapter9.scene3.dialog3") },
    { type: "custom", render: cd("lumio", "chapter9.scene3.dialog4") },
    { type: "custom", render: cd("sofia", "chapter9.scene3.dialog5") },
    { type: "custom", render: cd("erik", "chapter9.scene3.dialog6") },
    { type: "custom", render: cd("lumio", "chapter9.scene3.dialog7") },

    // ── SZENE 4 – Clawback aktivieren ────────────────────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene4.section"), render: cd("lumio", "chapter9.scene4.pre.dialog1") },
    { type: "custom", render: cd("sofia", "chapter9.scene4.pre.dialog2") },
    { type: "custom", render: cd("lumio", "chapter9.scene4.pre.dialog3") },
    { type: "custom", render: cd("erik", "chapter9.scene4.pre.dialog4") },
    {
      type: "custom",
      render: (next) => (
        <CreateClawbackAssetScene
          next={next} t={t} keypair={keypair}
          addXP={addXP} hasCompleted={hasCompleted} completeAction={completeAction}
          sofiaRef={sofiaRef}
        />
      ),
    },
    { type: "custom", render: cd("lumio", "chapter9.scene4.bridge.dialog1") },
    { type: "custom", render: cd("sofia", "chapter9.scene4.bridge.dialog2") },
    { type: "custom", render: cd("lumio", "chapter9.scene4.bridge.dialog3") },

    // ── SZENE 5 – Clawback ausführen ─────────────────────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene5.section"), render: cd("erik", "chapter9.scene5.pre.dialog1") },
    { type: "custom", render: cd("lumio", "chapter9.scene5.pre.dialog2") },
    { type: "custom", render: cd("sofia", "chapter9.scene5.pre.dialog3") },
    {
      type: "custom",
      render: (next) => (
        <ExecuteClawbackScene
          next={next} t={t} keypair={keypair}
          addXP={addXP} hasCompleted={hasCompleted} completeAction={completeAction}
          sofiaRef={sofiaRef}
        />
      ),
    },
    { type: "custom", render: cd("lumio", "chapter9.scene5.post.dialog1") },
    { type: "custom", render: cd("sofia", "chapter9.scene5.post.dialog2") },
    { type: "custom", render: cd("erik", "chapter9.scene5.post.dialog3") },
    { type: "custom", render: cd("lumio", "chapter9.scene5.post.dialog4") },
    { type: "custom", render: cd("sofia", "chapter9.scene5.post.dialog5") },

    // ── SZENE 6 – Vertraust du dem Issuer? (Choice) ──────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene6.section"), render: cd("lumio", "chapter9.scene6.dialog1") },
    { type: "custom", render: cd("lumio", "chapter9.scene6.dialog2") },
    { type: "custom", render: cd("lumio", "chapter9.scene6.dialog3") },
    {
      type: "custom",
      render: (next) => <Scene6Choice next={next} t={t} addXP={addXP} />,
    },

    // ── SZENE 7 – Mini-Quiz ───────────────────────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter9.quiz.section"),
      render: (next) => (
        <QuizQuestion
          question={t("chapter9.quiz.q1")}
          choices={[
            { value: "a1", label: t("chapter9.quiz.q1_a1") },
            { value: "a2", label: t("chapter9.quiz.q1_a2") },
            { value: "a3", label: t("chapter9.quiz.q1_a3") },
            { value: "a4", label: t("chapter9.quiz.q1_a4") },
          ]}
          correctValue="a1"
          explanation={t("chapter9.quiz.q1_explanation")}
          hint2={t("chapter9.quiz.q1_hint2")}
          wrongMsg={t("chapter9.quiz.wrong_msg")}
          retryBtn={t("chapter9.quiz.retry_btn")}
          correctCta={t("chapter9.quiz.correct_cta")}
          next={next}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter9.quiz.q2")}
          choices={[
            { value: "a1", label: t("chapter9.quiz.q2_a1") },
            { value: "a2", label: t("chapter9.quiz.q2_a2") },
            { value: "a3", label: t("chapter9.quiz.q2_a3") },
            { value: "a4", label: t("chapter9.quiz.q2_a4") },
          ]}
          correctValue="a1"
          explanation={t("chapter9.quiz.q2_explanation")}
          hint2={t("chapter9.quiz.q2_hint2")}
          wrongMsg={t("chapter9.quiz.wrong_msg")}
          retryBtn={t("chapter9.quiz.retry_btn")}
          correctCta={t("chapter9.quiz.correct_cta")}
          next={next}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          question={t("chapter9.quiz.q3")}
          choices={[
            { value: "a1", label: t("chapter9.quiz.q3_a1") },
            { value: "a2", label: t("chapter9.quiz.q3_a2") },
            { value: "a3", label: t("chapter9.quiz.q3_a3") },
            { value: "a4", label: t("chapter9.quiz.q3_a4") },
          ]}
          correctValue="a1"
          explanation={t("chapter9.quiz.q3_explanation")}
          hint2={t("chapter9.quiz.q3_hint2")}
          wrongMsg={t("chapter9.quiz.wrong_msg")}
          retryBtn={t("chapter9.quiz.retry_btn")}
          correctCta={t("chapter9.quiz.correct_cta")}
          next={next}
        />
      ),
    },

    // ── SZENE 8 – Abschlussdialog ─────────────────────────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene8.section"), render: cd("sofia", "chapter9.scene8.dialog1") },
    { type: "custom", render: cd("erik", "chapter9.scene8.dialog2") },
    { type: "custom", render: cd("lumio", "chapter9.scene8.dialog3") },

    // ── ZUSAMMENFASSUNG ──────────────────────────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter9.summary.section"),
      render: (next) => (
        <ChapterSummary
          chapter={9}
          title={t("chapter9.title")}
          learnings={[
            t("chapter9.summary.learning1"),
            t("chapter9.summary.learning2"),
            t("chapter9.summary.learning3"),
            t("chapter9.summary.learning4"),
            t("chapter9.summary.learning5"),
          ]}
          xpEarned={XP_SUMMARY}
          isLast={true}
          onNext={() => {
            addXP(XP_SUMMARY);
            completeChapter(9);
            next();
          }}
        />
      ),
    },
  ];
}

// ─── Chapter9 component ────────────────────────────────────────────────────────

export default function Chapter9() {
  const {
    openGlossary,
    setShowChapterSelect,
    keypair,
    addXP,
    hasCompleted,
    completeAction,
    completeChapter,
  } = useStory();
  const { t } = useTranslation("story");

  // Shared ref: Action1 stores Sofia's public key here; Action2 reads it
  const sofiaRef = useRef(null);

  const scenes = buildScenes({
    openGlossary, setShowChapterSelect, t,
    keypair, addXP, hasCompleted, completeAction, completeChapter,
    sofiaRef,
  });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => setShowChapterSelect(true)}
    />
  );
}
