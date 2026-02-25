import React, { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "../StoryContext";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";

// ─── Scam chat bubble ─────────────────────────────────────────────────────────

function ScamBubble({ text }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}
    >
      <div style={{
        width: "32px", height: "32px", borderRadius: "50%",
        background: "rgba(255,91,91,0.15)", border: "1px solid rgba(255,91,91,0.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "16px", flexShrink: 0,
      }}>
        🎭
      </div>
      <div style={{
        background: "rgba(255,91,91,0.08)",
        border: "1px solid rgba(255,91,91,0.18)",
        borderRadius: "0 12px 12px 12px",
        padding: "9px 13px",
        maxWidth: "calc(100% - 46px)",
      }}>
        <p style={{ margin: 0, fontSize: "14px", color: "rgba(255,255,255,0.85)", lineHeight: 1.55 }}>{text}</p>
      </div>
    </motion.div>
  );
}

// ─── Scammer contact header ───────────────────────────────────────────────────

function ScammerHeader({ t }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "10px",
      background: "rgba(255,91,91,0.08)",
      border: "1px solid rgba(255,91,91,0.2)",
      borderRadius: "14px", padding: "12px 14px",
    }}>
      <span style={{ fontSize: "24px" }}>🎭</span>
      <div>
        <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#ff5b5b" }}>
          {t("chapter4.scammer_name")}
        </p>
        <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
          {t("chapter4.scammer_subtitle")}
        </p>
      </div>
      <span style={{
        marginLeft: "auto", fontSize: "10px", fontWeight: 700,
        color: "#ff5b5b", background: "rgba(255,91,91,0.15)",
        border: "1px solid rgba(255,91,91,0.3)",
        borderRadius: "4px", padding: "2px 6px", flexShrink: 0,
      }}>
        ⚠️ {t("chapter4.unverified")}
      </span>
    </div>
  );
}

// ─── Social Engineering explainer card ───────────────────────────────────────

function SocialEngineeringCard({ next, t }) {
  const tactics = [
    { icon: "👤", title: t("chapter4.tactic1_title"), text: t("chapter4.tactic1_text") },
    { icon: "⏰", title: t("chapter4.tactic2_title"), text: t("chapter4.tactic2_text") },
    { icon: "🎁", title: t("chapter4.tactic3_title"), text: t("chapter4.tactic3_text") },
    { icon: "💔", title: t("chapter4.tactic4_title"), text: t("chapter4.tactic4_text") },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#ff5b5b" }}>
          {t("chapter4.social_eng_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>
          {t("chapter4.social_eng_title")}
        </h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
          {t("chapter4.social_eng_desc")}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {tactics.map((tac, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
            style={{
              display: "flex", gap: "12px", alignItems: "flex-start",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "12px", padding: "12px 14px",
            }}
          >
            <span style={{ fontSize: "22px", flexShrink: 0, marginTop: "1px" }}>{tac.icon}</span>
            <div>
              <p style={{ margin: "0 0 3px", fontSize: "13px", fontWeight: 700, color: "white" }}>{tac.title}</p>
              <p style={{ margin: 0, fontSize: "12px", color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>{tac.text}</p>
            </div>
          </motion.div>
        ))}
      </div>
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={next}
        style={{
          background: "linear-gradient(135deg, #ff5b5b, #ff9a3d)",
          border: "none", borderRadius: "14px", padding: "14px 32px",
          fontSize: "15px", fontWeight: 700, color: "white",
          fontFamily: "inherit", cursor: "pointer",
          boxShadow: "0 4px 16px rgba(255,91,91,0.3)",
        }}
      >
        {t("chapter4.social_eng_cta")}
      </motion.button>
    </motion.div>
  );
}

// ─── Wrong path: drain animation ─────────────────────────────────────────────

function WrongPathDrain({ onRetry, hint, t }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "20px", padding: "12px 0" }}
    >
      <motion.div
        animate={{ scale: [1, 1.08, 1], opacity: [1, 0.75, 1] }}
        transition={{ duration: 1.6, repeat: Infinity }}
        style={{ fontSize: "56px" }}
      >
        💸
      </motion.div>
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 8px", fontSize: "17px", fontWeight: 800, color: "#ff5b5b" }}>
          {t("chapter4.drain_title")}
        </p>
        <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
          {t("chapter4.drain_text")}
        </p>
      </div>
      {hint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          style={{
            background: "rgba(255,171,0,0.1)", border: "1px solid rgba(255,171,0,0.3)",
            borderRadius: "12px", padding: "12px 16px", width: "100%",
          }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "#ffab00", lineHeight: 1.55 }}>
            💡 {hint}
          </p>
        </motion.div>
      )}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={onRetry}
        style={{
          background: "rgba(255,255,255,0.08)",
          border: "1.5px solid rgba(255,255,255,0.2)",
          borderRadius: "12px", padding: "12px 28px",
          fontSize: "14px", fontWeight: 700, color: "white",
          fontFamily: "inherit", cursor: "pointer",
        }}
      >
        🔄 {t("chapter4.retry")}
      </motion.button>
    </motion.div>
  );
}

