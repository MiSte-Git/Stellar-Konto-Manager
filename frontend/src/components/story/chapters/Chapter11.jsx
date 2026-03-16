/**
 * Kapitel 11 – Das Treueprogramm
 *
 * Lernziele:
 *  - Was ist ein Custom Asset / Loyalty Token auf Stellar?
 *  - Was bedeutet es, Issuer zu sein?
 *  - Warum brauchen Kunden eine Trust Line?
 *  - Gleicher Token-Name, anderer Issuer = anderer Token
 *
 * Szenen 1–6 implementiert; Rest folgt.
 * Charaktere: Lumio, Marco (speaker: "narrator")
 */
import React, { useState } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";
import { useStory } from "../StoryContext";
import { changeTrust, friendbotFund } from "../TestnetAction";
import ExplorerConfirmDialog from "../ExplorerConfirmDialog";
import { useSettings } from "../../../utils/useSettings";

// ─── Constants ────────────────────────────────────────────────────────────────

// TESTNET ONLY – ephemeral issuer keypair, funded via Friendbot on demand.
// A new keypair is generated per browser session. Replace with a stable
// pre-funded testnet keypair for classroom / shared demos.
const MARCO_KEYPAIR = StellarSdk.Keypair.random(); // TESTNET ISSUER – replace before production
const MARCO_PUBLIC_KEY = MARCO_KEYPAIR.publicKey();
const FAKE_ISSUER = StellarSdk.Keypair.random().publicKey(); // TESTNET – fake issuer for scam demo
const BERRY_CODE = "BERRY";

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const server = new StellarSdk.Horizon.Server(HORIZON_TESTNET);

const ACTION_ID = "chapter11_receive_berry";
const XP_ACTION = 60;
const XP_CHOICE = 25;
const XP_SUMMARY = 140;

// ─── Stellar helpers ──────────────────────────────────────────────────────────

async function ensureMarcoFunded() {
  try {
    const res = await fetch(`${HORIZON_TESTNET}/accounts/${MARCO_PUBLIC_KEY}`);
    if (res.ok) return;
    await friendbotFund(MARCO_PUBLIC_KEY);
  } catch {
    try { await friendbotFund(MARCO_PUBLIC_KEY); } catch { /* ignore */ }
  }
}

async function sendBerry(destinationPublicKey) {
  await ensureMarcoFunded();
  const asset = new StellarSdk.Asset(BERRY_CODE, MARCO_PUBLIC_KEY);
  const account = await server.loadAccount(MARCO_PUBLIC_KEY);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: destinationPublicKey,
      asset,
      amount: "10",
    }))
    .setTimeout(30)
    .build();
  tx.sign(MARCO_KEYPAIR);
  return server.submitTransaction(tx);
}

// ─── LoyaltyInfoCard (Szene 2) ─────────────────────────────────────────────────

function LoyaltyInfoCard({ onNext, t, openGlossary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "40px", marginBottom: "6px" }}>🍓</div>
        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "white" }}>
          {t("chapter11.s2.card.title")}
        </h3>
      </div>

      {/* Body */}
      <div style={{
        background: "rgba(255,217,61,0.05)",
        border: "1px solid rgba(255,217,61,0.2)",
        borderRadius: "14px",
        padding: "16px 18px",
      }}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.75, color: "rgba(255,255,255,0.82)" }}>
          {t("chapter11.s2.card.body")}
        </p>
      </div>

      {/* Glossary buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={() => openGlossary("loyaltyToken")}
          style={{
            background: "rgba(255,217,61,0.07)", border: "1.5px solid rgba(255,217,61,0.28)",
            borderRadius: "10px", padding: "9px 14px", fontSize: "13px", fontWeight: 600,
            color: "#FFD93D", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
          }}
        >
          📖 {t("chapter11.s2.glossary_loyalty")}
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={() => openGlossary("issuer")}
          style={{
            background: "rgba(61,214,255,0.06)", border: "1.5px solid rgba(61,214,255,0.25)",
            borderRadius: "10px", padding: "9px 14px", fontSize: "13px", fontWeight: 600,
            color: "#3DD6FF", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
          }}
        >
          📖 {t("chapter11.s2.glossary_issuer")}
        </motion.button>
      </div>

      {/* CTA */}
      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
        onClick={onNext}
        style={{
          background: "linear-gradient(135deg, #FFD93D, #48c78e)", border: "none",
          borderRadius: "14px", padding: "13px 28px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {t("chapter11.s2.card.cta")}
      </motion.button>
    </motion.div>
  );
}

