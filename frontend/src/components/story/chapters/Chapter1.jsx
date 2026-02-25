/**
 * Kapitel 1 – Die Ankunft
 *
 * Lernziele:
 *  - Was ist eine Wallet / ein Keypair?
 *  - Was ist ein Public Key vs. Secret Key?
 *  - Was macht Friendbot?
 *
 * Ablauf:
 *  1. Lumio landet auf der Blockchain (Dialog)
 *  2. Wissenscheck: Public vs. Secret Key (Choice)
 *  3. Nutzer erstellt ein Keypair (TestnetAction)
 *  4. Keypair-Anzeige mit Bestätigung (Custom)
 *  5. Lumio Warnung (Dialog)
 *  6. Friendbot-Funding (TestnetAction)
 *  7. Explorer-Info (Custom)
 *  8. Outro (Dialog)
 *  9. Chapter Summary (Custom)
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";
import { useStory } from "../StoryContext";
import { friendbotFund } from "../TestnetAction";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings } from "../../../utils/useSettings";
import ExplorerConfirmDialog from "../ExplorerConfirmDialog";

// ─── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text, labelCopy, labelCopied }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        flexShrink: 0,
        background: copied ? "rgba(72,199,142,0.15)" : "rgba(255,255,255,0.08)",
        border: `1px solid ${copied ? "#48c78e" : "rgba(255,255,255,0.2)"}`,
        borderRadius: "6px",
        padding: "4px 10px",
        color: copied ? "#48c78e" : "rgba(255,255,255,0.7)",
        fontSize: "12px",
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "all 0.2s",
        whiteSpace: "nowrap",
      }}
    >
      {copied ? labelCopied : labelCopy}
    </button>
  );
}

// ─── KeypairDisplay ────────────────────────────────────────────────────────────

function KeypairDisplay({ next }) {
  const { keypair, accountFunded } = useStory();
  const { t } = useTranslation("story");
  const { explorers, defaultExplorer: defaultExplorerKey } = useSettings();
  const [confirmed, setConfirmed] = useState(false);
  const [confirmUrl, setConfirmUrl] = useState(null);

  if (!keypair) return null;

  const pub = keypair.publicKey();
  const sec = keypair.secret();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Public Key */}
      <div style={{
        background: "rgba(72,199,142,0.08)",
        border: "1.5px solid rgba(72,199,142,0.35)",
        borderRadius: "12px",
        padding: "14px 16px",
      }}>
        <p style={{
          margin: "0 0 8px",
          fontSize: "11px",
          fontWeight: 700,
          color: "#48c78e",
          letterSpacing: "0.07em",
          textTransform: "uppercase",
        }}>
          {t("chapter1.keypair_public_label")}
        </p>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <code style={{
            flex: 1,
            fontSize: "12px",
            fontFamily: "monospace",
            color: "#b4f0d0",
            wordBreak: "break-all",
            lineHeight: 1.6,
          }}>
            {pub}
          </code>
          <CopyButton
            text={pub}
            labelCopy={t("chapter1.keypair_copy")}
            labelCopied={t("chapter1.keypair_copied")}
          />
        </div>
      </div>

      {/* Secret Key */}
      <div style={{
        background: "rgba(255,91,91,0.08)",
        border: "1.5px solid rgba(255,91,91,0.45)",
        borderRadius: "12px",
        padding: "14px 16px",
      }}>
        <p style={{
          margin: "0 0 8px",
          fontSize: "11px",
          fontWeight: 700,
          color: "#ff5b5b",
          letterSpacing: "0.07em",
          textTransform: "uppercase",
        }}>
          {t("chapter1.keypair_secret_label")}
        </p>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <code style={{
            flex: 1,
            fontSize: "12px",
            fontFamily: "monospace",
            color: "#ffb4b4",
            wordBreak: "break-all",
            lineHeight: 1.6,
          }}>
            {sec}
          </code>
          <CopyButton
            text={sec}
            labelCopy={t("chapter1.keypair_copy")}
            labelCopied={t("chapter1.keypair_copied")}
          />
        </div>
      </div>

      {/* Warning + checkbox */}
      <div style={{
        background: "rgba(255,91,91,0.06)",
        border: "2px solid rgba(255,91,91,0.5)",
        borderRadius: "12px",
        padding: "14px 16px",
      }}>
        <p style={{
          margin: "0 0 12px",
          fontSize: "13px",
          color: "rgba(255,255,255,0.85)",
          lineHeight: 1.6,
        }}>
          ⚠️ {t("chapter1.keypair_warning")}
        </p>
        <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{
              marginTop: "2px",
              width: "16px",
              height: "16px",
              cursor: "pointer",
              flexShrink: 0,
              accentColor: "#48c78e",
            }}
          />
          <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>
            {t("chapter1.keypair_confirm")}
          </span>
        </label>
      </div>

      {/* Explorer hint / link (conditional on accountFunded) */}
      {(() => {
        if (!accountFunded) {
          return (
            <p style={{
              margin: 0,
              fontSize: "12px",
              color: "rgba(255,255,255,0.35)",
              fontStyle: "italic",
              lineHeight: 1.5,
              textAlign: "center",
            }}>
              💡 {t("chapter1.explorer_after_fund")}
            </p>
          );
        }
        const pub = keypair.publicKey();
        const activeExplorer = explorers.find((e) => e.key === defaultExplorerKey) ?? explorers[0];
        const accountUrl = activeExplorer?.testnetUrlTemplate
          ? activeExplorer.testnetUrlTemplate.replace("{address}", pub)
          : `https://stellar.expert/explorer/testnet/account/${pub}`;
        return (
          <>
            <button
              onClick={() => setConfirmUrl(accountUrl)}
              style={{
                background: "rgba(160,196,255,0.1)",
                border: "1px solid rgba(160,196,255,0.3)",
                borderRadius: "9px",
                padding: "9px 16px",
                color: "#a0c4ff",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                width: "100%",
                transition: "all 0.2s",
              }}
            >
              🔍 {t("chapter1.explorer_open", "Im Explorer ansehen")} ↗
            </button>
            <AnimatePresence>
              {confirmUrl && (
                <ExplorerConfirmDialog
                  url={confirmUrl}
                  explorerName={activeExplorer?.name}
                  onClose={() => setConfirmUrl(null)}
                />
              )}
            </AnimatePresence>
          </>
        );
      })()}

      {/* Continue button – active only after checkbox */}
      <button
        onClick={next}
        disabled={!confirmed}
        style={{
          background: confirmed ? "rgba(72,199,142,0.2)" : "rgba(255,255,255,0.05)",
          border: `1.5px solid ${confirmed ? "#48c78e" : "rgba(255,255,255,0.15)"}`,
          borderRadius: "10px",
          padding: "12px 20px",
          color: confirmed ? "#48c78e" : "rgba(255,255,255,0.3)",
          fontSize: "14px",
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: confirmed ? "pointer" : "default",
          transition: "all 0.3s",
          width: "100%",
        }}
      >
        {t("chapter1.keypair_continue")}
      </button>
    </div>
  );
}

