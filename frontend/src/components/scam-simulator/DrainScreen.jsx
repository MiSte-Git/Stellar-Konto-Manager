/**
 * DrainScreen.jsx
 *
 * Fullscreen animated visualization of an account being drained.
 * Replaces the chat window the moment the user "hands over" their secret key.
 *
 * Animation sequence:
 *   1. Header: "🔓 Zugriff erhalten..."
 *   2. Real tokens drain one by one: countdown, red flash, strikethrough (USDC → yXLM → BTC → EURC → AQUA)
 *   3. Fake tokens drain one by one: 300ms countdown + 300ms pause each (scrollable list)
 *   4. XLM drains last (longer countdown for maximum drama)
 *   5. Dead screen: black bg + 💀 + "Weiter" button → onComplete()
 *
 * Props:
 *   demoTokens – live token state from useScamSimulator (read-only, used for initial values)
 *   onComplete – called when user clicks "Weiter" at the end
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars -- motion used as JSX element
import { motion, AnimatePresence } from 'framer-motion';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Approximate XLM equivalent per unit – used only for the live total display */
const XLM_RATE = {
  XLM:  1,
  USDC: 8.33,
  yXLM: 1,
  BTC:  700_000,
  EURC: 9,
  AQUA: 0.02,
};

/** Order in which real tokens (except XLM) are drained */
const DRAIN_SEQUENCE = ['USDC', 'yXLM', 'BTC', 'EURC', 'AQUA'];

const DRAIN_DURATION_MS        = 900;   // countdown per real token
const XLM_DRAIN_DURATION       = 1800;  // XLM gets a longer, more dramatic countdown
const PAUSE_BETWEEN_TOKENS     = 700;   // pause after each real token
const FAKE_TOKEN_DRAIN_DURATION = 300;  // countdown per fake token
const FAKE_TOKEN_PAUSE         = 300;   // pause after each fake token (total ≈ 600ms per token)

// ── Utilities ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Animates a numeric value from `from` to 0 over `durationMs` milliseconds
 * using an ease-out-cubic curve. Calls `onTick` on each animation frame.
 * Resolves when animation completes or `cancelRef.current` is true.
 */
