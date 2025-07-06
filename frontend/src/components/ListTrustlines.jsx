// src/components/ListTrustlines.jsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';

function ListTrustlines({ sourcePublicKey, backendUrl, setResults, setError }) {
  const [isLoading, setIsLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    async function fetchTrustlines() {
      setIsLoading(true);
      try {
        const response = await axios.get(`${backendUrl}/trustlines?source=${sourcePublicKey}`);
        setResults(response.data);
        setError(null);
      } catch (err) {
        console.error('Fehler beim Abrufen der Trustlines:', err);
        setError(t('failedLoadAccount', { publicKey: sourcePublicKey, error: err.message }));
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }

    if (sourcePublicKey) {
      fetchTrustlines();
    }
  }, [sourcePublicKey, backendUrl, setResults, setError, t]);

  return (
    <div className="mt-4">
      {isLoading ? (
        <p>{t('loading')}</p>
      ) : (
        <p className="text-green-600">{t('listTrustlines')} {t('completed')}</p>
      )}
    </div>
  );
}

export default ListTrustlines;
