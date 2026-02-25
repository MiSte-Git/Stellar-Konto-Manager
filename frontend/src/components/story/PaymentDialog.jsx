import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "./StoryContext";

// ─── Stellar key validation ───────────────────────────────────────────────────

const STELLAR_PK_RE = /^G[A-Z2-7]{55}$/;

function validateDestination(value, ownKey) {
  if (!value || !value.trim()) return null;
  const v = value.trim();
  // Starts with S → Secret Key (always show immediately)
  if (v.startsWith("S")) return "secret_key";
  // Too short to judge format yet → silent
  if (v.length < 4) return null;
  // Wrong format
  if (!STELLAR_PK_RE.test(v)) return "invalid";
  // Valid format but own key
  if (v === ownKey) return "own_key";
  return "valid";
}

function truncateKey(key) {
  if (!key || key.length < 20) return key;
  return `${key.slice(0, 8)}…${key.slice(-8)}`;
}

// ─── PaymentDialog ────────────────────────────────────────────────────────────

/**
 * Props:
 *   sourcePublicKey  – string       sender's public key (readonly display)
 *   presetAccounts   – [{ label, publicKey }]  preset recipient buttons
 *   amount           – string       fixed amount (readonly)
 *   memo             – string       fixed memo (readonly)
 *   onConfirm        – ({ destination, amount, memo }) => void
 *   onCancel         – () => void
 */
