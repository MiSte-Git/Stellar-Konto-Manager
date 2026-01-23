import React from 'react';
import AddressDropdown from '../AddressDropdown.jsx';

export default function MultisigConfigForm({
  signersTitle = '',
  titleAs = 'h3',
  titleClassName = 'font-semibold mb-2',
  showBestPractices = false,
  bestPracticesTitle = '',
  bestPracticesText = '',
  signersInfo = '',
  signerWeightHeaderLabel = '',
  showSignerCount = false,
  signerCount = 0,
  signerCountMin = 0,
  signerCountMax = 0,
  onSignerCountChange = null,
  signerCountLabel = '',
  signerCountLimitLabel = '',
  signerCountLimitTitle = '',
  signers = [],
  signerOptions = [],
  signerPlaceholder = '',
  onSignerKeyChange = null,
  onSignerWeightChange = null,
  signerWeightTooltip = '',
  signerWeightHint = '',
  showSignerWeightInfo = false,
  signerWeightInputClassName = 'border rounded px-2 py-1 text-sm w-20',
  onAddSigner = null,
  addSignerLabel = '',
  addSignerClassName = 'mt-2 px-2 py-1 border rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-800',
  onRemoveSigner = null,
  removeSignerLabel = '',
  showSignerTypeNote = false,
  signerTypeNote = '',
  signerTypeLinkLabel = '',
  signerTypeLinkUrl = '',
  masterWeight = 0,
  onMasterWeightChange = null,
  masterWeightLabel = '',
  masterWeightLabelClassName = 'text-sm font-semibold inline-flex items-center gap-1',
  masterWeightHint = '',
  masterWeightTooltip = '',
  showMasterWeightInfo = false,
  masterWeightInputClassName = 'border rounded px-2 py-1 text-sm w-24',
  thresholdsLabel = '',
  thresholdLabels = {},
  thresholdTooltips = {},
  thresholdValues = {},
  thresholdErrors = {},
  onThresholdChange = null,
  thresholdInputClassName = 'border rounded px-2 py-1 w-16',
  thresholdUnitsLabel = '',
  thresholdLevelsHint = '',
  thresholdSumText = '',
  thresholdTooHighText = '',
  safetyErrors = [],
  safetyWarnings = [],
  safetyErrorTitle = '',
  safetyWarningTitle = '',
}) {
  const TitleTag = titleAs;
  const signerList = Array.isArray(signers) ? signers : [];
  const hasRemove = typeof onRemoveSigner === 'function';
  const hasAdd = typeof onAddSigner === 'function';
  const hasSignerCount = showSignerCount && typeof onSignerCountChange === 'function';
  const showSafetyErrors = Array.isArray(safetyErrors) && safetyErrors.length > 0;
  const showSafetyWarnings = Array.isArray(safetyWarnings) && safetyWarnings.length > 0;
  const showSignerTypeHint = showSignerTypeNote && (signerTypeNote || signerTypeLinkLabel);
  const showBestPracticesBlock = showBestPractices && (bestPracticesTitle || bestPracticesText);
  const showLevelsHint = thresholdLevelsHint || thresholdSumText;

  return (
    <div className="space-y-4">
      {signersTitle && (
        <TitleTag className={titleClassName}>{signersTitle}</TitleTag>
      )}

      {showBestPracticesBlock && (
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border rounded text-xs text-blue-900 dark:text-blue-200">
          <strong>{bestPracticesTitle}:</strong> {bestPracticesText}
        </div>
      )}

      {signersInfo && (
        <p className="text-xs text-gray-600 dark:text-gray-400">{signersInfo}</p>
      )}

      {hasSignerCount && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold">{signerCountLabel}</label>
          <input
            type="number"
            min={signerCountMin}
            max={signerCountMax}
            value={signerCount}
            onChange={(e) => onSignerCountChange(e.target.value)}
            onBlur={(e) => onSignerCountChange(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-24"
            title={signerCountLimitTitle}
          />
          <span className="text-xs text-gray-600 dark:text-gray-400">{signerCountLimitLabel}</span>
        </div>
      )}

      <div className="space-y-2">
        {signerWeightHeaderLabel && (
          <div className="grid gap-2 sm:grid-cols-6 items-center text-xs font-semibold text-gray-600 dark:text-gray-300">
            <div className="sm:col-span-4" />
            <div className="sm:col-span-2">{signerWeightHeaderLabel}</div>
          </div>
        )}
        {signerList.map((s, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-6 items-center">
            <AddressDropdown
              className="sm:col-span-4"
              value={s?.key ?? ''}
              onChange={(next) => onSignerKeyChange && onSignerKeyChange(i, next)}
              onSelect={(next) => onSignerKeyChange && onSignerKeyChange(i, next)}
              placeholder={signerPlaceholder}
              options={signerOptions}
              inputClassName="w-full border rounded px-2 py-1 font-mono text-sm"
              inputProps={{
                spellCheck: false,
                autoCorrect: 'off',
                autoCapitalize: 'off',
                autoComplete: 'off',
                inputMode: 'text',
              }}
            />
            <div className={`sm:col-span-2 flex items-center gap-2 ${hasRemove ? 'flex-nowrap' : ''}`}>
              <input
                type="number"
                min={0}
                max={255}
                value={s?.weight ?? 0}
                onChange={(e) => onSignerWeightChange && onSignerWeightChange(i, e.target.value)}
                onBlur={(e) => onSignerWeightChange && onSignerWeightChange(i, e.target.value)}
                className={signerWeightInputClassName}
                title={signerWeightTooltip}
              />
              {signerWeightHint && (
                <span className="text-xs text-gray-500">{signerWeightHint}</span>
              )}
              {showSignerWeightInfo && signerWeightTooltip && (
                <span className="text-xs cursor-help" title={signerWeightTooltip}>ⓘ</span>
              )}
              {hasRemove && (
                <button
                  type="button"
                  onClick={() => onRemoveSigner(i)}
                  className="shrink-0 px-1.5 py-1 border rounded text-xs whitespace-nowrap hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {removeSignerLabel}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {hasAdd && (
          <button type="button" onClick={onAddSigner} className={addSignerClassName}>
            {addSignerLabel}
          </button>
        )}
        {showSignerTypeHint && (
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border rounded text-xs text-blue-900 dark:text-blue-200">
            {signerTypeNote}{' '}
            {signerTypeLinkUrl && signerTypeLinkLabel && (
              <a
                href={signerTypeLinkUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2 text-blue-900 dark:text-blue-100"
              >
                {signerTypeLinkLabel}
              </a>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label className={masterWeightLabelClassName}>
          {masterWeightLabel}
          {masterWeightHint && (
            <span className="text-xs text-gray-500">{masterWeightHint}</span>
          )}
          {showMasterWeightInfo && masterWeightTooltip && (
            <span className="text-xs cursor-help" title={masterWeightTooltip}>ⓘ</span>
          )}
        </label>
        <input
          type="number"
          min={0}
          max={255}
          value={masterWeight}
          onChange={(e) => onMasterWeightChange && onMasterWeightChange(e.target.value)}
          onBlur={(e) => onMasterWeightChange && onMasterWeightChange(e.target.value)}
          className={masterWeightInputClassName}
          title={masterWeightHint}
        />
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">{thresholdsLabel}</label>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <span>{thresholdLabels?.low} {thresholdTooltips?.low && <span className="text-xs cursor-help" title={thresholdTooltips.low}>ⓘ</span>}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={thresholdValues?.low ?? 0}
              onChange={(e) => onThresholdChange && onThresholdChange('low', e.target.value)}
              onBlur={(e) => onThresholdChange && onThresholdChange('low', e.target.value)}
              className={`${thresholdInputClassName} ${thresholdErrors?.low ? 'border-red-500' : ''}`}
            />
            <span className="text-xs text-gray-700 dark:text-gray-300">{thresholdUnitsLabel}</span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <span>{thresholdLabels?.med} {thresholdTooltips?.med && <span className="text-xs cursor-help" title={thresholdTooltips.med}>ⓘ</span>}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={thresholdValues?.med ?? 0}
              onChange={(e) => onThresholdChange && onThresholdChange('med', e.target.value)}
              onBlur={(e) => onThresholdChange && onThresholdChange('med', e.target.value)}
              className={`${thresholdInputClassName} ${thresholdErrors?.med ? 'border-red-500' : ''}`}
            />
            <span className="text-xs text-gray-700 dark:text-gray-300">{thresholdUnitsLabel}</span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <span>{thresholdLabels?.high} {thresholdTooltips?.high && <span className="text-xs cursor-help" title={thresholdTooltips.high}>ⓘ</span>}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={thresholdValues?.high ?? 0}
              onChange={(e) => onThresholdChange && onThresholdChange('high', e.target.value)}
              onBlur={(e) => onThresholdChange && onThresholdChange('high', e.target.value)}
              className={`${thresholdInputClassName} ${thresholdErrors?.high ? 'border-red-500' : ''}`}
            />
            <span className="text-xs text-gray-700 dark:text-gray-300">{thresholdUnitsLabel}</span>
          </label>
        </div>
        {showLevelsHint && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {thresholdLevelsHint}
            {thresholdLevelsHint && thresholdSumText ? ' • ' : ''}
            {thresholdSumText}
          </p>
        )}
        {(thresholdErrors?.low || thresholdErrors?.med || thresholdErrors?.high) && (
          <p className="text-xs text-red-600 mt-1">{thresholdTooHighText}</p>
        )}
        {showSafetyErrors && (
          <div className="mt-2 border border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-900/30 rounded p-2">
            <div className="text-xs font-semibold text-red-900 dark:text-red-100">
              {safetyErrorTitle}
            </div>
            <ul className="list-disc ml-4 text-xs text-red-800 dark:text-red-200 mt-1 space-y-1">
              {safetyErrors.map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
        {showSafetyWarnings && (
          <div className="mt-2 border border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 rounded p-2">
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">
              {safetyWarningTitle}
            </div>
            <ul className="list-disc ml-4 text-xs text-amber-800 dark:text-amber-200 mt-1 space-y-1">
              {safetyWarnings.map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
