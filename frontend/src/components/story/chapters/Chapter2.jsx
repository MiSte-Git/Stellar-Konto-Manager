/**
 * Kapitel 2 – Lumios erste Transaktion
 *
 * Lernziele:
 *  - Was ist eine Stellar-Transaktion?
 *  - Was sind Transaktionsgebühren (Base Fee)?
 *  - Was ist ein Memo-Feld?
 *  - Was ist ein Transaction-Hash und wie findet man ihn im Explorer?
 *
 * Ablauf:
 *  1. Intro – was ist eine Transaktion?
 *  2. Wissensfrage: Wozu dient die Base Fee?
 *  3. Dialog: Memo-Feld
 *  4. Wissensfrage: Wann brauche ich ein Memo?
 *  5. Action: Zahlung an Cosmo senden
 *  6. Outro + Transaction-Hash
 *  7. Chapter Summary
 */

import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";
import { useStory } from "../StoryContext";
import { sendPayment, friendbotFund } from "../TestnetAction";
import PaymentDialog from "../PaymentDialog";

// ─── Cosmo – fixes Testnet-Empfängerkonto ─────────────────────────────────────
// Generiert und einmalig via Friendbot aktiviert.
const COSMO_PUBLIC_KEY = "GDTGA55CCRAMSW4KZFAIOCTYYS7H6UI7X7VWKOVPAYQSGEG6QI2ZCC4R";

/**
 * Stellt sicher dass Cosmos Konto auf dem Testnet existiert.
 * Falls nicht (z.B. nach Testnet-Reset), wird Friendbot aufgerufen.
 */
async function ensureCosmoFunded() {
  try {
    const res = await fetch(
      `https://horizon-testnet.stellar.org/accounts/${COSMO_PUBLIC_KEY}`
    );
    if (res.ok) return; // Konto existiert bereits
    // 404 oder anderer Fehler → via Friendbot aktivieren
    await friendbotFund(COSMO_PUBLIC_KEY);
  } catch {
    // Netzwerkfehler beim Check – Friendbot-Versuch trotzdem
    try { await friendbotFund(COSMO_PUBLIC_KEY); } catch { /* ignorieren */ }
  }
}

// ─── Scenes ────────────────────────────────────────────────────────────────────

