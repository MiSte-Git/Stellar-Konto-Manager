// frontend/src/utils/net/retry.js
// Small helpers for retry/backoff and error classification around Horizon calls

/**
 * Sleep for ms milliseconds
 * @param {number} ms
 */
export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Returns true if an HTTP status likely represents a timeout/gateway issue.
 * @param {number|undefined} status
 */
export function isTimeoutStatus(status) {
  return status === 408 || status === 504 || status === 522 || status === 524 || status === 598 || status === 599;
}

/**
 * Rough error classifier for Horizon/network errors
 * @param {any} err
 * @returns {{ type: 'timeout'|'notFound'|'rateLimit'|'network'|'horizon'|'validation'|'unknown', status?: number, detail?: string }}
 */
export function classifyError(err) {
  try {
    const status = err?.response?.status ?? err?.status;
    const code = String(err?.code || '').toLowerCase();
    const msg = String(err?.message || '').toLowerCase();

    if (status === 404) return { type: 'notFound', status };
    if (status === 429) return { type: 'rateLimit', status };
    if (isTimeoutStatus(status) || msg.includes('timeout')) return { type: 'timeout', status };
    if (code.includes('network') || msg.includes('failed to fetch') || msg.includes('networkerror')) return { type: 'network', status };

    // Stellar SDK sometimes embeds details in response.data
    if (err?.response?.data?.extras?.result_codes) return { type: 'horizon', status, detail: JSON.stringify(err.response.data.extras.result_codes) };

    return { type: 'unknown', status };
  } catch {
    return { type: 'unknown' };
  }
}

/**
 * Retry a function with exponential backoff when the error is considered transient (timeout/network/429)
 * @template T
 * @param {()=>Promise<T>} fn
 * @param {{ tries?: number, baseDelay?: number, maxDelay?: number, onRetry?:(info:{ attempt:number, error:any, delay:number })=>void, isRetryable?:(err:any)=>boolean }} [opts]
 * @returns {Promise<T>}
 */
export async function withBackoff(fn, opts = {}) {
  const tries = Math.max(1, opts.tries ?? 3);
  const base = Math.max(50, opts.baseDelay ?? 500);
  const maxDelay = Math.max(base, opts.maxDelay ?? 5000);
  let attempt = 0;
  let lastErr;
  while (attempt < tries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const c = classifyError(err);
      const retryable = opts.isRetryable ? opts.isRetryable(err) : (c.type === 'timeout' || c.type === 'network' || c.type === 'rateLimit');
      if (attempt >= tries - 1 || !retryable) break;
      const delay = Math.min(maxDelay, Math.round(base * Math.pow(2, attempt) * (1 + Math.random() * 0.25)));
      try { opts.onRetry?.({ attempt: attempt + 1, error: err, delay }); } catch { /* noop */ }
      await sleep(delay);
      attempt += 1;
    }
  }
  throw lastErr;
}
