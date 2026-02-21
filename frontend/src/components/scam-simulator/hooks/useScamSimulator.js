import React from 'react';
import { initDemoAccount, drainDemoAccount } from '../utils/testnetDemo.js';

// Typing speed multipliers (applied to all message delays)
const SPEED_MULTIPLIERS = { slow: 1.8, normal: 1.0, fast: 0.4 };

function readSpeedMultiplier() {
  try {
    const speed = localStorage.getItem('skm.scamSimulator.typingSpeed') || 'normal';
    return SPEED_MULTIPLIERS[speed] ?? 1.0;
  } catch { return 1.0; }
}

// XP helpers – same pattern as QuizRunner
function readTotalXP() {
  try { return Math.max(0, Number(localStorage.getItem('quiz_total_xp')) || 0); } catch { return 0; }
}
function writeTotalXP(v) {
  try { localStorage.setItem('quiz_total_xp', String(Math.max(0, v))); } catch { /* noop */ }
}

/**
 * Manages all state for the Scam Simulator.
 *
 * Phases:
 *   'intro'    – scenario card before starting
 *   'chat'     – messages are being shown one by one
 *   'decision' – waiting for user to pick an option
 *   'followup' – showing follow-up messages after choice
 *   'result'   – result screen
 */
export default function useScamSimulator(scenario) {
  const [phase, setPhase] = React.useState('intro');

  // Accumulated visible messages in the chat
  const [visibleMessages, setVisibleMessages] = React.useState([]);

  // The option object the user picked at the current decision point
  const [chosen, setChosen] = React.useState(null);

  // Options shown at the current decision point.
  // Starts as scenario.options; a decision entry with its own options array
  // can replace these for subsequent decision points.
  const [currentOptions, setCurrentOptions] = React.useState(() => scenario?.options ?? []);

  // Whether follow-up messages have finished playing
  const [followUpDone, setFollowUpDone] = React.useState(false);

  // Whether the typing indicator is visible
  const [isTyping, setIsTyping] = React.useState(false);

  // XP earned this session
  const [sessionXP, setSessionXP] = React.useState(0);

  // ── Testnet demo state ──────────────────────────────────────────────────────
  // XLM balance of the demo account (null = not yet loaded)
  const [demoBalance, setDemoBalance] = React.useState(null);
  // Hash + URL of the drain transaction (set after drainDemoAccount succeeds)
  const [txHash, setTxHash] = React.useState(null);
  const [explorerUrl, setExplorerUrl] = React.useState(null);
  /**
   * demoPhase tracks the lifecycle of the ephemeral Testnet account:
   *   null       – not started (intro screen)
   *   'init'     – initDemoAccount() is running (Friendbot + polling)
   *   'ready'    – account funded, ready to drain
   *   'draining' – drain sequence in progress
   */
  const [demoPhase, setDemoPhase] = React.useState(null);

  // Ephemeral demo data – keypair + scammer address, RAM only, never persisted
  const demoDataRef = React.useRef(null);
  // ───────────────────────────────────────────────────────────────────────────

  // Pending timeouts so we can cancel them on reset/unmount
  const timeoutsRef = React.useRef([]);

  // Guard: prevents choose() from being called while a choice is already being processed.
  const isProcessingRef = React.useRef(false);

  const clearTimeouts = React.useCallback(() => {
    for (const id of timeoutsRef.current) clearTimeout(id);
    timeoutsRef.current = [];
  }, []);

  /**
   * Plays a sequence of messages one by one with delays.
   *
   * When a `from: 'decision'` message is encountered:
   *   - An extra 400ms buffer is added before showing the decision buttons
   *   - `chosen` is reset so the fresh decision point is interactive
   *   - If the decision entry has its own `options`, those replace `currentOptions`
   *   - `isProcessingRef` is cleared so choose() can be called again
   *
   * After the last message, `onDone()` is called.
   */
  const playMessages = React.useCallback((messages, onDone) => {
    clearTimeouts();
    const multiplier = readSpeedMultiplier();
    let cumulativeDelay = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.from === 'decision') {
        const decisionAt = cumulativeDelay + Math.round(240 * multiplier);
        const decisionOptions = msg.options ?? null;

        const t = setTimeout(() => {
          setIsTyping(false);
          setChosen(null);
          isProcessingRef.current = false;
          if (decisionOptions) setCurrentOptions(decisionOptions);
          setPhase('decision');
        }, decisionAt);
        timeoutsRef.current.push(t);
        return;
      }

      const typingAt = cumulativeDelay;
      const t1 = setTimeout(() => setIsTyping(true), typingAt);
      timeoutsRef.current.push(t1);

      const revealAt = cumulativeDelay + Math.round((msg.delay ?? 720) * multiplier);
      const t2 = setTimeout(() => {
        setIsTyping(false);
        setVisibleMessages((prev) => [...prev, msg]);
      }, revealAt);
      timeoutsRef.current.push(t2);

      cumulativeDelay = revealAt + Math.round(180 * multiplier);
    }

    const t = setTimeout(() => onDone?.(), cumulativeDelay);
    timeoutsRef.current.push(t);
  }, [clearTimeouts]);

  // Start the scenario from the beginning
  const start = React.useCallback(() => {
    if (!scenario) return;
    clearTimeouts();
    isProcessingRef.current = false;
    demoDataRef.current = null;
    setPhase('chat');
    setVisibleMessages([]);
    setChosen(null);
    setCurrentOptions(scenario.options ?? []);
    setFollowUpDone(false);
    setIsTyping(false);
    setSessionXP(0);
    setDemoBalance(null);
    setTxHash(null);
    setExplorerUrl(null);
    setDemoPhase('init');

    // Initialize ephemeral Testnet demo account in the background.
    // Chat messages start immediately; account card appears in chat once Friendbot confirms.
    initDemoAccount()
      .then(({ keypair, scammerPublicKey, balance }) => {
        demoDataRef.current = { keypair, scammerPublicKey };
        setDemoBalance(balance);
        setDemoPhase('ready');
        // Inject the account card directly into the chat as a prominent message
        setVisibleMessages((prev) => [
          ...prev,
          {
            id: 'demo-account-card',
            from: 'account-card',
            publicKey: keypair.publicKey(),
            balance,
          },
        ]);
      })
      .catch(() => {
        setDemoPhase(null);
      });

    playMessages(scenario.messages, () => {
      setPhase('result');
    });
  }, [scenario, playMessages, clearTimeouts]);

  // User selects an option at the current decision point
  const choose = React.useCallback((option) => {
    if (!option || isProcessingRef.current) return;
    isProcessingRef.current = true;

    setChosen(option);
    setPhase('followup');

    // Add the user's choice as a "me" bubble
    setVisibleMessages((prev) => [
      ...prev,
      { id: `choice-${option.id}`, from: 'me', i18nKey: option.i18nKey },
    ]);

    // Award XP
    const xp = option.xp ?? 0;
    if (xp > 0) {
      setSessionXP((prev) => prev + xp);
      writeTotalXP(readTotalXP() + xp);
    }

    const startFollowUp = () => {
      if (!option.followUp || option.followUp.length === 0) {
        setFollowUpDone(true);
        setPhase('result');
        isProcessingRef.current = false;
        return;
      }
      playMessages(option.followUp, () => {
        setFollowUpDone(true);
        isProcessingRef.current = false;
      });
    };

    // For scam options with a ready demo account: run the dramatic drain sequence
    if (option.isScam && demoDataRef.current) {
      const { keypair, scammerPublicKey } = demoDataRef.current;
      demoDataRef.current = null; // Prevent double-drain

      setDemoPhase('draining');

      const mult = readSpeedMultiplier();

      // ── Step 1-3: Drama messages leading up to the drain ──────────────────
      const dramaSteps = [
        { delay: Math.round(600  * mult), id: 'drain-step-1', i18nKey: 'ui.drain.access' },
        { delay: Math.round(1500 * mult), id: 'drain-step-2', i18nKey: 'ui.drain.preparing' },
        { delay: Math.round(2400 * mult), id: 'drain-step-3', i18nKey: 'ui.drain.transferring' },
      ];

      for (const { delay, id, i18nKey } of dramaSteps) {
        const tid = setTimeout(() => {
          setVisibleMessages((prev) => [...prev, { id, from: 'system', i18nKey }]);
        }, delay);
        timeoutsRef.current.push(tid);
      }

      // ── Step 4: Execute the real Testnet drain ─────────────────────────────
      const drainAt = Math.round(3200 * mult);
      const drainTid = setTimeout(() => {
        drainDemoAccount(keypair, scammerPublicKey)
          .then(({ txHash: hash, explorerUrl: url }) => {
            setDemoBalance('0.00');
            setTxHash(hash);
            setExplorerUrl(url);
          })
          .catch(() => { /* Testnet optional – silent fail */ })
          .finally(() => {
            // ── Step 5: Final dramatic "account drained" message ─────────────
            setVisibleMessages((prev) => [
              ...prev,
              { id: 'drain-final', from: 'drain-fatal', i18nKey: 'ui.drain.final' },
            ]);
            setDemoPhase(null);

            // Brief pause so the user can read the final message before follow-ups start
            const afterTid = setTimeout(
              () => startFollowUp(),
              Math.round(900 * mult)
            );
            timeoutsRef.current.push(afterTid);
          });
      }, drainAt);
      timeoutsRef.current.push(drainTid);
    } else {
      startFollowUp();
    }
  }, [playMessages]);

  // Advance from followup → result after user clicks "Weiter"
  const continueToResult = React.useCallback(() => {
    setPhase('result');
  }, []);

  // Reset to intro screen
  const reset = React.useCallback(() => {
    clearTimeouts();
    isProcessingRef.current = false;
    demoDataRef.current = null;
    setPhase('intro');
    setVisibleMessages([]);
    setChosen(null);
    setCurrentOptions(scenario?.options ?? []);
    setFollowUpDone(false);
    setIsTyping(false);
    setSessionXP(0);
    setDemoBalance(null);
    setTxHash(null);
    setExplorerUrl(null);
    setDemoPhase(null);
  }, [clearTimeouts, scenario]);

  // Cleanup on unmount
  React.useEffect(() => () => clearTimeouts(), [clearTimeouts]);

  return {
    phase,
    visibleMessages,
    chosen,
    currentOptions,
    followUpDone,
    isTyping,
    sessionXP,
    demoBalance,
    demoPhase,
    txHash,
    explorerUrl,
    start,
    choose,
    continueToResult,
    reset,
  };
}
