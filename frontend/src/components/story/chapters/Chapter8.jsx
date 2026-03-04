/**
 * Kapitel 8 – Der automatische Vertrag
 * Thema: Soroban – Stellars Smart Contract Plattform
 */
import React, { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "../StoryContext";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";
import * as StellarSdk from "@stellar/stellar-sdk";

// ─── Constants ────────────────────────────────────────────────────────────────

const BUYER_ADDRESS = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const ACTION_ID = "ch8-escrow";
const ESCROW_XP = 80;
const CHOICE_XP = 25;
const SUMMARY_XP = 175;

// ─── Escrow transaction helpers ───────────────────────────────────────────────

async function createClaimableBalance(keypair) {
  const server = new StellarSdk.Horizon.Server(HORIZON_TESTNET);
  const account = await server.loadAccount(keypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.createClaimableBalance({
        asset: StellarSdk.Asset.native(),
        amount: "1",
        claimants: [
          new StellarSdk.Claimant(
            BUYER_ADDRESS,
            StellarSdk.Claimant.predicateUnconditional()
          ),
          new StellarSdk.Claimant(
            keypair.publicKey(),
            StellarSdk.Claimant.predicateNot(
              StellarSdk.Claimant.predicateBeforeRelativeTime("3600")
            )
          ),
        ],
      })
    )
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  return server.submitTransaction(tx);
}

async function fetchBalanceId(publicKey) {
  await new Promise((r) => setTimeout(r, 2000));
  const res = await fetch(
    `${HORIZON_TESTNET}/claimable_balances?sponsor=${publicKey}&order=desc&limit=1`
  );
  const data = await res.json();
  return data._embedded?.records?.[0]?.id ?? null;
}

// ─── EscrowActionScene ────────────────────────────────────────────────────────

function EscrowActionScene({ next, t, keypair, addXP, completeAction, hasCompleted }) {
  const [phase, setPhase] = useState(hasCompleted(ACTION_ID) ? "done" : "idle");
  const [balanceId, setBalanceId] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleRun() {
    if (!keypair) {
      setError("Kein Keypair – bitte zuerst ein Konto erstellen.");
      return;
    }
    setPhase("loading");
    setError(null);
    try {
      await createClaimableBalance(keypair);
      const id = await fetchBalanceId(keypair.publicKey());
      setBalanceId(id);
      setPhase("success");
    } catch (err) {
      console.error(err);
      setError(
        err?.response?.data?.extras?.result_codes?.transaction ||
        err?.message ||
        "Fehler"
      );
      setPhase("error");
    }
  }

  function handleCopy() {
    if (balanceId) {
      navigator.clipboard.writeText(balanceId).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  function handleContinue() {
    completeAction(ACTION_ID);
    addXP(ESCROW_XP);
    next();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{
        background: "rgba(61,214,255,0.06)", border: "1.5px solid rgba(61,214,255,0.2)",
        borderRadius: "16px", padding: "18px 20px",
        display: "flex", flexDirection: "column", gap: "8px",
      }}>
        <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#3DD6FF" }}>
          {t("chapter8.scene4.action.label")}
        </p>
        <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
          {t("chapter8.scene4.action.description")}
        </p>
      </div>

      {(phase === "idle" || phase === "error") && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {error && (
            <div style={{
              background: "rgba(255,91,91,0.08)", border: "1px solid rgba(255,91,91,0.25)",
              borderRadius: "10px", padding: "10px 14px",
              fontSize: "13px", color: "#ff5b5b",
            }}>
              ⚠️ {error}
            </div>
          )}
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={handleRun}
            style={{
              background: "linear-gradient(135deg, #3DD6FF, #48c78e)", border: "none",
              borderRadius: "14px", padding: "14px 28px", fontSize: "15px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}>
            🔒 {t("chapter8.scene4.action.label")}
          </motion.button>
        </motion.div>
      )}

      {phase === "loading" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "20px" }}>
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            style={{ fontSize: "28px" }}>
            ⚙️
          </motion.div>
          <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.5)" }}>
            Escrow wird erstellt…
          </p>
        </motion.div>
      )}

      {(phase === "success" || phase === "done") && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{
            background: "rgba(72,199,142,0.08)", border: "1.5px solid rgba(72,199,142,0.3)",
            borderRadius: "14px", padding: "14px 18px",
            display: "flex", alignItems: "center", gap: "12px",
          }}>
            <span style={{ fontSize: "24px" }}>✅</span>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#48c78e" }}>
              {t("chapter8.scene4.action.success")}
            </p>
          </div>

          {balanceId && (
            <div style={{
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px", padding: "12px 16px",
              display: "flex", flexDirection: "column", gap: "6px",
            }}>
              <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {t("chapter8.scene4.action.escrow_id_label")}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <code style={{
                  flex: 1, fontSize: "10px", color: "#3DD6FF", wordBreak: "break-all",
                  background: "rgba(61,214,255,0.05)", borderRadius: "6px", padding: "6px 8px",
                }}>
                  {balanceId}
                </code>
                <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={handleCopy}
                  style={{
                    background: copied ? "rgba(72,199,142,0.15)" : "rgba(61,214,255,0.1)",
                    border: `1px solid ${copied ? "rgba(72,199,142,0.3)" : "rgba(61,214,255,0.2)"}`,
                    borderRadius: "8px", padding: "6px 10px",
                    fontSize: "11px", fontWeight: 600,
                    color: copied ? "#48c78e" : "#3DD6FF",
                    fontFamily: "inherit", cursor: "pointer", flexShrink: 0,
                  }}>
                  {copied ? "✓" : "📋"}
                </motion.button>
              </div>
              <a href={`https://stellar.expert/explorer/testnet/claimable-balance/${balanceId}`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: "11px", color: "rgba(61,214,255,0.6)", textDecoration: "none" }}>
                → Explorer ↗
              </a>
            </div>
          )}

          <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
            {t("chapter8.scene4.action.testnet_note")}
          </p>

          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={handleContinue}
            style={{
              background: "linear-gradient(135deg, #FFD93D, #FF9A3D)", border: "none",
              borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}>
            {t("chapter8.cta_continue")} → (+{ESCROW_XP} XP)
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── FutureListScene (Scene 5) ────────────────────────────────────────────────

const LIST_ITEMS = [
  { icon: "🏠", key: "item1" },
  { icon: "📜", key: "item2" },
  { icon: "🎵", key: "item3" },
  { icon: "🏥", key: "item4" },
  { icon: "🗳️", key: "item5" },
  { icon: "🎓", key: "item6" },
];

const listContainerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.35 } },
};
const listItemVariants = {
  hidden: { opacity: 0, x: -18 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4 } },
};

