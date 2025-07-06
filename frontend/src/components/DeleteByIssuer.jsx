// src/components/DeleteByIssuer.jsx
import React from 'react';
import StellarSdk from '@stellar/stellar-sdk';
import { useTranslation } from 'react-i18next';

function DeleteByIssuer({
  issuerAddress,
  setIssuerAddress,
  sourcePublicKey,
  sourceSecret,
  setSourceSecret,
  setShowSecretKey,
  setTrustlines,
  setResults,
  setError,
  setConfirmAction,
  setShowConfirm,
  loadTrustlines,
  backendUrl,
  isLoading,
  setIsLoading,
}) {
  const { t } = useTranslation();

  const handleDelete = async () => {
    if (!issuerAddress || !StellarSdk.StrKey.isValidEd25519PublicKey(issuerAddress)) {
      setError(t('invalidIssuer'));
      return;
    }

    setError('');
    setIsLoading(true);
    try {
      const trustlines = await loadTrustlines(sourcePublicKey);
      const issuerTrustlines = trustlines.filter(t => t.assetIssuer === issuerAddress);

      if (issuerTrustlines.length > 0) {
        setResults(issuerTrustlines);

        setConfirmAction(() => async () => {
          if (!sourceSecret || !StellarSdk.StrKey.isValidEd25519SecretSeed(sourceSecret)) {
            setError(t('invalidSecret'));
            return;
          }

          try {
            /*const response = await fetch(`${backendUrl}/delete-trustlines`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secretKey: sourceSecret, trustlines: issuerTrustlines })
            });
            const result = await response.json(); */

            // Fake-Aufruf zur Vermeidung echter Löschung
            console.log(`[Test-Modus] Fake DELETE an ${backendUrl}/delete-trustlines`);
            console.log('Trustlines:', issuerTrustlines);

            // FAKE-Fetch zum Testen!
            const result = {
              messages: [`[Test-Modus] ${issuerTrustlines.length} Trustlines mit Issuer ${issuerAddress} würden jetzt gelöscht werden.`]
            };
            
            const response = { ok: true };

            if (!response.ok) throw new Error(result.error || t('failedDeleteTrustlines'));

            setResults([...result.messages, t('secretKeyCleared')]);
            setTrustlines(await loadTrustlines(sourcePublicKey));
            setSourceSecret('');
            setShowSecretKey(false);
          } catch (err) {
            console.error('Fetch error:', err);
            setError(t('deleteError'));
          }
        });

        setShowConfirm(true);
      } else {
        setResults([t('noIssuerTrustlinesFound', { issuer: issuerAddress })]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-4">
      <label className="block mb-2">{t('enterIssuer')}</label>
      <input
        type="text"
        value={issuerAddress}
        onChange={(e) => setIssuerAddress(e.target.value)}
        className="w-full p-2 border rounded"
        placeholder="e.g., GA5ZSEJ..."
      />
      <button
        onClick={handleDelete}
        className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        disabled={isLoading}
      >
        {isLoading ? t('loading') : t('delete')}
      </button>
    </div>
  );
}

export default DeleteByIssuer;