export default function PaymentDialog({
  sourcePublicKey,
  presetAccounts = [],
  amount = "10",
  memo = "Hallo Cosmo",
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation("story");
  const { setLumioMood } = useStory();

  const defaultPreset = presetAccounts[0]?.publicKey ?? "";
  const [destination, setDestination] = useState(defaultPreset);
  const [selectedPreset, setSelectedPreset] = useState(defaultPreset || null);
  const [senderCopied, setSenderCopied] = useState(false);

  const validation = validateDestination(destination, sourcePublicKey);

  // Warn Lumio when user tries to enter a secret key
  const prevValidation = React.useRef(null);
  if (validation !== prevValidation.current) {
    prevValidation.current = validation;
    if (validation === "secret_key") setLumioMood("worried");
    else if (validation === "valid") setLumioMood("happy");
  }

  const canSend = validation === "valid";

  const handleDestinationChange = (e) => {
    setDestination(e.target.value);
    setSelectedPreset(null);
  };

  const handlePresetClick = (preset) => {
    setDestination(preset.publicKey);
    setSelectedPreset(preset.publicKey);
  };

  const handleCopySender = async () => {
    try { await navigator.clipboard.writeText(sourcePublicKey); } catch {}
    setSenderCopied(true);
    setTimeout(() => setSenderCopied(false), 2000);
  };

  const handleConfirm = () => {
    if (!canSend) return;
    onConfirm({ destination: destination.trim(), amount, memo });
  };

  // ── Shared label style ──────────────────────────────────────────────────────
  const labelStyle = {
    fontSize: "11px",
    fontWeight: 700,
    color: "rgba(255,255,255,0.45)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: "4px",
  };

  const readonlyFieldStyle = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "8px",
    padding: "9px 12px",
    color: "rgba(255,255,255,0.5)",
    fontSize: "14px",
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.68)",
        backdropFilter: "blur(6px)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        style={{
          background: "linear-gradient(160deg, #1a1a2e, #0f1a2e)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "18px",
          padding: "24px",
          maxWidth: "440px",
          width: "100%",
          fontFamily: "'Nunito', 'Poppins', sans-serif",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          maxHeight: "90dvh",
          overflowY: "auto",
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "22px" }}>💸</span>
          <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "white" }}>
            {t("payment.title", "Zahlung senden")}
          </h3>
        </div>

        {/* Section 1: From (sender, readonly) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <p style={{ ...labelStyle, margin: 0 }}>
            {t("payment.from_label", "Von (dein Konto)")}
          </p>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: "8px",
            padding: "8px 12px",
          }}>
            <code style={{ flex: 1, fontSize: "12px", fontFamily: "monospace", color: "rgba(255,255,255,0.45)", wordBreak: "break-all" }}>
              {truncateKey(sourcePublicKey)}
            </code>
            <button
              onClick={handleCopySender}
              style={{
                background: "none",
                border: "none",
                color: senderCopied ? "#48c78e" : "rgba(255,255,255,0.35)",
                fontSize: "14px",
                cursor: "pointer",
                padding: "2px 4px",
                transition: "color 0.2s",
                flexShrink: 0,
              }}
            >
              {senderCopied ? "✓" : "📋"}
            </button>
          </div>
        </div>

        {/* Section 2: To (recipient) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ ...labelStyle, margin: 0 }}>
            {t("payment.to_label", "An (Empfänger)")}
          </p>

          {/* Preset account buttons */}
          {presetAccounts.length > 0 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {presetAccounts.map((acc) => {
                const isSelected = selectedPreset === acc.publicKey;
                return (
                  <button
                    key={acc.publicKey}
                    onClick={() => handlePresetClick(acc)}
                    style={{
                      background: isSelected ? "rgba(255,217,61,0.16)" : "rgba(255,255,255,0.06)",
                      border: `1.5px solid ${isSelected ? "#FFD93D" : "rgba(255,255,255,0.15)"}`,
                      borderRadius: "20px",
                      padding: "5px 14px",
                      color: isSelected ? "#FFD93D" : "rgba(255,255,255,0.7)",
                      fontSize: "13px",
                      fontWeight: 600,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    {isSelected ? "✓ " : ""}{acc.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Manual input */}
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={destination}
              onChange={handleDestinationChange}
              placeholder={t("payment.to_placeholder", "G... (Public Key eingeben)")}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.04)",
                border: `1.5px solid ${
                  validation === "secret_key"   ? "#ff5b5b" :
                  validation === "invalid"      ? "rgba(255,91,91,0.45)" :
                  validation === "own_key"      ? "rgba(255,91,91,0.45)" :
                  validation === "valid"        ? "#48c78e" :
                  "rgba(255,255,255,0.15)"
                }`,
                borderRadius: "8px",
                padding: "9px 36px 9px 12px",
                color: "rgba(255,255,255,0.9)",
                fontSize: "12px",
                fontFamily: "monospace",
                boxSizing: "border-box",
                outline: "none",
                transition: "border-color 0.2s",
              }}
            />
            {/* Validation icon */}
            {validation === "valid" && (
              <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", color: "#48c78e", fontSize: "16px", pointerEvents: "none" }}>
                ✓
              </span>
            )}
            {(validation === "invalid" || validation === "own_key") && (
              <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", color: "#ff9b9b", fontSize: "14px", pointerEvents: "none" }}>
                ✗
              </span>
            )}
          </div>

          {/* Validation messages */}
          <AnimatePresence mode="wait">
            {validation === "secret_key" && (
              <motion.div
                key="err-secret"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{
                  background: "rgba(255,91,91,0.1)",
                  border: "1px solid rgba(255,91,91,0.4)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontSize: "13px",
                  color: "#ff9b9b",
                  lineHeight: 1.55,
                }}
              >
                ⚠️ <strong>{t("payment.error_secret_key", "Das ist ein Secret Key! Ein Secret Key ist niemals eine Empfängeradresse. Gib deinen Secret Key niemals irgendwo ein.")}</strong>
              </motion.div>
            )}
            {validation === "invalid" && (
              <motion.div
                key="err-invalid"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{ fontSize: "12px", color: "rgba(255,155,155,0.8)", lineHeight: 1.5, padding: "4px 2px" }}
              >
                {t("payment.error_invalid_key", "Kein gültiger Stellar Public Key. Public Keys beginnen mit 'G' und sind 56 Zeichen lang.")}
              </motion.div>
            )}
            {validation === "own_key" && (
              <motion.div
                key="err-own"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{ fontSize: "12px", color: "rgba(255,155,155,0.8)", lineHeight: 1.5, padding: "4px 2px" }}
              >
                {t("payment.error_own_key", "Das ist dein eigener Public Key. Du kannst dir selbst keine Zahlung senden.")}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Section 3: Amount (readonly) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <p style={{ ...labelStyle, margin: 0 }}>
            {t("payment.amount_label", "Betrag (XLM)")}
          </p>
          <div style={readonlyFieldStyle}>
            <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.65)" }}>{amount} XLM</span>
            {" "}
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>(Testnet)</span>
          </div>
        </div>

        {/* Section 4: Memo (readonly) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <p style={{ ...labelStyle, margin: 0 }}>
            {t("payment.memo_label", "Memo (optional)")}
          </p>
          <div style={readonlyFieldStyle}>
            <span style={{ color: "rgba(255,255,255,0.65)" }}>{memo}</span>
          </div>
          <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.35)", fontStyle: "italic", lineHeight: 1.5 }}>
            💡 {t("payment.memo_hint", "Tipp: Börsen brauchen oft ein Memo zur Identifikation")}
          </p>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
          <button
            onClick={onCancel}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "9px",
              padding: "10px 20px",
              color: "rgba(255,255,255,0.6)",
              fontSize: "14px",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {t("payment.cancel", "Abbrechen")}
          </button>

          <motion.button
            whileHover={canSend ? { scale: 1.02 } : {}}
            whileTap={canSend ? { scale: 0.98 } : {}}
            onClick={handleConfirm}
            disabled={!canSend}
            style={{
              background: canSend ? "rgba(72,199,142,0.2)" : "rgba(255,255,255,0.05)",
              border: `1.5px solid ${canSend ? "#48c78e" : "rgba(255,255,255,0.1)"}`,
              borderRadius: "9px",
              padding: "10px 24px",
              color: canSend ? "#48c78e" : "rgba(255,255,255,0.22)",
              fontSize: "14px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: canSend ? "pointer" : "default",
              transition: "all 0.2s",
            }}
          >
            {t("payment.send", "Senden")} ›
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
