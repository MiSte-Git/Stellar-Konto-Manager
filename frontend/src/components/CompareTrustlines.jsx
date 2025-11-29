import React from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { useTranslation } from 'react-i18next';
import MenuHeader from './MenuHeader';

function CompareTrustlines({
  sourcePublicKey,
  sourceSecret,
  destinationPublicKey,
  setDestinationPublicKey,
  setResults,
  setError,
  setShowSecretKey,
  setSourceSecret,
  setTrustlines,
  setConfirmAction,
  setShowConfirm,
  loadTrustlines,
  backendUrl,
  setMenuSelection,
  menuSelection,
  isLoading,
  setIsLoading
}) {
  const { t } = useTranslation(['publicKey', 'secretKey', 'common', 'trustline']);
  const [destNotFound, setDestNotFound] = React.useState(false);

  const handleCompare = async () => {
    if (!destinationPublicKey || !StrKey.isValidEd25519PublicKey(destinationPublicKey)) {
      setError(t('publicKey:destination.error'));
      setDestNotFound(false);
      return;
    }

    setError('');
    setDestNotFound(false);
    setIsLoading(true);
    try {
      const sourceTrustlines = await loadTrustlines(sourcePublicKey);
      let destTrustlines;
      try {
        destTrustlines = await loadTrustlines(destinationPublicKey);
      } catch (e) {
        const msg = String(e?.message || '');
        if (/nicht gefunden|not found/i.test(msg)) {
          setDestNotFound(true);
          return;
        }
        throw e;
      }
      const duplicates = sourceTrustlines.filter(source =>
        destTrustlines.some(dest =>
          dest.assetCode === source.assetCode && dest.assetIssuer === source.assetIssuer
        )
      );

      if (duplicates.length > 0) {
        setResults(duplicates);
        setConfirmAction(() => async () => {
          if (!sourceSecret || !StrKey.isValidEd25519SecretSeed(sourceSecret)) {
            setError(t('secretKey:invalid'));
            return;
          }

          try {
            const result = {
              messages: ['[Test-Modus] Diese Trustlines würden jetzt gelöscht.']
            };

            setResults([...result.messages, t('secretKey:cleared')]);
            setTrustlines(await loadTrustlines(sourcePublicKey));
            setSourceSecret('');
            setShowSecretKey(false);
          } catch (err) {
            console.error('Fetch error:', err);
            setError(err.message.includes('Failed to fetch')
              ? `${t('common:error.connection.backend')} ${backendUrl}`
              : err.message
            );
          }
        });
        setShowConfirm(true);
      } else {
        setResults([t('trustline:noDuplicates')]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const netLabel = (typeof window !== 'undefined' && window.localStorage?.getItem('STM_NETWORK') === 'TESTNET') ? 'Testnet' : 'Mainnet';

  return (
    <div>
      <MenuHeader setMenuSelection={setMenuSelection} menuSelection={menuSelection} />
      <h2 className="text-center text-xl font-semibold">{t('trustline:compare')}</h2>
      <label className="block mb-2">{t('publicKey:destination.input')}:</label>
      <div className="relative">
        <input
          type="text"
          value={destinationPublicKey}
          onChange={(e) => { setDestinationPublicKey(e.target.value); if (destNotFound) setDestNotFound(false); }}
          className={`wallet-input w-full p-2 border rounded pr-8 font-mono text-sm ${destNotFound ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300'}`}
          placeholder="e.g., GBZVTOY..."
          list="recent-wallets"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          inputMode="text"
        />
        {destinationPublicKey && (
          <button
            type="button"
            onClick={() => setDestinationPublicKey('')}
            title={t('common:common.clear')}
            aria-label={t('common:common.clear')}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-xs flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>
      <button
        onClick={handleCompare}
        className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        disabled={isLoading}
      >
        {isLoading ? t('common:option.loading', 'Loading…') : t('trustline:compare')}
      </button>
      {destNotFound && (
        <div className="text-center text-xs text-red-700 my-2 inline-block border border-red-500 rounded px-2 py-0.5">
          {t('common:error.accountNotFoundInNetwork', { net: netLabel })}
        </div>
      )}
    </div>
  );
}

export default CompareTrustlines;
