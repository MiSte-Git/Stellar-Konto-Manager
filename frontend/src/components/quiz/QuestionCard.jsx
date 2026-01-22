import React from 'react';
import { useTranslation } from 'react-i18next';

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
  const groupName = `stm-q-${uid}`;

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

  const renderFeedback = () => {
    if (!showFeedback || !selectedOptionId) return null;
    const sel = options.find((o) => o.id === selectedOptionId);
    if (!sel) return null;
    const ok = !!sel.correct;
    return (
      <div
        id={feedbackId}
        className={`mt-3 text-sm rounded p-2 ${ok ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'}`}
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
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHint((s) => !s)}
            className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-xs font-medium px-2 py-1 rounded"
            aria-pressed={showHint}
            aria-expanded={showHint}
            aria-controls={hintId}
          >
            {t('quiz.ui:hint')}
          </button>
        </div>
      )}
      {hintsEnabled && showHint && (
        <div id={hintId} className="mt-2 text-sm text-gray-700 dark:text-gray-300">{t(hintKey)}</div>
      )}

      <div className="mt-3">
        {type === 'true_false' ? (
          <div
            role="radiogroup"
            aria-labelledby={headingId}
            aria-describedby={describedBy.join(' ') || undefined}
            className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          >
            {shuffledOptions.map((opt) => {
              const isTrue = String(opt.id).toLowerCase() === 'true';
              const isSelected = selectedOptionId === opt.id;
              const base = isTrue
                ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-100'
                : 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-100';
              return (
                <label
                  key={opt.id}
                  className={`block border rounded px-4 py-3 text-center cursor-pointer select-none ${base} ${isSelected ? 'ring-2 ring-offset-0 ring-indigo-300 border-indigo-500' : ''} peer-[]:focus-visible:ring-2`}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={opt.id}
                    checked={isSelected}
                    onChange={() => handleSelect(opt.id)}
                    disabled={disabled}
                    className="sr-only peer"
                    aria-labelledby={headingId}
                    aria-describedby={describedBy.join(' ') || undefined}
                  />
                  <span className="font-semibold">{t(opt.textKey)}</span>
                </label>
              );
            })}
          </div>
        ) : (
          <div
            role="radiogroup"
          aria-labelledby={headingId}
          aria-describedby={describedBy.join(' ') || undefined}
          >
            {shuffledOptions.map((opt) => (
              <label
                key={opt.id}
                className={`block border rounded px-4 py-3 mb-2 cursor-pointer transition-colors ${selectedOptionId === opt.id ? 'border-indigo-500 ring-2 ring-indigo-300 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-indigo-300 hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={opt.id}
                  checked={selectedOptionId === opt.id}
                  onChange={() => handleSelect(opt.id)}
                  disabled={disabled}
                  className="peer mr-2 align-middle"
                  aria-labelledby={headingId}
                  aria-describedby={describedBy.join(' ') || undefined}
                />
                <span className="align-middle">{t(opt.textKey)}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {renderFeedback()}
    </div>
  );
}