const OUTRO_DELAY = LIST_ITEMS.length * 0.35 + 0.4;

function FutureListScene({ next, t }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      {/* Animated list */}
      <motion.div
        variants={listContainerVariants}
        initial="hidden"
        animate="show"
        style={{ display: "flex", flexDirection: "column", gap: "8px" }}
      >
        {LIST_ITEMS.map(({ icon, key }) => (
          <motion.div
            key={key}
            variants={listItemVariants}
            style={{
              display: "flex", gap: "12px", alignItems: "flex-start",
              background: "rgba(61,214,255,0.04)", border: "1px solid rgba(61,214,255,0.1)",
              borderRadius: "12px", padding: "10px 14px",
            }}
          >
            <span style={{ fontSize: "18px", flexShrink: 0, marginTop: "1px" }}>{icon}</span>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.8)", lineHeight: 1.55 }}>
              {t(`chapter8.scene5.list.${key}`)}
            </p>
          </motion.div>
        ))}
      </motion.div>

      {/* Outro dialog lines */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: OUTRO_DELAY }}
        style={{ display: "flex", flexDirection: "column", gap: "8px" }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              display: "flex", gap: "10px", alignItems: "flex-start",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px", padding: "10px 12px",
            }}
          >
            <span style={{ fontSize: "14px", flexShrink: 0 }}>
              {i % 2 === 1 ? "☕" : "⭐"}
            </span>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
              {t(`chapter8.scene5.outro.dialog${i}`)}
            </p>
          </div>
        ))}
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: OUTRO_DELAY + 0.3 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={next}
        style={{
          background: "linear-gradient(135deg, #3DD6FF, #48c78e)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {t("chapter8.cta_continue")} →
      </motion.button>
    </motion.div>
  );
}

