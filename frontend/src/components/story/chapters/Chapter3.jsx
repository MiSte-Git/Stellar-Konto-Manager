/**
 * Kapitel 3 – Der Händler
 *
 * Lernziele:
 *  - Was ist ein Asset auf Stellar?
 *  - Was ist ein Anchor?
 *  - Was ist eine Trust Line und wie ist sie aufgebaut?
 *  - Wie verifiziert man den echten Issuer?
 *  - Wie erkennt man gefälschte QR-Codes und Phishing-Domains?
 *
 * Ablauf:
 *  1. Intro – Lumio trifft Marco den Obsthändler (Narrator + Dialog)
 *  2. Was ist ein Asset? Was ist ein Anchor? (Dialog + Narrator)
 *  3. Trust Line Erklärung – visuelles Info-Card (Narrator + Custom)
 *  4. Gefahren: Fake QR-Codes & Phishing-Domains (Dialog + Narrator)
 *  5. QR-Code Entscheidung – Choice Scene
 *  6. Trust Line einrichten (Dialog + Custom Preview + TestnetAction)
 *  7. Mini-Quiz 3 Fragen (3× Choice)
 *  8. BERRY-Token empfangen (Dialog + TestnetAction)
 *  9. Chapter Summary (Custom)
 */

import React from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";
import { useStory } from "../StoryContext";
import { changeTrust, friendbotFund } from "../TestnetAction";

// ─── Marco's Testnet Issuer Keypair ────────────────────────────────────────────
//
// TESTNET ONLY – a fresh ephemeral keypair is generated per browser session and
// funded via Friendbot on first use.  This means BERRY is a different asset each
// session, which is fine for a self-contained demo.
//
// For a stable testnet demo (e.g. shared classroom use) replace with a real
// pre-funded testnet keypair:
//   const kp = StellarSdk.Keypair.random()
//   console.log(kp.publicKey(), kp.secret())
//   // Fund: https://friendbot.stellar.org?addr=<publicKey>
//   const MARCO_KEYPAIR = StellarSdk.Keypair.fromSecret("<secret>"); // TESTNET ISSUER - replace before production
//
const MARCO_KEYPAIR = StellarSdk.Keypair.random(); // TESTNET ISSUER - replace before production
const MARCO_PUBLIC_KEY = MARCO_KEYPAIR.publicKey();

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const server = new StellarSdk.Horizon.Server(HORIZON_TESTNET);

/** Ensures Marco's testnet account exists; funds it via Friendbot if needed. */
async function ensureMarcoFunded() {
  try {
    const res = await fetch(`${HORIZON_TESTNET}/accounts/${MARCO_PUBLIC_KEY}`);
    if (res.ok) return;
    await friendbotFund(MARCO_PUBLIC_KEY);
  } catch {
    try { await friendbotFund(MARCO_PUBLIC_KEY); } catch { /* ignore */ }
  }
}

/**
 * Marco (as issuer) mints and sends 10 BERRY tokens to the user's account.
 * Requires the user to have set up a trust line first (Scene 6).
 */
async function sendBerryToUser(destinationPublicKey) {
  await ensureMarcoFunded();
  const cafeAsset = new StellarSdk.Asset("BERRY", MARCO_PUBLIC_KEY);
  const account = await server.loadAccount(MARCO_PUBLIC_KEY);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: destinationPublicKey,
      asset: cafeAsset,
      amount: "10",
    }))
    .setTimeout(30)
    .build();

  tx.sign(MARCO_KEYPAIR);
  return server.submitTransaction(tx);
}

// ─── TrustLineInfoCard ─────────────────────────────────────────────────────────

/**
 * Visual explanation of a Trust Line: its 3 components and 4 ways to add one.
 * Used in Scene 3 (educational visual).
 */