function buildScenes({ keypair, completeChapter, goToChapter, t, pendingPaymentRef }) {
  return [
    // ── Szene 1: Intro (narrator) ─────────────────────────────────────────────
    {
      type: "narrator",
      lines: t("chapter2.narrator_intro"),
    },

    // ── Szene 2: Lumio fragt nach Transaktionen ───────────────────────────────
    {
      type: "dialog",
      speaker: "lumio",
      lines: [
        t("chapter2.lumio_1a"),
        t("chapter2.lumio_1b"),
      ],
    },

    // ── Szene 3: Erklärung Transaktion (narrator) ─────────────────────────────
    {
      sectionTitle: t("chapter2.section_tx"),
      type: "narrator",
      lines: t("chapter2.narrator_tx"),
    },

    // ── Szene 4: Wissensfrage Base Fee ────────────────────────────────────────
    {
      type: "choice",
      question: t("chapter2.q1_question"),
      choices: [
        {
          value: "fee_correct",
          label: t("chapter2.choice1_a"),
          correct: true,
          hint: t("chapter2.choice1_a_hint"),
          xp: 30,
        },
        {
          value: "fee_sdf",
          label: t("chapter2.choice1_b"),
          correct: false,
          hint: t("chapter2.choice1_b_hint"),
        },
        {
          value: "fee_optional",
          label: t("chapter2.choice1_c"),
          correct: false,
          hint: t("chapter2.choice1_c_hint"),
        },
      ],
    },

    // ── Szene 5: Lumio fragt nach Memo ───────────────────────────────────────
    {
      type: "dialog",
      speaker: "lumio",
      lines: t("chapter2.lumio_2"),
    },

    // ── Szene 6: Erklärung Memo (narrator) ────────────────────────────────────
    {
      sectionTitle: t("chapter2.section_memo"),
      type: "narrator",
      lines: t("chapter2.narrator_memo"),
    },

    // ── Szene 7: Wissensfrage Memo ────────────────────────────────────────────
    {
      type: "choice",
      question: t("chapter2.q2_question"),
      choices: [
        {
          value: "memo_always",
          label: t("chapter2.choice2_a"),
          correct: false,
          hint: t("chapter2.choice2_a_hint"),
        },
        {
          value: "memo_exchange",
          label: t("chapter2.choice2_b"),
          correct: true,
          hint: t("chapter2.choice2_b_hint"),
          xp: 30,
        },
        {
          value: "memo_never",
          label: t("chapter2.choice2_c"),
          correct: false,
          hint: t("chapter2.choice2_c_hint"),
        },
      ],
    },

    // ── Szene 8: Lumio möchte senden ─────────────────────────────────────────
    {
      type: "dialog",
      speaker: "lumio",
      lines: t("chapter2.lumio_3"),
    },

    // ── Szene 9: Zahlungs-Dialog ──────────────────────────────────────────────
    {
      sectionTitle: t("chapter2.section_action"),
      type: "custom",
      render: (next, prev) => (
        <PaymentDialog
          sourcePublicKey={keypair?.publicKey()}
          presetAccounts={[{ label: t("chapter2.preset_cosmo"), publicKey: COSMO_PUBLIC_KEY }]}
          amount="10"
          memo="Hallo Cosmo"
          onConfirm={(data) => {
            pendingPaymentRef.current = data;
            next();
          }}
          onCancel={prev}
        />
      ),
    },

    // ── Szene 10: Zahlung senden (action) ─────────────────────────────────────
    {
      type: "action",
      actionId: "payment_ch2",
      icon: "💸",
      label: t("chapter2.action_label"),
      description: t("chapter2.action_desc"),
      xpReward: 100,
      execute: async (kp) => {
        if (!kp) throw new Error(t("chapter2.error_no_keypair"));
        const { destination, amount, memo } = pendingPaymentRef.current;
        await ensureCosmoFunded();
        return sendPayment({
          sourceKeypair: kp,
          destinationPublicKey: destination,
          amount,
          memo,
        });
      },
    },

    // ── Szene 10: Lumio sieht die Transaktion ────────────────────────────────
    {
      type: "dialog",
      speaker: "lumio",
      lines: [
        t("chapter2.lumio_4a"),
        t("chapter2.lumio_4b"),
      ],
    },

    // ── Szene 11: Transaction-Hash (narrator) ────────────────────────────────
    {
      type: "narrator",
      lines: t("chapter2.narrator_hash"),
    },

    // ── Szene 12: Summary ─────────────────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <ChapterSummary
          chapter={2}
          title={t("chapter2.title")}
          xpEarned={200}
          learnings={[
            t("chapter2.learning_1"),
            t("chapter2.learning_2"),
            t("chapter2.learning_3"),
            t("chapter2.learning_4"),
          ]}
          onNext={() => {
            completeChapter(2, 200);
            goToChapter(3);
          }}
        />
      ),
    },
  ];
}

// ─── Chapter2 Component ────────────────────────────────────────────────────────

export default function Chapter2() {
  const { keypair, completeChapter, goToChapter } = useStory();
  const { t } = useTranslation("story");

  // Persists the payment dialog result across scene re-renders
  const pendingPaymentRef = useRef({
    destination: COSMO_PUBLIC_KEY,
    amount: "10",
    memo: "Hallo Cosmo",
  });

  const scenes = buildScenes({ keypair, completeChapter, goToChapter, t, pendingPaymentRef });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => {
        completeChapter(2, 200);
        goToChapter(3);
      }}
    />
  );
}
