import React, { createContext, useContext, useReducer, useCallback } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";

// ─── Initial State ─────────────────────────────────────────────────────────────

const initialState = {
  currentChapter: 1,
  currentScene: 0,
  phase: "story",           // "story" | "action" | "summary" | "complete"

  // Chapter select screen
  showChapterSelect: true,

  // Scene-level navigation (shared with SceneRunner)
  sceneIndex: 0,

  // Saved action results (actionId → result) for alreadyDone re-use
  actionResults: {},

  // Testnet identity – created in Chapter 1, used throughout
  keypair: null,            // StellarSdk.Keypair
  accountFunded: false,

  // Narrative tracking
  choices: [],              // [{ chapter, scene, value }]
  completedActions: [],     // ["friendbot", "payment", "changeTrust", ...]

  // Gamification
  xp: 0,
  hearts: 3,                // lives for wrong choices
  lumioMood: "happy",       // "happy" | "worried" | "sad" | "excited"

  // Per-chapter unlocks
  chaptersCompleted: [],

  // Glossary popup
  glossaryOpen: false,
  glossaryTerm: null,
};

// ─── Action Types ──────────────────────────────────────────────────────────────

const A = {
  SET_CHAPTER: "SET_CHAPTER",
  SET_SCENE: "SET_SCENE",
  SET_PHASE: "SET_PHASE",
  SET_CHAPTER_SELECT: "SET_CHAPTER_SELECT",
  SET_SCENE_INDEX: "SET_SCENE_INDEX",
  SET_ACTION_RESULT: "SET_ACTION_RESULT",
  CREATE_KEYPAIR: "CREATE_KEYPAIR",
  SET_FUNDED: "SET_FUNDED",
  RECORD_CHOICE: "RECORD_CHOICE",
  COMPLETE_ACTION: "COMPLETE_ACTION",
  ADD_XP: "ADD_XP",
  LOSE_HEART: "LOSE_HEART",
  SET_MOOD: "SET_MOOD",
  COMPLETE_CHAPTER: "COMPLETE_CHAPTER",
  RESET: "RESET",
  OPEN_GLOSSARY: "OPEN_GLOSSARY",
  CLOSE_GLOSSARY: "CLOSE_GLOSSARY",
};

// ─── Reducer ───────────────────────────────────────────────────────────────────

function storyReducer(state, { type, payload }) {
  switch (type) {
    case A.SET_CHAPTER:
      return { ...state, currentChapter: payload, currentScene: 0, sceneIndex: 0, phase: "story", showChapterSelect: false };

    case A.SET_SCENE:
      return { ...state, currentScene: payload };

    case A.SET_PHASE:
      return { ...state, phase: payload };

    case A.SET_CHAPTER_SELECT:
      return { ...state, showChapterSelect: payload };

    case A.SET_SCENE_INDEX:
      return { ...state, sceneIndex: Math.max(0, payload) };

    case A.SET_ACTION_RESULT:
      return { ...state, actionResults: { ...state.actionResults, [payload.id]: payload.result } };

    case A.CREATE_KEYPAIR:
      return { ...state, keypair: payload };

    case A.SET_FUNDED:
      return { ...state, accountFunded: payload };

    case A.RECORD_CHOICE:
      return {
        ...state,
        choices: [...state.choices, {
          chapter: state.currentChapter,
          scene: state.currentScene,
          ...payload,
        }],
      };

    case A.COMPLETE_ACTION:
      if (state.completedActions.includes(payload)) return state;
      return { ...state, completedActions: [...state.completedActions, payload] };

    case A.ADD_XP:
      return { ...state, xp: state.xp + payload };

    case A.LOSE_HEART:
      return { ...state, hearts: Math.max(0, state.hearts - 1) };

    case A.SET_MOOD:
      return { ...state, lumioMood: payload };

    case A.COMPLETE_CHAPTER:
      if (state.chaptersCompleted.includes(payload)) return state;
      return { ...state, chaptersCompleted: [...state.chaptersCompleted, payload] };

    case A.RESET:
      return initialState;

    case A.OPEN_GLOSSARY:
      return { ...state, glossaryOpen: true, glossaryTerm: payload };

    case A.CLOSE_GLOSSARY:
      return { ...state, glossaryOpen: false, glossaryTerm: null };

    default:
      return state;
  }
}

