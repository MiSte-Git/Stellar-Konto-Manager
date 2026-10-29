import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PoolPositions from '../components/liquidity/PoolPositions.jsx';
import PoolFinder from '../components/liquidity/PoolFinder.jsx';
import DepositDialog from '../components/liquidity/DepositDialog.jsx';
import WithdrawDialog from '../components/liquidity/WithdrawDialog.jsx';
import { NOTE_ERROR, NOTE_NEUTRAL, NOTE_WARN } from '../components/liquidity/LiquidityDialogShell.jsx';
import usePoolLookup from '../components/liquidity/hooks/usePoolLookup.js';
import { readPoolIdFromSearch } from '../components/liquidity/liquidityNavigation.js';
import { NETWORKS } from '../config/networks.js';
import { shortenKey } from '../components/trading/assetSearchUtils.js';

/**
 * Liquidity Pools: eigene Positionen und Pool-Suche fuer native Stellar Pools,
 * Einzahlen und Abheben direkt signiert (Stufe 2a, keine Multisig-Jobs).
 *
 * publicKey/notFound/accountLoading kommen aus main.jsx (dieselben Werte wie
 * fuer die AccountGate der anderen Seiten). Nur "Meine Positionen" braucht ein
 * Konto; "Pool finden" funktioniert auch ohne.
 *
 * ?pool=<64 hex> waehlt beim Oeffnen einen Pool vor; ungueltige Werte werden
 * ignoriert.
 *
 * Wird ein Dialog waehrend eines laufenden Submits abgebaut (Konto-/Netzwechsel),
 * meldet er das Ergebnis ueber onBackgroundResult; die Seite zeigt es als Hinweis.
 */
