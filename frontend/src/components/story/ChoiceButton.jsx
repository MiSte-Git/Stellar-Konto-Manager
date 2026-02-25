import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStory } from "./StoryContext";
import { renderWithGlossaryLinks } from "./parseGlossaryTerms";

/**
 * ChoiceButton
 *
 * Props:
 *   question – string (optional)  question shown above choice buttons
 *   choices  – [{ label, value, correct?, hint?, xp?, glossaryTerm? }]
 *   onChoice – (choice) => void   called only after a CORRECT answer
 *   disabled – bool
 *
 * Behaviour:
 *   - Wrong answer  → hint shown permanently (opacity 0.75, red) → wrong button
 *                     grayed out, other buttons re-enable immediately → retry
 *   - Correct answer → hint shown permanently (opacity 1.0, green) → buttons locked
 *                     → "Weiter" button appears → onChoice() called on click
 *   - [[term|key]] markers in question/hint → rendered as clickable glossary links
 */
export default function ChoiceButton({ question, choices = [], onChoice, disabled = false }) {
  const { recordChoice, addXP, loseHeart, setLumioMood, openGlossary } = useStory();
  const { t } = useTranslation("story");

  // Most recently clicked choice (updates on each click)
  const [selected, setSelected] = useState(null);
  // True permanently once the correct answer has been chosen
  const [revealed, setRevealed] = useState(false);
  // Set of values that were tried and are wrong – stay disabled forever
  const [wrongAttempts, setWrongAttempts] = useState(() => new Set());

  const handleSelect = (choice) => {
    if (disabled || revealed || wrongAttempts.has(choice.value)) return;

    const isCorrect = choice.correct !== false;
    setSelected(choice);
    recordChoice(choice.value, { correct: isCorrect });

    if (isCorrect) {
      addXP(choice.xp ?? 50);
      setLumioMood("excited");
      setRevealed(true);
      // onChoice is called by the user clicking "Weiter" – not automatically
    } else {
      loseHeart();
      setLumioMood("worried");
      setWrongAttempts((prev) => new Set([...prev, choice.value]));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
      {/* Question box – shown above choice buttons */}
      {question && (
        <div style={{
          background: "rgba(255,217,61,0.06)",
          border: "1px solid rgba(255,217,61,0.22)",
          borderRadius: "10px",
          padding: "12px 16px",
          fontSize: "14px",
          fontWeight: 500,
          color: "rgba(255,255,255,0.9)",
          lineHeight: 1.6,
          marginBottom: "2px",
        }}>
          {renderWithGlossaryLinks(question, openGlossary)}
        </div>
      )}

      {choices.map((choice, i) => {
        const isCorrect = choice.correct !== false;
        const isWrong = wrongAttempts.has(choice.value); // permanently tried & wrong
        const isCurrentSelected = selected?.value === choice.value;
        const isCurrentCorrect = isCurrentSelected && isCorrect && revealed;
        const isCurrentWrong = isCurrentSelected && !isCorrect;
        const isInteractable = !disabled && !revealed && !isWrong;

        let bg = "rgba(255,255,255,0.07)";
        let border = "rgba(255,255,255,0.18)";
        let color = "rgba(255,255,255,0.9)";
        let opacity = 1;

        if (isCurrentCorrect) {
          bg = "rgba(72,199,142,0.2)";
          border = "#48c78e";
          color = "#48c78e";
        } else if (isCurrentWrong) {
          bg = "rgba(255,91,91,0.15)";
          border = "#ff5b5b";
          color = "rgba(255,91,91,0.85)";
          opacity = 0.75;
        } else if (isWrong) {
          // Already tried and wrong → permanently grayed
          bg = "rgba(255,255,255,0.03)";
          border = "rgba(255,255,255,0.08)";
          color = "rgba(255,255,255,0.25)";
          opacity = 0.45;
        } else if (revealed && !isCurrentSelected) {
          // Correct was chosen, other buttons fade
          bg = "rgba(255,255,255,0.03)";
          border = "rgba(255,255,255,0.08)";
          color = "rgba(255,255,255,0.35)";
        }

        const isButtonDisabled = disabled || revealed || isWrong;

        return (
          <motion.button
            key={choice.value}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: opacity, x: 0 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            whileHover={isInteractable ? { scale: 1.02, x: 4 } : {}}
            whileTap={isInteractable ? { scale: 0.98 } : {}}
            onClick={() => handleSelect(choice)}
            disabled={isButtonDisabled}
            style={{
              background: bg,
              border: `2px solid ${border}`,
              borderRadius: "12px",
              padding: "14px 18px",
              color,
              fontSize: "15px",
              fontFamily: "inherit",
              textAlign: "left",
              cursor: isInteractable ? "pointer" : "default",
              transition: "all 0.3s",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Option letter */}
            <span style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              border: `1.5px solid ${border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: 700,
              flexShrink: 0,
              transition: "all 0.3s",
            }}>
              {String.fromCharCode(65 + i)}
            </span>

            {choice.label}

            {/* Result icon – shown for the currently selected button */}
            <AnimatePresence>
              {(isCurrentCorrect || isCurrentWrong) && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  style={{ marginLeft: "auto", fontSize: "20px" }}
                >
                  {isCorrect ? "✓" : "✗"}
                </motion.span>
              )}
            </AnimatePresence>

            {/* Ripple on correct */}
            <AnimatePresence>
              {isCurrentCorrect && (
                <motion.div
                  initial={{ scale: 0, opacity: 0.5 }}
                  animate={{ scale: 4, opacity: 0 }}
                  transition={{ duration: 0.6 }}
                  style={{
                    position: "absolute",
                    width: "80px",
                    height: "80px",
                    borderRadius: "50%",
                    background: "#48c78e",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}

      {/* Hint – permanent once a choice is made */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.value}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: selected.correct !== false ? 1 : 0.75, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              margin: "4px 0 0",
              fontSize: "13px",
              color: selected.correct !== false ? "#48c78e" : "#ff9b9b",
              padding: "10px 14px",
              borderRadius: "8px",
              background: selected.correct !== false
                ? "rgba(72,199,142,0.08)"
                : "rgba(255,91,91,0.08)",
              lineHeight: 1.5,
            }}
          >
            {renderWithGlossaryLinks(
              selected.hint ?? (selected.correct !== false
                ? "Richtig! Gut gemacht."
                : t("ui.retry_hint", "Versuch es nochmal!")),
              openGlossary
            )}
            {selected.glossaryTerm && (
              <span
                onClick={(e) => { e.stopPropagation(); openGlossary(selected.glossaryTerm); }}
                style={{
                  display: "inline-block",
                  marginLeft: "8px",
                  color: "#FFD93D",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                {t("ui.learn_more", "Mehr erfahren")} →
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Weiter button – appears after correct answer, user must click to advance */}
      <AnimatePresence>
        {revealed && selected && (
          <motion.button
            key="continue"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setLumioMood("happy");
              onChoice?.(selected);
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
        )}
      </AnimatePresence>
    </div>
  );
}