// ─── Context ───────────────────────────────────────────────────────────────────

const StoryContext = createContext(null);

export function StoryProvider({ children, onExit }) {
  const [state, dispatch] = useReducer(storyReducer, initialState);

  // ── Navigation ───────────────────────────────────────────────────────────────

  const goToChapter = useCallback((n) => dispatch({ type: A.SET_CHAPTER, payload: n }), []);
  const goToScene = useCallback((n) => dispatch({ type: A.SET_SCENE, payload: n }), []);
  const nextScene = useCallback(() => dispatch({ type: A.SET_SCENE, payload: state.currentScene + 1 }), [state.currentScene]);
  const setPhase = useCallback((p) => dispatch({ type: A.SET_PHASE, payload: p }), []);
  const setShowChapterSelect = useCallback((v) => dispatch({ type: A.SET_CHAPTER_SELECT, payload: v }), []);
  const setSceneIndex = useCallback((n) => dispatch({ type: A.SET_SCENE_INDEX, payload: n }), []);

  // ── Keypair ───────────────────────────────────────────────────────────────────

  const createKeypair = useCallback(() => {
    const kp = StellarSdk.Keypair.random();
    dispatch({ type: A.CREATE_KEYPAIR, payload: kp });
    return kp;
  }, []);

  const setFunded = useCallback((v) => dispatch({ type: A.SET_FUNDED, payload: v }), []);

  // ── Narrative ────────────────────────────────────────────────────────────────

  const recordChoice = useCallback((value, meta = {}) => {
    dispatch({ type: A.RECORD_CHOICE, payload: { value, ...meta } });
  }, []);

  const completeAction = useCallback((id) => {
    dispatch({ type: A.COMPLETE_ACTION, payload: id });
  }, []);

  const hasCompleted = useCallback((id) => state.completedActions.includes(id), [state.completedActions]);

  const setActionResult = useCallback((id, result) => {
    dispatch({ type: A.SET_ACTION_RESULT, payload: { id, result } });
  }, []);

  // ── Gamification ─────────────────────────────────────────────────────────────

  const addXP = useCallback((amount) => dispatch({ type: A.ADD_XP, payload: amount }), []);
  const loseHeart = useCallback(() => dispatch({ type: A.LOSE_HEART }), []);
  const setLumioMood = useCallback((mood) => dispatch({ type: A.SET_MOOD, payload: mood }), []);

  const completeChapter = useCallback((n, xpReward = 100) => {
    dispatch({ type: A.COMPLETE_CHAPTER, payload: n });
    dispatch({ type: A.ADD_XP, payload: xpReward });
    dispatch({ type: A.SET_PHASE, payload: "summary" });
  }, []);

  const reset = useCallback(() => dispatch({ type: A.RESET }), []);

  // ── Glossary ──────────────────────────────────────────────────────────────────

  const openGlossary = useCallback((termKey) => dispatch({ type: A.OPEN_GLOSSARY, payload: termKey }), []);
  const closeGlossary = useCallback(() => dispatch({ type: A.CLOSE_GLOSSARY }), []);

  const value = {
    ...state,
    onExit: onExit ?? (() => {}),
    goToChapter,
    goToScene,
    nextScene,
    setPhase,
    setShowChapterSelect,
    setSceneIndex,
    createKeypair,
    setFunded,
    recordChoice,
    completeAction,
    hasCompleted,
    setActionResult,
    addXP,
    loseHeart,
    setLumioMood,
    completeChapter,
    reset,
    openGlossary,
    closeGlossary,
  };

  return <StoryContext.Provider value={value}>{children}</StoryContext.Provider>;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useStory() {
  const ctx = useContext(StoryContext);
  if (!ctx) throw new Error("useStory must be used inside <StoryProvider>");
  return ctx;
}

export default StoryContext;