// ─── Choice scene with wrong-path retry ──────────────────────────────────────

function ChoiceWithRetry({ question, choices, correctValue, next, t, hintKey2 }) {
  const [chosen, setChosen] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [showWrong, setShowWrong] = useState(false);
  const { loseHeart } = useStory();

  if (showWrong) {
    const hint = attempts >= 2 ? t(hintKey2) : null;
    return (
      <WrongPathDrain
        t={t}
        hint={hint}
        onRetry={() => { setChosen(null); setShowWrong(false); }}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "white", lineHeight: 1.5 }}>
        {question}
      </p>
      {choices.map((c, i) => {
        const isChosen = chosen === c.value;
        const isCorrect = c.value === correctValue;
        return (
          <motion.button
            key={i}
            whileHover={!chosen ? { scale: 1.02 } : {}}
            whileTap={!chosen ? { scale: 0.98 } : {}}
            disabled={!!chosen && !isChosen}
            onClick={() => {
              if (chosen) return;
              setChosen(c.value);
              if (c.value !== correctValue) {
                loseHeart();
                setAttempts(a => a + 1);
                setTimeout(() => { setChosen(null); setShowWrong(true); }, 500);
              }
            }}
            style={{
              background: isChosen
                ? isCorrect ? "rgba(72,199,142,0.15)" : "rgba(255,91,91,0.15)"
                : "rgba(255,255,255,0.05)",
              border: isChosen
                ? isCorrect ? "1.5px solid #48c78e" : "1.5px solid #ff5b5b"
                : "1.5px solid rgba(255,255,255,0.12)",
              borderRadius: "12px", padding: "13px 16px",
              textAlign: "left", cursor: chosen ? "default" : "pointer",
              fontFamily: "inherit", transition: "all 0.2s",
              opacity: (!chosen || isChosen) ? 1 : 0.4,
              width: "100%",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: isChosen ? 700 : 500, color: "white" }}>
              {c.label}
            </span>
          </motion.button>
        );
      })}
      {chosen && chosen === correctValue && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "#48c78e", lineHeight: 1.55 }}>
            ✓ {choices.find(c => c.value === correctValue)?.hint}
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={next}
            style={{
              background: "linear-gradient(135deg, #48c78e, #3DD6FF)",
              border: "none", borderRadius: "12px", padding: "13px 28px",
              fontSize: "14px", fontWeight: 700, color: "#1a1a2e",
              fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter4.choice_correct_cta")} →
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Inline mini scam simulator ───────────────────────────────────────────────

function MiniScamSimulator({ next, t }) {
  const messages = [
    t("chapter4.mini_sim_msg1"),
    t("chapter4.mini_sim_msg2"),
    t("chapter4.mini_sim_msg3"),
  ];
  const options = [
    { value: "share",  label: t("chapter4.mini_sim_opt_share"),  isScam: true },
    { value: "ignore", label: t("chapter4.mini_sim_opt_ignore"), isScam: false },
    { value: "report", label: t("chapter4.mini_sim_opt_report"), isScam: false },
  ];
  const [chosen, setChosen] = useState(null);
  const chosenOpt = options.find(o => o.value === chosen);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      <div style={{
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "16px", overflow: "hidden",
      }}>
        {/* Chat header */}
        <div style={{
          display: "flex", alignItems: "center", gap: "10px",
          padding: "12px 14px",
          background: "rgba(255,91,91,0.1)",
          borderBottom: "1px solid rgba(255,91,91,0.2)",
        }}>
          <span style={{ fontSize: "22px" }}>🎭</span>
          <div>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#ff5b5b" }}>
              {t("chapter4.scammer_name")}
            </p>
            <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
              {t("chapter4.scammer_subtitle")}
            </p>
          </div>
          <span style={{
            marginLeft: "auto", fontSize: "10px", fontWeight: 700,
            color: "#ff5b5b", background: "rgba(255,91,91,0.15)",
            border: "1px solid rgba(255,91,91,0.3)",
            borderRadius: "4px", padding: "2px 6px",
          }}>
            ⚠️ {t("chapter4.unverified")}
          </span>
        </div>
        {/* Messages */}
        <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.15 }}
              style={{
                background: "rgba(255,255,255,0.06)",
                borderRadius: "0 10px 10px 10px",
                padding: "8px 12px",
                maxWidth: "90%",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>
                {msg}
              </p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Choice */}
      {!chosen ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ margin: 0, fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "rgba(255,255,255,0.4)" }}>
            {t("chapter4.mini_sim_prompt")}
          </p>
          {options.map((opt, i) => (
            <motion.button
              key={i}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setChosen(opt.value)}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1.5px solid rgba(255,255,255,0.12)",
                borderRadius: "10px", padding: "11px 14px",
                textAlign: "left", cursor: "pointer",
                fontFamily: "inherit", color: "white", fontSize: "13px",
                width: "100%",
              }}
            >
              {opt.label}
            </motion.button>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <div style={{
            background: chosenOpt?.isScam ? "rgba(255,91,91,0.1)" : "rgba(72,199,142,0.1)",
            border: `1.5px solid ${chosenOpt?.isScam ? "rgba(255,91,91,0.3)" : "rgba(72,199,142,0.3)"}`,
            borderRadius: "12px", padding: "12px 16px",
          }}>
            <p style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 700, color: chosenOpt?.isScam ? "#ff5b5b" : "#48c78e" }}>
              {chosenOpt?.isScam ? t("chapter4.mini_sim_scam_result") : t("chapter4.mini_sim_safe_result")}
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.65)", lineHeight: 1.55 }}>
              {chosenOpt?.isScam ? t("chapter4.mini_sim_scam_desc") : t("chapter4.mini_sim_safe_desc")}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={next}
            style={{
              background: "linear-gradient(135deg, #48c78e, #3DD6FF)",
              border: "none", borderRadius: "12px", padding: "13px 28px",
              fontSize: "14px", fontWeight: 700, color: "#1a1a2e",
              fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter4.mini_sim_cta")} →
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Emergency steps card ─────────────────────────────────────────────────────

function EmergencyStepsCard({ next, t }) {
  const steps = [
    { icon: "🔄", text: t("chapter4.emergency1") },
    { icon: "💸", text: t("chapter4.emergency2") },
    { icon: "🔒", text: t("chapter4.emergency3") },
    { icon: "🆕", text: t("chapter4.emergency4") },
    { icon: "📢", text: t("chapter4.emergency5") },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#ff5b5b" }}>
          {t("chapter4.emergency_label")}
        </p>
        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "white" }}>
          {t("chapter4.emergency_title")}
        </h3>
        <p style={{ margin: "8px 0 0", fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
          {t("chapter4.emergency_desc")}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {steps.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
            style={{
              display: "flex", gap: "12px", alignItems: "flex-start",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "10px", padding: "11px 13px",
            }}
          >
            <span style={{ fontSize: "20px", flexShrink: 0 }}>{s.icon}</span>
            <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.55 }}>{s.text}</p>
          </motion.div>
        ))}
      </div>
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.65 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={next}
        style={{
          background: "linear-gradient(135deg, #3DD6FF, #48c78e)",
          border: "none", borderRadius: "14px", padding: "14px 32px",
          fontSize: "15px", fontWeight: 700, color: "#1a1a2e",
          fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {t("chapter4.emergency_cta")}
      </motion.button>
    </motion.div>
  );
}

