import React from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars -- motion used as JSX element
import { motion, AnimatePresence } from 'framer-motion';

/** Three-dot typing animation */
function TypingIndicator() {
  return (
    <div className="flex items-end gap-1.5 px-4 py-3 max-w-[70%] rounded-2xl rounded-bl-sm bg-gray-200 dark:bg-gray-700">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block w-2 h-2 rounded-full bg-gray-500 dark:bg-gray-400"
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

/**
 * Approximate XLM rates for each token – used to compute a total for the
 * account card. Values are intentionally rough; they just need to look plausible.
 */
const REAL_TOKEN_RATES = [
  { key: 'usdc', xlmRate: 8.33    },
  { key: 'yxlm', xlmRate: 1       },
  { key: 'btc',  xlmRate: 700_000 },
  { key: 'eurc', xlmRate: 9       },
  { key: 'aqua', xlmRate: 0.02    },
];

function computeTotalXLM(tokens) {
  if (!tokens) return null;
  let total = parseFloat(tokens.xlm ?? '0');
  for (const { key, xlmRate } of REAL_TOKEN_RATES) {
    total += parseFloat(tokens[key] ?? '0') * xlmRate;
  }
  total += (tokens.fakeTokens ?? []).reduce(
    (s, ft) => s + parseFloat(ft.valueInXLM ?? '0'), 0
  );
  return total;
}

/**
 * ChatWindow – renders accumulated messages with slide-in animations.
 *
 * Props:
 *   contact            – { nameKey, subtitleKey, avatar, verified }
 *   messages           – array of message objects:
 *                          { id, from: 'them'|'me'|'system'|'account-card'|'drain-fatal', i18nKey|content }
 *                          account-card also has { publicKey }
 *   isTyping           – boolean: show typing indicator
 *   scrollRef          – ref forwarded to the scroll container
 *   disableAutoScroll  – stop scrolling when decision / weiter buttons visible
 *   demoTokens         – live token balances: { xlm, usdc, yxlm, btc, eurc, aqua, fakeTokens[] }
 */
export default function ChatWindow({ contact, messages, isTyping, scrollRef, disableAutoScroll, demoTokens }) {
  const { t, i18n } = useTranslation('scamSimulator');

  React.useEffect(() => {
    if (disableAutoScroll) return;
    if (scrollRef?.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, scrollRef, disableAutoScroll]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Chat header ── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 rounded-t-2xl">
        <div className="text-3xl select-none shrink-0" aria-hidden="true">{contact?.avatar ?? '💬'}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">
              {t(contact?.nameKey ?? '')}
            </span>
            {contact?.verified === false && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium shrink-0"
                title="Nicht verifiziert"
              >
                ?
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {t(contact?.subtitleKey ?? '')}
          </div>
        </div>
      </div>

      {/* ── Message list ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50 dark:bg-gray-900/50"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => {

            // ── Account card – compact wallet notification ──────────────────
            if (msg.from === 'account-card') {
              const total = computeTotalXLM(demoTokens);
              const formatted = total != null
                ? new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
                    Math.round(total)
                  )
                : '—';

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="flex justify-center"
                >
                  <div className="w-full max-w-[82%] rounded-xl border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <p className="font-semibold text-sm text-green-800 dark:text-green-300">
                        💳 {t('ui.accountCard.title')}
                      </p>
                      <p className="font-mono text-sm font-bold text-green-700 dark:text-green-400 shrink-0 tabular-nums">
                        ~{formatted} XLM
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            }

            // ── Drain-fatal (red, bold) – final "account emptied" message ──
            if (msg.from === 'drain-fatal') {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, type: 'spring', stiffness: 260, damping: 20 }}
                  className="flex justify-center"
                >
                  <span className="inline-block px-5 py-2.5 rounded-2xl bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-black text-base shadow-sm border border-red-200 dark:border-red-800">
                    {msg.content ?? t(msg.i18nKey)}
                  </span>
                </motion.div>
              );
            }

            // ── System message (yellow pill) ──
            if (msg.from === 'system') {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-center"
                >
                  <span className="inline-block text-xs px-3 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                    {msg.content ?? t(msg.i18nKey)}
                  </span>
                </motion.div>
              );
            }

            // ── Chat bubble (me / them) ──
            const isMe = msg.from === 'me';
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: isMe ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={[
                    'max-w-[75%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words',
                    isMe
                      ? 'rounded-2xl rounded-br-sm bg-indigo-600 text-white'
                      : 'rounded-2xl rounded-bl-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm border border-gray-100 dark:border-gray-600',
                  ].join(' ')}
                >
                  {msg.content ?? t(msg.i18nKey)}
                </div>
              </motion.div>
            );
          })}

          {/* Typing indicator */}
          {isTyping && (
            <motion.div
              key="typing"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex justify-start"
            >
              <TypingIndicator />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