export default function LiquidityPoolsPage({ publicKey = '', notFound = false, accountLoading = false, network = 'PUBLIC' }) {
  const { t } = useTranslation(['liquidity']);
  const lookup = usePoolLookup(network);
  const [mode, setMode] = useState('pair');
  const [poolIdInput, setPoolIdInput] = useState('');
  const [lastLookupMode, setLastLookupMode] = useState('pair');
  const [firstAsset, setFirstAsset] = useState(null);
  const finderRef = useRef(null);
  // Offener Einzahlen-/Abheben-Dialog: { type: 'deposit'|'withdraw', poolId, firstAsset }
  const [dialog, setDialog] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  // Ergebnis eines Submits, dessen Dialog schon abgebaut war: { type, hash?, message?, network, publicKey }
  const [backgroundResult, setBackgroundResult] = useState(null);
  const hasAccount = !!publicKey && !notFound && !accountLoading;

  // Konto- oder Netzwechsel: offenen Dialog schliessen (laufende Schritte verwirft der Dialog beim Unmount).
  useEffect(() => {
    setDialog(null);
  }, [publicKey, network]);

  const { lookupById, lookupByAssets } = lookup;

  const showPoolById = useCallback((poolId) => {
    setMode('id');
    setPoolIdInput(poolId);
    setLastLookupMode('id');
    setFirstAsset(null);
    lookupById(poolId);
  }, [lookupById]);

  // Query-Param nur beim Oeffnen bzw. bei Vor/Zurueck auswerten, nicht bei
  // jedem Netzwechsel (der setzt die Suche zurueck). Andere popstate-Ereignisse
  // mit unveraendertem ?pool= ueberschreiben eine laufende Suche nicht.
  const showPoolByIdRef = useRef(showPoolById);
  showPoolByIdRef.current = showPoolById;
  useEffect(() => {
    let lastApplied = '';
    const applyFromUrl = () => {
      const id = readPoolIdFromSearch();
      if (id && id !== lastApplied) showPoolByIdRef.current(id);
      lastApplied = id;
    };
    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => window.removeEventListener('popstate', applyFromUrl);
  }, []);

  const handleDone = (poolId) => {
    setRefreshToken((v) => v + 1);
    if (lookup.pool?.poolId === poolId) lookupById(poolId);
  };

  // Nur die Positionen neu laden: Netz oder Konto koennen inzwischen gewechselt
  // haben, eine Pool-Suche liefe dann im falschen Netz.
  const handleBackgroundResult = (res) => {
    setBackgroundResult(res);
    setRefreshToken((v) => v + 1);
  };

  const handleShowDetails = (poolId) => {
    showPoolById(poolId);
    try { finderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* noop */ }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4 text-left">
      <div>
        <h1 className="text-2xl font-bold text-center">{t('liquidity:page.title')}</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{t('liquidity:page.intro')}</p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          {t('liquidity:page.network')}: {NETWORKS[network]?.label || network}
        </p>
      </div>
      {backgroundResult && <BackgroundResultNote result={backgroundResult} onDismiss={() => setBackgroundResult(null)} />}
      <PoolPositions
        publicKey={publicKey}
        notFound={notFound}
        accountLoading={accountLoading}
        network={network}
        onShowDetails={handleShowDetails}
        onWithdraw={(poolId) => setDialog({ type: 'withdraw', poolId })}
        refreshToken={refreshToken}
      />
      <div ref={finderRef}>
        <PoolFinder
          network={network}
          lookup={lookup}
          mode={mode}
          onModeChange={setMode}
          poolIdInput={poolIdInput}
          onPoolIdInputChange={setPoolIdInput}
          onLookupId={() => {
            setLastLookupMode('id');
            setFirstAsset(null);
            lookupById(poolIdInput);
          }}
          onLookupPair={(a, b) => {
            setLastLookupMode('pair');
            setFirstAsset(a);
            lookupByAssets(a, b);
          }}
          lastLookupMode={lastLookupMode}
          firstAsset={firstAsset}
          hasAccount={hasAccount}
          onDeposit={(pool, first) => setDialog({ type: 'deposit', poolId: pool.poolId, firstAsset: first })}
        />
      </div>
      {dialog?.type === 'deposit' && hasAccount && (
        <DepositDialog
          poolId={dialog.poolId}
          firstAsset={dialog.firstAsset}
          publicKey={publicKey}
          network={network}
          onClose={() => setDialog(null)}
          onDone={() => handleDone(dialog.poolId)}
          onBackgroundResult={handleBackgroundResult}
        />
      )}
      {dialog?.type === 'withdraw' && hasAccount && (
        <WithdrawDialog
          poolId={dialog.poolId}
          publicKey={publicKey}
          network={network}
          onClose={() => setDialog(null)}
          onDone={() => handleDone(dialog.poolId)}
          onBackgroundResult={handleBackgroundResult}
        />
      )}
    </div>
  );
}

function BackgroundResultNote({ result, onDismiss }) {
  const { t } = useTranslation(['liquidity']);
  let className = NOTE_NEUTRAL;
  let content;
  if (result.type === 'ambiguous') {
    className = NOTE_WARN;
    content = (
      <>
        <div className="font-semibold">{t('liquidity:dialog.ambiguousTitle')}</div>
        <div>{t('liquidity:dialog.ambiguousBody')}</div>
      </>
    );
  } else if (result.type === 'error') {
    className = NOTE_ERROR;
    content = <div>{t('liquidity:background.failed')} {result.message}</div>;
  } else {
    content = <div className="font-semibold">{t('liquidity:background.success')}</div>;
  }
  return (
    <div className={className} role={result.type === 'success' ? 'status' : 'alert'} data-testid="liquidity-background-result">
      {content}
      {result.hash && <div className="mt-1 break-all font-mono">{result.hash}</div>}
      <div className="mt-1">
        {t('liquidity:background.context', { network: NETWORKS[result.network]?.label || result.network, account: shortenKey(result.publicKey) })}
      </div>
      <button type="button" className="mt-2 text-xs underline" onClick={onDismiss}>{t('liquidity:background.dismiss')}</button>
    </div>
  );
}
