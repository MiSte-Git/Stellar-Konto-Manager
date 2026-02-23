import React from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars -- motion used as JSX element
import { motion, AnimatePresence } from 'framer-motion';

const popIn = {
  initial: { scale: 0.3, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 280, damping: 18 } },
};

/**
 * ResultScreen – shown after a scenario completes.
 *
 * Props:
 *   scenario    – full scenario object (for redFlags, explanationKey)
 *   chosen      – option object the user chose
 *   sessionXP   – XP earned this run
 *   txHash      – Testnet drain tx hash (only set on scam outcomes)
 *   explorerUrl – stellar.expert explorer URL for the drain tx
 *   onRestart   – callback to replay
 *   onBack      – callback to go back to overview
 */
export default function ResultScreen({ scenario, chosen, sessionXP, txHash, explorerUrl, onRestart, onBack }) {
  const { t } = useTranslation('scamSimulator');
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  if (!chosen) return null;

  const isSafe = !chosen.isScam;
  const isKeyCompromise = chosen.scamType === 'key-compromise';
  const emoji = isSafe ? '🛡️' : '😱';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="max-w-lg mx-auto px-4 py-8 text-center"
    >
      {/* Big emoji with popIn */}
      <motion.div
        {...popIn}
        className="text-[100px] leading-none select-none mb-4"
        aria-hidden="true"
      >
        {emoji}
      </motion.div>

      {/* Title & subtitle */}
      <h2 className={`text-2xl font-bold ${isSafe ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
        {t(isSafe ? 'ui.result.safe.title' : 'ui.result.scam.title')}
      </h2>
      <p className="mt-2 text-gray-600 dark:text-gray-400">
        {t(isSafe ? 'ui.result.safe.subtitle' : 'ui.result.scam.subtitle')}
      </p>

      {/* Testnet transaction block – only on key-compromise scams with a confirmed tx */}
      {!isSafe && isKeyCompromise && txHash && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4 }}
          className="mt-6 text-left rounded-2xl border-2 border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/30 overflow-hidden shadow-md"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-red-100 dark:bg-red-900/40 border-b border-red-200 dark:border-red-800">
            <p className="font-bold text-sm text-red-700 dark:text-red-400">
              {t('ui.testnet.realTransaction')}
            </p>
          </div>

          {/* Amount */}
          <div className="px-4 pt-4 pb-3 space-y-0.5">
            <p className="text-2xl font-black text-red-600 dark:text-red-400 tracking-tight">
              {t('ui.testnet.amountLine')}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('ui.testnet.drained')}
            </p>
          </div>

          {/* Explorer button */}
          <div className="px-4 pb-4">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors"
            >
              🔍 {t('ui.testnet.openExplorer')}
            </a>
          </div>

          {/* Disclaimer */}
          <div className="px-4 py-2.5 border-t border-red-100 dark:border-red-900/30 bg-gray-50 dark:bg-gray-800/40">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('ui.testnet.disclaimer')}
            </p>
          </div>
        </motion.div>
      )}

      {/* Watcher warning – only on key-compromise scam outcomes */}
      {!isSafe && isKeyCompromise && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: txHash ? 0.55 : 0.4, duration: 0.4 }}
          className="mt-4 text-left rounded-2xl border-2 border-red-600 dark:border-red-700 bg-gray-900 overflow-hidden shadow-lg"
        >
          <div className="px-4 py-3 border-b border-red-800 dark:border-red-900">
            <p className="font-bold text-base text-red-400">
              {t('ui.watcher.title')}
            </p>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="text-sm text-gray-300 leading-relaxed">
              {t('ui.watcher.body')}
            </p>
            <div className="rounded-lg bg-amber-950/60 border border-amber-700/50 px-3 py-2.5">
              <p className="text-sm font-bold text-amber-400 leading-relaxed">
                {t('ui.watcher.solution')}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* XP badge – only on safe outcomes */}
      {isSafe && sessionXP > 0 && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4, type: 'spring', stiffness: 300 }}
          className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold text-lg"
        >
          <span>⭐</span>
          <span>{t('ui.xpGained', { xp: sessionXP })}</span>
        </motion.div>
      )}

      {/* Collapsible: Red Flags & Explanation */}
      {scenario && (
        <div className="mt-6 text-left">
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            aria-expanded={detailsOpen}
          >
            <span>{t('ui.result.redFlagsTitle')}</span>
            <motion.span
              animate={{ rotate: detailsOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-gray-500"
              aria-hidden="true"
            >
              ▼
            </motion.span>
          </button>

          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div
                key="details"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="mt-3 px-4 space-y-4">
                  {/* Red flags list */}
                  {Array.isArray(scenario.redFlags) && scenario.redFlags.length > 0 && (
                    <ul className="space-y-2">
                      {scenario.redFlags.map((flagKey) => (
                        <li
                          key={flagKey}
                          className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
                        >
                          <span className="mt-0.5 text-red-500 shrink-0" aria-hidden="true">🚩</span>
                          <span>{t(flagKey)}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Explanation */}
                  {scenario.explanationKey && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
                        {t('ui.result.explanationTitle')}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                        {t(scenario.explanationKey)}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
        <button
          type="button"
          onClick={onRestart}
          className="px-6 py-3 rounded-2xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
        >
          {t('ui.restartButton')}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 rounded-2xl text-sm font-bold bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors"
        >
          {t('ui.backButton')}
        </button>
      </div>
    </motion.div>
  );
}
