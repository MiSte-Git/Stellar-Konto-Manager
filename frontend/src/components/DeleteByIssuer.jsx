// src/components/DeleteByIssuer.jsx
import React, { useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
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
  const [localError, setLocalError] = useState('');

  const handleDelete = async () => {
    if (!issuerAddress || !StrKey.isValidEd25519PublicKey(issuerAddress)) {
      setLocalError(t('issuer.invalid', 'Invalid issuer address.'));
      return;
    }

    setLocalError('');
    setError('');
    setIsLoading(true);
    try {
      const trustlines = await loadTrustlines(sourcePublicKey);
      const issuerTrustlines = trustlines.filter(tl => tl.assetIssuer === issuerAddress);

      if (issuerTrustlines.length > 0) {
        setResults(issuerTrustlines);

        setConfirmAction(() => async () => {
          if (!sourceSecret || !StrKey.isValidEd25519SecretSeed(sourceSecret)) {
            setError(t('secretKey.invalid', 'Invalid secret key.'));
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

            if (!response.ok) throw new Error(result.error || t('error.trustline.unknown', 'Unknown error when deleting the trustline.'));

            setResults([...result.messages, t('secretKey.cleared', 'Secret key has been deleted.')]);
            setTrustlines(await loadTrustlines(sourcePublicKey));
            setSourceSecret('');
            setShowSecretKey(false);
          } catch (err) {
            console.error('Fetch error:', err);
            setError(t('error.trustline.unknown', 'Unknown error when deleting the trustline.'));
          }
        });

        setShowConfirm(true);
      } else {
        setResults([t('noIssuerTrustlinesFound', { issuer: issuerAddress, defaultValue: 'No trustlines found for issuer {{issuer}}.' })]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-4">
      <label className="block mb-2">{t('issuer.enter')}</label>
      <input
        type="text"
        value={issuerAddress}
        onChange={(e) => { setIssuerAddress(e.target.value); if (localError) setLocalError(''); }}
        className={`w-full p-2 border rounded ${localError ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300'}`}
        placeholder="e.g., GA5ZSEJ..."
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={handleDelete}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? t('option.loading', 'Loading…') : t('option.delete')}
        </button>
        {localError && (
          <span className="text-xs text-red-700 inline-block border border-red-500 rounded px-2 py-0.5">
            {localError}
          </span>
        )}
      </div>
    </div>
  );
}

export default DeleteByIssuer;
