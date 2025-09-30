// src/utils/expert/expertUtils.js
// Lightweight client for StellarExpert Explorer API via proxied base (e.g. '/expert/explorer/public')

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function withRetry(fn, { tries = 4, baseDelay = 400 } = {}) {
  let attempt = 0, lastErr;
  while (attempt < tries) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status || 0;
      if (status && status !== 429 && status >= 400 && status < 500) break;
      await sleep(baseDelay * Math.pow(2, attempt));
      attempt++;
    }
  }
  throw lastErr;
}

function buildUrl(base, path, params) {
  const b = (base || '/expert/explorer/public').replace(/\/$/, '');
  const url = b + path;
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v != null && v !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

export async function expertEarliestPaymentAt({ base = '/expert/explorer/public', account }) {
  const url = buildUrl(base, `/payments`, { account, order: 'asc', limit: 1 });
  const res = await withRetry(() => fetch(url, { credentials: 'omit' }));
  if (!res.ok) throw new Error(`expert.earliest.failed:${res.status}`);
  const data = await res.json();
  const recs = data?._embedded?.records || data?.records || [];
  return recs[0]?.created_at || '';
}

export async function fetchGroupfundByMemoExpert({
  account,
  base = '/expert/explorer/public',
  fromISO,
  toISO,
  limitPages = 5000,
  onProgress,
  signal,
}) {
  const memoGroups = new Map(); // memo -> { count, totalXlm, firstTx, firstCreatedAt, destinations: Map(addr->count) }
  const t0 = Date.now();
  let pages = 0;
  let cursor = undefined;
  while (pages < limitPages) {
    if (signal?.aborted) throw new Error('expert.fetch.aborted');
    const url = buildUrl(base, `/payments`, {
      account,
      order: 'desc',
      limit: 200,
      cursor,
    });
    const res = await withRetry(() => fetch(url, { credentials: 'omit' }));
    if (!res.ok) break;
    const data = await res.json();
    const recs = data?._embedded?.records || data?.records || [];
    if (!recs.length) break;

    for (const rec of recs) {
      if (toISO && rec.created_at && rec.created_at >= toISO) continue; // upper bound exclusive
      const type = String(rec.type || '');
      const fromAddr = rec.from || (type === 'create_account' ? rec.funder : null);
      if (fromAddr !== account) continue; // outgoing only
      const isNative = rec.asset_type === 'native' || type === 'create_account';
      if (!isNative) continue;
      // Try joined memo or fetch tx lazily
      let memo = (rec?.transaction?.memo != null ? String(rec.transaction.memo) : '').trim();
      if (!memo && rec.transaction_hash) {
        try {
          const txUrl = buildUrl(base, `/transactions/${rec.transaction_hash}`, {});
          const txRes = await withRetry(() => fetch(txUrl, { credentials: 'omit' }));
          if (txRes.ok) {
            const tx = await txRes.json();
            memo = (tx?.memo != null ? String(tx.memo) : '').trim();
          }
        } catch { /* ignore */ }
      }
      if (!memo) continue;
      const amountXlm = parseFloat(type === 'create_account' ? (rec.starting_balance || '0') : (rec.amount || '0')) || 0;
      const createdAt = rec.created_at || null;
      let destAddr = null;
      if (type === 'create_account') destAddr = rec.account || null; else destAddr = rec.to || rec.to_muxed || null;

      const g = memoGroups.get(memo);
      if (!g) {
        const dests = new Map();
        if (destAddr) dests.set(destAddr, 1);
        memoGroups.set(memo, { count: 1, totalXlm: amountXlm, firstTx: rec.transaction_hash || '', firstCreatedAt: createdAt, destinations: dests });
      } else {
        g.count += 1; g.totalXlm += amountXlm; if (destAddr) g.destinations.set(destAddr, (g.destinations.get(destAddr) || 0) + 1);
      }
    }

    pages += 1;
    const oldestOnPage = recs[recs.length - 1]?.created_at || '';
    onProgress?.({ phase: 'scan_payments', page: pages, elapsedMs: Date.now() - t0, oldestOnPage, source: 'expert' });
    if (fromISO && oldestOnPage && oldestOnPage < fromISO) break;

    // next cursor from last record or from link
    cursor = recs[recs.length - 1]?.paging_token || (data?._links?.next?.href ? new URL(data._links.next.href).searchParams.get('cursor') : undefined);
    if (!cursor) break;
  }

  const items = [...memoGroups.entries()].map(([memo, v]) => {
    const destArr = v.destinations ? [...v.destinations.entries()] : [];
    destArr.sort((a, b) => b[1] - a[1]);
    return {
      type: 'memo',
      group: memo,
      occurrences: v.count,
      totalAmount: v.totalXlm,
      asset: 'XLM',
      sample: { tx: v.firstTx, created_at: v.firstCreatedAt || null },
      uniqueDestinations: destArr.length,
      topDestination: destArr[0] ? destArr[0][0] : null,
      destinations: destArr.map(([addr, cnt]) => ({ address: addr, count: cnt })),
    };
  });

  return { mode: 'groupfundByMemo.expert', totalGroups: items.length, items };
}
