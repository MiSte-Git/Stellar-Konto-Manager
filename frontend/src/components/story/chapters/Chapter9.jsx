/**
 * Kapitel 9 – Die Rückruf-Macht
 * Thema: Clawback – Schutz oder Macht?
 */
import React, { useState, useRef, useEffect } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import confetti from "canvas-confetti";
import { useStory } from "../StoryContext";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";
import ExplorerConfirmDialog from "../ExplorerConfirmDialog";
import { useSettings } from "../../../utils/useSettings";
import { renderWithGlossaryLinks } from "../parseGlossaryTerms";
import Lumio from "../../quiz/Lumio";

// ─── Constants ────────────────────────────────────────────────────────────────

const TRUST_CODE = "TRUST";
const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org/?addr=";
const ACTION1_ID = "chapter9_create_clawback_asset";
const ACTION2_ID = "chapter9_execute_clawback";
const XP_ACTION = 60;
const XP_CHOICE = 25;
const XP_SUMMARY = 175;
const CHAPTER_XP_ALL = [100, 110, 120, 150, 200, 160, 200, 280, 320];
const TOTAL_XP_ALL = CHAPTER_XP_ALL.reduce((a, b) => a + b, 0);

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

// ─── useExplorer ──────────────────────────────────────────────────────────────

function useExplorer() {
  const { explorers, defaultExplorer: defaultKey } = useSettings();
  const explorer = explorers?.find((e) => e.key === defaultKey) || explorers?.[0];
  const name = explorer?.name || "Explorer";

  function tx(hash) {
    if (!explorer?.testnetTxTemplate || !hash) return null;
    return explorer.testnetTxTemplate.replace("{tx}", hash);
  }

  function account(addr) {
    if (!explorer?.testnetUrlTemplate || !addr) return null;
    return explorer.testnetUrlTemplate.replace("{address}", addr);
  }

  function asset(code, issuer) {
    if (!explorer?.testnetUrlTemplate || !code || !issuer) return null;
    // Derive asset base from account template
    const base = explorer.testnetUrlTemplate
      .replace(/\/account\/\{address\}.*$/, "")
      .replace(/\/address\/\{address\}.*$/, "");
    if (explorer.key === "stellar_expert") return `${base}/asset/${code}-${issuer}`;
    return `${base}/assets/${code}-${issuer}`;
  }

  return { name, tx, account, asset };
}

// ─── ExplorerLink ─────────────────────────────────────────────────────────────

