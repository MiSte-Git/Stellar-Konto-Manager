import React from 'react';
import StellarSdk from '@stellar/stellar-sdk';
import { useTranslation } from 'react-i18next';

function DeleteAllTrustlines({
  sourcePublicKey,
  sourceSecret,
  setSourceSecret,
  setShowSecretKey,
  setTrustlines,
  setResults,
  setError,
  backendUrl,
  setShowConfirm,
  setConfirmAction,
  loadTrustlines,
  setIsLoading
}) {
  const { t } = useTranslation();

  const handleDelete = async () => {
    setError('');
    setIsLoading(true);
    try {
      const trustlines = await loadTrustlines(sourcePublicKey);
      if (trustlines.length > 0) {
        setResults(trustlines);
        setConfirmAction(() => async () => {
          if (!sourceSecret || !StellarSdk.StrKey.isValidEd25519SecretSeed(sourceSecret)) {
            setError(t('secretKeyInvalid'));
            return;
          }
          try {
            /*const response = await fetch(`${backendUrl}/delete-trustlines`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secretKey: sourceSecret, trustlines }),
            });*/
            // Fake response statt echtem Lösch-Request
            const result = {
            messages: ['[Test-Modus] Trustlines würden jetzt gelöscht werden.']
            };
            /*const result = await response.json();
            if (!response.ok) throw new Error(result.error || t('failedDeleteTrustlines'));*/
            setResults([...result.messages, t('secretKeyCleared')]);
            setTrustlines([]);
            setSourceSecret('');
            setShowSecretKey(false);
          } catch (err) {
            console.error('Fetch error:', err);
            setError(err.message.includes('Failed to fetch')
              ? `${t('backendConnectError', { url: backendUrl })}`
              : err.message);
          }
        });
        setShowConfirm(true);
      } else {
        setResults([t('noTrustlines')]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleDelete}
        className="mt-2 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
      >
        {t('deleteAllButton')}
      </button>
    </div>
  );
}

export default DeleteAllTrustlines;
