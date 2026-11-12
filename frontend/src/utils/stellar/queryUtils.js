// SKM_VER:queryUtils.js@2025-09-10
// Gemeinsame Helfer fuer Horizon-Scans: Memo-Normierung und Retry.
// Sichtbare Vergleichsnormierung: entferne unsichtbare Zeichen + trim, Case bleibt erhalten
// Built from numeric code points (not a regex literal) to strip zero-width
// chars (ZWSP/ZWNJ/ZWJ/BOM) from memo comparisons.
// eslint-disable-next-line no-misleading-character-class -- see above, false positive on a dynamically-built pattern
const ZERO_WIDTH_RE = new RegExp('[' + String.fromCharCode(0x200b, 0x200c, 0x200d, 0xfeff) + ']', 'g');
export const cleanMemo = (s) => String(s ?? '').replace(ZERO_WIDTH_RE, '').trim();

// Retry-Helfer gegen temporäre Horizon-Fehler (z. B. 500, 429), genutzt von den Horizon-Scans
// (Transaktionen durchsuchen, Export, Groupfund).
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
export async function withRetry(fn, { tries = 4, baseDelay = 400, signal } = {}) {
  let attempt = 0, lastErr;
  while (attempt < tries) {
    if (signal?.aborted) throw Object.assign(new Error('withRetry.aborted'), { isAborted: true });
    try { return await fn(); } catch (e) {
      lastErr = e;
      const status = e?.response?.status || e?.status || 0;
      if (status && status !== 429 && status >= 400 && status < 500) break;
      await sleep(baseDelay * Math.pow(2, attempt));
      attempt++;
    }
  }
  throw lastErr;
}
