/**
 * Kapitel 10 – Wie einigen sie sich?
 * Thema: Stellar Consensus Protocol (SCP)
 * Charaktere: Lumio, Sofia
 * Szenen 1–9 + ChapterSummary
 */
import React, { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "../StoryContext";
import SceneRunner from "../SceneRunner";
import ChapterSummary from "../ChapterSummary";

const XP_SUMMARY = 175;

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
};

// ─── CharacterDialog ──────────────────────────────────────────────────────────

function CharacterDialog({ speaker, text, onNext }) {
  const { t } = useTranslation("story");
  const s = SPEAKER[speaker] || SPEAKER.lumio;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
        <div style={{ fontSize: "32px", flexShrink: 0, lineHeight: 1 }}>{s.avatar}</div>
        <div style={{
          flex: 1, background: s.bg,
          border: `1.5px solid ${s.border}`,
          borderRadius: "16px 16px 16px 4px", padding: "12px 16px",
        }}>
          <div style={{
            fontSize: "10px", fontWeight: 700, color: s.color,
            textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "5px",
          }}>
            {s.name}
          </div>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.65, color: "rgba(255,255,255,0.88)" }}>
            {text}
          </p>
        </div>
      </div>
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={onNext}
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
          width: "100%",
        }}
      >
        {t("ui.continue", "Weiter")} →
      </motion.button>
    </motion.div>
  );
}

// ─── InfoCard ─────────────────────────────────────────────────────────────────

function InfoCard({ icon, title, body, cta, accentColor, onNext, children }) {
  const acc = accentColor || "#3DD6FF";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "40px", marginBottom: "6px" }}>{icon}</div>
        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "white" }}>{title}</h3>
      </div>
      <div style={{
        background: "rgba(61,214,255,0.04)", border: "1px solid rgba(61,214,255,0.18)",
        borderRadius: "14px", padding: "16px 18px",
      }}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.75, color: "rgba(255,255,255,0.82)" }}>
          {body}
        </p>
      </div>
      {children}
      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onNext}
        style={{
          background: `linear-gradient(135deg, ${acc}, #48c78e)`, border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {cta}
      </motion.button>
    </motion.div>
  );
}

// ─── GlossaryButton ───────────────────────────────────────────────────────────

function GlossaryButton({ label, termKey, openGlossary }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
      onClick={() => openGlossary(termKey)}
      style={{
        background: "rgba(61,214,255,0.08)", border: "1.5px solid rgba(61,214,255,0.3)",
        borderRadius: "10px", padding: "10px 16px", fontSize: "13px", fontWeight: 600,
        color: "#3DD6FF", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
      }}
    >
      📖 {label}
    </motion.button>
  );
}

// ─── QuizQ (Szene 6) ──────────────────────────────────────────────────────────

