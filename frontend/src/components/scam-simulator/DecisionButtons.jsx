import React from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars -- motion used as JSX element
import { motion, AnimatePresence } from 'framer-motion';

/**
 * DecisionButtons – shown when a 'decision' step is reached in the chat.
 *
 * Props:
 *   options  – array of option objects from the scenario
 *   chosen   – the chosen option (or null while deciding)
 *   onChoose – callback(option)
 *   label    – label text shown above buttons (e.g. "Was tust du?")
 */
export default function DecisionButtons({ options = [], chosen, onChoose, label }) {
  const { t } = useTranslation('scamSimulator');
  const disabled = chosen !== null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 rounded-b-2xl"
      >
        {label && (
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            {label}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {options.map((option) => {
            const isChosen = chosen?.id === option.id;
            const isOther = disabled && !isChosen;

            // Colour after reveal: green = safe, red = scam
            let chosenStyle = '';
            if (isChosen) {
              chosenStyle = option.isScam
                ? 'bg-red-600 text-white border-red-600 ring-2 ring-red-400'
                : 'bg-green-600 text-white border-green-600 ring-2 ring-green-400';
            }

            return (
              <motion.button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onChoose?.(option)}
                whileTap={disabled ? {} : { scale: 0.97 }}
                className={[
                  'w-full text-left px-4 py-3 rounded-xl text-sm font-medium border transition-all duration-200',
                  !disabled
                    ? 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer'
                    : '',
                  isOther ? 'opacity-40 cursor-not-allowed' : '',
                  isChosen ? chosenStyle : '',
                ].join(' ')}
              >
                <span className="flex items-center gap-2">
                  {isChosen && (
                    <span aria-hidden="true">
                      {option.isScam ? '✗' : '✓'}
                    </span>
                  )}
                  {t(option.i18nKey)}
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
