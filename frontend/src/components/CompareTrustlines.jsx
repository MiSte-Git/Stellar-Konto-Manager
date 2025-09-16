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
  const { t } = useTranslation();
  // Im Parent (Main)

  const handleCompare = async () => {
    if (!destinationPublicKey || !StrKey.isValidEd25519PublicKey(destinationPublicKey)) {
      setError(t('publicKey.destination.error'));
      return;
    }

    setError('');
    setIsLoading(true);
    try {
      const sourceTrustlines = await loadTrustlines(sourcePublicKey);
      const destTrustlines = await loadTrustlines(destinationPublicKey);
      const duplicates = sourceTrustlines.filter(source =>
        destTrustlines.some(dest =>
          dest.assetCode === source.assetCode && dest.assetIssuer === source.assetIssuer
        )
      );

      if (duplicates.length > 0) {
        setResults(duplicates);
        setConfirmAction(() => async () => {
          if (!sourceSecret || !StrKey.isValidEd25519SecretSeed(sourceSecret)) {
            setError(t('secretKey.invalid'));
            return;
          }

          try {
            // 🔁 Testmodus: Nur simulieren, nichts senden
            const result = {
              messages: ['[Test-Modus] Diese Trustlines würden jetzt gelöscht.']
            };

            // 👉 Wenn du später echtes Löschen aktivieren willst, entferne diese zwei Zeilen und nimm fetch:
            // const response = await fetch(`${backendUrl}/delete-trustlines`, {
            //   method: 'POST',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ secretKey: sourceSecret, trustlines: duplicates })
            // });
            // const result = await response.json();
            // if (!response.ok) throw new Error(result.error || t('error.trustline.unknown'));

            setResults([...result.messages, t('secretKey.cleared')]);
            setTrustlines(await loadTrustlines(sourcePublicKey));
            setSourceSecret('');
            setShowSecretKey(false);
          } catch (err) {
            console.error('Fetch error:', err);
            setError(err.message.includes('Failed to fetch')
              ? `${t('error.connection.backend')} ${backendUrl}`
              : err.message
            );
          }
        });
        setShowConfirm(true);
      } else {
        // Keine Duplikate gefunden: Info-Meldung anzeigen
        setResults([t('trustline.noDuplicates')]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      {/* Menükopf mit Zurück-Button + aktuelle Ansicht */}
      <MenuHeader setMenuSelection={setMenuSelection} menuSelection={menuSelection} />

      <label className="block mb-2">{t('publicKey.destination.input')}:</label>
      <div className="relative">
        <input
          type="text"
          value={destinationPublicKey}
          onChange={(e) => setDestinationPublicKey(e.target.value)}
          className="wallet-input w-full p-2 border rounded pr-8 font-mono text-sm"
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
            title={t('common.clear')}
            aria-label={t('common.clear')}
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
        {isLoading ? t('option.loading') : t('trustline.compare')}
      </button>
    </div>
  );
}

export default CompareTrustlines;