function TrustLineInfoCard({ next, t }) {
  const shortMarco = `${MARCO_PUBLIC_KEY.slice(0, 8)}…${MARCO_PUBLIC_KEY.slice(-6)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* ── 3 Components ───────────────────────────────────────────────────── */}
      <div style={{
        background: "rgba(160,196,255,0.07)",
        border: "1.5px solid rgba(160,196,255,0.28)",
        borderRadius: "14px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}>
        <p style={{
          margin: 0,
          fontSize: "11px",
          fontWeight: 700,
          color: "#a0c4ff",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}>
          {t("chapter3.tl_components_title")}
        </p>

        {[
          { label: t("chapter3.tl_code_label"),   value: "BERRY",     color: "#FFD93D", mono: false },
          { label: t("chapter3.tl_issuer_label"),  value: shortMarco,  color: "#a0c4ff", mono: true  },
          { label: t("chapter3.tl_limit_label"),   value: t("chapter3.tl_limit_val"), color: "#48c78e", mono: false },
        ].map(({ label, value, color, mono }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 12px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "8px",
              border: `1px solid ${color}33`,
            }}
          >
            <span style={{
              fontSize: "10px",
              fontWeight: 700,
              color,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              minWidth: "80px",
              flexShrink: 0,
            }}>
              {label}
            </span>
            <span style={{
              fontSize: mono ? "11px" : "13px",
              fontFamily: mono ? "monospace" : "inherit",
              color,
              fontWeight: 600,
              wordBreak: "break-all",
            }}>
              {value}
            </span>
          </motion.div>
        ))}
      </div>

      {/* ── Why the issuer is needed ────────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,217,61,0.06)",
        border: "1px solid rgba(255,217,61,0.22)",
        borderRadius: "10px",
        padding: "12px 14px",
        fontSize: "13px",
        color: "rgba(255,255,255,0.75)",
        lineHeight: 1.6,
      }}>
        💡 {t("chapter3.narrator_tl_why")}
      </div>

      {/* ── 3 Ways to add a Trust Line ──────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1.5px solid rgba(255,255,255,0.12)",
        borderRadius: "14px",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}>
        <p style={{
          margin: 0,
          fontSize: "11px",
          fontWeight: 700,
          color: "rgba(255,255,255,0.5)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}>
          {t("chapter3.tl_methods_title")}
        </p>

        {[
          { emoji: "⌨️", text: t("chapter3.tl_method1") },
          { emoji: "📷", text: t("chapter3.tl_method2") },
          { emoji: "🌐", text: t("chapter3.tl_method3") },
          { emoji: "🔍", text: t("chapter3.tl_method4") },
        ].map(({ emoji, text }, i) => (
          <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "16px", flexShrink: 0 }}>{emoji}</span>
            <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{text}</span>
          </div>
        ))}
      </div>

      {/* ── Continue button ─────────────────────────────────────────────────── */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={next}
        style={{
          background: "rgba(255,217,61,0.2)",
          border: "1.5px solid #FFD93D",
          borderRadius: "10px",
          padding: "12px 20px",
          color: "#FFD93D",
          fontSize: "14px",
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
          width: "100%",
          transition: "all 0.2s",
        }}
      >
        {t("chapter3.tl_continue")}
      </motion.button>
    </div>
  );
}

// ─── TrustLinePreview ──────────────────────────────────────────────────────────

/**
 * Compact preview of the Trust Line about to be created.
 * Shown before the TestnetAction in Scene 6.
 */
function TrustLinePreview({ t, onReady }) {
  const shortMarco = `${MARCO_PUBLIC_KEY.slice(0, 8)}…${MARCO_PUBLIC_KEY.slice(-6)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{
        background: "rgba(160,196,255,0.07)",
        border: "1.5px solid rgba(160,196,255,0.3)",
        borderRadius: "12px",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}>
        <p style={{
          margin: 0,
          fontSize: "10px",
          fontWeight: 700,
          color: "#a0c4ff",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}>
          {t("chapter3.tl_preview_title")}
        </p>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px" }}>
            <span style={{ color: "rgba(255,255,255,0.45)", marginRight: "4px" }}>
              {t("chapter3.tl_code_label")}:
            </span>
            <span style={{ color: "#FFD93D", fontWeight: 700 }}>BERRY</span>
          </span>
          <span style={{ fontSize: "11px", fontFamily: "monospace" }}>
            <span style={{ color: "rgba(255,255,255,0.45)", marginRight: "4px" }}>
              {t("chapter3.tl_issuer_label")}:
            </span>
            <span style={{ color: "#a0c4ff" }}>{shortMarco}</span>
          </span>
          <span style={{ fontSize: "13px" }}>
            <span style={{ color: "rgba(255,255,255,0.45)", marginRight: "4px" }}>
              {t("chapter3.tl_limit_label")}:
            </span>
            <span style={{ color: "#48c78e" }}>∞</span>
          </span>
        </div>
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onReady}
        style={{
          background: "rgba(72,199,142,0.15)",
          border: "1.5px solid rgba(72,199,142,0.5)",
          borderRadius: "10px",
          padding: "11px 20px",
          color: "#48c78e",
          fontSize: "14px",
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
          width: "100%",
          transition: "all 0.2s",
        }}
      >
        {t("chapter3.tl_setup_ready")} →
      </motion.button>
    </div>
  );
}

