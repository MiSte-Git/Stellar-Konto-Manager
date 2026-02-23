import React from 'react';
import {
  setupDemoAccounts,
  createTrustlines,
  createScammerTrustlines,
  fundDemoWithTokens,
  drainAccount,
  getFullBalance,
  getFakeTokens,
} from '../utils/testnetDemo.js';

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
  /**
   * demoTokens holds live balances for all tokens (real + fake).
   * null = not yet initialized.
   * Structure: { xlm, usdc, yxlm, btc, eurc, aqua, fakeTokens: [{ code, balance, valueInXLM }] }
   */
  const [demoTokens, setDemoTokens] = React.useState(null);

  // Hash + URL of the drain transaction (set after drainAccount succeeds)
  const [txHash, setTxHash] = React.useState(null);
  const [explorerUrl, setExplorerUrl] = React.useState(null);

  /**
   * demoPhase tracks the lifecycle of the ephemeral Testnet account:
   *   null       – not started (intro screen)
   *   'init'     – setupDemoAccounts() + trustlines + funding is running
   *   'ready'    – account funded, ready to drain
   *   'draining' – drain sequence in progress
   */
  const [demoPhase, setDemoPhase] = React.useState(null);

  // Ephemeral demo data – keypair + scammer + issuer address + fake tokens, RAM only, never persisted
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
    setDemoTokens(null);
    setTxHash(null);
    setExplorerUrl(null);
    setDemoPhase('init');

    // Full Testnet demo setup in the background:
    //   1. Friendbot all 3 accounts + poll until visible
    //   2. Create trustlines on demo + scammer (parallel)
    //   3. Fund demo with tokens
    //   4. Read balances + generate fake tokens
    //   5. Inject account card into chat
    setupDemoAccounts()
      .then(async ({ issuerKeypair, demoKeypair, scammerKeypair }) => {
        const issuerPublicKey  = issuerKeypair.publicKey();
        const demoPublicKey    = demoKeypair.publicKey();
        const scammerPublicKey = scammerKeypair.publicKey();

        // Trustlines on both accounts can run in parallel
        await Promise.all([
          createTrustlines(demoKeypair, issuerPublicKey),
          createScammerTrustlines(scammerKeypair, issuerPublicKey),
        ]);

        await fundDemoWithTokens(issuerKeypair, demoPublicKey);

        const balances   = await getFullBalance(demoPublicKey);
        const fakeTokens = getFakeTokens();

        demoDataRef.current = {
          keypair: demoKeypair,
          scammerPublicKey,
          issuerPublicKey,
          fakeTokens,
        };

        setDemoTokens({ ...balances, fakeTokens });
        setDemoPhase('ready');

        // Inject account card into chat (no balance data – ChatWindow reads from demoTokens state)
        setVisibleMessages((prev) => [
          ...prev,
          {
            id: 'demo-account-card',
            from: 'account-card',
            publicKey: demoPublicKey,
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

    // key-compromise scams → timeskip interstitial → DrainScreen
    if (option.isScam && option.scamType === 'key-compromise') {
      setPhase('timeskip');

      // If testnet is already ready, start the real drain immediately in the background
      // so it runs in parallel while the timeskip animation plays.
      if (demoDataRef.current) {
        const { keypair, scammerPublicKey, issuerPublicKey } = demoDataRef.current;
        demoDataRef.current = null; // prevent double-drain
        setDemoPhase('draining');
        drainAccount(keypair, scammerPublicKey, issuerPublicKey)
          .then(({ hashes, explorerUrls }) => {
            setTxHash(hashes[hashes.length - 1] ?? null);
            setExplorerUrl(explorerUrls[explorerUrls.length - 1] ?? null);
            setDemoPhase(null);
          })
          .catch(() => { setDemoPhase(null); });
      }
      // else: completeTimeskip() will start the drain once testnet is ready
    } else {
      setPhase('followup');
      startFollowUp();
    }
  }, [playMessages]);

  /**
   * Called by TimeSkipScreen when its animation ends (and demoPhase !== 'init').
   * If the testnet account became ready during the timeskip, starts drain now;
   * otherwise drain is already running in the background.
   */
  const completeTimeskip = React.useCallback(() => {
    if (demoDataRef.current) {
      // Testnet finished during timeskip – start drain now
      const { keypair, scammerPublicKey, issuerPublicKey } = demoDataRef.current;
      demoDataRef.current = null;
      setDemoPhase('draining');
      drainAccount(keypair, scammerPublicKey, issuerPublicKey)
        .then(({ hashes, explorerUrls }) => {
          setTxHash(hashes[hashes.length - 1] ?? null);
          setExplorerUrl(explorerUrls[explorerUrls.length - 1] ?? null);
          setDemoPhase(null);
        })
        .catch(() => { setDemoPhase(null); });
    }
    setPhase('drain');
  }, []);

  /**
   * Called by DrainScreen when its animation sequence ends and the user
   * clicks "Weiter". Skips follow-up messages and goes directly to result.
   */
  const completeDrain = React.useCallback(() => {
    setDemoTokens((prev) => prev ? { ...prev, xlm: '0' } : prev);
    isProcessingRef.current = false;
    setFollowUpDone(true);
    setPhase('result');
  }, []);

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
    setDemoTokens(null);
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
    demoTokens,
    demoPhase,
    txHash,
    explorerUrl,
    start,
    choose,
    completeTimeskip,
    completeDrain,
    continueToResult,
    reset,
  };
}