// ─── Scene builder ────────────────────────────────────────────────────────────

function buildScenes({ completeChapter, goToChapter, t }) {
  return [
    // ── Scene 0: Intro narrator ───────────────────────────────────────────────
    {
      type: "narrator",
      sectionTitle: t("chapter4.section_intro"),
      lines: [t("chapter4.intro_narrator1"), t("chapter4.intro_narrator2")],
    },
    // ── Scene 1: Scammer contact ──────────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          <ScammerHeader t={t} />
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingLeft: "6px" }}>
            {[t("chapter4.scam_msg1"), t("chapter4.scam_msg2"), t("chapter4.scam_msg3")].map((msg, i) => (
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.2 }}>
                <ScamBubble text={msg} />
              </motion.div>
            ))}
          </div>
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={next}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1.5px solid rgba(255,255,255,0.15)",
              borderRadius: "12px", padding: "13px 24px",
              fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.7)",
              fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {t("chapter4.scam_msg_cta")} →
          </motion.button>
        </motion.div>
      ),
    },
    // ── Scene 2: Social Engineering explainer ─────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter4.section_social_eng"),
      render: (next) => <SocialEngineeringCard next={next} t={t} />,
    },
    // ── Scene 3: Choice 1 – Share Secret Key? ─────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter4.section_choice1"),
      render: (next) => (
        <ChoiceWithRetry
          t={t}
          question={t("chapter4.choice1_question")}
          hintKey2="chapter4.choice1_hint2"
          correctValue="no"
          choices={[
            { value: "yes", label: t("chapter4.choice1_yes"), hint: t("chapter4.choice1_yes_hint") },
            { value: "no",  label: t("chapter4.choice1_no"),  hint: t("chapter4.choice1_no_hint") },
            { value: "ask", label: t("chapter4.choice1_ask"), hint: t("chapter4.choice1_ask_hint") },
          ]}
          next={next}
        />
      ),
    },
    // ── Scene 4: Lumio dialog after correct choice ─────────────────────────────
    {
      type: "dialog",
      speaker: "lumio",
      lines: [t("chapter4.after_choice1_1"), t("chapter4.after_choice1_2")],
    },
    // ── Scene 5: Choice 2 – Phishing link ────────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter4.section_choice2"),
      render: (next) => (
        <ChoiceWithRetry
          t={t}
          question={t("chapter4.choice2_question")}
          hintKey2="chapter4.choice2_hint2"
          correctValue="ignore"
          choices={[
            { value: "click",  label: t("chapter4.choice2_click"),  hint: t("chapter4.choice2_click_hint") },
            { value: "ignore", label: t("chapter4.choice2_ignore"), hint: t("chapter4.choice2_ignore_hint") },
            { value: "reply",  label: t("chapter4.choice2_reply"),  hint: t("chapter4.choice2_reply_hint") },
          ]}
          next={next}
        />
      ),
    },
    // ── Scene 6: Mini scam simulator ─────────────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter4.section_simulator"),
      render: (next) => <MiniScamSimulator next={next} t={t} />,
    },
    // ── Scene 7: Emergency steps ──────────────────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter4.section_emergency"),
      render: (next) => <EmergencyStepsCard next={next} t={t} />,
    },
    // ── Scene 8: Quiz question 1 ──────────────────────────────────────────────
    {
      type: "choice",
      sectionTitle: t("chapter4.section_quiz"),
      question: t("chapter4.quiz1_q"),
      choices: [
        { label: t("chapter4.quiz1_a1"), value: "a1", correct: false, hint: t("chapter4.quiz1_a1_hint") },
        { label: t("chapter4.quiz1_a2"), value: "a2", correct: true,  hint: t("chapter4.quiz1_a2_hint") },
        { label: t("chapter4.quiz1_a3"), value: "a3", correct: false, hint: t("chapter4.quiz1_a3_hint") },
      ],
      xp: 10,
    },
    // ── Scene 9: Quiz question 2 ──────────────────────────────────────────────
    {
      type: "choice",
      question: t("chapter4.quiz2_q"),
      choices: [
        { label: t("chapter4.quiz2_a1"), value: "a1", correct: false, hint: t("chapter4.quiz2_a1_hint") },
        { label: t("chapter4.quiz2_a2"), value: "a2", correct: false, hint: t("chapter4.quiz2_a2_hint") },
        { label: t("chapter4.quiz2_a3"), value: "a3", correct: true,  hint: t("chapter4.quiz2_a3_hint") },
      ],
      xp: 10,
    },
    // ── Scene 10: Quiz question 3 ─────────────────────────────────────────────
    {
      type: "choice",
      question: t("chapter4.quiz3_q"),
      choices: [
        { label: t("chapter4.quiz3_a1"), value: "a1", correct: true,  hint: t("chapter4.quiz3_a1_hint") },
        { label: t("chapter4.quiz3_a2"), value: "a2", correct: false, hint: t("chapter4.quiz3_a2_hint") },
        { label: t("chapter4.quiz3_a3"), value: "a3", correct: false, hint: t("chapter4.quiz3_a3_hint") },
      ],
      xp: 10,
    },
    // ── Scene 11: Chapter summary ─────────────────────────────────────────────
    {
      type: "custom",
      render: () => (
        <ChapterSummary
          chapter={4}
          title={t("chapter4.title")}
          xpEarned={150}
          onNext={() => { completeChapter(4, 150); goToChapter(5); }}
          learnings={[
            t("chapter4.learning1"),
            t("chapter4.learning2"),
            t("chapter4.learning3"),
            { text: t("chapter4.learning4"), type: "warning" },
            { text: t("chapter4.learning5"), type: "warning" },
          ]}
        />
      ),
    },
  ];
}

// ─── Chapter 4 ────────────────────────────────────────────────────────────────

export default function Chapter4() {
  const { completeChapter, goToChapter } = useStory();
  const { t } = useTranslation("story");
  const scenes = buildScenes({ completeChapter, goToChapter, t });

  return (
    <SceneRunner
      scenes={scenes}
      onFinish={() => { completeChapter(4, 150); goToChapter(5); }}
    />
  );
}
