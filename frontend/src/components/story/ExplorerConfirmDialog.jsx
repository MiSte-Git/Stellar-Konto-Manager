import React from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

/**
 * Shared confirmation dialog before opening an external explorer link.
 *
 * Props:
 *   url          – string   full URL to open
 *   explorerName – string   displayed explorer name (optional)
 *   onClose      – () => void
 */
export default function ExplorerConfirmDialog({ url, explorerName, onClose }) {
  const { t } = useTranslation("story");

  const handleOpen = () => {
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, #1a1a2e, #0f1a2e)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "16px",
          padding: "24px",
          maxWidth: "380px",
          width: "100%",
          fontFamily: "'Nunito', 'Poppins', sans-serif",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div>
          <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "16px", color: "white" }}>
            🔗 {t("ui.explorer_confirm_title", "Externer Link")}
          </p>
          <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.65)", lineHeight: 1.55 }}>
            {explorerName
              ? `${explorerName} – `
              : ""}
            {t("ui.explorer_confirm_text", "Ein neuer Tab wird geöffnet.")}
          </p>
        </div>

        {/* URL preview */}
        <div style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "8px",
          padding: "8px 12px",
          fontSize: "11px",
          fontFamily: "monospace",
          color: "rgba(255,255,255,0.4)",
          wordBreak: "break-all",
          lineHeight: 1.5,
        }}>
          {url}
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "8px",
              padding: "9px 18px",
              color: "rgba(255,255,255,0.6)",
              fontSize: "14px",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {t("ui.explorer_confirm_cancel", "Abbrechen")}
          </button>
          <button
            onClick={handleOpen}
            style={{
              background: "rgba(160,196,255,0.18)",
              border: "1.5px solid #a0c4ff",
              borderRadius: "8px",
              padding: "9px 18px",
              color: "#a0c4ff",
              fontSize: "14px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {t("ui.explorer_confirm_ok", "Öffnen")} ↗
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