function QuizQ({ question, choices, correctValue, feedbackCorrect, feedbackWrong, retryLabel, nextLabel, onNext }) {
  const [selected, setSelected] = useState(null);

  const isCorrect = selected === correctValue;
  const isWrong   = selected !== null && !isCorrect;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <p style={{
        margin: "0 0 4px", fontSize: "14px", fontWeight: 700,
        color: "rgba(255,255,255,0.92)", lineHeight: 1.55,
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px", padding: "12px 14px",
      }}>
        {question}
      </p>

      {!selected && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {choices.map((c) => (
            <motion.button
              key={c.value}
              whileHover={{ scale: 1.02, x: 3 }} whileTap={{ scale: 0.98 }}
              onClick={() => setSelected(c.value)}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.12)",
                borderRadius: "10px", padding: "10px 14px", textAlign: "left",
                cursor: "pointer", fontFamily: "inherit", fontSize: "13px",
                color: "rgba(255,255,255,0.82)",
              }}
            >
              <span style={{ fontWeight: 700, marginRight: "8px", opacity: 0.45 }}>
                {c.value.toUpperCase()})
              </span>
              {c.label}
            </motion.button>
          ))}
        </div>
      )}

      {isCorrect && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <div style={{
            background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.22)",
            borderRadius: "12px", padding: "12px 14px",
          }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#4ade80", lineHeight: 1.55 }}>
              ✓ {feedbackCorrect}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onNext}
            style={{
              background: "linear-gradient(135deg, #4ade80, #3DD6FF)", border: "none",
              borderRadius: "12px", padding: "12px 28px", fontSize: "14px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {nextLabel} →
          </motion.button>
        </motion.div>
      )}

      {isWrong && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          <div style={{
            background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "12px", padding: "12px 14px",
          }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#f87171", lineHeight: 1.55 }}>
              ✗ {feedbackWrong}
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={() => setSelected(null)}
            style={{
              background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.15)",
              borderRadius: "10px", padding: "10px 20px", fontSize: "13px", fontWeight: 600,
              color: "rgba(255,255,255,0.65)", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {retryLabel}
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── ValidatorCard (Szene s5d) ────────────────────────────────────────────────

function ValidatorCard({ title, body, urlLabel, urlNote, cta, onNext }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "40px", marginBottom: "6px" }}>🔭</div>
        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "white" }}>{title}</h3>
      </div>
      <div style={{
        background: "rgba(61,214,255,0.04)", border: "1px solid rgba(61,214,255,0.18)",
        borderRadius: "14px", padding: "16px 18px",
        display: "flex", flexDirection: "column", gap: "12px",
      }}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.75, color: "rgba(255,255,255,0.82)" }}>
          {body}
        </p>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px" }}>
          <p style={{ margin: "0 0 4px", fontSize: "12px", color: "rgba(255,255,255,0.45)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {urlLabel}
          </p>
          <code style={{
            display: "block", fontSize: "13px", fontFamily: "monospace",
            color: "#3DD6FF", background: "rgba(61,214,255,0.07)",
            border: "1px solid rgba(61,214,255,0.2)", borderRadius: "8px",
            padding: "8px 12px", wordBreak: "break-all",
          }}>
            stellarbeat.io
          </code>
          <p style={{ margin: "6px 0 0", fontSize: "11px", color: "rgba(255,255,255,0.32)", fontStyle: "italic" }}>
            {urlNote}
          </p>
        </div>
      </div>
      <motion.button
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onNext}
        style={{
          background: "linear-gradient(135deg, #3DD6FF, #48c78e)", border: "none",
          borderRadius: "14px", padding: "14px 32px", fontSize: "15px", fontWeight: 700,
          color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
        }}
      >
        {cta} →
      </motion.button>
    </motion.div>
  );
}

// ─── ReflectionChoice (Szene 7) ───────────────────────────────────────────────

