// Nur fuer Tests: ersetzt Horizon.Server#loadAccount im gestarteten server.js, damit die
// Live-Pruefung der Signer offline laeuft. Wird per `node --require` vor server.js geladen,
// nie im Produktionscode. Pendant in PHP: vorbelegter data/signers_cache_v2.json.
//
// SKM_TEST_HORIZON_ACCOUNTS zeigt auf eine JSON-Datei { "<accountId>": { signers:
// [{ key, weight }], thresholds: { low_threshold, med_threshold, high_threshold }, sequence } }.
// Ein Eintrag "*" gilt fuer jedes sonst unbekannte Konto (Signer: das Konto selbst, Gewicht 1).
// Die Datei wird bei jedem Aufruf neu gelesen, ein Test kann Signer also waehrend des Laufs
// entfernen. Fehlt das Konto, wirft loadAccount wie Horizon bei einem Fehler (ohne HTTP-Status,
// also "Horizon nicht erreichbar"). Ein Eintrag { "notFound": true } wirft wie Horizon bei einem
// unbekannten Konto (NotFoundError, Status 404), { "hang": true } antwortet nie (Timeout-Test).
const fs = require('fs');
const StellarSdk = require('@stellar/stellar-sdk');

const file = process.env.SKM_TEST_HORIZON_ACCOUNTS;
if (!file) throw new Error('horizonAccountsMock: SKM_TEST_HORIZON_ACCOUNTS fehlt');

StellarSdk.Horizon.Server.prototype.loadAccount = async function loadAccount(accountId) {
  const accounts = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Eintrag "*": jedes sonst unbekannte Konto existiert, mit sich selbst als einzigem Signer (Gewicht 1)
  // und den Schwellen/der Sequenz aus "*" (fuer Tests mit zufaelligen Konten, F-8).
  const acc = accounts[accountId]
    ?? (accounts['*'] ? { ...accounts['*'], signers: [{ key: accountId, weight: 1 }] } : undefined);
  if (!acc) throw new Error('horizon_mock_not_found');
  if (acc.hang) return new Promise(() => {});
  if (acc.notFound) {
    throw Object.assign(new Error('Not Found'), { name: 'NotFoundError', response: { status: 404 } });
  }
  return {
    id: accountId,
    signers: acc.signers || [],
    thresholds: acc.thresholds || { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    sequenceNumber: () => String(acc.sequence ?? '0'),
  };
};

// Optional: SKM_TEST_SUBMIT_HASH ersetzt Horizon.Server#submitTransaction durch eine erfolgreiche
// Antwort mit diesem Hash (Test "Speichern scheitert nach dem Senden", B3-1). Ohne die Variable
// bleibt das SDK unveraendert.
if (process.env.SKM_TEST_SUBMIT_HASH) {
  StellarSdk.Horizon.Server.prototype.submitTransaction = async function submitTransaction() {
    return { hash: process.env.SKM_TEST_SUBMIT_HASH, ledger: 1, envelope_xdr: 'MOCK_ENVELOPE_XDR', result_xdr: 'MOCK_RESULT_XDR' };
  };
}

// Optional: SKM_TEST_SUBMIT_REJECT ersetzt submitTransaction durch eine Ablehnung wie Horizon (400
// mit extras samt envelope_xdr und result_xdr, F-3). Der Wert ist der Transaktions-Code.
if (process.env.SKM_TEST_SUBMIT_REJECT) {
  StellarSdk.Horizon.Server.prototype.submitTransaction = async function submitTransaction() {
    const data = {
      type: 'https://stellar.org/horizon-errors/transaction_failed',
      title: 'Transaction Failed',
      status: 400,
      detail: 'The transaction failed when submitted to the stellar network.',
      extras: {
        envelope_xdr: 'MOCK_ENVELOPE_XDR',
        result_xdr: 'MOCK_RESULT_XDR',
        result_codes: { transaction: process.env.SKM_TEST_SUBMIT_REJECT },
      },
    };
    throw Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data } });
  };
}
