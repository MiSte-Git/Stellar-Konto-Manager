import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as StellarSdk from "@stellar/stellar-sdk";
import { useTranslation } from "react-i18next";
import { useStory } from "./StoryContext";
import { useSettings } from "../../utils/useSettings";
import ExplorerConfirmDialog from "./ExplorerConfirmDialog";

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const server = new StellarSdk.Horizon.Server(HORIZON_TESTNET);

// ─── Stellar Helpers ──────────────────────────────────────────────────────────

export async function friendbotFund(publicKey) {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) throw new Error("Friendbot failed");
  return res.json();
}

export async function sendPayment({ sourceKeypair, destinationPublicKey, amount, memo }) {
  const account = await server.loadAccount(sourceKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: destinationPublicKey,
      asset: StellarSdk.Asset.native(),
      amount: String(amount),
    }))
    .addMemo(memo ? StellarSdk.Memo.text(memo) : StellarSdk.Memo.none())
    .setTimeout(30)
    .build();

  tx.sign(sourceKeypair);
  return server.submitTransaction(tx);
}

export async function changeTrust({ sourceKeypair, assetCode, assetIssuer, limit }) {
  const account = await server.loadAccount(sourceKeypair.publicKey());
  const asset = new StellarSdk.Asset(assetCode, assetIssuer);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.changeTrust({ asset, limit }))
    .setTimeout(30)
    .build();

  tx.sign(sourceKeypair);
  return server.submitTransaction(tx);
}

// ─── TxHashLink ───────────────────────────────────────────────────────────────