function ReflectionChoice({ question, choices, continueLabel, onNext }) {
  const [picked, setPicked] = useState(null);

  const response = picked ? choices.find((c) => c.value === picked)?.response : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
    >
      {/* Lumio question */}
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
        <div style={{ fontSize: "32px", flexShrink: 0, lineHeight: 1 }}>⭐</div>
        <div style={{
          flex: 1, background: SPEAKER.lumio.bg, border: `1.5px solid ${SPEAKER.lumio.border}`,
          borderRadius: "16px 16px 16px 4px", padding: "12px 16px",
        }}>
          <div style={{
            fontSize: "10px", fontWeight: 700, color: SPEAKER.lumio.color,
            textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "5px",
          }}>
            Lumio
          </div>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.65, color: "rgba(255,255,255,0.88)" }}>
            {question}
          </p>
        </div>
      </div>

      {/* Choices */}
      {!picked && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {choices.map((c) => (
            <motion.button
              key={c.value}
              whileHover={{ scale: 1.02, x: 3 }} whileTap={{ scale: 0.98 }}
              onClick={() => setPicked(c.value)}
              style={{
                background: "rgba(255,217,61,0.05)", border: "1.5px solid rgba(255,217,61,0.2)",
                borderRadius: "10px", padding: "10px 14px", textAlign: "left",
                cursor: "pointer", fontFamily: "inherit", fontSize: "13px",
                color: "rgba(255,255,255,0.82)",
              }}
            >
              <span style={{ fontWeight: 700, marginRight: "8px", opacity: 0.45 }}>
                {c.value.toUpperCase()})
              </span>
              {c.label}
            </motion.button>
          ))}
        </div>
      )}

      {/* Lumio response */}
      {picked && response && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
            <div style={{ fontSize: "32px", flexShrink: 0, lineHeight: 1 }}>⭐</div>
            <div style={{
              flex: 1, background: "rgba(255,217,61,0.08)", border: "1.5px solid rgba(255,217,61,0.3)",
              borderRadius: "16px 16px 16px 4px", padding: "12px 16px",
            }}>
              <div style={{
                fontSize: "10px", fontWeight: 700, color: "#FFD93D",
                textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "5px",
              }}>
                Lumio
              </div>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.65, color: "rgba(255,255,255,0.88)" }}>
                {response}
              </p>
            </div>
          </div>
          <motion.button
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onNext}
            style={{
              background: "linear-gradient(135deg, #FFD93D, #48c78e)", border: "none",
              borderRadius: "14px", padding: "13px 28px", fontSize: "14px", fontWeight: 700,
              color: "#1a1a2e", fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {continueLabel} →
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── buildScenes ──────────────────────────────────────────────────────────────

function buildScenes({ openGlossary, completeChapter, goToChapter, t }) {
  const cd = (speaker, text) => ({
    type: "custom",
    render: (next) => <CharacterDialog speaker={speaker} text={text} onNext={next} />,
  });

  return [
    // ── Szene 1: Sofias Frage ──────────────────────────────────────────────
    cd("sofia",  t("chapter10.s1.sofia1")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s1.lumio1")] },
    cd("sofia",  t("chapter10.s1.sofia2")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s1.lumio2")] },

    // ── Szene 2: Was ist Konsens? ──────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <InfoCard icon="🗳️" title={t("chapter10.s2.card.title")}
          body={t("chapter10.s2.card.body")} cta={t("chapter10.s2.card.cta")} onNext={next} />
      ),
    },
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s2.lumio1")] },
    cd("sofia",  t("chapter10.s2.sofia1")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s2.lumio2")] },

    // ── Szene 3: Warum ist Konsens wichtig? ──────────────────────────────
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s5.lumio1")] },
    cd("sofia",  t("chapter10.s5.sofia1")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s5.lumio2")] },
    cd("sofia",  t("chapter10.s5.sofia2")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s5.lumio3")] },

    // ── Szene 4: Nutzer vs. Validatoren ───────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter10.s5c.section"),
      render: (next) => <CharacterDialog speaker="lumio" text={t("chapter10.s5c.lumio1")} onNext={next} />,
    },
    {
      type: "custom",
      render: (next) => <CharacterDialog speaker="lumio" text={t("chapter10.s5c.lumio2")} onNext={next} />,
    },
    {
      type: "custom",
      render: (next) => <CharacterDialog speaker="sofia" text={t("chapter10.s5c.sofia1")} onNext={next} />,
    },
    {
      type: "custom",
      render: (next) => <CharacterDialog speaker="lumio" text={t("chapter10.s5c.lumio3")} onNext={next} />,
    },
    {
      type: "custom",
      render: (next) => <CharacterDialog speaker="lumio" text={t("chapter10.s5c.lumio4")} onNext={next} />,
    },

    // ── Szene 5: Quorum Slice und Vertrauen ───────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <InfoCard icon="🔗" title={t("chapter10.s3.card.title")}
          body={t("chapter10.s3.card.body")} cta={t("chapter10.s3.card.cta")} onNext={next}
        >
          <GlossaryButton label={t("chapter10.s3.glossary_btn")}
            termKey="quorumSet" openGlossary={openGlossary} />
        </InfoCard>
      ),
    },
    cd("sofia",  t("chapter10.s3.sofia1")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s3.lumio1")] },
    cd("sofia",  t("chapter10.s3.sofia2")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s3.lumio2")] },
    cd("sofia",  t("chapter10.s3.sofia3")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s3.lumio3")] },
    cd("sofia",  t("chapter10.s3.sofia4")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s3.lumio4")] },
    cd("sofia",  t("chapter10.s3.sofia5")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s3.lumio5")] },

    // ── Szene 6: FBA – Das Herzstück von SCP ────────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter10.s5b.section"),
      render: (next) => (
        <InfoCard icon="🏛️" title={t("chapter10.s5b.card.title")}
          body={t("chapter10.s5b.card.body")} cta={t("chapter10.s5b.card.cta")} onNext={next}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <GlossaryButton label={t("chapter10.s5b.glossary_fba")} termKey="fba" openGlossary={openGlossary} />
            <GlossaryButton label={t("chapter10.s5b.glossary_quorum")} termKey="quorumSet" openGlossary={openGlossary} />
          </div>
        </InfoCard>
      ),
    },
    {
      type: "custom",
      render: (next) => <CharacterDialog speaker="lumio" text={t("chapter10.s5b.lumio1")} onNext={next} />,
    },
    {
      type: "custom",
      render: (next) => <CharacterDialog speaker="sofia" text={t("chapter10.s5b.sofia1")} onNext={next} />,
    },

    // ── Szene 7: Wer sichert das Netzwerk ab? ───────────────────────────────
    {
      type: "custom",
      sectionTitle: t("chapter10.s5d.section"),
      render: (next) => (
        <ValidatorCard
          title={t("chapter10.s5d.card.title")}
          body={t("chapter10.s5d.card.body")}
          urlLabel={t("chapter10.s5d.card.url_label")}
          urlNote={t("chapter10.s5d.card.url_note")}
          cta={t("chapter10.s5d.card.cta")}
          onNext={next}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => <CharacterDialog speaker="lumio" text={t("chapter10.s5d.lumio1")} onNext={next} />,
    },

    // ── Szene 8: Kein Mining nötig ────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <InfoCard icon="⚡" title={t("chapter10.s4.card.title")}
          body={t("chapter10.s4.card.body")} cta={t("chapter10.s4.card.cta")}
          accentColor="#FFD93D" onNext={next} />
      ),
    },
    cd("sofia",  t("chapter10.s4.sofia1")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s4.lumio1")] },

    // ── Szene 9: Quiz (3 Fragen) ──────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <QuizQ
          question={t("chapter10.s6.q1.question")}
          choices={[
            { value: "a", label: t("chapter10.s6.q1.a") },
            { value: "b", label: t("chapter10.s6.q1.b") },
            { value: "c", label: t("chapter10.s6.q1.c") },
          ]}
          correctValue="b"
          feedbackCorrect={t("chapter10.s6.q1.feedback_correct")}
          feedbackWrong={t("chapter10.s6.q1.feedback_wrong")}
          retryLabel={t("chapter10.s6.retry")}
          nextLabel={t("chapter10.s6.next")}
          onNext={next}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQ
          question={t("chapter10.s6.q2.question")}
          choices={[
            { value: "a", label: t("chapter10.s6.q2.a") },
            { value: "b", label: t("chapter10.s6.q2.b") },
            { value: "c", label: t("chapter10.s6.q2.c") },
          ]}
          correctValue="c"
          feedbackCorrect={t("chapter10.s6.q2.feedback_correct")}
          feedbackWrong={t("chapter10.s6.q2.feedback_wrong")}
          retryLabel={t("chapter10.s6.retry")}
          nextLabel={t("chapter10.s6.next")}
          onNext={next}
        />
      ),
    },
    {
      type: "custom",
      render: (next) => (
        <QuizQ
          question={t("chapter10.s6.q3.question")}
          choices={[
            { value: "a", label: t("chapter10.s6.q3.a") },
            { value: "b", label: t("chapter10.s6.q3.b") },
            { value: "c", label: t("chapter10.s6.q3.c") },
          ]}
          correctValue="a"
          feedbackCorrect={t("chapter10.s6.q3.feedback_correct")}
          feedbackWrong={t("chapter10.s6.q3.feedback_wrong")}
          retryLabel={t("chapter10.s6.retry")}
          nextLabel={t("chapter10.s6.next")}
          onNext={next}
        />
      ),
    },

    // ── Szene 7: Reflexions-Choice ────────────────────────────────────────
    {
      type: "custom",
      render: (next) => (
        <ReflectionChoice
          question={t("chapter10.s7.question")}
          choices={[
            { value: "a", label: t("chapter10.s7.a"), response: t("chapter10.s7.response_a") },
            { value: "b", label: t("chapter10.s7.b"), response: t("chapter10.s7.response_b") },
            { value: "c", label: t("chapter10.s7.c"), response: t("chapter10.s7.response_c") },
          ]}
          continueLabel={t("chapter10.s7.continue")}
          onNext={next}
        />
      ),
    },

    // ── Szene 8: Abschlussdialog ──────────────────────────────────────────
    cd("sofia",  t("chapter10.s8.sofia1")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s8.lumio1")] },
    cd("sofia",  t("chapter10.s8.sofia2")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s8.lumio2")] },
    cd("sofia",  t("chapter10.s8.sofia3")),
    { type: "dialog", speaker: "lumio", lines: [t("chapter10.s8.lumio3")] },

    // ── Szene 9: ChapterSummary ───────────────────────────────────────────
    {
      type: "custom",
      render: () => (
        <ChapterSummary
          chapter={10}
          title={t("chapter10.title")}
          learnings={[
            t("chapter10.s9.learning1"),
            t("chapter10.s9.learning2"),
            t("chapter10.s9.learning3"),
          ]}
          xpEarned={XP_SUMMARY}
          isLast={false}
          onNext={() => {
            completeChapter(10, XP_SUMMARY);
            goToChapter(11);
          }}
          onReplay={() => goToChapter(10)}
          replayLabel="Kapitel 10 wiederholen"
        />
      ),
    },
  ];
}

// ─── Chapter10 ────────────────────────────────────────────────────────────────

export default function Chapter10() {
  const { t } = useTranslation("story");
  const { completeChapter, goToChapter, openGlossary } = useStory();

  const scenes = buildScenes({ openGlossary, completeChapter, goToChapter, t });

  return <SceneRunner scenes={scenes} />;
}
