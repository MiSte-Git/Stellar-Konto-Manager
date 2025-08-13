import React from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { useTranslation } from 'react-i18next';

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
  isLoading,
  setIsLoading
}) {
  const { t } = useTranslation();

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
            setError(t('secretKey.error'));
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
            // if (!response.ok) throw new Error(result.error || t('trustline.delete.error'));

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
      <label className="block mb-2">{t('publicKey.destination.input')}:</label>
      <input
        type="text"
        value={destinationPublicKey}
        onChange={(e) => setDestinationPublicKey(e.target.value)}
        className="w-full p-2 border rounded"
        placeholder="e.g., GBZVTOY..."
      />
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