function TxHashLink({ hash }) {
  const { t } = useTranslation("story");
  const { explorers, defaultExplorer: defaultExplorerKey } = useSettings();
  const [copied, setCopied] = useState(false);
  const [confirmUrl, setConfirmUrl] = useState(null);

  if (!hash) return null;

  const short = `${hash.slice(0, 8)}…${hash.slice(-8)}`;
  const activeExplorer = explorers.find((e) => e.key === defaultExplorerKey) ?? explorers[0];
  const explorerUrl = activeExplorer?.testnetTxTemplate
    ? activeExplorer.testnetTxTemplate.replace("{tx}", hash)
    : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
    } catch {
      const el = document.createElement("textarea");
      el.value = hash;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        marginTop: "4px",
      }}>
        <span style={{ fontSize: "12px", color: "#a0aec0", whiteSpace: "nowrap" }}>
          {t("ui.tx_hash_label", "Transaktions-Hash")}:
        </span>
        <span style={{
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#FFD93D",
          background: "rgba(255,217,61,0.1)",
          padding: "2px 7px",
          borderRadius: "4px",
        }}>
          {short}
        </span>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          title={copied ? t("ui.hash_copied", "Kopiert!") : t("ui.copy_hash", "Hash kopieren")}
          style={{
            background: copied ? "rgba(72,199,142,0.15)" : "rgba(255,255,255,0.07)",
            border: `1px solid ${copied ? "#48c78e" : "rgba(255,255,255,0.18)"}`,
            borderRadius: "5px",
            padding: "2px 8px",
            color: copied ? "#48c78e" : "rgba(255,255,255,0.6)",
            fontSize: "11px",
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            transition: "all 0.2s",
            whiteSpace: "nowrap",
          }}
        >
          {copied ? t("ui.hash_copied", "Kopiert!") : "📋"}
        </button>

        {/* Explorer button */}
        {explorerUrl && (
          <button
            onClick={() => setConfirmUrl(explorerUrl)}
            style={{
              background: "rgba(160,196,255,0.1)",
              border: "1px solid rgba(160,196,255,0.3)",
              borderRadius: "5px",
              padding: "2px 8px",
              color: "#a0c4ff",
              fontSize: "11px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t("ui.open_in_explorer", "Im Explorer ansehen ↗")}
          </button>
        )}
      </div>

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
}

// ─── Keypair Redo Warning Dialog ──────────────────────────────────────────────

function KeypairRedoWarning({ onCancel, onConfirm }) {
  const { t } = useTranslation("story");
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        overflow: "hidden",
        background: "rgba(255,91,91,0.08)",
        border: "1.5px solid rgba(255,91,91,0.4)",
        borderRadius: "10px",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <p style={{ margin: 0, fontSize: "13px", color: "#ff9999", lineHeight: 1.55 }}>
        ⚠️ {t("action.redo_keypair_warning")}
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "8px",
            padding: "8px 12px",
            color: "rgba(255,255,255,0.6)",
            fontSize: "13px",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {t("action.redo_cancel")}
        </button>
        <button
          onClick={onConfirm}
          style={{
            flex: 1,
            background: "rgba(255,91,91,0.2)",
            border: "1.5px solid #ff5b5b",
            borderRadius: "8px",
            padding: "8px 12px",
            color: "#ff5b5b",
            fontSize: "13px",
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {t("action.redo_confirm")}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Already Done View ────────────────────────────────────────────────────────

function AlreadyDoneView({ actionId, label, xpReward, onSuccess, onRedo }) {
  const { t } = useTranslation("story");
  const { actionResults } = useStory();
  const [showRedoWarning, setShowRedoWarning] = useState(false);

  const savedResult = actionResults?.[actionId];
  const isKeypair = actionId === "create_keypair_ch1";
  const txHash = savedResult?.hash || savedResult?.id;
  const pubKey = savedResult?.publicKey;

  const handleRedoClick = () => {
    if (isKeypair) {
      setShowRedoWarning(true);
    } else {
      onRedo();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{
        background: "rgba(72,199,142,0.08)",
        border: "2px solid rgba(72,199,142,0.5)",
        borderRadius: "14px",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "18px" }}>✓</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: "#48c78e", fontSize: "14px" }}>
            {t("action.already_done")}
          </div>
          <div style={{ fontSize: "12px", color: "rgba(72,199,142,0.7)" }}>{label}</div>
        </div>
        {xpReward > 0 && (
          <span style={{ fontSize: "12px", color: "rgba(72,199,142,0.7)", fontWeight: 600 }}>
            +{xpReward} XP
          </span>
        )}
      </div>

      {/* Saved result summary */}
      {pubKey && (
        <div style={{
          background: "rgba(72,199,142,0.08)",
          borderRadius: "8px",
          padding: "7px 10px",
          fontSize: "12px",
          fontFamily: "monospace",
          color: "#b4f0d0",
          wordBreak: "break-all",
        }}>
          🔑 {pubKey.slice(0, 8)}…{pubKey.slice(-8)}
        </div>
      )}
      {txHash && !pubKey && (
        <TxHashLink hash={txHash} />
      )}

      {/* Continue button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onSuccess?.(savedResult)}
        style={{
          background: "rgba(72,199,142,0.2)",
          border: "1.5px solid #48c78e",
          borderRadius: "10px",
          padding: "10px 20px",
          color: "#48c78e",
          fontSize: "14px",
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
          width: "100%",
        }}
      >
        {t("action.continue_with_existing", "Weiter")} ›
      </motion.button>

      {/* Redo button */}
      <AnimatePresence>
        {showRedoWarning ? (
          <KeypairRedoWarning
            key="redo-warning"
            onCancel={() => setShowRedoWarning(false)}
            onConfirm={() => { setShowRedoWarning(false); onRedo(); }}
          />
        ) : (
          <motion.button
            key="redo-btn"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileHover={{ color: "rgba(255,255,255,0.7)" }}
            onClick={handleRedoClick}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.35)",
              fontSize: "12px",
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "2px 0",
              alignSelf: "center",
              transition: "color 0.15s",
            }}
          >
            🔄 {t("action.redo", "Nochmals ausführen?")}
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── TestnetAction ────────────────────────────────────────────────────────────

/**
 * Props:
 *   actionId     – string          unique ID (e.g. "friendbot", "payment_ch2")
 *   label        – string          button text
 *   description  – string          what this action does (shown before click)
 *   xpReward     – number          XP for completing the action
 *   execute      – async () => {}  the actual async operation; receives (keypair)
 *   onSuccess    – (result) => {}  called on success
 *   onError      – (err) => {}     called on error
 *   icon         – string          emoji prefix for button
 */
export default function TestnetAction({
  actionId,
  label = "Ausführen",
  description,
  xpReward = 75,
  execute,
  onSuccess,
  onError,
  icon = "🚀",
}) {
  const { keypair, hasCompleted, completeAction, addXP, setActionResult } = useStory();
  const { t } = useTranslation("story");
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [allowRedo, setAllowRedo] = useState(false);

  const alreadyDone = hasCompleted(actionId) && !allowRedo;

  // Compact view for already-completed actions
  if (alreadyDone) {
    return (
      <AlreadyDoneView
        actionId={actionId}
        label={label}
        xpReward={xpReward}
        onSuccess={onSuccess}
        onRedo={() => {
          setAllowRedo(true);
          setStatus("idle");
          setResult(null);
          setError(null);
        }}
      />
    );
  }

  const handleExecute = async () => {
    if (status === "loading") return;
    setStatus("loading");
    setError(null);

    try {
      const res = await execute(keypair);
      setResult(res);
      setStatus("success");
      // Save result to context for future alreadyDone views
      setActionResult(actionId, res);
      // completeAction + addXP deferred to "Weiter" click to avoid
      // alreadyDone flipping true before the success block renders
    } catch (err) {
      console.error(`[TestnetAction:${actionId}]`, err);
      setError(err.message || "Unbekannter Fehler");
      setStatus("error");
      onError?.(err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "2px solid rgba(255,255,255,0.15)",
        borderRadius: "16px",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "20px" }}>{icon}</span>
        <span style={{ fontWeight: 600, color: "white", fontSize: "15px" }}>{label}</span>
        {xpReward > 0 && (
          <span style={{
            marginLeft: "auto",
            fontSize: "12px",
            fontWeight: 700,
            color: "#FFD93D",
            background: "rgba(255,217,61,0.15)",
            padding: "2px 8px",
            borderRadius: "20px",
          }}>
            +{xpReward} XP
          </span>
        )}
      </div>

      {/* Testnet warning */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        background: "rgba(255, 171, 0, 0.12)",
        border: "1.5px solid rgba(255, 171, 0, 0.5)",
        borderRadius: "8px",
        fontSize: "13px",
        color: "#ffab00",
      }}>
        <span>⚠️</span>
        <span>{t("ui.testnet_badge", "Testnet – keine echten Token")}</span>
      </div>

      {/* Description */}
      {description && (
        <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
          {description}
        </p>
      )}

      {/* Action button */}
      <motion.button
        onClick={handleExecute}
        disabled={status === "loading"}
        whileHover={status !== "loading" ? { scale: 1.02 } : {}}
        whileTap={status !== "loading" ? { scale: 0.98 } : {}}
        style={{
          background: status === "loading"
            ? "rgba(255,217,61,0.15)"
            : "rgba(255,217,61,0.2)",
          border: "1.5px solid #FFD93D",
          borderRadius: "10px",
          padding: "11px 20px",
          color: "#FFD93D",
          fontSize: "14px",
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: status === "loading" ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          transition: "all 0.3s",
        }}
      >
        <AnimatePresence mode="wait">
          {status === "loading" ? (
            <motion.span
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, rotate: 360 }}
              transition={{ rotate: { duration: 1, repeat: Infinity, ease: "linear" } }}
              style={{ display: "inline-block" }}
            >
              ⟳
            </motion.span>
          ) : (
            <motion.span key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {icon} {label}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Success result */}
      {status === "success" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          style={{ fontSize: "13px", color: "#48c78e", display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <span>✓ {t("ui.tx_success", "Transaktion erfolgreich!")}</span>
          <TxHashLink hash={result?.hash || result?.id} />
          <motion.button
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              completeAction(actionId);
              addXP(xpReward);
              onSuccess?.(result);
            }}
            style={{
              background: "rgba(72,199,142,0.2)",
              border: "1.5px solid #48c78e",
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
            {t("ui.continue", "Weiter")} ›
          </motion.button>
        </motion.div>
      )}

      {/* Error */}
      {status === "error" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          style={{
            fontSize: "13px",
            color: "#ff5b5b",
            background: "rgba(255,91,91,0.08)",
            padding: "8px 12px",
            borderRadius: "8px",
            lineHeight: 1.5,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <span>✗ Fehler: {error}</span>
          <button
            onClick={handleExecute}
            style={{
              alignSelf: "flex-start",
              background: "rgba(255,91,91,0.15)",
              border: "1px solid rgba(255,91,91,0.4)",
              borderRadius: "6px",
              padding: "6px 14px",
              color: "#ff5b5b",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            🔄 {t("ui.retry_hint", "Versuch es nochmal!")}
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
