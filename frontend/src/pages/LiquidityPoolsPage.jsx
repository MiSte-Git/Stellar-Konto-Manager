import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PoolPositions from '../components/liquidity/PoolPositions.jsx';
import PoolFinder from '../components/liquidity/PoolFinder.jsx';
import usePoolLookup from '../components/liquidity/hooks/usePoolLookup.js';
import { readPoolIdFromSearch } from '../components/liquidity/liquidityNavigation.js';
import { NETWORKS } from '../config/networks.js';

/**
 * Liquidity Pools, Stufe 1 (nur lesend): eigene Positionen und Pool-Suche fuer
 * native Stellar Pools. Kein Signieren, keine Transaktionen.
 *
 * publicKey/notFound/accountLoading kommen aus main.jsx (dieselben Werte wie
 * fuer die AccountGate der anderen Seiten). Nur "Meine Positionen" braucht ein
 * Konto; "Pool finden" funktioniert auch ohne.
 *
 * ?pool=<64 hex> waehlt beim Oeffnen einen Pool vor; ungueltige Werte werden
 * ignoriert.
 */
export default function LiquidityPoolsPage({ publicKey = '', notFound = false, accountLoading = false, network = 'PUBLIC' }) {
  const { t } = useTranslation(['liquidity']);
  const lookup = usePoolLookup(network);
  const [mode, setMode] = useState('pair');
  const [poolIdInput, setPoolIdInput] = useState('');
  const [lastLookupMode, setLastLookupMode] = useState('pair');
  const [firstAsset, setFirstAsset] = useState(null);
  const finderRef = useRef(null);

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
      <PoolPositions
        publicKey={publicKey}
        notFound={notFound}
        accountLoading={accountLoading}
        network={network}
        onShowDetails={handleShowDetails}
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
        />
      </div>
    </div>
  );
}
