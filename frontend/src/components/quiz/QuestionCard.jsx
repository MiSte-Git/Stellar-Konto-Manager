import React from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.button>, <motion.div> etc.
import { motion, AnimatePresence } from 'framer-motion';

const bounceVariant = {
  initial: {},
  correct: { y: [0, -8, 0], transition: { duration: 0.4, ease: 'easeOut' } },
  wrong: { x: [0, -8, 8, -8, 0], transition: { duration: 0.4, ease: 'easeOut' } },
};

export default function QuestionCard({
  type = 'single',
  questionKey,
  hintKey,
  options = [],
  selectedOptionId,
  onAnswer,
  showFeedback = false,
  disabled = false,
  hintsEnabled = true,
}) {
  const { t } = useTranslation(['quiz.ui']);
  const [showHint, setShowHint] = React.useState(false);

  React.useEffect(() => {
    if (!hintsEnabled) setShowHint(false);
  }, [hintsEnabled]);

  // Stable ids for a11y associations
  const uid = React.useId();
  const headingId = `stm-q-heading-${uid}`;
  const hintId = `stm-q-hint-${uid}`;
  const feedbackId = `stm-q-fb-${uid}`;

  const describedBy = [];
  if (hintsEnabled && showHint) describedBy.push(hintId);
  if (showFeedback && selectedOptionId) describedBy.push(feedbackId);

  const handleSelect = (id) => {
    if (disabled) return;
    try { onAnswer && onAnswer(id); } catch { /* noop */ }
  };

  const shuffledOptions = React.useMemo(() => {
    const arr = Array.isArray(options) ? [...options] : [];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [options]);

  const getFeedbackState = (opt) => {
    if (!showFeedback || selectedOptionId !== opt.id) return null;
    return opt.correct ? 'correct' : 'wrong';
  };

  const getOptionClasses = (opt) => {
    const isSelected = selectedOptionId === opt.id;
    const fb = getFeedbackState(opt);

    if (fb === 'correct') {
      return 'border-green-500 bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100 ring-2 ring-green-300';
    }
    if (fb === 'wrong') {
      return 'border-red-500 bg-red-100 dark:bg-red-900/30 text-red-900 dark:text-red-100 ring-2 ring-red-300';
    }
    if (isSelected) {
      return 'border-indigo-500 ring-2 ring-indigo-300 bg-indigo-50 dark:bg-indigo-900/20';
    }
    return 'border-gray-300 dark:border-gray-600 hover:border-indigo-300 hover:bg-gray-50 dark:hover:bg-gray-700/60';
  };

  const getTrueFalseClasses = (opt) => {
    const isTrue = String(opt.id).toLowerCase() === 'true';
    const isSelected = selectedOptionId === opt.id;
    const fb = getFeedbackState(opt);

    if (fb === 'correct') {
      return 'border-green-500 bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100 ring-2 ring-green-300';
    }
    if (fb === 'wrong') {
      return 'border-red-500 bg-red-100 dark:bg-red-900/30 text-red-900 dark:text-red-100 ring-2 ring-red-300';
    }

    const base = isTrue
      ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-100'
      : 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-100';
    const ring = isSelected ? 'ring-2 ring-indigo-300 border-indigo-500' : '';
    return `${base} ${ring}`;
  };

  const feedbackIcon = (opt) => {
    const fb = getFeedbackState(opt);
    if (fb === 'correct') return <span className="text-green-600 font-bold text-lg">&#10003;</span>;
    if (fb === 'wrong') return <span className="text-red-600 font-bold text-lg">&#10007;</span>;
    return null;
  };

  const renderFeedback = () => {
    if (!showFeedback || !selectedOptionId) return null;
    const sel = options.find((o) => o.id === selectedOptionId);
    if (!sel) return null;
    const ok = !!sel.correct;
    return (
      <div
        id={feedbackId}
        className={`mt-3 text-sm rounded-xl p-3 ${ok ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'}`}
        role="status"
        aria-live="polite"
      >
        <div className="font-semibold">{ok ? t('quiz.ui:correct') : t('quiz.ui:incorrect')}</div>
        <div className="mt-1">{t(sel.feedbackKey)}</div>
      </div>
    );
  };

  return (
    <div>
      <h3 id={headingId} className="text-lg font-semibold">{t(questionKey)}</h3>
      {hintsEnabled && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowHint((s) => !s)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 hover:bg-yellow-100 dark:bg-gray-700 dark:hover:bg-yellow-900/40 text-lg transition-colors"
            aria-label={t('quiz.ui:hint')}
            aria-pressed={showHint}
            aria-expanded={showHint}
            aria-controls={hintId}
            title={t('quiz.ui:hint')}
          >
            &#x1F4A1;
          </button>
        </div>
      )}
      <AnimatePresence>
        {hintsEnabled && showHint && (
          <motion.div
            id={hintId}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 text-sm text-gray-700 dark:text-gray-300 overflow-hidden"
          >
            {t(hintKey)}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3">
        {type === 'true_false' ? (
          <div
            role="radiogroup"
            aria-labelledby={headingId}
            aria-describedby={describedBy.join(' ') || undefined}
            className="grid grid-cols-2 gap-3"
          >
            {shuffledOptions.map((opt) => {
              const fb = getFeedbackState(opt);
              return (
                <motion.button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedOptionId === opt.id}
                  aria-labelledby={headingId}
                  aria-describedby={describedBy.join(' ') || undefined}
                  disabled={disabled}
                  onClick={() => handleSelect(opt.id)}
                  variants={bounceVariant}
                  animate={fb || 'initial'}
                  className={`flex items-center justify-center gap-2 border-2 rounded-2xl px-6 py-4 text-center cursor-pointer select-none font-semibold text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed ${getTrueFalseClasses(opt)}`}
                >
                  <span>{t(opt.textKey)}</span>
                  {feedbackIcon(opt)}
                </motion.button>
              );
            })}
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-labelledby={headingId}
            aria-describedby={describedBy.join(' ') || undefined}
            className="flex flex-col gap-2"
          >
            {shuffledOptions.map((opt) => {
              const fb = getFeedbackState(opt);
              return (
                <motion.button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedOptionId === opt.id}
                  aria-labelledby={headingId}
                  aria-describedby={describedBy.join(' ') || undefined}
                  disabled={disabled}
                  onClick={() => handleSelect(opt.id)}
                  variants={bounceVariant}
                  animate={fb || 'initial'}
                  className={`flex items-center justify-between w-full border-2 rounded-2xl px-5 py-4 text-left cursor-pointer select-none text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed ${getOptionClasses(opt)}`}
                >
                  <span>{t(opt.textKey)}</span>
                  {feedbackIcon(opt)}
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {renderFeedback()}
    </div>
  );
}