// ─── ExplorerInfo ──────────────────────────────────────────────────────────────

function ExplorerInfo({ next }) {
  const { keypair } = useStory();
  const { t } = useTranslation("story");
  const { explorers, defaultExplorer: defaultExplorerKey } = useSettings();
  const [confirmUrl, setConfirmUrl] = useState(null);

  if (!keypair) return null;

  const pub = keypair.publicKey();
  const activeExplorer = explorers.find((e) => e.key === defaultExplorerKey) ?? explorers[0];
  const explorerUrl = activeExplorer?.testnetUrlTemplate
    ? activeExplorer.testnetUrlTemplate.replace("{address}", pub)
    : `https://stellar.expert/explorer/testnet/account/${pub}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{
        background: "rgba(160,196,255,0.07)",
        border: "1.5px solid rgba(160,196,255,0.25)",
        borderRadius: "12px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}>
        {/* Title */}
        <div>
          <p style={{
            margin: "0 0 4px",
            fontSize: "11px",
            fontWeight: 700,
            color: "#a0c4ff",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}>
            {t("chapter1.explorer_title")}
          </p>
          <p style={{
            margin: 0,
            fontSize: "13px",
            color: "rgba(255,255,255,0.75)",
            lineHeight: 1.6,
          }}>
            {t("chapter1.explorer_desc")}
          </p>
        </div>

        {/* Public Key */}
        <div>
          <p style={{
            margin: "0 0 6px",
            fontSize: "11px",
            fontWeight: 700,
            color: "#48c78e",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            {t("chapter1.keypair_public_label")}
          </p>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <code style={{
              flex: 1,
              fontSize: "12px",
              fontFamily: "monospace",
              color: "#b4f0d0",
              wordBreak: "break-all",
              lineHeight: 1.5,
            }}>
              {pub}
            </code>
            <CopyButton
              text={pub}
              labelCopy={t("chapter1.keypair_copy")}
              labelCopied={t("chapter1.keypair_copied")}
            />
          </div>
        </div>

        {/* Explorer URL */}
        <div>
          <p style={{
            margin: "0 0 6px",
            fontSize: "11px",
            fontWeight: 700,
            color: "#a0c4ff",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            {t("chapter1.explorer_url_label")}
          </p>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <code style={{
              flex: 1,
              fontSize: "11px",
              fontFamily: "monospace",
              color: "#c0d8ff",
              wordBreak: "break-all",
              lineHeight: 1.5,
            }}>
              {explorerUrl}
            </code>
            <CopyButton
              text={explorerUrl}
              labelCopy={t("chapter1.explorer_copy_url")}
              labelCopied={t("chapter1.keypair_copied")}
            />
          </div>
        </div>

        {/* Open in Explorer button */}
        <button
          onClick={() => setConfirmUrl(explorerUrl)}
          style={{
            alignSelf: "flex-start",
            background: "rgba(160,196,255,0.12)",
            border: "1px solid rgba(160,196,255,0.35)",
            borderRadius: "8px",
            padding: "7px 14px",
            color: "#a0c4ff",
            fontSize: "13px",
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          🔍 {t("chapter1.explorer_open", "Im Explorer ansehen")} ↗
        </button>

        {/* Hint */}
        <p style={{
          margin: 0,
          fontSize: "12px",
          color: "rgba(255,255,255,0.45)",
          fontStyle: "italic",
          lineHeight: 1.5,
        }}>
          💡 {t("chapter1.explorer_hint")}
        </p>
      </div>

      {/* Continue */}
      <button
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
          transition: "all 0.3s",
          width: "100%",
        }}
      >
        {t("chapter1.keypair_continue")}
      </button>

      {/* Confirmation dialog (shared) */}
      <AnimatePresence>
        {confirmUrl && (
          <ExplorerConfirmDialog
            url={confirmUrl}
            explorerName={activeExplorer?.name}
            onClose={() => setConfirmUrl(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Scenes ────────────────────────────────────────────────────────────────────

function buildScenes({ keypair, createKeypair, completeChapter, goToChapter, t }) {
  return [
    // ── Scene 0: Intro ────────────────────────────────────────────────────────
    {
      type: "narrator",
      lines: t("chapter1.introNarrator"),
    },
    {
      type: "dialog",
      lines: [
        t("chapter1.introDialog1"),
        t("chapter1.introDialog2"),
      ],
    },

    // ── Scene 1: Was ist ein Keypair? ─────────────────────────────────────────
    {
      sectionTitle: t("chapter1.keypairTitle"),
      type: "narrator",
      lines: t("chapter1.keypairNarrator"),
    },
    {
      type: "choice",
      question: t("chapter1.q1_question"),
      choices: [
        {
          value: "public",
          label: t("chapter1.choicePublicKeyLabel"),
          correct: true,
          hint: t("chapter1.choicePublicKeyHint"),
          xp: 30,
          glossaryTerm: "publicKey",
        },
        {
          value: "secret_share",
          label: t("chapter1.choiceSecretShareLabel"),
          correct: false,
          hint: t("chapter1.choiceSecretShareHint"),
          glossaryTerm: "privateKey",
        },
        {
          value: "same",
          label: t("chapter1.choiceSameLabel"),
          correct: false,
          hint: t("chapter1.choiceSameHint"),
          glossaryTerm: "keypair",
        },
      ],
    },

    // ── Scene 2: Keypair erstellen ────────────────────────────────────────────
    {
      sectionTitle: t("chapter1.createTitle"),
      type: "dialog",
      lines: t("chapter1.createDialog"),
    },
    {
      type: "action",
      actionId: "create_keypair_ch1",
      icon: "🔑",
      label: t("chapter1.createActionLabel"),
      description: t("chapter1.createActionDesc"),
      xpReward: 50,
      execute: async () => {
        const kp = createKeypair();
        return { publicKey: kp.publicKey() };
      },
    },

    // ── Scene 3: Keypair-Anzeige (Fix 1) ─────────────────────────────────────
    {
      type: "custom",
      render: (next) => <KeypairDisplay next={next} />,
    },

    // ── Scene 4: Lumio Warnung ────────────────────────────────────────────────
    {
      type: "dialog",
      speaker: "lumio",
      lines: [
        t("chapter1.warningDialog1"),
        t("chapter1.warningDialog2"),
      ],
    },

    // ── Scene 5: Friendbot ────────────────────────────────────────────────────
    {
      sectionTitle: t("chapter1.activateTitle"),
      type: "narrator",
      lines: t("chapter1.activateNarrator"),
    },
    {
      type: "action",
      actionId: "friendbot_ch1",
      icon: "🤖",
      label: t("chapter1.friendbotLabel"),
      description: t("chapter1.friendbotDesc"),
      xpReward: 75,
      execute: async (kp) => {
        if (!kp) throw new Error(t("chapter1.friendbotError"));
        return friendbotFund(kp.publicKey());
      },
    },

    // ── Scene 6: Explorer-Info (Fix 3) ───────────────────────────────────────
    {
      type: "custom",
      render: (next) => <ExplorerInfo next={next} />,
    },

    // ── Scene 7: Outro ────────────────────────────────────────────────────────
    {
      type: "dialog",
      lines: [
        t("chapter1.outroDialog1"),
        t("chapter1.outroDialog2"),
      ],
    },

    // ── Scene 8: Summary ──────────────────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <ChapterSummary
          chapter={1}
          title={t("chapter1.title")}
          xpEarned={150}
          learnings={[
            t("chapter1.summaryLearning1"),
            t("chapter1.summaryLearning2"),
            t("chapter1.summaryLearning3"),
            t("chapter1.summaryLearning4a"),
            { text: t("chapter1.summaryLearning4b"), type: "warning" },
          ]}
          onNext={() => {
            completeChapter(1, 150);
            goToChapter(2);
          }}
        />
      ),
    },
  ];
}

// ─── Chapter1 Component ────────────────────────────────────────────────────────

export default function Chapter1() {
  const { keypair, createKeypair, completeChapter, goToChapter } = useStory();
  const { t } = useTranslation("story");
  const scenes = buildScenes({ keypair, createKeypair, completeChapter, goToChapter, t });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => {
        completeChapter(1, 150);
        goToChapter(2);
      }}
    />
  );
}
