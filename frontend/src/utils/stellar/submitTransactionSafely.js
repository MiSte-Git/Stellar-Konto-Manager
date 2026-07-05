// Shared helper for submitting a signed transaction to Horizon while handling
// ambiguous network failures (timeout / 5xx) that leave the actual outcome
// unknown - the transaction may have been applied even though the request
// itself failed. Used by SendPaymentPage.jsx and AssetSearch.jsx so both
// treat "we don't know if this went through" the same way instead of letting
// the caller resubmit blindly and risk a duplicate operation.

export function isAmbiguousSubmitError(err) {
  const extras = err?.response?.data?.extras;
  if (extras?.result_codes) return false;
  const status = err?.response?.status;
  return !status || status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function findSubmittedTransaction(server, hash, { attempts = 8, delayMs = 1500 } = {}) {
  if (!hash) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const record = await server.transactions().transaction(hash).call();
      if (record?.hash || record?.id) return record;
    } catch (lookupErr) {
      const status = lookupErr?.response?.status;
      if (status && status !== 404) {
        console.debug?.('transaction confirmation lookup failed', lookupErr);
      }
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

// Thrown instead of the original network error when a submit failed
// ambiguously and the follow-up hash lookup could not confirm either
// outcome. Callers should surface this distinctly (not as a generic
// failure) and block immediate resubmission until the user has checked
// the transaction hash manually.
export class AmbiguousSubmitResultError extends Error {
  constructor(hash, cause) {
    super('submitTransaction.ambiguousResult');
    this.name = 'AmbiguousSubmitResultError';
    this.hash = hash;
    this.cause = cause;
  }
}

export async function submitTransactionSafely(server, tx) {
  const hash = tx.hash().toString('hex');
  try {
    return await server.submitTransaction(tx);
  } catch (err) {
    if (!isAmbiguousSubmitError(err)) throw err;
    const confirmed = await findSubmittedTransaction(server, hash);
    if (confirmed) return confirmed;
    throw new AmbiguousSubmitResultError(hash, err);
  }
}
