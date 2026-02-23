/**
 * TimeSkipScreen.jsx
 *
 * Fullscreen "time passing" interstitial shown when the user hands over
 * their secret key. Runs an automatic ~6-second sequence, then calls
 * onComplete() to transition to DrainScreen.
 *
 * If the Testnet setup is still in progress (demoPhase === 'init') when the
 * animation ends, the screen waits and shows a loading overlay until the
 * account is ready before calling onComplete().
 *
 * Props:
 *   demoPhase  – 'init' | 'ready' | 'draining' | null
 *   onComplete – called when animation done AND demoPhase !== 'init'
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars -- motion used as JSX element
import { motion, AnimatePresence } from 'framer-motion';

/** Pulsing three-dot overlay shown while Testnet account is still initializing */
function NetworkOverlay({ label }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="absolute inset-x-0 bottom-10 flex justify-center pointer-events-none"
    >
      <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-black/75 border border-indigo-800/60">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block w-1.5 h-1.5 rounded-full bg-indigo-400"
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }}
          />
        ))}
        <span className="text-xs text-indigo-300 font-medium">{label}</span>
      </div>
    </motion.div>
  );
}

export default function TimeSkipScreen({ demoPhase, onComplete }) {
  const { t } = useTranslation('scamSimulator');

  // ── Individual visibility flags for each animation beat ──────────────────
  const [show, setShow] = React.useState({
    hourglass: false,
    text1: false,
    text2: false,
    text3: false,
    fadeOut: false,
  });
  const [sequenceDone, setSequenceDone] = React.useState(false);

  // Alternating ⏳ / ⌛ emoji tick
  const [tick, setTick] = React.useState(false);

  // ── Run the timed sequence once on mount ──────────────────────────────────
  React.useEffect(() => {
    const timers = [];
    const at = (ms, fn) => { const id = setTimeout(fn, ms); timers.push(id); };

    at( 400, () => setShow((s) => ({ ...s, hourglass: true  })));
    at(1500, () => setShow((s) => ({ ...s, text1: true      })));
    at(3000, () => setShow((s) => ({ ...s, text2: true      })));
    at(4500, () => setShow((s) => ({ ...s, text3: true      })));
    at(5500, () => setShow((s) => ({ ...s, fadeOut: true    })));
    at(6000, () => setSequenceDone(true));

    return () => timers.forEach(clearTimeout);
  }, []);

  // ── Tick the hourglass while it's visible ─────────────────────────────────
  React.useEffect(() => {
    if (!show.hourglass || show.fadeOut) return;
    const id = setInterval(() => setTick((v) => !v), 800);
    return () => clearInterval(id);
  }, [show.hourglass, show.fadeOut]);

  // ── Transition to drain when both animation done AND testnet ready ─────────
  React.useEffect(() => {
    if (sequenceDone && demoPhase !== 'init') {
      onComplete();
    }
  }, [sequenceDone, demoPhase, onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: show.fadeOut ? 0 : 1 }}
      transition={{ duration: 0.5 }}
      className="relative flex flex-col items-center justify-center h-full min-h-[420px] bg-gray-950 px-8"
    >
      {/* ── Hourglass ── */}
      <AnimatePresence>
        {show.hourglass && !show.fadeOut && (
          <motion.div
            key="hourglass"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 18 }}
            className="text-7xl mb-10 select-none"
            aria-hidden="true"
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={tick ? 'a' : 'b'}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.3 }}
              >
                {tick ? '⌛' : '⏳'}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Text lines ── */}
      <div className="flex flex-col items-center gap-5 text-center">
        <AnimatePresence>
          {show.text1 && !show.fadeOut && (
            <motion.p
              key="text1"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="text-lg text-gray-400 font-medium"
            >
              {t('ui.timeskip.laterText')}
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {show.text2 && !show.fadeOut && (
            <motion.p
              key="text2"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="text-lg text-gray-400 font-medium"
            >
              {t('ui.timeskip.checkText')}
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {show.text3 && !show.fadeOut && (
            <motion.p
              key="text3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-xl font-bold text-red-400"
            >
              {t('ui.timeskip.wrongText')}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ── Network loading overlay (only when testnet is still initializing) ── */}
      <AnimatePresence>
        {demoPhase === 'init' && (
          <NetworkOverlay key="network-overlay" label={t('ui.testnetConnecting')} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