function ExplorerLink({ url, label, explorerName, flex }) {
  const [pending, setPending] = useState(null);
  if (!url) return null;
  return (
    <>
      <button
        onClick={() => setPending(url)}
        style={{
          background: "rgba(160,196,255,0.08)",
          border: "1px solid rgba(160,196,255,0.25)",
          borderRadius: "8px",
          padding: "6px 12px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#a0c4ff",
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "center",
          flex: flex || undefined,
        }}
      >
        🔗 {label}
      </button>
      <AnimatePresence>
        {pending && (
          <ExplorerConfirmDialog
            url={pending}
            explorerName={explorerName}
            onClose={() => setPending(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── AccountsOverview ─────────────────────────────────────────────────────────

function AccountsOverview({ issuerPubKey, sofiaAddr, action1Done, action2Done, t }) {
  const { name: explorerName, account: explorerAccount, asset: explorerAsset, tx: explorerTx } = useExplorer();
  const { explorers } = useSettings();

  // Derive asset URL for a specific explorer key (regardless of configured default)
  function assetUrlForKey(explorerKey, code, issuer) {
    const exp = explorers?.find((e) => e.key === explorerKey);
    if (!exp?.testnetUrlTemplate || !code || !issuer) return null;
    const base = exp.testnetUrlTemplate
      .replace(/\/account\/\{address\}.*$/, "")
      .replace(/\/address\/\{address\}.*$/, "");
    return explorerKey === "stellar_expert"
      ? `${base}/asset/${code}-${issuer}`
      : `${base}/assets/${code}-${issuer}`;
  }

  // Derive account URL for a specific explorer key
  function accountUrlForKey(explorerKey, addr) {
    const exp = explorers?.find((e) => e.key === explorerKey);
    if (!exp?.testnetUrlTemplate || !addr) return null;
    return exp.testnetUrlTemplate.replace("{address}", addr);
  }

  const truncate = (addr) => addr ? `${addr.slice(0, 8)}…${addr.slice(-8)}` : "—";

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "14px",
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    }}>
      <p style={{
        margin: 0,
        fontSize: "10px",
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.35)",
      }}>
        {t("chapter9.accounts.title")}
      </p>

      {/* Issuer */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: "rgba(255,217,61,0.8)" }}>
          ⭐ {t("chapter9.accounts.issuer_label")}
        </p>
        <p style={{
          margin: 0, fontFamily: "monospace", fontSize: "11px",
          color: "rgba(255,255,255,0.55)", wordBreak: "break-all",
        }}>
          {truncate(issuerPubKey)}
        </p>
        {action1Done && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <ExplorerLink
                url={explorerAccount(issuerPubKey)}
                label={t("chapter9.accounts.view_account")}
                explorerName={explorerName}
              />
            </div>
            {/* Two explorers shown: Clawback flag display varies by explorer.
                Note: Stellarchain shows Clawback flag only on issuer account level,
                not per asset. Stellar.expert shows it correctly per asset under Summary.
                This note should be reviewed and removed once Stellarchain adds per-asset flag display. */}
            <div style={{
              border: "1px solid rgba(160,196,255,0.18)",
              borderRadius: "10px",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}>
              <p style={{
                margin: 0,
                fontSize: "10px",
                fontWeight: 700,
                color: "rgba(160,196,255,0.6)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}>
                {t("chapter9.accounts.view_token")}
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <ExplorerLink
                  url={assetUrlForKey("stellar_expert", TRUST_CODE, issuerPubKey)}
                  label={`🔍 ${t("chapter9.accounts.view_on_stellar_expert")}`}
                  explorerName="Stellar.expert"
                  flex="1"
                />
                <ExplorerLink
                  url={assetUrlForKey("stellarchain", TRUST_CODE, issuerPubKey)}
                  label={`🔍 ${t("chapter9.accounts.view_on_stellarchain")}`}
                  explorerName="Stellarchain"
                  flex="1"
                />
              </div>
            </div>
            <div style={{
              background: "rgba(255,200,80,0.06)",
              border: "1px solid rgba(255,200,80,0.18)",
              borderRadius: "10px",
              padding: "10px 12px",
            }}>
              <p style={{
                margin: 0,
                fontSize: "11px",
                color: "rgba(255,255,255,0.5)",
                lineHeight: 1.6,
                whiteSpace: "pre-line",
              }}>
                💡 {t("chapter9.accounts.explorer_note")}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)" }} />

      {/* Demo (Sofia) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: "rgba(255,143,171,0.8)" }}>
          🌸 {t("chapter9.accounts.demo_label")}
        </p>
        {sofiaAddr ? (
          <>
            <p style={{
              margin: 0, fontFamily: "monospace", fontSize: "11px",
              color: "rgba(255,255,255,0.55)", wordBreak: "break-all",
            }}>
              {truncate(sofiaAddr)}
            </p>
            {action2Done && (
              <div style={{
                border: "1px solid rgba(160,196,255,0.18)",
                borderRadius: "10px",
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}>
                <p style={{
                  margin: 0,
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "rgba(160,196,255,0.6)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}>
                  {t("chapter9.accounts.view_history")}
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <ExplorerLink
                    url={accountUrlForKey("stellar_expert", sofiaAddr)}
                    label={`🔍 ${t("chapter9.accounts.view_on_stellar_expert")}`}
                    explorerName="Stellar.expert"
                    flex="1"
                  />
                  <ExplorerLink
                    url={accountUrlForKey("stellarchain", sofiaAddr)}
                    label={`🔍 ${t("chapter9.accounts.view_on_stellarchain")}`}
                    explorerName="Stellarchain"
                    flex="1"
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>
            {t("chapter9.accounts.demo_pending")}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── StepRow ──────────────────────────────────────────────────────────────────

function StepRow({ label, done, active }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "10px",
      fontSize: "13px",
      color: done ? "#4ade80" : active ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)",
    }}>
      <span style={{ fontSize: "15px", width: "18px", textAlign: "center" }}>
        {done ? "✓" : active ? "⟳" : "○"}
      </span>
      {label}
    </div>
  );
}

// ─── TxResult ─────────────────────────────────────────────────────────────────

function TxResult({ txHash, successText, xpText, txLabel, explorerName, explorerTx }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: "rgba(74,222,128,0.06)",
        border: "1px solid rgba(74,222,128,0.2)",
        borderRadius: "12px",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <p style={{ margin: 0, fontSize: "13px", color: "#4ade80", fontWeight: 700 }}>
        {successText}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>{txLabel}</span>
        <ExplorerLink
          url={explorerTx(txHash)}
          label={`${txHash.slice(0, 10)}…`}
          explorerName={explorerName}
        />
      </div>
      <span style={{
        alignSelf: "flex-start",
        background: "rgba(255,217,61,0.12)",
        border: "1px solid rgba(255,217,61,0.3)",
        borderRadius: "20px",
        padding: "3px 12px",
        fontSize: "12px",
        fontWeight: 700,
        color: "#FFD93D",
      }}>
        {xpText}
      </span>
    </motion.div>
  );
}

// ─── CreateClawbackAssetAction ────────────────────────────────────────────────

function CreateClawbackAssetAction({ keypair, sofiaRef, onSuccess, addXP, completeAction, t }) {
  const { hasCompleted, actionResults, setActionResult } = useStory();
  const { name: explorerName, tx: explorerTx } = useExplorer();

  const alreadyDone = hasCompleted(ACTION1_ID);
  const savedResult = actionResults?.[ACTION1_ID];

  const [step, setStep] = useState(null); // null | "friendbot" | "setflags" | "trustline" | "payment" | "done"
  const [error, setError] = useState(null);
  const [txHash, setTxHash] = useState(savedResult?.hash || null);
  const [sofiaAddr, setSofiaAddr] = useState(
    sofiaRef.current || savedResult?.sofiaPublicKey || null
  );

  async function run() {
    setError(null);
    try {
      const kp = keypair;
      const server = new StellarSdk.Horizon.Server(HORIZON);
      const asset = new StellarSdk.Asset(TRUST_CODE, kp.publicKey());

      // Step 1 – Friendbot Sofia
      setStep("friendbot");
      const sofiaKp = StellarSdk.Keypair.random();
      sofiaRef.current = sofiaKp.publicKey();
      setSofiaAddr(sofiaKp.publicKey());
      await fetch(`${FRIENDBOT}${encodeURIComponent(sofiaKp.publicKey())}`);

      // Step 2 – AuthRevocableFlag + AuthClawbackEnabledFlag
      setStep("setflags");
      const AUTH_REVOCABLE = StellarSdk.AuthRevocableFlag ?? 2;
      const AUTH_CLAWBACK = StellarSdk.AuthClawbackEnabledFlag ?? 8;
      const issuerAcc1 = await server.loadAccount(kp.publicKey());
      const setOptsTx = new StellarSdk.TransactionBuilder(issuerAcc1, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.setOptions({ setFlags: AUTH_REVOCABLE | AUTH_CLAWBACK }))
        .setTimeout(30)
        .build();
      setOptsTx.sign(kp);
      await server.submitTransaction(setOptsTx);

      // Step 3 – Sofia establishes trustline
      setStep("trustline");
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

      // Step 4 – Payment 100 TRUST
      setStep("payment");
      const issuerAcc2 = await server.loadAccount(kp.publicKey());
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
      payTx.sign(kp);
      const result = await server.submitTransaction(payTx);
      const hash = result.hash;

      // Persist
      const saved = { hash, sofiaPublicKey: sofiaKp.publicKey() };
      setActionResult(ACTION1_ID, saved);
      completeAction(ACTION1_ID);
      addXP(XP_ACTION);
      setTxHash(hash);
      setStep("done");
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.extras?.result_codes || e.message);
      setStep(null);
    }
  }

  const issuerAddr = keypair?.publicKey?.() || null;
  const action1Done = alreadyDone || step === "done";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      {/* Accounts overview */}
      <AccountsOverview
        issuerPubKey={issuerAddr}
        sofiaAddr={sofiaAddr}
        action1Done={action1Done}
        action2Done={false}
        t={t}
      />

      {/* Action header */}
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "14px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}>
        <p style={{ margin: 0, fontSize: "13px", fontWeight: 800, color: "rgba(255,255,255,0.85)" }}>
          🔑 {t("chapter9.act1.title")}
        </p>
        <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>
          {t("chapter9.act1.description")}
        </p>

        {/* Steps (only while running) */}
        {step && step !== "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
            <StepRow label={t("chapter9.act1.step_friendbot")} done={["setflags","trustline","payment"].includes(step)} active={step === "friendbot"} />
            <StepRow label={t("chapter9.act1.step_setflags")} done={["trustline","payment"].includes(step)} active={step === "setflags"} />
            <StepRow label={t("chapter9.act1.step_trustline")} done={step === "payment"} active={step === "trustline"} />
            <StepRow label={t("chapter9.act1.step_payment")} done={false} active={step === "payment"} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "10px",
            padding: "10px 12px",
            fontSize: "12px",
            color: "#f87171",
          }}>
            {typeof error === "object" ? JSON.stringify(error) : String(error)}
          </div>
        )}

        {/* Success */}
        {(action1Done && txHash) && (
          <TxResult
            txHash={txHash}
            successText={t("chapter9.act1.success")}
            xpText={t("chapter9.act1.xp")}
            txLabel={t("chapter9.act1.tx_label")}
            explorerName={explorerName}
            explorerTx={explorerTx}
          />
        )}

        {/* Button */}
        {!action1Done && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={run}
            disabled={!!step}
            style={{
              background: step ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #FFD93D, #FF9A3D)",
              border: "none",
              borderRadius: "12px",
              padding: "12px 20px",
              fontSize: "14px",
              fontWeight: 700,
              color: step ? "rgba(255,255,255,0.35)" : "#1a1a2e",
              fontFamily: "inherit",
              cursor: step ? "default" : "pointer",
            }}
          >
            {step && step !== "done" ? "⟳ …" : t("chapter9.act1.btn_start")}
          </motion.button>
        )}

        {/* Error retry */}
        {error && !step && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={run}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "10px",
              padding: "10px 18px",
              fontSize: "13px",
              fontWeight: 600,
              color: "rgba(255,255,255,0.6)",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            ↺ {t("chapter9.act1.error_retry")}
          </motion.button>
        )}
      </div>

      {/* Continue button */}
      {action1Done && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onSuccess}
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1.5px solid rgba(255,255,255,0.15)",
            borderRadius: "12px",
            padding: "12px 24px",
            fontSize: "14px",
            fontWeight: 600,
            color: "rgba(255,255,255,0.7)",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {t("chapter9.cta_continue")} →
        </motion.button>
      )}
    </motion.div>
  );
}

