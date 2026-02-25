import React, { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import DialogBox from "./DialogBox";
import ChoiceButton from "./ChoiceButton";
import TestnetAction from "./TestnetAction";
import { useStory } from "./StoryContext";
import StoryNavButtons from "./StoryNavButtons";

/**
 * SceneRunner
 *
 * Lets you define a chapter as a plain array of scene objects.
 * Each scene has a `type` that determines which component renders.
 *
 * Scene types:
 *   { type: "dialog",  speaker?, lines, xp? }
 *   { type: "narrator", lines }
 *   { type: "choice",  choices: [{ label, value, correct?, hint?, xp? }] }
 *   { type: "action",  ...TestnetAction props }
 *   { type: "custom",  render: (next, prev) => <JSX /> }
 *   { type: "summary", ...ChapterSummary props }
 *
 * Props:
 *   scenes         – Scene[]
 *   onFinish       – () => void        called after last scene
 *   onIndexChange  – (index) => void   optional, called when scene index changes
 */
export default function SceneRunner({ scenes = [], onFinish, onIndexChange }) {
  const { sceneIndex: index, setSceneIndex, addXP } = useStory();

  const current = scenes[index];
  const isLast = index >= scenes.length - 1;

  // Report index changes to parent if needed
  useEffect(() => {
    onIndexChange?.(index);
  }, [index, onIndexChange]);

  const next = () => {
    if (isLast) {
      onFinish?.();
    } else {
      setSceneIndex(index + 1);
    }
  };

  const prev = () => {
    if (index > 0) setSceneIndex(index - 1);
  };

  if (!current) return null;

  const renderScene = () => {
    switch (current.type) {
      case "dialog":
        return (
          <DialogBox
            key={index}
            speaker={current.speaker ?? "lumio"}
            lines={current.lines}
            onDone={() => {
              if (current.xp) addXP(current.xp);
              next();
            }}
          />
        );

      case "narrator":
        return (
          <DialogBox
            key={index}
            speaker="narrator"
            lines={current.lines}
            onDone={next}
          />
        );

      case "choice":
        return (
          <ChoiceButton
            key={index}
            question={current.question}
            choices={current.choices}
            onChoice={() => {
              next();
            }}
          />
        );

      case "action":
        return (
          <TestnetAction
            key={index}
            {...current}
            onSuccess={(res) => {
              current.onSuccess?.(res);
              next();
            }}
          />
        );

      case "custom":
        return (
          <div key={index}>
            {current.render(next, prev)}
          </div>
        );

      default:
        return (
          <div key={index} style={{ color: "rgba(255,255,255,0.4)", padding: "20px", textAlign: "center" }}>
            Unbekannter Scene-Typ: {current.type}
          </div>
        );
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", paddingTop: "8px" }}>
      {/* Chapter title hint */}
      {current.sectionTitle && (
        <motion.p
          key={`title-${index}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            margin: 0,
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "rgba(255,217,61,0.6)",
          }}
        >
          {current.sectionTitle}
        </motion.p>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {renderScene()}
        </motion.div>
      </AnimatePresence>

      {/* Navigation buttons */}
      <StoryNavButtons />

      {/* Scene counter (subtle) */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        gap: "4px",
        paddingTop: "4px",
      }}>
        {scenes.map((_, i) => (
          <div
            key={i}
            style={{
              width: "4px",
              height: "4px",
              borderRadius: "50%",
              background: i === index
                ? "rgba(255,217,61,0.8)"
                : i < index
                ? "rgba(72,199,142,0.5)"
                : "rgba(255,255,255,0.15)",
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>
    </div>
  );
}