function countDown(from, durationMs, onTick, cancelRef) {
  return new Promise((resolve) => {
    if (from <= 0 || cancelRef.current) {
      onTick(0);
      resolve();
      return;
    }
    const start = performance.now();
    function tick(now) {
      if (cancelRef.current) { resolve(); return; }
      const t      = Math.min((now - start) / durationMs, 1);
      const eased  = 1 - Math.pow(1 - t, 3); // ease-out cubic
      onTick(from * (1 - eased));
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        onTick(0);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

/** Format a numeric balance for display */
function fmtBalance(value, code) {
  if (value <= 0) return '0';
  if (code === 'BTC')  return value.toFixed(4);
  if (code === 'AQUA') return Math.round(value).toLocaleString('en-US');
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
  if (value >= 1000)   return Math.round(value).toLocaleString('en-US');
  if (value >= 10)     return value.toFixed(2);
  return value.toFixed(4);
}

// ── TokenRow sub-component ────────────────────────────────────────────────────

function TokenRow({ code, balance, active, drained, drainDuration = DRAIN_DURATION_MS }) {
  const displayValue = drained ? '0' : fmtBalance(balance, code);

  return (
    <motion.div
      className="flex items-center justify-between gap-2 px-4 py-2.5"
      animate={{
        backgroundColor: active
          ? 'rgba(127, 29, 29, 0.40)'
          : 'rgba(0, 0, 0, 0)',
      }}
      transition={{ duration: 0.25 }}
    >
      {/* Status icon + token code */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={[
            'text-xs w-4 shrink-0 select-none',
            drained ? 'text-green-600' : active ? 'text-red-400' : 'text-gray-600',
          ].join(' ')}
          aria-hidden="true"
        >
          {drained ? '✓' : active ? '▶' : '·'}
        </span>
        <span
          className={[
            'text-sm font-semibold',
            drained ? 'line-through text-gray-600'
            : active ? 'text-red-300 font-bold'
            : 'text-gray-400',
          ].join(' ')}
        >
          {code}
        </span>
      </div>

      {/* Balance + progress bar */}
      <div className="flex items-center gap-2 shrink-0">
        <motion.span
          className={[
            'font-mono text-sm tabular-nums',
            drained ? 'line-through text-gray-600'
            : active  ? 'text-white font-bold'
            : 'text-gray-500',
          ].join(' ')}
          animate={active ? { opacity: 1 } : drained ? { opacity: 0.55 } : { opacity: 0.7 }}
        >
          {displayValue}
        </motion.span>

        {/* Drain progress bar – visible only while this token is active */}
        {active && (
          <div className="w-12 h-1.5 rounded-full bg-gray-700 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-red-500"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: drainDuration / 1000, ease: 'linear' }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DrainScreen({ demoTokens, onComplete }) {
  const { t, i18n } = useTranslation('scamSimulator');

  // ── Compute initial data once (ref so it survives re-renders) ────────────────
  const initRef = React.useRef(null);
  if (initRef.current === null) {
    const real = {
      XLM:  parseFloat(demoTokens?.xlm  ?? '0'),
      USDC: parseFloat(demoTokens?.usdc ?? '0'),
      yXLM: parseFloat(demoTokens?.yxlm ?? '0'),
      BTC:  parseFloat(demoTokens?.btc  ?? '0'),
      EURC: parseFloat(demoTokens?.eurc ?? '0'),
      AQUA: parseFloat(demoTokens?.aqua ?? '0'),
    };
    const fakeTokens = (demoTokens?.fakeTokens ?? []).map((ft) => ({
      ...ft,
      balanceNum: parseFloat(ft.balance ?? '0'),
      // XLM value per unit of this token (for live total computation)
      xlmPerUnit: parseFloat(ft.valueInXLM ?? '0') / Math.max(1, parseFloat(ft.balance ?? '1')),
    }));
    const fakeTotal  = fakeTokens.reduce((s, ft) => s + parseFloat(ft.valueInXLM ?? '0'), 0);
    const realTotal  = Object.entries(real).reduce(
      (s, [code, bal]) => s + bal * (XLM_RATE[code] ?? 0), 0
    );
    initRef.current = { real, fakeTokens, fakeTotal, grandTotal: realTotal + fakeTotal };
  }
  const { real, fakeTokens } = initRef.current;

  // ── Animation state ──────────────────────────────────────────────────────────

  // Real token balances
  const [balances,     setBalances]     = React.useState({ ...real });
  const [drainedSet,   setDrainedSet]   = React.useState(() => new Set());
  const [activeToken,  setActiveToken]  = React.useState(null);

  // Fake token balances (individual countdowns)
  const [fakeBalances,    setFakeBalances]    = React.useState(() => {
    const init = {};
    fakeTokens.forEach((ft) => { init[ft.code] = ft.balanceNum; });
    return init;
  });
  const [drainedFakeSet,  setDrainedFakeSet]  = React.useState(() => new Set());
  const [activeFakeToken, setActiveFakeToken] = React.useState(null);

  const [statusMsg,    setStatusMsg]    = React.useState('');
  const [isDead,       setIsDead]       = React.useState(false);
  const [showContinue, setShowContinue] = React.useState(false);
  const cancelRef = React.useRef(false);

  // ── Live total value – recomputed from both real and fake balances ────────────
  const totalValue = React.useMemo(() => {
    const realSum = Object.entries(balances).reduce(
      (s, [code, bal]) => s + bal * (XLM_RATE[code] ?? 0), 0
    );
    const fakeSum = initRef.current.fakeTokens.reduce((s, ft) => {
      const bal = fakeBalances[ft.code] ?? 0;
      return s + bal * ft.xlmPerUnit;
    }, 0);
    return Math.max(0, realSum + fakeSum);
  }, [balances, fakeBalances]);

  const formattedTotal = new Intl.NumberFormat(
    i18n.language, { maximumFractionDigits: 0 }
  ).format(Math.round(totalValue));

  // ── Full drain animation sequence (runs once on mount) ───────────────────────
  React.useEffect(() => {
    cancelRef.current = false;

    async function run() {
      // ── Step 0: brief delay + initial status ───────────────────────────────
      setStatusMsg(t('ui.drain.access'));
      await sleep(1000);
      if (cancelRef.current) return;

      // ── Step 1: Drain each real token one by one ───────────────────────────
      for (const code of DRAIN_SEQUENCE) {
        const initBal = real[code];
        if (initBal <= 0 || cancelRef.current) continue;

        setActiveToken(code);
        setStatusMsg(
          t('ui.drain.converting', {
            token: code,
            defaultValue: `⚡ ${code} wird transferiert...`,
          })
        );

        await countDown(initBal, DRAIN_DURATION_MS, (val) => {
          setBalances((prev) => ({ ...prev, [code]: val }));
        }, cancelRef);

        if (cancelRef.current) return;

        setDrainedSet((prev) => new Set([...prev, code]));
        setActiveToken(null);
        await sleep(PAUSE_BETWEEN_TOKENS);
      }

      // ── Step 2: Fake tokens – one by one with individual countdowns ────────
      if (fakeTokens.length > 0 && !cancelRef.current) {
        setStatusMsg(t('ui.drain.preparing'));
        await sleep(400);

        for (const ft of fakeTokens) {
          if (cancelRef.current) return;

          setActiveFakeToken(ft.code);
          setStatusMsg(
            t('ui.drain.converting', {
              token: ft.code,
              defaultValue: `⚡ ${ft.code} wird transferiert...`,
            })
          );

          await countDown(ft.balanceNum, FAKE_TOKEN_DRAIN_DURATION, (val) => {
            setFakeBalances((prev) => ({ ...prev, [ft.code]: val }));
          }, cancelRef);

          if (cancelRef.current) return;

          setDrainedFakeSet((prev) => new Set([...prev, ft.code]));
          setActiveFakeToken(null);
          await sleep(FAKE_TOKEN_PAUSE);
        }
      }

      if (cancelRef.current) return;

      // ── Step 3: XLM drain (longest, most dramatic) ─────────────────────────
      setActiveToken('XLM');
      setStatusMsg(t('ui.drain.transferring'));

      await countDown(real['XLM'], XLM_DRAIN_DURATION, (val) => {
        setBalances((prev) => ({ ...prev, XLM: val }));
      }, cancelRef);

      if (cancelRef.current) return;

      setDrainedSet((prev) => new Set([...prev, 'XLM']));
      setActiveToken(null);
      await sleep(700);
      if (cancelRef.current) return;

      // ── Step 4: Dead screen ────────────────────────────────────────────────
      setIsDead(true);
      await sleep(1200);
      if (cancelRef.current) return;
      setShowContinue(true);
    }

    run();
    return () => { cancelRef.current = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dead screen ──────────────────────────────────────────────────────────────
  if (isDead) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="flex flex-col items-center justify-center h-full min-h-[420px] bg-black px-6"
      >
        <motion.div
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 180, damping: 14 }}
          className="text-8xl mb-5 select-none"
          aria-hidden="true"
        >
          💀
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.4 }}
          className="text-xl font-black text-red-400 mb-10 text-center"
        >
          {t('ui.drain.final')}
        </motion.p>

        <AnimatePresence>
          {showContinue && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              type="button"
              onClick={onComplete}
              className="px-8 py-3 rounded-2xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-lg"
            >
              {t('ui.nextButton')} →
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  // ── Active drain screen ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-[420px] bg-gray-950">

      {/* Status message pill */}
      <div className="flex items-center justify-center min-h-[3rem] px-4 pt-4 pb-1 shrink-0">
        <AnimatePresence mode="wait">
          <motion.p
            key={statusMsg}
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.2 }}
            className="text-sm font-bold text-yellow-400 text-center"
          >
            {statusMsg}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Wallet card – scrollable so all tokens are visible */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="rounded-2xl border border-red-900/50 bg-gray-900 overflow-hidden">

          {/* Header: WALLET label + live total */}
          <div className="flex items-center justify-between px-4 py-3 bg-red-950/40 border-b border-red-900/40 sticky top-0 z-10 bg-gray-900">
            <span className="text-xs font-bold text-red-500 tracking-widest uppercase select-none">
              WALLET
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black text-white tabular-nums">
                {formattedTotal} XLM
              </span>
              {totalValue > 0 && (
                <motion.span
                  className="text-red-400 text-xs font-bold select-none"
                  animate={{ opacity: [1, 0.25, 1] }}
                  transition={{ duration: 0.7, repeat: Infinity }}
                  aria-hidden="true"
                >
                  ↓
                </motion.span>
              )}
            </div>
          </div>

          {/* ── Real token rows ── */}
          <div className="divide-y divide-gray-800/60">
            {/* XLM – shown first, drained last */}
            <TokenRow
              code="XLM"
              balance={balances['XLM']}
              active={activeToken === 'XLM'}
              drained={drainedSet.has('XLM')}
              drainDuration={XLM_DRAIN_DURATION}
            />
            {/* Other real tokens in drain order */}
            {DRAIN_SEQUENCE.map((code) =>
              real[code] > 0 ? (
                <TokenRow
                  key={code}
                  code={code}
                  balance={balances[code]}
                  active={activeToken === code}
                  drained={drainedSet.has(code)}
                  drainDuration={DRAIN_DURATION_MS}
                />
              ) : null
            )}
          </div>

          {/* ── Fake token rows ── */}
          {fakeTokens.length > 0 && (
            <div className="border-t border-gray-700/40">
              <p className="px-4 pt-2.5 pb-1 text-[0.65rem] font-bold text-gray-600 uppercase tracking-widest select-none">
                DeFi / Alt Tokens
              </p>
              <div className="divide-y divide-gray-800/30">
                {fakeTokens.map((ft) => (
                  <TokenRow
                    key={ft.code}
                    code={ft.code}
                    balance={fakeBalances[ft.code] ?? 0}
                    active={activeFakeToken === ft.code}
                    drained={drainedFakeSet.has(ft.code)}
                    drainDuration={FAKE_TOKEN_DRAIN_DURATION}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