// ─── ExecuteClawbackAction ────────────────────────────────────────────────────

function ExecuteClawbackAction({ keypair, sofiaRef, onSuccess, addXP, completeAction, t }) {
  const { hasCompleted, actionResults, setActionResult } = useStory();
  const { name: explorerName, tx: explorerTx } = useExplorer();

  const action1Done = hasCompleted(ACTION1_ID);
  const action2Done = hasCompleted(ACTION2_ID);
  const savedResult = actionResults?.[ACTION2_ID];

  const [step, setStep] = useState(null); // null | "clawback" | "done"
  const [error, setError] = useState(null);
  const [txHash, setTxHash] = useState(savedResult?.hash || null);

  // Restore sofiaRef from persisted result if lost across navigation
  const sofiaAddr =
    sofiaRef.current ||
    actionResults?.[ACTION1_ID]?.sofiaPublicKey ||
    null;

  const issuerAddr = keypair?.publicKey?.() || null;

  async function run() {
    setError(null);
    if (!sofiaAddr) {
      setError(t("chapter9.act2.error_no_sofia"));
      return;
    }
    try {
      setStep("clawback");
      const server = new StellarSdk.Horizon.Server(HORIZON);
      const asset = new StellarSdk.Asset(TRUST_CODE, keypair.publicKey());
      const account = await server.loadAccount(keypair.publicKey());

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.clawback({
          asset,
          from: sofiaAddr,
          amount: "100",
        }))
        .setTimeout(30)
        .build();
      tx.sign(keypair);
      const result = await server.submitTransaction(tx);

      const hash = result.hash;
      setActionResult(ACTION2_ID, { hash });
      completeAction(ACTION2_ID);
      addXP(XP_ACTION);
      setTxHash(hash);
      setStep("done");
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.extras?.result_codes || e.message);
      setStep(null);
    }
  }

  const isDone = action2Done || step === "done";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      {/* Accounts overview */}
      <AccountsOverview
        issuerPubKey={issuerAddr}
        sofiaAddr={sofiaAddr}
        action1Done={action1Done}
        action2Done={isDone}
        t={t}
      />

      {/* Locked state */}
      {!action1Done && (
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "14px",
          padding: "20px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}>
          <span style={{ fontSize: "22px" }}>🔒</span>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.4)", lineHeight: 1.55 }}>
            {t("chapter9.act2.locked")}
          </p>
        </div>
      )}

      {/* Action */}
      {action1Done && (
        <div style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "14px",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}>
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 800, color: "rgba(255,255,255,0.85)" }}>
            ⚡ {t("chapter9.act2.title")}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>
            {t("chapter9.act2.description")}
          </p>

          {/* Step */}
          {step === "clawback" && (
            <StepRow label={t("chapter9.act2.step_clawback")} done={false} active={true} />
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: "10px",
              padding: "10px 12px",
              fontSize: "12px",
              color: "#f87171",
            }}>
              {typeof error === "object" ? JSON.stringify(error) : String(error)}
            </div>
          )}

          {/* Success */}
          {isDone && txHash && (
            <TxResult
              txHash={txHash}
              successText={t("chapter9.act2.success")}
              xpText={t("chapter9.act2.xp")}
              txLabel={t("chapter9.act2.tx_label")}
              explorerName={explorerName}
              explorerTx={explorerTx}
            />
          )}

          {/* Button */}
          {!isDone && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={run}
              disabled={!!step}
              style={{
                background: step ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #FF9A3D, #f87171)",
                border: "none",
                borderRadius: "12px",
                padding: "12px 20px",
                fontSize: "14px",
                fontWeight: 700,
                color: step ? "rgba(255,255,255,0.35)" : "#1a1a2e",
                fontFamily: "inherit",
                cursor: step ? "default" : "pointer",
              }}
            >
              {step === "clawback" ? "⟳ …" : t("chapter9.act2.btn_start")}
            </motion.button>
          )}

          {/* Error retry */}
          {error && !step && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={run}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "10px",
                padding: "10px 18px",
                fontSize: "13px",
                fontWeight: 600,
                color: "rgba(255,255,255,0.6)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              ↺ {t("chapter9.act2.error_retry")}
            </motion.button>
          )}
        </div>
      )}

      {/* Continue button */}
      {isDone && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onSuccess}
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1.5px solid rgba(255,255,255,0.15)",
            borderRadius: "12px",
            padding: "12px 24px",
            fontSize: "14px",
            fontWeight: 600,
            color: "rgba(255,255,255,0.7)",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {t("chapter9.cta_continue")} →
        </motion.button>
      )}
    </motion.div>
  );
}

