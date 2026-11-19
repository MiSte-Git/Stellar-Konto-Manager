// Seit wann besteht die Trustline eines Kontos fuer ein Asset? Gesucht wird nur auf Knopfdruck im Verlauf der
// Effekte des Kontos (neueste zuerst) nach dem letzten trustline_created genau dieses Assets. Das ist die
// Anlage der heutigen Trustline, auch wenn sie frueher schon einmal entfernt wurde.
// Hoechstens MAX_PAGES Seiten zu PAGE_SIZE, danach nur "aelter als" (aktive Konten haben sehr viele Effekte).
// Weitere Seiten per cursor ueber den eingestellten Server, nicht ueber den absoluten next-Link von Horizon
// (der umgeht den Dev-Proxy, vgl. assetMarket.js).

export const MAX_PAGES = 10;
export const PAGE_SIZE = 200;

function isNotFound(err) {
  return (err?.response?.status ?? err?.status) === 404;
}

/**
 * Ergebnis:
 * { status: 'found', at } Zeitpunkt der Anlage (created_at von Horizon)
 * { status: 'olderThan', oldest } nach MAX_PAGES Seiten nicht gefunden; aelter als oldest
 * { status: 'notInHistory', oldest } ganzer verfuegbarer Verlauf durchsucht, nicht gefunden (Horizon haelt nicht
 *   den ganzen Verlauf); oldest ist der aelteste gesehene Eintrag oder null
 * Fehler beim Abruf werfen. onProgress(page) nach jeder Seite. isCancelled() bricht ohne Ergebnis ab (null).
 */
export async function findTrustlineSince({ server, account, code, issuer, onProgress, isCancelled = () => false }) {
  let cursor = '';
  let oldest = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let builder = server.effects().forAccount(account).order('desc').limit(PAGE_SIZE);
    if (cursor) builder = builder.cursor(cursor);
    let res;
    try {
      res = await builder.call();
    } catch (err) {
      if (isNotFound(err)) return { status: 'notInHistory', oldest };
      throw err;
    }
    if (isCancelled()) return null;
    const records = Array.isArray(res?.records) ? res.records : [];
    for (const r of records) {
      if (r?.type === 'trustline_created' && r.asset_code === code && r.asset_issuer === issuer) {
        return { status: 'found', at: r.created_at || null };
      }
    }
    if (records.length) oldest = records[records.length - 1]?.created_at || oldest;
    if (onProgress) onProgress(page);
    const nextCursor = records.length ? records[records.length - 1]?.paging_token : '';
    if (records.length < PAGE_SIZE || !nextCursor || nextCursor === cursor) return { status: 'notInHistory', oldest };
    cursor = nextCursor;
  }
  return { status: 'olderThan', oldest };
}