// ─── Scenes ────────────────────────────────────────────────────────────────────

function buildScenes({ keypair, completeChapter, goToChapter, t }) {
  return [

    // ── Scene 1: Intro – Lumio trifft Marco ────────────────────────────────────
    {
      type: "narrator",
      lines: t("chapter3.narrator_intro"),
    },
    {
      type: "dialog",
      speaker: "narrator",
      lines: [
        t("chapter3.marco_1a"),
        t("chapter3.marco_1b"),
      ],
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: t("chapter3.lumio_1"),
    },

    // ── Scene 2: Was ist ein Asset? Was ist ein Anchor? ────────────────────────
    {
      sectionTitle: t("chapter3.section_asset"),
      type: "dialog",
      speaker: "lumio",
      lines: t("chapter3.lumio_2"),
    },
    {
      type: "narrator",
      lines: t("chapter3.narrator_asset"),
    },
    {
      type: "dialog",
      speaker: "narrator",
      lines: [
        t("chapter3.marco_asset_1"),
        t("chapter3.marco_asset_3"),
        t("chapter3.marco_asset_2"),
      ],
    },

    // ── Scene 3: Trust Line – visuelle Erklärung ───────────────────────────────
    {
      sectionTitle: t("chapter3.section_trustline"),
      type: "narrator",
      lines: t("chapter3.narrator_trustline_intro"),
    },
    {
      type: "custom",
      render: (next) => <TrustLineInfoCard next={next} t={t} />,
    },

    // ── Scene 4: Gefahren & Fake Trust Lines ───────────────────────────────────
    {
      sectionTitle: t("chapter3.section_danger"),
      type: "dialog",
      speaker: "narrator",
      lines: t("chapter3.marco_danger"),
    },
    {
      type: "narrator",
      lines: t("chapter3.narrator_danger_qr"),
    },
    {
      type: "narrator",
      lines: t("chapter3.narrator_danger_toml"),
    },
    {
      type: "narrator",
      lines: t("chapter3.narrator_verify"),
    },

    // ── Scene 5: QR-Code Entscheidung ─────────────────────────────────────────
    {
      sectionTitle: t("chapter3.section_qr"),
      type: "choice",
      question: t("chapter3.q_qr"),
      choices: [
        {
          value: "real_qr",
          label: t("chapter3.choice_real_label"),
          correct: true,
          hint: t("chapter3.choice_real_hint"),
          xp: 30,
        },
        {
          value: "fake_qr",
          label: t("chapter3.choice_fake_label"),
          correct: false,
          hint: t("chapter3.choice_fake_hint"),
        },
      ],
    },

    // ── Scene 6: Trust Line einrichten ─────────────────────────────────────────
    {
      sectionTitle: t("chapter3.section_action_tl"),
      type: "dialog",
      speaker: "narrator",
      lines: t("chapter3.marco_before_tl"),
    },
    {
      type: "custom",
      render: (next) => <TrustLinePreview t={t} onReady={next} />,
    },
    {
      type: "action",
      actionId: "trust_line_berry_ch3",
      icon: "🤝",
      label: t("chapter3.action_tl_label"),
      description: t("chapter3.action_tl_desc"),
      xpReward: 60,
      execute: async (kp) => {
        if (!kp) throw new Error(t("chapter3.error_no_keypair"));
        await ensureMarcoFunded();
        return changeTrust({
          sourceKeypair: kp,
          assetCode: "BERRY",
          assetIssuer: MARCO_PUBLIC_KEY,
        });
      },
    },

    // ── Scene 7: Mini-Quiz – 3 Fragen ──────────────────────────────────────────
    {
      sectionTitle: t("chapter3.section_quiz"),
      type: "choice",
      question: t("chapter3.q1_question"),
      choices: [
        {
          value: "q1_correct",
          label: t("chapter3.q1_a"),
          correct: true,
          hint: t("chapter3.q1_a_hint"),
          xp: 20,
          glossaryTerm: "trustline",
        },
        {
          value: "q1_wrong1",
          label: t("chapter3.q1_b"),
          correct: false,
          hint: t("chapter3.q1_b_hint"),
        },
        {
          value: "q1_wrong2",
          label: t("chapter3.q1_c"),
          correct: false,
          hint: t("chapter3.q1_c_hint"),
        },
      ],
    },
    {
      type: "choice",
      question: t("chapter3.q2_question"),
      choices: [
        {
          value: "q2_wrong1",
          label: t("chapter3.q2_a"),
          correct: false,
          hint: t("chapter3.q2_a_hint"),
        },
        {
          value: "q2_correct",
          label: t("chapter3.q2_b"),
          correct: true,
          hint: t("chapter3.q2_b_hint"),
          xp: 20,
        },
        {
          value: "q2_wrong2",
          label: t("chapter3.q2_c"),
          correct: false,
          hint: t("chapter3.q2_c_hint"),
        },
      ],
    },
    {
      type: "choice",
      question: t("chapter3.q3_question"),
      choices: [
        {
          value: "q3_wrong1",
          label: t("chapter3.q3_a"),
          correct: false,
          hint: t("chapter3.q3_a_hint"),
        },
        {
          value: "q3_correct",
          label: t("chapter3.q3_b"),
          correct: true,
          hint: t("chapter3.q3_b_hint"),
          xp: 20,
        },
        {
          value: "q3_wrong2",
          label: t("chapter3.q3_c"),
          correct: false,
          hint: t("chapter3.q3_c_hint"),
        },
      ],
    },

    // ── Scene 8: BERRY-Token empfangen ─────────────────────────────────────────
    {
      sectionTitle: t("chapter3.section_receive"),
      type: "dialog",
      speaker: "narrator",
      lines: t("chapter3.marco_send"),
    },
    {
      type: "dialog",
      speaker: "lumio",
      lines: t("chapter3.lumio_receive"),
    },
    {
      type: "dialog",
      speaker: "narrator",
      lines: t("chapter3.marco_confirm"),
    },
    {
      type: "action",
      actionId: "receive_berry_ch3",
      icon: "🍓",
      label: t("chapter3.action_receive_label"),
      description: t("chapter3.action_receive_desc"),
      xpReward: 80,
      execute: async (kp) => {
        if (!kp) throw new Error(t("chapter3.error_no_keypair"));
        return sendBerryToUser(kp.publicKey());
      },
    },

    // ── Scene 9: Chapter Summary ───────────────────────────────────────────────
    {
      type: "custom",
      render: () => (
        <ChapterSummary
          chapter={3}
          title={t("chapter3.title")}
          xpEarned={120}
          learnings={[
            t("chapter3.learning_1"),
            t("chapter3.learning_2"),
            t("chapter3.learning_3"),
            t("chapter3.learning_4"),
            { text: t("chapter3.learning_5"), type: "warning" },
          ]}
          onNext={() => {
            completeChapter(3, 120);
            goToChapter(4);
          }}
        />
      ),
    },
  ];
}

// ─── Chapter3 Component ────────────────────────────────────────────────────────

export default function Chapter3() {
  const { keypair, completeChapter, goToChapter } = useStory();
  const { t } = useTranslation("story");
  const scenes = buildScenes({ keypair, completeChapter, goToChapter, t });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => {
        completeChapter(3, 120);
        goToChapter(4);
      }}
    />
  );
}
