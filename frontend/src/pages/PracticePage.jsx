import React from 'react';
import { useTranslation } from 'react-i18next';
import { buildPath } from '../utils/basePath.js';
import { recordPracticeCheck } from '../utils/learnProgress.js';

function useLessonIdFromPath() {
  const [id, setId] = React.useState(() => {
    try {
      const p = typeof window !== 'undefined' ? window.location.pathname : '';
      const m = p.match(/lesson\/(\d+)/);
      return m ? m[1] : '10';
    } catch { return '10'; }
  });
  React.useEffect(() => {
    const onPop = () => {
      try {
        const p = window.location.pathname;
        const m = p.match(/lesson\/(\d+)/);
        setId(m ? m[1] : '10');
      } catch { /* noop */ }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return id;
}

export default function PracticePage() {
  const { t } = useTranslation();
  const lessonNum = useLessonIdFromPath();
  const [accountId, setAccountId] = React.useState('');
  const [assetCode, setAssetCode] = React.useState('SKM');
  const [assetIssuer, setAssetIssuer] = React.useState('');
  const [memoIncludes, setMemoIncludes] = React.useState('SKM-LEARN');
  const [status, setStatus] = React.useState('');

  const goBack = React.useCallback(() => {
    try {
      const prev = (typeof window !== 'undefined' && window.sessionStorage)
        ? window.sessionStorage.getItem('STM_PREV_PATH')
        : '';
      if (prev) {
        window.history.pushState({}, '', prev);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      const url = buildPath('learn');
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* noop */ }
  }, []);

  const lessonId = `lesson${lessonNum}`;

  const runCheck = async (checkId) => {
    setStatus('');
    try {
      const params = { accountId, assetCode, assetIssuer, memoIncludes };
      const res = await recordPracticeCheck(lessonId, checkId, params, t);
      setStatus(`${res.status}: ${res.detail || ''}`);
    } catch {
      setStatus('error');
    }
  };

  const onlyL10Active = lessonNum !== '10';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-sm font-medium px-3 py-1.5 rounded"
        >
          ← {t('learn:back', 'Back')}
        </button>
        <h1 className="text-2xl font-bold flex-1 text-center">{t('quiz.ui:practice')} · L{lessonNum}</h1>
        <div className="w-[76px]" aria-hidden />
      </div>

      {onlyL10Active ? (
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {t('learn:status.comingSoon', 'Practice for this lesson is coming soon.')}
        </div>
      ) : (
        <div>
          <div className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-300/60 rounded p-2 mb-3">
            {t('learn:status.testnetOnly', 'Use TESTNET only. Never paste real secret keys. We do not store secrets.')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="block mb-1">Public Key (Testnet)</span>
              <input
                className="w-full border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                placeholder="G..."
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1">Asset Code</span>
              <input
                className="w-full border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                placeholder="SKM"
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1">Asset Issuer</span>
              <input
                className="w-full border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                placeholder="G... (Issuer)"
                value={assetIssuer}
                onChange={(e) => setAssetIssuer(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="block mb-1">Memo includes</span>
              <input
                className="w-full border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                placeholder="SKM-LEARN"
                value={memoIncludes}
                onChange={(e) => setMemoIncludes(e.target.value)}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runCheck('accountActivated')}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {t('learn:practice.accountActivated', 'Check: Account activated')}
            </button>
            <button
              type="button"
              onClick={() => runCheck('trustline')}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {t('learn:practice.trustline', 'Check: Trustline present')}
            </button>
            <button
              type="button"
              onClick={() => runCheck('payment')}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {t('learn:practice.payment', 'Check: Payment received')}
            </button>
          </div>

          {status && (
            <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">{status}</div>
          )}
        </div>
      )}
    </div>
  );
}