// ─── Scene6ChoiceScene ────────────────────────────────────────────────────────

const CHOICE_OPTIONS = [
  { value: "a", key: "a1" },
  { value: "b", key: "a2" }, // CORRECT
  { value: "c", key: "a3" },
  { value: "d", key: "a4" },
];
const CHOICE_CORRECT = "b";

function Scene6ChoiceScene({ next, t, addXP }) {
  const [phase, setPhase] = useState("choosing");
  const [attempts, setAttempts] = useState(0);
  const [xpAdded, setXpAdded] = useState(false);

  function handleSelect(value) {
    if (value === CHOICE_CORRECT) {
      if (!xpAdded) {
        addXP(CHOICE_XP);
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
        {t("chapter8.scene6.choice.question")}
      </p>

      {phase === "choosing" && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "8px" }}
        >
          {CHOICE_OPTIONS.map(({ value, key }) => (
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
              {t(`chapter8.scene6.choice.${key}`)}
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
            <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700, color: "#ff5b5b" }}>
              ✗ {t("chapter8.quiz.wrong_msg")}
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.55 }}>
              {t("chapter8.scene6.choice.wrong")}
            </p>
          </div>
          {attempts >= 2 && (
            <div style={{
              background: "rgba(255,217,61,0.07)", border: "1px solid rgba(255,217,61,0.2)",
              borderRadius: "10px", padding: "10px 14px",
              fontSize: "13px", color: "rgba(255,217,61,0.9)", lineHeight: 1.5,
            }}>
              💡 {t("chapter8.scene6.choice.hint2")}
            </div>
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
            {t("chapter8.scene6.choice.retry_btn")}
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
                {t("chapter8.scene6.choice.correct")}
              </p>
              <p style={{ margin: 0, fontSize: "11px", color: "rgba(72,199,142,0.7)" }}>
                +{CHOICE_XP} XP
              </p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
            style={{
              background: "linear-gradient(135deg, #FFD93D, #FF9A3D)", border: "none",
              borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter8.cta_continue")} →
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── QuizQuestion ─────────────────────────────────────────────────────────────

function QuizQuestion({ qKey, choices, correctValue, t, addXP, next, xpReward = 0 }) {
  const [phase, setPhase] = useState("choosing");
  const [attempts, setAttempts] = useState(0);
  const [xpAdded, setXpAdded] = useState(false);

  function handleSelect(value) {
    if (value === correctValue) {
      if (!xpAdded && xpReward > 0) {
        addXP(xpReward);
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
        {t(`chapter8.quiz.${qKey}`)}
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
            <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700, color: "#ff5b5b" }}>
              ✗ {t("chapter8.quiz.wrong_msg")}
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.55 }}>
              {t(`chapter8.quiz.${qKey}_explanation`)}
            </p>
          </div>
          {attempts >= 2 && (
            <div style={{
              background: "rgba(255,217,61,0.07)", border: "1px solid rgba(255,217,61,0.2)",
              borderRadius: "10px", padding: "10px 14px",
              fontSize: "13px", color: "rgba(255,217,61,0.9)", lineHeight: 1.5,
            }}>
              💡 {t(`chapter8.quiz.${qKey}_hint2`)}
            </div>
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
            {t("chapter8.quiz.retry_btn")}
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
              {t(choices.find(c => c.value === correctValue)?.labelKey || "")}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
            style={{
              background: "linear-gradient(135deg, #FFD93D, #FF9A3D)", border: "none",
              borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter8.quiz.correct_cta")} →
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── SorobanInfoCard ──────────────────────────────────────────────────────────

function SorobanInfoCard({ next, t }) {
  const ethRows = [
    { icon: "⚡", key: "eth_speed" },
    { icon: "💸", key: "eth_fees" },
    { icon: "🔧", key: "eth_complexity" },
  ];
  const solRows = [
    { icon: "⚡", key: "sol_speed" },
    { icon: "💸", key: "sol_fees" },
    { icon: "🔧", key: "sol_complexity" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#3DD6FF" }}>
          {t("chapter8.scene3.card.label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "white" }}>
          {t("chapter8.scene3.card.title")}
        </h3>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div style={{
          background: "rgba(255,91,91,0.06)", border: "1px solid rgba(255,91,91,0.2)",
          borderRadius: "14px", padding: "14px 12px", display: "flex", flexDirection: "column", gap: "10px",
        }}>
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 800, color: "#ff5b5b", textAlign: "center" }}>
            Ethereum
          </p>
          {ethRows.map(row => (
            <div key={row.key} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <span style={{ fontSize: "14px", flexShrink: 0 }}>{row.icon}</span>
              <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
                {t(`chapter8.scene3.card.${row.key}`)}
              </p>
            </div>
          ))}
        </div>

        <div style={{
          background: "rgba(72,199,142,0.06)", border: "1px solid rgba(72,199,142,0.25)",
          borderRadius: "14px", padding: "14px 12px", display: "flex", flexDirection: "column", gap: "10px",
        }}>
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 800, color: "#48c78e", textAlign: "center" }}>
            Stellar / Soroban
          </p>
          {solRows.map(row => (
            <div key={row.key} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <span style={{ fontSize: "14px", flexShrink: 0 }}>{row.icon}</span>
              <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
                {t(`chapter8.scene3.card.${row.key}`)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "linear-gradient(135deg, #3DD6FF, #48c78e)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {t("chapter8.scene3.card.cta")}
      </motion.button>
    </motion.div>
  );
}

// ─── GlossaryScene ────────────────────────────────────────────────────────────

function GlossaryScene({ next, t, openGlossary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      <div style={{
        display: "flex", gap: "10px", alignItems: "flex-start",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "0 14px 14px 14px", padding: "12px 14px",
      }}>
        <span style={{ fontSize: "20px", flexShrink: 0 }}>☕</span>
        <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.85)", lineHeight: 1.6 }}>
          {t("chapter8.scene2.dialog4")}
        </p>
      </div>

      <motion.button
        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
        onClick={() => openGlossary("smartContract")}
        style={{
          background: "rgba(61,214,255,0.08)", border: "1.5px solid rgba(61,214,255,0.25)",
          borderRadius: "12px", padding: "11px 16px", textAlign: "left",
          cursor: "pointer", fontFamily: "inherit", width: "100%",
          display: "flex", alignItems: "center", gap: "10px",
        }}
      >
        <span style={{ fontSize: "18px" }}>📖</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#3DD6FF" }}>
          {t("chapter8.scene2.glossary_btn")}
        </span>
        <span style={{ marginLeft: "auto", fontSize: "16px", color: "rgba(61,214,255,0.5)" }}>?</span>
      </motion.button>

      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={next}
        style={{
          background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
          borderRadius: "12px", padding: "12px 24px", fontSize: "14px", fontWeight: 600,
          color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {t("chapter8.cta_continue")} →
      </motion.button>
    </motion.div>
  );
}

// ─── Scene builder ─────────────────────────────────────────────────────────────

function buildScenes({ openGlossary, keypair, addXP, completeAction, hasCompleted, completeChapter, t }) {
  return [
    // ── SZENE 1 – Das Problem ────────────────────────────────────────────────
    { type: "dialog", sectionTitle: t("chapter8.scene1.section"), speaker: "marco", lines: [t("chapter8.scene1.dialog1")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene1.dialog2")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene1.dialog3")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene1.dialog4")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene1.dialog5")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene1.dialog6")] },

    // ── SZENE 2 – Was ist ein Smart Contract? ────────────────────────────────
    { type: "dialog", sectionTitle: t("chapter8.scene2.section"), speaker: "lumio", lines: [t("chapter8.scene2.dialog1")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene2.dialog2")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene2.dialog3")] },
    { type: "custom", render: (next) => <GlossaryScene next={next} t={t} openGlossary={openGlossary} /> },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene2.dialog5")] },

    // ── SZENE 3 – Soroban auf Stellar ────────────────────────────────────────
    { type: "dialog", sectionTitle: t("chapter8.scene3.section"), speaker: "lumio", lines: [t("chapter8.scene3.dialog1")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene3.dialog2")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene3.dialog3")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene3.dialog4")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene3.dialog5")] },
    { type: "custom", render: (next) => <SorobanInfoCard next={next} t={t} /> },

    // ── SZENE 4 – Testnet Escrow ─────────────────────────────────────────────
    { type: "dialog", sectionTitle: t("chapter8.scene4.section"), speaker: "lumio", lines: [t("chapter8.scene4.pre.dialog1")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene4.pre.dialog2")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene4.pre.dialog3")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene4.pre.dialog4")] },
    {
      type: "custom",
      render: (next) => (
        <EscrowActionScene next={next} t={t} keypair={keypair}
          addXP={addXP} completeAction={completeAction} hasCompleted={hasCompleted} />
      ),
    },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene4.post.dialog1")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene4.post.dialog2")] },

    // ── SZENE 5 – Die Zukunft der Verträge ───────────────────────────────────
    { type: "dialog", sectionTitle: t("chapter8.scene5.section"), speaker: "lumio", lines: [t("chapter8.scene5.intro.dialog1")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene5.intro.dialog2")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene5.intro.dialog3")] },
    { type: "custom", render: (next) => <FutureListScene next={next} t={t} /> },

    // ── SZENE 6 – Soroban richtig verstehen ──────────────────────────────────
    { type: "dialog", sectionTitle: t("chapter8.scene6.section"), speaker: "marco", lines: [t("chapter8.scene6.dialog1")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene6.dialog2")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene6.dialog3")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene6.dialog4")] },
    { type: "dialog", speaker: "marco", lines: [t("chapter8.scene6.dialog5")] },
    { type: "dialog", speaker: "lumio", lines: [t("chapter8.scene6.dialog6")] },
    { type: "custom", render: (next) => <Scene6ChoiceScene next={next} t={t} addXP={addXP} /> },

    // ── SZENE 7 – Mini-Quiz ──────────────────────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter8.quiz.section"),
      render: (next) => (
        <QuizQuestion
          qKey="q1"
          choices={[
            { value: "b", labelKey: "chapter8.quiz.q1_a2" },
            { value: "c", labelKey: "chapter8.quiz.q1_a3" },
            { value: "a", labelKey: "chapter8.quiz.q1_a1" }, // correct
            { value: "d", labelKey: "chapter8.quiz.q1_a4" },
          ]}
          correctValue="a"
          t={t} addXP={addXP} next={next} xpReward={0}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          qKey="q2"
          choices={[
            { value: "a", labelKey: "chapter8.quiz.q2_a1" }, // correct
            { value: "b", labelKey: "chapter8.quiz.q2_a2" },
            { value: "c", labelKey: "chapter8.quiz.q2_a3" },
            { value: "d", labelKey: "chapter8.quiz.q2_a4" },
          ]}
          correctValue="a"
          t={t} addXP={addXP} next={next} xpReward={0}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQuestion
          qKey="q3"
          choices={[
            { value: "b", labelKey: "chapter8.quiz.q3_a2" },
            { value: "a", labelKey: "chapter8.quiz.q3_a1" }, // correct
            { value: "c", labelKey: "chapter8.quiz.q3_a3" },
            { value: "d", labelKey: "chapter8.quiz.q3_a4" },
          ]}
          correctValue="a"
          t={t} addXP={addXP} next={next} xpReward={0}
        />
      ),
    },

    // ── SZENE 8 – ChapterSummary ─────────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <ChapterSummary
          chapter={8}
          title={t("chapter8.title")}
          learnings={[
            t("chapter8.summary.learning1"),
            t("chapter8.summary.learning2"),
            t("chapter8.summary.learning3"),
            t("chapter8.summary.learning4"),
            t("chapter8.summary.learning5"),
          ]}
          xpEarned={SUMMARY_XP}
          onNext={() => { addXP(SUMMARY_XP); completeChapter(8); next(); }}
          isLast={true}
        />
      ),
    },
  ];
}

// ─── Chapter8 component ────────────────────────────────────────────────────────

export default function Chapter8() {
  const {
    openGlossary, setShowChapterSelect, keypair,
    addXP, completeAction, hasCompleted, completeChapter,
  } = useStory();
  const { t } = useTranslation("story");

  const scenes = buildScenes({
    openGlossary, keypair, addXP, completeAction, hasCompleted, completeChapter, t,
  });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => setShowChapterSelect(true)}
    />
  );
}