// ─── CharacterDialog ──────────────────────────────────────────────────────────

function CharacterDialog({ speaker, text, next, t, openGlossary }) {
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
            {renderWithGlossaryLinks(text, openGlossary)}
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

// ─── ExpertCertificateScreen ───────────────────────────────────────────────────

function ExpertCertificateScreen({ t, i18n, keypair, onHome }) {
  useEffect(() => {
    const fire = (opts) => confetti({
      particleCount: 120, spread: 90,
      colors: ["#FFD93D", "#3DD6FF", "#48c78e", "#FF9A3D", "#c77aff", "#ffffff"],
      ...opts,
    });
    fire({ origin: { x: 0.25, y: 0.7 } });
    setTimeout(() => fire({ origin: { x: 0.75, y: 0.7 } }), 200);
    setTimeout(() => fire({ origin: { x: 0.5, y: 0.2 }, particleCount: 200 }), 500);
    setTimeout(() => fire({ origin: { x: 0.3, y: 0.5 } }), 900);
    setTimeout(() => fire({ origin: { x: 0.7, y: 0.5 } }), 1100);

    const style = document.createElement("style");
    style.id = "ch9-print-style";
    style.textContent = `@media print {
      body > * { visibility: hidden !important; }
      #ch9-certificate { visibility: visible !important; position: fixed !important;
        top: 0 !important; left: 0 !important; width: 100% !important;
        background: white !important; color: #111 !important;
        border: 2px solid #4a0080 !important; border-radius: 0 !important;
        padding: 40px !important; box-shadow: none !important; }
      #ch9-certificate * { visibility: visible !important; color: #111 !important; }
      #ch9-certificate .cert-xp-badge { background: #f0e8ff !important; border: 1px solid #4a0080 !important; }
    }`;
    document.head.appendChild(style);
    return () => document.getElementById("ch9-print-style")?.remove();
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
        id="ch9-certificate"
        style={{
          width: "100%",
          background: "linear-gradient(160deg, #1a1a2e, #0f0a1e)",
          border: "2px solid rgba(199,122,255,0.45)", borderRadius: "20px", padding: "28px 24px",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: "16px", textAlign: "center", boxShadow: "0 0 40px rgba(199,122,255,0.15)",
        }}
      >
        <Lumio state="celebrate" size={72} />
        <div>
          <p style={{ margin: "0 0 4px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", color: "rgba(199,122,255,0.7)", textTransform: "uppercase" }}>
            Stellar Konto Manager
          </p>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 900, color: "#c77aff", lineHeight: 1.3 }}>
            {t("chapter9.cert_title")}
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: "14px", color: "#48c78e", fontWeight: 700 }}>
          {t("chapter9.cert_tagline")}
        </p>

        <div style={{ width: "100%", height: "1px", background: "rgba(199,122,255,0.15)" }} />

        <div style={{ width: "100%" }}>
          <p style={{ margin: "0 0 4px", fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("chapter9.cert_public_key_label")}
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
            {t("chapter9.cert_date_label")}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.8)" }}>{dateStr}</p>
        </div>

        <div style={{ width: "100%" }}>
          <p style={{ margin: "0 0 8px", fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("chapter9.cert_chapters_label")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                <span style={{ color: "#48c78e", width: "16px", flexShrink: 0 }}>✓</span>
                <span style={{ color: "rgba(255,255,255,0.75)", flex: 1, textAlign: "left" }}>{t(`chapter${n}.title`)}</span>
                <span style={{ color: "#FFD93D", fontSize: "11px", fontWeight: 700 }}>+{CHAPTER_XP_ALL[n - 1]} XP</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { icon: "🥇", key: "cert_badge1", color: "#FFD93D", bg: "rgba(255,217,61,0.1)", border: "rgba(255,217,61,0.3)" },
            { icon: "🏆", key: "cert_badge2", color: "#c77aff", bg: "rgba(199,122,255,0.1)", border: "rgba(199,122,255,0.3)" },
            { icon: "🌟", key: "cert_badge3", color: "#3DD6FF", bg: "rgba(61,214,255,0.1)", border: "rgba(61,214,255,0.3)" },
          ].map(({ icon, key, color, bg, border }) => (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: "6px",
              background: bg, border: `1px solid ${border}`,
              borderRadius: "20px", padding: "5px 14px", fontSize: "12px",
            }}>
              <span>{icon}</span>
              <span style={{ fontWeight: 700, color }}>{t(`chapter9.${key}`)}</span>
            </div>
          ))}
        </div>

        <div
          className="cert-xp-badge"
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            background: "rgba(199,122,255,0.1)", border: "1px solid rgba(199,122,255,0.25)",
            borderRadius: "30px", padding: "8px 20px",
          }}
        >
          <span style={{ fontSize: "20px" }}>⭐</span>
          <span style={{ fontSize: "18px", fontWeight: 800, color: "#c77aff" }}>
            {TOTAL_XP_ALL} {t("chapter9.cert_xp_label")}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={() => window.print()}
          style={{
            background: "linear-gradient(135deg, #c77aff, #3DD6FF)", border: "none",
            borderRadius: "14px", padding: "14px 24px", fontSize: "15px", fontWeight: 700,
            color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            boxShadow: "0 4px 16px rgba(199,122,255,0.3)",
          }}
        >🖨️ {t("chapter9.cert_print_btn")}</motion.button>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onHome}
          style={{
            background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
            borderRadius: "14px", padding: "13px 24px", fontSize: "14px", fontWeight: 600,
            color: "rgba(255,255,255,0.7)", fontFamily: "inherit", cursor: "pointer",
          }}
        >🏠 {t("chapter9.cert_home_btn")}</motion.button>
      </div>
    </motion.div>
  );
}