// ─── BerryReceiveScene (Szene 4) ───────────────────────────────────────────────

function BerryReceiveScene({ next, t, keypair, addXP, hasCompleted, completeAction }) {
  const [phase, setPhase] = useState(hasCompleted(ACTION_ID) ? "done" : "idle");
  const [step, setStep] = useState(0);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);
  const [confirmUrl, setConfirmUrl] = useState(null);

  const { explorers, defaultExplorer: defaultExplorerKey } = useSettings();
  const activeExplorer = explorers.find((e) => e.key === defaultExplorerKey) ?? explorers[0];
  const explorerBase = activeExplorer?.testnetUrlTemplate
    ?.replace(/\/(account|address)\/\{address\}$/, "")
    ?? "https://stellar.expert/explorer/testnet";

  const shortMarco = `${MARCO_PUBLIC_KEY.slice(0, 8)}…${MARCO_PUBLIC_KEY.slice(-6)}`;

  async function handleRun() {
    if (!keypair) {
      setError(t("chapter11.s4.action.error_no_keypair"));
      return;
    }
    setPhase("loading");
    setStep(0);
    setError(null);
    try {
      // Fund Marco (issuer) first – must exist before changeTrust can reference it
      await ensureMarcoFunded();

      // Step 1 – Trust Line
      setStep(1);
      await changeTrust({
        sourceKeypair: keypair,
        assetCode: BERRY_CODE,
        assetIssuer: MARCO_PUBLIC_KEY,
      });

      // Step 2 – Marco sends BERRY
      setStep(2);
      const result = await sendBerry(keypair.publicKey());
      setTxHash(result.hash);
      setPhase("success");
    } catch (err) {
      console.error("Chapter11 BerryReceive error:", err);
      const ops = err?.response?.data?.extras?.result_codes?.operations;
      setError(ops ? ops.join(", ") : (err.message || "Unbekannter Fehler"));
      setPhase("error");
    }
  }

  function handleContinue() {
    completeAction(ACTION_ID);
    addXP(XP_ACTION);
    next();
  }

  const stepRows = [
    t("chapter11.s4.action.step1"),
    t("chapter11.s4.action.step2"),
  ];

  if (phase === "success" || phase === "done") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <div style={{
          background: "rgba(72,199,142,0.08)", border: "1.5px solid rgba(72,199,142,0.3)",
          borderRadius: "14px", padding: "16px 18px",
          display: "flex", alignItems: "center", gap: "12px",
        }}>
          <span style={{ fontSize: "28px" }}>🍓</span>
          <div>
            <p style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 700, color: "#48c78e" }}>
              {t("chapter11.s4.action.success")}
            </p>
            <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
              {t("chapter11.s4.action.testnet_note")}
            </p>
          </div>
        </div>

        {txHash && (
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px", padding: "10px 14px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
          }}>
            <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.35)", fontFamily: "monospace", wordBreak: "break-all" }}>
              TX: {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </p>
            <button
              onClick={() => setConfirmUrl(`${explorerBase}/tx/${txHash}`)}
              style={{
                background: "rgba(160,196,255,0.1)", border: "1px solid rgba(160,196,255,0.3)",
                borderRadius: "5px", padding: "3px 9px", color: "#a0c4ff",
                fontSize: "11px", fontWeight: 600, fontFamily: "inherit",
                cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              Explorer ↗
            </button>
          </div>
        )}

        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={handleContinue}
          style={{
            background: "linear-gradient(135deg, #FFD93D, #48c78e)", border: "none",
            borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
            color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
          }}
        >
          {t("chapter11.s4.cta_continue")} → (+{XP_ACTION} XP)
        </motion.button>

        <AnimatePresence>
          {confirmUrl && (
            <ExplorerConfirmDialog
              url={confirmUrl}
              explorerName={activeExplorer?.name}
              onClose={() => setConfirmUrl(null)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      {/* Hint: who already has the Trust Line */}
      <div style={{
        background: "rgba(61,214,255,0.05)", border: "1px solid rgba(61,214,255,0.18)",
        borderRadius: "12px", padding: "12px 16px",
        fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.6,
      }}>
        💡 {t("chapter11.s4.hint")}
      </div>

      {/* Description card */}
      <div style={{
        background: "rgba(255,217,61,0.05)", border: "1px solid rgba(255,217,61,0.18)",
        borderRadius: "14px", padding: "16px 18px",
        display: "flex", flexDirection: "column", gap: "10px",
      }}>
        <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#FFD93D" }}>
          {t("chapter11.s4.action.label")}
        </p>
        <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
          {t("chapter11.s4.action.description")}
        </p>

        {/* Issuer address preview */}
        <div style={{
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "8px", padding: "8px 12px",
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>
            Issuer
          </span>
          <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#a0c4ff", wordBreak: "break-all" }}>
            {shortMarco}
          </span>
          <span style={{
            fontSize: "9px", fontWeight: 700, color: "#ff5b5b",
            background: "rgba(255,91,91,0.15)", border: "1px solid rgba(255,91,91,0.4)",
            borderRadius: "3px", padding: "1px 5px", letterSpacing: "0.06em", flexShrink: 0,
          }}>
            TESTNET
          </span>
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {stepRows.map((label, i) => {
            const done = phase === "loading" && step > i + 1;
            const active = phase === "loading" && step === i + 1;
            const color = done ? "#4ade80" : active ? "#FFD93D" : "rgba(255,255,255,0.3)";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color }}>
                <span>{done ? "✓" : active ? "⏳" : "○"}</span>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div style={{
          background: "rgba(255,91,91,0.08)", border: "1px solid rgba(255,91,91,0.25)",
          borderRadius: "10px", padding: "10px 14px",
          fontSize: "13px", color: "#ff5b5b", lineHeight: 1.5,
        }}>
          ⚠️ {error}
        </div>
      )}

      {phase === "loading" ? (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px", justifyContent: "center" }}>
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            style={{ fontSize: "22px", display: "inline-block" }}
          >
            ⚙️
          </motion.span>
          <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.5)" }}>
            {step === 1 ? t("chapter11.s4.action.step1") : t("chapter11.s4.action.step2")}…
          </p>
        </div>
      ) : (
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={handleRun}
          style={{
            background: "linear-gradient(135deg, #FFD93D, #48c78e)", border: "none",
            borderRadius: "14px", padding: "14px 28px", fontSize: "15px", fontWeight: 700,
            color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
          }}
        >
          🍓 {t("chapter11.s4.action.run_btn")}
        </motion.button>
      )}
    </motion.div>
  );
}

// ─── ScamRevealScene (Szene 5) ─────────────────────────────────────────────────

const REVEAL_STEPS = [
  { labelKey: "chapter11.s5.scam.reveal1.label", textKey: "chapter11.s5.scam.reveal1.text", ok: true },
  { labelKey: "chapter11.s5.scam.reveal2.label", textKey: "chapter11.s5.scam.reveal2.text", ok: false },
  { labelKey: "chapter11.s5.scam.reveal3.label", textKey: "chapter11.s5.scam.reveal3.text", ok: false },
];

function ScamRevealScene({ next, t, openGlossary }) {
  const [revealed, setRevealed] = useState(0);
  const realPubShort = `${MARCO_PUBLIC_KEY.slice(0, 6)}…${MARCO_PUBLIC_KEY.slice(-6)}`;
  const fakePubShort = `${FAKE_ISSUER.slice(0, 6)}…${FAKE_ISSUER.slice(-6)}`;

  const allRevealed = revealed >= REVEAL_STEPS.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      {/* Fake message card */}
      <div style={{
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "14px", padding: "16px 18px",
        display: "flex", flexDirection: "column", gap: "10px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "22px" }}>🍓</span>
          <div>
            <p style={{ margin: 0, fontSize: "12px", fontWeight: 800, color: "white" }}>
              {t("chapter11.s5.scam.sender_name")}
            </p>
            <p style={{ margin: 0, fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>
              {t("chapter11.s5.scam.sender")}
            </p>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#FFD93D" }}>
          {t("chapter11.s5.scam.message")}
        </p>
      </div>

      {/* Issuer comparison card */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {/* Real issuer – green */}
        <div style={{
          background: "rgba(72,199,142,0.07)", border: "1.5px solid rgba(72,199,142,0.35)",
          borderRadius: "10px", padding: "10px 14px",
          display: "flex", alignItems: "flex-start", gap: "10px",
        }}>
          <span style={{ fontSize: "16px", flexShrink: 0 }}>✅</span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: "0 0 3px", fontSize: "10px", fontWeight: 700, color: "#48c78e", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {t("chapter11.s5.compare.real_label")}
            </p>
            <p style={{ margin: 0, fontSize: "11px", fontFamily: "monospace", color: "rgba(72,199,142,0.9)", wordBreak: "break-all", lineHeight: 1.4 }}>
              {realPubShort}
            </p>
          </div>
        </div>

        {/* Fake issuer – red */}
        <div style={{
          background: "rgba(255,91,91,0.07)", border: "1.5px solid rgba(255,91,91,0.35)",
          borderRadius: "10px", padding: "10px 14px",
          display: "flex", alignItems: "flex-start", gap: "10px",
        }}>
          <span style={{ fontSize: "16px", flexShrink: 0 }}>❌</span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: "0 0 3px", fontSize: "10px", fontWeight: 700, color: "#ff5b5b", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {t("chapter11.s5.compare.fake_label")}
            </p>
            <p style={{ margin: 0, fontSize: "11px", fontFamily: "monospace", color: "rgba(255,91,91,0.9)", wordBreak: "break-all", lineHeight: 1.4 }}>
              {fakePubShort}
            </p>
          </div>
        </div>

        {/* Lumio comment */}
        <p style={{
          margin: 0, fontSize: "13px", fontWeight: 600, color: "rgba(255,217,61,0.9)",
          lineHeight: 1.5, padding: "8px 12px",
          background: "rgba(255,217,61,0.05)", borderRadius: "8px",
        }}>
          ⭐ {t("chapter11.s5.compare.lumio_comment")}
        </p>
      </div>

      {/* Lumio's question */}
      <p style={{
        margin: 0, fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.8)",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px", padding: "12px 16px", lineHeight: 1.5,
      }}>
        ⭐ {t("chapter11.s5.scam.question")}
      </p>

      {/* Reveal steps */}
      {revealed === 0 && (
        <motion.button
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={() => setRevealed(1)}
          style={{
            background: "rgba(255,217,61,0.1)", border: "1.5px solid rgba(255,217,61,0.3)",
            borderRadius: "12px", padding: "12px 20px", fontSize: "14px", fontWeight: 600,
            color: "#FFD93D", fontFamily: "inherit", cursor: "pointer",
          }}
        >
          🔍 {t("chapter11.s5.scam.reveal_prompt")}
        </motion.button>
      )}

      {revealed > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {REVEAL_STEPS.slice(0, revealed).map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                background: step.ok ? "rgba(72,199,142,0.07)" : "rgba(255,91,91,0.07)",
                border: `1px solid ${step.ok ? "rgba(72,199,142,0.25)" : "rgba(255,91,91,0.25)"}`,
                borderRadius: "10px", padding: "10px 14px",
                display: "flex", alignItems: "flex-start", gap: "10px",
              }}
            >
              <span style={{ fontSize: "16px", flexShrink: 0 }}>{step.ok ? "✅" : "❌"}</span>
              <div>
                <p style={{ margin: "0 0 2px", fontSize: "11px", fontWeight: 700, color: step.ok ? "#48c78e" : "#ff5b5b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t(step.labelKey)}
                </p>
                <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                  {t(step.textKey)}
                </p>
              </div>
            </motion.div>
          ))}

          {revealed < REVEAL_STEPS.length && (
            <motion.button
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => setRevealed((r) => r + 1)}
              style={{
                background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(255,255,255,0.14)",
                borderRadius: "12px", padding: "11px 20px", fontSize: "14px", fontWeight: 600,
                color: "rgba(255,255,255,0.65)", fontFamily: "inherit", cursor: "pointer",
              }}
            >
              {t("chapter11.s5.scam.reveal_next")} →
            </motion.button>
          )}
        </div>
      )}

      {/* Lesson + Glossary button + CTA – only after all revealed */}
      {allRevealed && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <div style={{
            background: "rgba(255,217,61,0.07)", border: "1.5px solid rgba(255,217,61,0.25)",
            borderRadius: "12px", padding: "12px 16px",
            fontSize: "14px", fontWeight: 700, color: "#FFD93D", lineHeight: 1.55,
          }}>
            💡 {t("chapter11.s5.scam.lesson")}
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => openGlossary("issuer")}
            style={{
              background: "rgba(61,214,255,0.06)", border: "1.5px solid rgba(61,214,255,0.25)",
              borderRadius: "10px", padding: "9px 14px",
              display: "flex", alignItems: "center", gap: "10px",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: "16px" }}>📖</span>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#3DD6FF" }}>
              {t("chapter11.s5.glossary_issuer")}
            </span>
            <span style={{ marginLeft: "auto", fontSize: "14px", color: "rgba(61,214,255,0.4)" }}>?</span>
          </motion.button>

          <motion.button
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={next}
            style={{
              background: "linear-gradient(135deg, #ff5b5b, #FFD93D)", border: "none",
              borderRadius: "14px", padding: "13px 28px", fontSize: "15px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter11.s5.cta_next")}
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── IssuerChoiceScene (Szene 6) ───────────────────────────────────────────────

const CHOICE_OPTIONS = [
  { value: "a", labelKey: "chapter11.s6.choice.a" },
  { value: "b", labelKey: "chapter11.s6.choice.b" }, // CORRECT
  { value: "c", labelKey: "chapter11.s6.choice.c" },
];
const CHOICE_CORRECT = "b";

function IssuerChoiceScene({ next, t, addXP }) {
  const [phase, setPhase] = useState("choosing");
  const [attempts, setAttempts] = useState(0);
  const [xpAdded, setXpAdded] = useState(false);

  function handleSelect(value) {
    if (value === CHOICE_CORRECT) {
      if (!xpAdded) {
        addXP(XP_CHOICE);
        setXpAdded(true);
      }
      setPhase("correct");
    } else {
      setAttempts((a) => a + 1);
      setPhase("wrong");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{
        margin: 0, fontSize: "15px", fontWeight: 700, color: "white",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px", padding: "14px 16px", lineHeight: 1.5,
      }}>
        {t("chapter11.s6.choice.question")}
      </p>

      {phase === "choosing" && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "8px" }}
        >
          {CHOICE_OPTIONS.map(({ value, labelKey }) => (
            <motion.button
              key={value}
              whileHover={{ scale: 1.02, x: 3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelect(value)}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.12)",
                borderRadius: "12px", padding: "12px 16px", textAlign: "left",
                fontSize: "14px", color: "rgba(255,255,255,0.85)",
                fontFamily: "inherit", cursor: "pointer", lineHeight: 1.4,
              }}
            >
              {t(labelKey)}
            </motion.button>
          ))}
        </motion.div>
      )}

      {phase === "wrong" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <div style={{
            background: "rgba(255,91,91,0.07)", border: "1px solid rgba(255,91,91,0.2)",
            borderRadius: "12px", padding: "12px 16px",
          }}>
            <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 700, color: "#ff5b5b" }}>
              ✗ {t("chapter11.s6.choice.wrong_title")}
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.55 }}>
              {t("chapter11.s6.choice.wrong")}
            </p>
          </div>
          {attempts >= 2 && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{
                background: "rgba(255,217,61,0.07)", border: "1px solid rgba(255,217,61,0.2)",
                borderRadius: "10px", padding: "10px 14px",
                fontSize: "13px", color: "rgba(255,217,61,0.9)", lineHeight: 1.5,
              }}
            >
              💡 {t("chapter11.s6.choice.hint2")}
            </motion.div>
          )}
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => setPhase("choosing")}
            style={{
              background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
              borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
              color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter11.s6.choice.retry_btn")}
          </motion.button>
        </motion.div>
      )}

      {phase === "correct" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <div style={{
            background: "rgba(72,199,142,0.08)", border: "1.5px solid rgba(72,199,142,0.3)",
            borderRadius: "12px", padding: "14px 16px",
            display: "flex", alignItems: "flex-start", gap: "10px",
          }}>
            <span style={{ fontSize: "20px" }}>✅</span>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: "13px", fontWeight: 700, color: "#48c78e" }}>
                {t("chapter11.s6.choice.correct")}
              </p>
              <p style={{ margin: 0, fontSize: "11px", color: "rgba(72,199,142,0.7)" }}>
                +{XP_CHOICE} XP
              </p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
            style={{
              background: "linear-gradient(135deg, #FFD93D, #48c78e)", border: "none",
              borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter11.s6.choice.cta_next")} →
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── QuizQuestion (Szene 7) ────────────────────────────────────────────────────

function QuizQuestion({ qKey, choices, correctValue, t, next }) {
  const [phase, setPhase] = useState("choosing");
  const [attempts, setAttempts] = useState(0);

  function handleSelect(value) {
    if (value === correctValue) {
      setPhase("correct");
    } else {
      setAttempts((a) => a + 1);
      setPhase("wrong");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{
        margin: 0, fontSize: "15px", fontWeight: 700, color: "white",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px", padding: "14px 16px", lineHeight: 1.5,
      }}>
        {t(`chapter11.s7.${qKey}`)}
      </p>

      {phase === "choosing" && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "8px" }}
        >
          {choices.map(({ value, labelKey }) => (
            <motion.button
              key={value}
              whileHover={{ scale: 1.02, x: 3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelect(value)}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.12)",
                borderRadius: "12px", padding: "12px 16px", textAlign: "left",
                fontSize: "14px", color: "rgba(255,255,255,0.85)",
                fontFamily: "inherit", cursor: "pointer", lineHeight: 1.4,
              }}
            >
              {t(labelKey)}
            </motion.button>
          ))}
        </motion.div>
      )}

      {phase === "wrong" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <div style={{
            background: "rgba(255,91,91,0.07)", border: "1px solid rgba(255,91,91,0.2)",
            borderRadius: "12px", padding: "12px 16px",
          }}>
            <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 700, color: "#ff5b5b" }}>
              ✗ {t("chapter11.s7.wrong_msg")}
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.55 }}>
              {t(`chapter11.s7.${qKey}_explanation`)}
            </p>
          </div>
          {attempts >= 2 && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{
                background: "rgba(255,217,61,0.07)", border: "1px solid rgba(255,217,61,0.2)",
                borderRadius: "10px", padding: "10px 14px",
                fontSize: "13px", color: "rgba(255,217,61,0.9)", lineHeight: 1.5,
              }}
            >
              💡 {t(`chapter11.s7.${qKey}_hint2`)}
            </motion.div>
          )}
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => setPhase("choosing")}
            style={{
              background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
              borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
              color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter11.s7.retry_btn")}
          </motion.button>
        </motion.div>
      )}

      {phase === "correct" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <div style={{
            background: "rgba(72,199,142,0.08)", border: "1.5px solid rgba(72,199,142,0.3)",
            borderRadius: "12px", padding: "14px 16px",
            display: "flex", alignItems: "center", gap: "10px",
          }}>
            <span style={{ fontSize: "20px" }}>✅</span>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#48c78e" }}>
              {t(choices.find((c) => c.value === correctValue)?.labelKey || "")}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
            style={{
              background: "linear-gradient(135deg, #FFD93D, #48c78e)", border: "none",
              borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter11.s7.correct_cta")} →
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── buildScenes ───────────────────────────────────────────────────────────────

function buildScenes({ openGlossary, setShowChapterSelect, keypair, addXP, hasCompleted, completeAction, completeChapter, t }) {
  return [

    // ── Szene 1: Marcos neue Idee ──────────────────────────────────────────────
    {
      sectionTitle: t("chapter11.s1.section"),
      type: "dialog",
      speaker: "narrator",
      lines: [t("chapter11.s1.marco1")],
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s1.lumio1")],
    },
    {
      type: "dialog",
      speaker: "narrator",
      lines: [t("chapter11.s1.marco2")],
    },
    {
      type: "dialog",
      speaker: "narrator",
      lines: [t("chapter11.s1.marco3")],
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s1.lumio2")],
    },

    // ── Szene 2: Was ist ein Loyalty Token? ────────────────────────────────────
    {
      sectionTitle: t("chapter11.s2.section"),
      type: "custom",
      render: (next) => (
        <LoyaltyInfoCard onNext={next} t={t} openGlossary={openGlossary} />
      ),
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s2.lumio1")],
    },
    {
      type: "dialog",
      speaker: "narrator",
      lines: [t("chapter11.s2.marco1")],
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s2.lumio2")],
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s2.lumio3")],
    },

    // ── Szene 3: BERRY im Detail ───────────────────────────────────────────────
    {
      sectionTitle: t("chapter11.s3.section"),
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s3.lumio1")],
    },
    {
      type: "dialog",
      speaker: "narrator",
      lines: [t("chapter11.s3.marco1")],
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s3.lumio2")],
    },
    {
      type: "dialog",
      speaker: "narrator",
      lines: [t("chapter11.s3.marco2")],
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s3.lumio3")],
    },

    // ── Szene 4: BERRY empfangen ───────────────────────────────────────────────
    {
      sectionTitle: t("chapter11.s4.section"),
      type: "dialog",
      speaker: "narrator",
      lines: [t("chapter11.s4.marco1")],
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s4.lumio1")],
    },
    {
      type: "custom",
      render: (next) => (
        <BerryReceiveScene
          next={next} t={t} keypair={keypair}
          addXP={addXP} hasCompleted={hasCompleted} completeAction={completeAction}
        />
      ),
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s4.lumio2")],
    },

    // ── Szene 5: Die gefälschte BERRY-Aktion ──────────────────────────────────
    {
      sectionTitle: t("chapter11.s5.section"),
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s5.lumio1")],
    },
    {
      type: "custom",
      render: (next) => (
        <ScamRevealScene next={next} t={t} openGlossary={openGlossary} />
      ),
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s5.lumio2")],
    },

    // ── Szene 6: Richtig entscheiden ──────────────────────────────────────────
    {
      sectionTitle: t("chapter11.s6.section"),
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s6.lumio1")],
    },
    {
      type: "custom",
      render: (next) => (
        <IssuerChoiceScene next={next} t={t} addXP={addXP} />
      ),
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter11.s6.lumio2")],
    },

    // ── Szene 7: Mini-Quiz ─────────────────────────────────────────────────────
    {
      sectionTitle: t("chapter11.s7.section"),
      type: "custom",
      render: (next) => (
        <QuizQuestion
          qKey="q1"
          choices={[
            { value: "a", labelKey: "chapter11.s7.q1_a1" }, // correct
            { value: "b", labelKey: "chapter11.s7.q1_a2" },
            { value: "c", labelKey: "chapter11.s7.q1_a3" },
          ]}
          correctValue="a"
          t={t} next={next}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          qKey="q2"
          choices={[
            { value: "b", labelKey: "chapter11.s7.q2_a2" },
            { value: "a", labelKey: "chapter11.s7.q2_a1" }, // correct
            { value: "c", labelKey: "chapter11.s7.q2_a3" },
          ]}
          correctValue="a"
          t={t} next={next}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          qKey="q3"
          choices={[
            { value: "b", labelKey: "chapter11.s7.q3_a2" },
            { value: "c", labelKey: "chapter11.s7.q3_a3" },
            { value: "a", labelKey: "chapter11.s7.q3_a1" }, // correct
          ]}
          correctValue="a"
          t={t} next={next}
        />
      ),
    },

    // ── Szene 8: ChapterSummary ────────────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <ChapterSummary
          chapter={11}
          title={t("chapter11.title")}
          learnings={[
            t("chapter11.summary.learning1"),
            t("chapter11.summary.learning2"),
            t("chapter11.summary.learning3"),
            t("chapter11.summary.learning4"),
            t("chapter11.summary.learning5"),
          ]}
          xpEarned={XP_SUMMARY}
          onNext={() => {
            addXP(XP_SUMMARY);
            completeChapter(11);
            setShowChapterSelect(true);
          }}
          isLast={false}
        />
      ),
    },
  ];
}

// ─── Chapter11 ─────────────────────────────────────────────────────────────────

export default function Chapter11() {
  const { t } = useTranslation("story");
  const { openGlossary, setShowChapterSelect, keypair, addXP, hasCompleted, completeAction, completeChapter } = useStory();

  const scenes = buildScenes({ openGlossary, setShowChapterSelect, keypair, addXP, hasCompleted, completeAction, completeChapter, t });

  return <SceneRunner scenes={scenes} />;
}