// ─── Scene builder ─────────────────────────────────────────────────────────────

function buildScenes({ openGlossary, setShowChapterSelect, t, i18n, keypair, addXP, completeChapter, completeAction, sofiaRef, onExit }) {
  const cd = (speaker, textKey) =>
    (next) => <CharacterDialog speaker={speaker} text={t(textKey)} next={next} t={t} openGlossary={openGlossary} />;

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
    { type: "custom", render: cd("lumio", "chapter9.scene2.dialog7") },
    {
      type: "custom",
      render: (next) => <ClawbackGlossaryScene next={next} t={t} openGlossary={openGlossary} />,
    },

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
        <CreateClawbackAssetAction
          keypair={keypair}
          sofiaRef={sofiaRef}
          onSuccess={next}
          addXP={addXP}
          completeAction={completeAction}
          t={t}
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
        <ExecuteClawbackAction
          keypair={keypair}
          sofiaRef={sofiaRef}
          onSuccess={next}
          addXP={addXP}
          completeAction={completeAction}
          t={t}
        />
      ),
    },
    { type: "custom", render: cd("lumio", "chapter9.scene5.post.dialog1") },
    { type: "custom", render: cd("sofia", "chapter9.scene5.post.dialog2") },
    { type: "custom", render: cd("erik", "chapter9.scene5.post.dialog3") },
    { type: "custom", render: cd("lumio", "chapter9.scene5.post.dialog4") },
    { type: "custom", render: cd("sofia", "chapter9.scene5.post.dialog5") },

    // ── SZENE 5b – Ein zweischneidiges Schwert ────────────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene5b.section"), render: cd("lumio", "chapter9.scene5b.dialog1") },
    { type: "custom", render: cd("lumio", "chapter9.scene5b.dialog2") },
    { type: "custom", render: cd("lumio", "chapter9.scene5b.dialog3") },
    { type: "custom", render: cd("lumio", "chapter9.scene5b.dialog4") },
    { type: "custom", render: cd("erik", "chapter9.scene5b.dialog5") },
    { type: "custom", render: cd("sofia", "chapter9.scene5b.dialog6") },
    { type: "custom", render: cd("lumio", "chapter9.scene5b.dialog7") },

    // ── SZENE 5c – Die Grenzen von Clawback ──────────────────────────────────
    { type: "custom", sectionTitle: t("chapter9.scene5c.section"), render: cd("lumio", "chapter9.scene5c.dialog1") },
    { type: "custom", render: cd("lumio", "chapter9.scene5c.dialog2") },
    { type: "custom", render: cd("lumio", "chapter9.scene5c.dialog3") },
    { type: "custom", render: cd("lumio", "chapter9.scene5c.dialog4") },
    { type: "custom", render: cd("erik",  "chapter9.scene5c.dialog5") },
    { type: "custom", render: cd("sofia", "chapter9.scene5c.dialog6") },
    { type: "custom", render: cd("lumio", "chapter9.scene5c.dialog7") },

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
          isLast
          onNext={() => {
            addXP(XP_SUMMARY);
            completeChapter(9);
            next();
          }}
        />
      ),
    },
    // ── EXPERTEN-ZERTIFIKAT ───────────────────────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter9.section_cert"),
      render: () => (
        <ExpertCertificateScreen t={t} i18n={i18n} keypair={keypair} onHome={onExit} />
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
    completeChapter,
    completeAction,
    onExit,
  } = useStory();
  const { t, i18n } = useTranslation("story");

  const sofiaRef = useRef(null);

  const scenes = buildScenes({
    openGlossary, setShowChapterSelect, t, i18n,
    keypair, addXP, completeChapter, completeAction,
    sofiaRef, onExit,
  });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => setShowChapterSelect(true)}
    />
  );
}
